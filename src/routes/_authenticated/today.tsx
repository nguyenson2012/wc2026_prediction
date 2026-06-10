import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stageLabel, formatCountdown, timeStr, isSameUtcDay, calcPoints } from "@/lib/match-utils";
import { Lock, CheckCircle2, Calendar, List } from "lucide-react";

export const Route = createFileRoute("/_authenticated/today")({
  ssr: false,
  component: TodayPage,
});

type Match = {
  id: string; home_team: string; away_team: string;
  home_flag: string | null; away_flag: string | null;
  kickoff_at: string; stadium: string | null; stage: string;
  home_score: number | null; away_score: number | null; is_finished: boolean;
};

type Prediction = { match_id: string; home_score: number; away_score: number; points: number };

function TodayPage() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<"today" | "schedule">("today");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: allMatches = [], isLoading: isLoadingMatches } = useQuery<Match[]>({
    queryKey: ["all-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Match[];
    },
  });

  const { data: predictions = [] } = useQuery<Prediction[]>({
    queryKey: ["my-predictions"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase.from("predictions").select("match_id,home_score,away_score,points").eq("user_id", u.user.id);
      return (data ?? []) as Prediction[];
    },
  });

  // Filter today's matches
  const todayMatches = useMemo(() => {
    return allMatches.filter((m) => isSameUtcDay(new Date(m.kickoff_at), now));
  }, [allMatches, now]);

  // Find next match day if there is no match today
  const nextMatchDayInfo = useMemo(() => {
    if (todayMatches.length > 0) return null;
    const nextMatch = allMatches.find(m => new Date(m.kickoff_at) > now && !isSameUtcDay(new Date(m.kickoff_at), now));
    if (!nextMatch) return null;
    const date = new Date(nextMatch.kickoff_at);
    const dateStr = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const matches = allMatches.filter(m => isSameUtcDay(new Date(m.kickoff_at), date));
    return { dateStr, matches, date };
  }, [allMatches, todayMatches, now]);

  const matches = todayMatches;

  useEffect(() => {
    const ch = supabase
      .channel("matches-today")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => {
        qc.invalidateQueries({ queryKey: ["all-matches"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["my-predictions"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const lockTime = useMemo(() => {
    if (matches.length === 0) return null;
    return new Date(Math.min(...matches.map((m) => new Date(m.kickoff_at).getTime())));
  }, [matches]);

  const locked = lockTime ? now >= lockTime : false;
  const msLeft = lockTime ? lockTime.getTime() - now.getTime() : 0;

  const predMap = useMemo(() => new Map(predictions.map((p) => [p.match_id, p])), [predictions]);

  const [drafts, setDrafts] = useState<Record<string, { h: string; a: string }>>({});
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("wc-drafts") : null;
    if (saved) {
      try { setDrafts(JSON.parse(saved)); } catch { /* */ }
    }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("wc-drafts", JSON.stringify(drafts));
  }, [drafts]);

  function getInput(matchId: string, side: "h" | "a"): string {
    const draft = drafts[matchId];
    if (draft && draft[side] !== undefined) return draft[side];
    const p = predMap.get(matchId);
    if (p) return side === "h" ? String(p.home_score) : String(p.away_score);
    return "";
  }

  function setInput(matchId: string, side: "h" | "a", val: string) {
    setDrafts((d) => ({ ...d, [matchId]: { ...(d[matchId] ?? { h: "", a: "" }), [side]: val.replace(/[^0-9]/g, "").slice(0, 2) } }));
  }

  const submit = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const rows = matches
        .filter((m) => !m.is_finished)
        .map((m) => {
          const h = parseInt(getInput(m.id, "h"));
          const a = parseInt(getInput(m.id, "a"));
          if (Number.isNaN(h) || Number.isNaN(a)) return null;
          return { user_id: u.user!.id, match_id: m.id, home_score: h, away_score: a };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length === 0) throw new Error("Enter at least one prediction");
      const { error } = await supabase.from("predictions").upsert(rows, { onConflict: "user_id,match_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Predictions saved!");
      setDrafts({});
      localStorage.removeItem("wc-drafts");
      qc.invalidateQueries({ queryKey: ["my-predictions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupedMatches = useMemo(() => {
    const groups: Record<string, Match[]> = {};
    allMatches.forEach((m) => {
      const date = new Date(m.kickoff_at);
      const dateStr = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(m);
    });
    return Object.entries(groups);
  }, [allMatches]);

  if (isLoadingMatches) {
    return (
      <div className="flex min-h-[400px] items-center justify-center bg-pitch-dark">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="size-2 animate-pulse rounded-full bg-grass" />
          <span className="text-sm font-medium uppercase tracking-widest">Loading matches…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
      <section className="lg:col-span-7 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white">World Cup 2026</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          {activeTab === "today" && lockTime && (
            <div className={`px-4 py-2 rounded-xl text-right border ${locked ? "bg-muted/20 border-border" : "bg-rose-500/10 border-rose-500/20"} self-start sm:self-auto`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${locked ? "text-muted-foreground" : "text-rose-400"}`}>
                {locked ? "Locked" : "Locking in"}
              </p>
              <p className={`text-lg font-black tabular-nums ${locked ? "text-muted-foreground" : "text-rose-500"}`}>
                {locked ? "—" : formatCountdown(msLeft)}
              </p>
            </div>
          )}
        </header>

        {/* Tab navigation */}
        <div className="flex border-b border-white/10 pb-px gap-6">
          <button
            onClick={() => setActiveTab("today")}
            className={`pb-3 text-sm font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === "today"
                ? "border-grass text-white"
                : "border-transparent text-muted-foreground hover:text-white"
            }`}
          >
            <Calendar className="size-4" />
            Today's Predictions ({todayMatches.length})
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`pb-3 text-sm font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === "schedule"
                ? "border-grass text-white"
                : "border-transparent text-muted-foreground hover:text-white"
            }`}
          >
            <List className="size-4" />
            Full Schedule ({allMatches.length})
          </button>
        </div>

        {activeTab === "today" ? (
          matches.length === 0 ? (
            <div className="space-y-6">
              {/* No Match Today Card */}
              <div className="rounded-2xl bg-pitch-surface border border-border p-10 text-center">
                <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto mb-4 text-xl">⚽</div>
                <h3 className="text-lg font-bold text-white">No Matches Today</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Enjoy the break! Predictions will open on the next match day.
                </p>
              </div>

              {/* Next Match Day Schedule */}
              {nextMatchDayInfo && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <span className="size-2 rounded-full bg-indigo-500 animate-pulse" />
                    <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">
                      Up Next: {nextMatchDayInfo.dateStr}
                    </h3>
                  </div>
                  <div className="space-y-4">
                    {nextMatchDayInfo.matches.map((m) => {
                      const p = predMap.get(m.id);
                      return (
                        <div key={m.id} className="bg-pitch-surface rounded-2xl border border-border overflow-hidden opacity-90">
                          <div className="bg-white/5 px-4 py-2 flex justify-between items-center">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              {stageLabel(m.stage)} • {timeStr(new Date(m.kickoff_at))} {m.stadium ? `• ${m.stadium}` : ""}
                            </span>
                            <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 uppercase tracking-wider">
                              Upcoming
                            </span>
                          </div>
                          <div className="p-5 md:p-6 flex items-center justify-between gap-3">
                            <TeamSide name={m.home_team} flag={m.home_flag} />
                            <div className="flex items-center gap-3">
                              <div className="w-14 h-14 bg-pitch-dark/50 border border-border/50 rounded-xl grid place-items-center text-xl font-black text-muted-foreground/60 select-none">
                                -
                              </div>
                              <span className="text-muted-foreground font-black text-xl">-</span>
                              <div className="w-14 h-14 bg-pitch-dark/50 border border-border/50 rounded-xl grid place-items-center text-xl font-black text-muted-foreground/60 select-none">
                                -
                              </div>
                            </div>
                            <TeamSide name={m.away_team} flag={m.away_flag} />
                          </div>
                          <div className="px-5 pb-4 flex items-center justify-between text-xs border-t border-white/5 pt-3">
                            <span className="text-muted-foreground">
                              {p ? (
                                <>Your predicted score: <span className="text-white font-bold">{p.home_score} - {p.away_score}</span></>
                              ) : (
                                "Predictions will open on the match day."
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {matches.map((m) => {
                  const p = predMap.get(m.id);
                  const isFinished = m.is_finished && m.home_score !== null && m.away_score !== null;
                  const matchLocked = locked || isFinished;
                  const points = p && isFinished ? calcPoints(p.home_score, p.away_score, m.home_score, m.away_score) : 0;
                  return (
                    <div key={m.id} className="bg-pitch-surface rounded-2xl border border-border overflow-hidden">
                      <div className="bg-white/5 px-4 py-2 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                          {stageLabel(m.stage)} • {timeStr(new Date(m.kickoff_at))} {m.stadium ? `• ${m.stadium}` : ""}
                        </span>
                        <StatusBadge isFinished={isFinished} locked={matchLocked} />
                      </div>
                      <div className="p-5 md:p-6 flex items-center justify-between gap-3">
                        <TeamSide name={m.home_team} flag={m.home_flag} />
                        <div className="flex items-center gap-3">
                          <ScoreInput
                            disabled={matchLocked}
                            value={isFinished ? String(m.home_score) : getInput(m.id, "h")}
                            onChange={(v) => setInput(m.id, "h", v)}
                          />
                          <span className="text-muted-foreground font-black text-xl">-</span>
                          <ScoreInput
                            disabled={matchLocked}
                            value={isFinished ? String(m.away_score) : getInput(m.id, "a")}
                            onChange={(v) => setInput(m.id, "a", v)}
                          />
                        </div>
                        <TeamSide name={m.away_team} flag={m.away_flag} />
                      </div>
                      {p && (
                        <div className="px-5 pb-4 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Your pick: <span className="text-white font-bold">{p.home_score} - {p.away_score}</span>
                          </span>
                          {isFinished && (
                            <span className={`font-black ${points === 200 ? "text-trophy" : points === 100 ? "text-grass" : "text-muted-foreground"}`}>
                              {points === 200 ? "Perfect! +200 pts" : points === 100 ? "Correct outcome +100" : "+0 pts"}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!locked && matches.some((m) => !m.is_finished) && (
                <button
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending}
                  className="w-full bg-grass text-pitch-dark font-black py-4 rounded-2xl hover:scale-[1.01] active:scale-95 transition shadow-xl shadow-grass/20 disabled:opacity-50"
                >
                  {submit.isPending ? "SAVING…" : "SUBMIT TODAY'S PREDICTIONS"}
                </button>
              )}
            </>
          )
        ) : (
          <div className="space-y-6">
            {groupedMatches.map(([dateStr, dayMatches]) => (
              <div key={dateStr} className="bg-pitch-surface/40 rounded-2xl border border-border/80 p-4 md:p-6 space-y-4">
                <h3 className="text-xs font-black text-grass uppercase tracking-wider border-b border-white/5 pb-2">
                  {dateStr}
                </h3>
                <div className="divide-y divide-white/5">
                  {dayMatches.map((m) => {
                    const p = predMap.get(m.id);
                    const isFinished = m.is_finished && m.home_score !== null && m.away_score !== null;
                    const isToday = isSameUtcDay(new Date(m.kickoff_at), now);
                    const points = p && isFinished ? calcPoints(p.home_score, p.away_score, m.home_score, m.away_score) : 0;

                    return (
                      <div key={m.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Match Meta (Time & Stage) */}
                        <div className="flex items-center gap-2 sm:flex-col sm:items-start min-w-[100px]">
                          <span className="text-xs font-black text-white bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                            {timeStr(new Date(m.kickoff_at))}
                          </span>
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                            {stageLabel(m.stage)}
                          </span>
                        </div>

                        {/* Matchup */}
                        <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
                          <div className="flex-1 flex items-center justify-end gap-2.5 min-w-0">
                            <span className="font-bold text-xs md:text-sm text-right truncate text-white/90">{m.home_team}</span>
                            <FlagImg flag={m.home_flag} size="sm" />
                          </div>

                          {/* Score or VS */}
                          <div className="px-3 py-1 bg-pitch-dark/60 rounded-lg border border-border/50 min-w-[60px] text-center">
                            {isFinished ? (
                              <span className="font-black text-xs md:text-sm text-white">
                                {m.home_score} - {m.away_score}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                VS
                              </span>
                            )}
                          </div>

                          <div className="flex-1 flex items-center justify-start gap-2.5 min-w-0">
                            <FlagImg flag={m.away_flag} size="sm" />
                            <span className="font-bold text-xs md:text-sm text-left truncate text-white/90">{m.away_team}</span>
                          </div>
                        </div>

                        {/* Prediction Status or Result */}
                        <div className="min-w-[120px] text-right flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground sm:hidden">Prediction:</span>
                          {isFinished ? (
                            <div className="text-xs">
                              <p className="text-muted-foreground">
                                Pick: <span className="font-bold text-white">{p ? `${p.home_score}-${p.away_score}` : "None"}</span>
                              </p>
                              {p && (
                                <p className={`font-bold ${points === 200 ? "text-trophy" : points === 100 ? "text-grass" : "text-muted-foreground"}`}>
                                  {points > 0 ? `+${points} pts` : "0 pts"}
                                </p>
                              )}
                            </div>
                          ) : isToday ? (
                            <button
                              onClick={() => setActiveTab("today")}
                              className="text-xs bg-grass/15 text-grass border border-grass/30 font-bold px-3 py-1 rounded-lg hover:bg-grass hover:text-pitch-dark transition w-full sm:w-auto text-center"
                            >
                              {p ? `Edit Pick (${p.home_score}-${p.away_score})` : "Predict Now"}
                            </button>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {p ? (
                                <p>Pick: <span className="font-bold text-white">{p.home_score} - {p.away_score}</span></p>
                              ) : (
                                <p className="text-[10px] uppercase tracking-wider font-bold text-white/20">Upcoming</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="lg:col-span-5 space-y-6">
        <ScoringCard />
        <NextMatchCard now={now} />
      </aside>
    </div>
  );
}

function StatusBadge({ isFinished, locked }: { isFinished: boolean; locked: boolean }) {
  if (isFinished) {
    return <span className="text-[10px] font-bold text-trophy uppercase flex items-center gap-1"><CheckCircle2 className="size-3" /> Finished</span>;
  }
  if (locked) {
    return <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1"><Lock className="size-3" /> Locked</span>;
  }
  return <span className="text-[10px] font-bold text-grass uppercase flex items-center gap-1"><span className="size-1.5 bg-grass rounded-full animate-pulse" /> Open</span>;
}

function FlagImg({ flag, size = "md" }: { flag: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-12" : size === "sm" ? "size-5" : "size-8";
  const isUrl = flag?.startsWith("http");
  if (isUrl) {
    return (
      <img
        src={flag!}
        alt=""
        className={`${sizeClass} object-contain rounded-sm`}
        loading="lazy"
      />
    );
  }
  return <span className={size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-2xl"}>{flag ?? "⚽"}</span>;
}

function TeamSide({ name, flag }: { name: string; flag: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 w-1/3 min-w-0">
      <div className="size-12 rounded-full bg-pitch-elevated grid place-items-center shadow-lg overflow-hidden">
        <FlagImg flag={flag} size="md" />
      </div>
      <span className="font-bold text-sm text-center truncate w-full">{name}</span>
    </div>
  );
}

function ScoreInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0"
      className="w-14 h-14 bg-pitch-dark border border-border rounded-xl text-center text-2xl font-black focus:border-grass focus:ring-1 focus:ring-grass outline-none transition disabled:opacity-60"
    />
  );
}

function ScoringCard() {
  return (
    <div className="bg-indigo-600 rounded-2xl p-6 text-white overflow-hidden relative">
      <div className="relative z-10">
        <h4 className="text-lg font-extrabold mb-4">Scoring System</h4>
        <ul className="space-y-3 text-sm">
          <li className="flex justify-between items-center"><span className="opacity-80">Correct Winner / Draw</span><span className="font-black">+100 PTS</span></li>
          <li className="flex justify-between items-center"><span className="opacity-80">Exact Scoreline</span><span className="font-black">+100 PTS</span></li>
          <li className="pt-2 border-t border-white/20 flex justify-between items-center font-black"><span>Max Potential</span><span className="text-trophy">200 PTS</span></li>
        </ul>
      </div>
      <div className="absolute -bottom-4 -right-4 size-24 bg-white/10 rounded-full blur-2xl" />
    </div>
  );
}

function NextMatchCard({ now }: { now: Date }) {
  const { data: next } = useQuery<Match | null>({
    queryKey: ["next-match", now.toDateString()],
    queryFn: async () => {
      const { data } = await supabase.from("matches").select("*").gt("kickoff_at", new Date().toISOString()).order("kickoff_at").limit(1).maybeSingle();
      return data as Match | null;
    },
    refetchInterval: 60000,
  });
  if (!next) return null;
  return (
    <div className="bg-pitch-surface rounded-2xl border border-border p-6">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Up Next</p>
      <p className="text-xl font-extrabold mt-2 flex items-center gap-2 flex-wrap">
        <FlagImg flag={next.home_flag} size="sm" />
        {next.home_team} vs {next.away_team}
        <FlagImg flag={next.away_flag} size="sm" />
      </p>
      <p className="text-sm text-muted-foreground mt-1">{new Date(next.kickoff_at).toLocaleString()}</p>
      {next.stadium && <p className="text-xs text-muted-foreground mt-1">{next.stadium}</p>}
    </div>
  );
}
