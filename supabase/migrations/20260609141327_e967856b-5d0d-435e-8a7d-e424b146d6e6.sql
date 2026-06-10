
-- Recreate leaderboard view with security_invoker so RLS applies as caller
drop view if exists public.leaderboard;
create view public.leaderboard with (security_invoker = true) as
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

-- Lock down execute on internal trigger/helper functions
revoke execute on function public.day_lock_time(uuid) from public, anon, authenticated;
revoke execute on function public.predictions_guard() from public, anon, authenticated;
revoke execute on function public.recompute_match_points() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.score_prediction(int,int,int,int) from public, anon;

-- has_role stays callable by authenticated users (used by RLS policies)
grant execute on function public.has_role(uuid, app_role) to authenticated;
