
-- Roles enum + table
create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "roles readable by authenticated" on public.user_roles for select to authenticated using (true);

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Match stage enum
create type public.match_stage as enum ('group','round_of_32','round_of_16','quarter_final','semi_final','third_place','final');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  home_team text not null,
  away_team text not null,
  home_flag text,
  away_flag text,
  kickoff_at timestamptz not null,
  stadium text,
  stage match_stage not null default 'group',
  home_score int,
  away_score int,
  is_finished boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matches_kickoff_idx on public.matches(kickoff_at);
grant select on public.matches to authenticated;
grant all on public.matches to service_role;
alter table public.matches enable row level security;
create policy "matches readable by authenticated" on public.matches for select to authenticated using (true);
create policy "admins manage matches" on public.matches for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Daily lock helper: first kickoff of the (UTC) day of given match
create or replace function public.day_lock_time(_match_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(m2.kickoff_at) from public.matches m1
  join public.matches m2 on date_trunc('day', m2.kickoff_at) = date_trunc('day', m1.kickoff_at)
  where m1.id = _match_id
$$;

create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  home_score int not null check (home_score >= 0),
  away_score int not null check (away_score >= 0),
  points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, match_id)
);
create index predictions_user_idx on public.predictions(user_id);
create index predictions_match_idx on public.predictions(match_id);
grant select, insert, update, delete on public.predictions to authenticated;
grant all on public.predictions to service_role;
alter table public.predictions enable row level security;
create policy "predictions readable by authenticated" on public.predictions for select to authenticated using (true);
create policy "users insert own predictions" on public.predictions for insert to authenticated with check (auth.uid() = user_id);
create policy "users update own predictions" on public.predictions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.prediction_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  match_id uuid not null,
  home_score int not null,
  away_score int not null,
  created_at timestamptz not null default now()
);
create index prediction_logs_user_match_idx on public.prediction_logs(user_id, match_id);
grant select, insert on public.prediction_logs to authenticated;
grant all on public.prediction_logs to service_role;
alter table public.prediction_logs enable row level security;
create policy "logs readable by authenticated" on public.prediction_logs for select to authenticated using (true);
create policy "users insert own logs" on public.prediction_logs for insert to authenticated with check (auth.uid() = user_id);

-- Enforce lock + match-must-be-today and append log
create or replace function public.predictions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare lock_ts timestamptz; m_kickoff timestamptz;
begin
  select kickoff_at into m_kickoff from public.matches where id = new.match_id;
  if m_kickoff is null then raise exception 'Match not found'; end if;
  -- Only today's matches (UTC)
  if date_trunc('day', m_kickoff) <> date_trunc('day', now()) then
    raise exception 'You can only predict matches happening today';
  end if;
  lock_ts := public.day_lock_time(new.match_id);
  if lock_ts is not null and now() >= lock_ts then
    raise exception 'Predictions for today are locked';
  end if;
  new.updated_at := now();
  insert into public.prediction_logs(user_id, match_id, home_score, away_score)
    values (new.user_id, new.match_id, new.home_score, new.away_score);
  return new;
end $$;

create trigger predictions_guard_ins before insert on public.predictions
for each row execute function public.predictions_guard();
create trigger predictions_guard_upd before update on public.predictions
for each row execute function public.predictions_guard();

-- Scoring function: 100 outcome, +100 exact
create or replace function public.score_prediction(p_home int, p_away int, a_home int, a_away int)
returns int language sql immutable as $$
  select case
    when a_home is null or a_away is null then 0
    when p_home = a_home and p_away = a_away then 200
    when sign(p_home - p_away) = sign(a_home - a_away) then 100
    else 0
  end
$$;

-- Recompute points when match finishes / score changes
create or replace function public.recompute_match_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_score is not null and new.away_score is not null then
    update public.predictions
      set points = public.score_prediction(home_score, away_score, new.home_score, new.away_score)
      where match_id = new.id;
  end if;
  return new;
end $$;
create trigger matches_recompute_points after update of home_score, away_score, is_finished on public.matches
for each row execute function public.recompute_match_points();

-- Auto-create profile on signup, plus first user becomes admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare user_count int;
begin
  insert into public.profiles(id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  select count(*) into user_count from public.user_roles;
  if user_count = 0 then
    insert into public.user_roles(user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles(user_id, role) values (new.id, 'user');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Leaderboard view
create or replace view public.leaderboard as
select
  p.id as user_id,
  p.display_name,
  p.avatar_url,
  coalesce(sum(pr.points),0)::int as total_points,
  count(*) filter (where pr.points = 200)::int as exact_scores,
  count(*) filter (where pr.points >= 100)::int as correct_outcomes
from public.profiles p
left join public.predictions pr on pr.user_id = p.id
left join public.matches m on m.id = pr.match_id and m.is_finished = true
group by p.id, p.display_name, p.avatar_url;
grant select on public.leaderboard to authenticated;

-- Realtime
alter publication supabase_realtime add table public.predictions;
alter publication supabase_realtime add table public.matches;
