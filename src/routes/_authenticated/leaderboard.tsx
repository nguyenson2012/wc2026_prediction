import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leaderboard")({
  ssr: false,
  component: LeaderboardPage,
});

type Row = { user_id: string; display_name: string; avatar_url: string | null; total_points: number; exact_scores: number; correct_outcomes: number };

function LeaderboardPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leaderboard")
        .select("*")
        .order("total_points", { ascending: false })
        .order("exact_scores", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  useEffect(() => {
    const ch = supabase
      .channel("leaderboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => qc.invalidateQueries({ queryKey: ["leaderboard"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => qc.invalidateQueries({ queryKey: ["leaderboard"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const [first, second, third, ...rest] = rows;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-extrabold flex items-center gap-3"><Trophy className="size-7 text-trophy" /> Leaderboard</h2>
        <p className="text-sm text-muted-foreground mt-1">Live ranking — updates instantly as matches finish.</p>
      </header>

      {isLoading ? (
        <div className="rounded-2xl bg-pitch-surface border border-border p-10 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-pitch-surface border border-border p-10 text-center text-muted-foreground">No players yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 md:gap-4 items-end">
            <Podium rank={2} row={second} color="silver" />
            <Podium rank={1} row={first} color="gold" />
            <Podium rank={3} row={third} color="bronze" />
          </div>

          <div className="bg-pitch-surface rounded-3xl border border-border overflow-hidden">
            <div className="p-4 space-y-1">
              {rest.map((r, i) => {
                const isMe = me?.id === r.user_id;
                return (
                  <div key={r.user_id} className={`flex items-center gap-4 p-3 rounded-2xl transition ${isMe ? "bg-grass/5 border border-grass/20" : "hover:bg-white/5"}`}>
                    <span className="text-lg font-black text-muted-foreground italic w-8 text-center">{i + 4}</span>
                    <Avatar url={r.avatar_url} name={r.display_name} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white truncate">{r.display_name || "Anonymous"} {isMe && <span className="text-grass text-xs">(You)</span>}</p>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide">
                        {r.exact_scores} perfect • {r.correct_outcomes} correct
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-white tabular-nums">{r.total_points.toLocaleString()}</p>
                      <p className="text-[10px] text-grass font-bold uppercase">PTS</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Podium({ rank, row, color }: { rank: number; row?: Row; color: "gold" | "silver" | "bronze" }) {
  if (!row) return <div />;
  const heights = { 1: "h-44", 2: "h-32", 3: "h-24" } as const;
  const colors = {
    gold: "bg-gradient-to-b from-trophy/30 to-trophy/5 border-trophy/40 text-trophy",
    silver: "bg-gradient-to-b from-slate-300/20 to-slate-400/5 border-slate-300/30 text-slate-200",
    bronze: "bg-gradient-to-b from-bronze/20 to-bronze/5 border-bronze/30 text-bronze",
  } as const;
  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar url={row.avatar_url} name={row.display_name} large />
      <p className="font-bold text-sm text-white truncate max-w-full">{row.display_name}</p>
      <div className={`w-full ${heights[rank as 1 | 2 | 3]} rounded-t-2xl border ${colors[color]} flex flex-col items-center justify-center p-3`}>
        <div className="text-3xl font-black italic">{rank}</div>
        <div className="text-lg font-black text-white tabular-nums mt-1">{row.total_points}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">PTS</div>
      </div>
    </div>
  );
}

function Avatar({ url, name, large }: { url: string | null; name: string; large?: boolean }) {
  const size = large ? "size-14" : "size-10";
  if (url) return <img src={url} alt="" className={`${size} rounded-full object-cover bg-pitch-elevated`} />;
  return (
    <div className={`${size} rounded-full bg-pitch-elevated grid place-items-center text-grass font-black`}>
      {(name || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
    </div>
  );
}
