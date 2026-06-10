import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { stageLabel, calcPoints } from "@/lib/match-utils";

export const Route = createFileRoute("/_authenticated/predictions")({
  ssr: false,
  component: PredictionsPage,
});

type Row = {
  id: string; home_score: number; away_score: number; points: number; created_at: string;
  match: {
    id: string; home_team: string; away_team: string; home_flag: string | null; away_flag: string | null;
    kickoff_at: string; stage: string; group_name: string | null; home_score: number | null; away_score: number | null; is_finished: boolean;
  } | null;
};

function PredictionsPage() {
  const { data: rows = [] } = useQuery<Row[]>({
    queryKey: ["my-predictions-history"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("predictions")
        .select("id,home_score,away_score,points,created_at,match:matches(id,home_team,away_team,home_flag,away_flag,kickoff_at,stage,group_name,home_score,away_score,is_finished)")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const total = rows.reduce((s, r) => s + r.points, 0);
  const exact = rows.filter((r) => r.points === 200).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold">My Predictions</h2>
          <p className="text-sm text-muted-foreground mt-1">Every prediction you've made, with points earned.</p>
        </div>
        <div className="flex gap-4">
          <Stat label="Total" value={total.toLocaleString()} accent="trophy" />
          <Stat label="Perfect" value={exact.toString()} accent="grass" />
          <Stat label="Predictions" value={rows.length.toString()} />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-pitch-surface border border-border p-10 text-center text-muted-foreground">
          You haven't made any predictions yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            if (!r.match) return null;
            const m = r.match;
            const finished = m.is_finished && m.home_score !== null && m.away_score !== null;
            const points = finished ? calcPoints(r.home_score, r.away_score, m.home_score, m.away_score) : r.points;
            return (
              <div key={r.id} className="bg-pitch-surface rounded-2xl border border-border p-4 md:p-5 flex flex-wrap items-center gap-4">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest w-full md:w-auto">
                  {m.stage === "group" && m.group_name ? m.group_name : stageLabel(m.stage)} • {new Date(m.kickoff_at).toLocaleDateString()}
                </div>
                <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
                  <span className="text-right flex-1 truncate"><span className="mr-2">{m.home_flag}</span>{m.home_team}</span>
                  <div className="flex items-center gap-2 font-black">
                    <span className="bg-pitch-dark border border-border rounded-lg px-3 py-1 text-lg">{r.home_score}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="bg-pitch-dark border border-border rounded-lg px-3 py-1 text-lg">{r.away_score}</span>
                  </div>
                  <span className="flex-1 truncate">{m.away_team}<span className="ml-2">{m.away_flag}</span></span>
                </div>
                <div className="text-right">
                  {finished ? (
                    <>
                      <p className="text-xs text-muted-foreground">Final {m.home_score} - {m.away_score}</p>
                      <p className={`font-black text-lg ${points === 200 ? "text-trophy" : points === 100 ? "text-grass" : "text-muted-foreground"}`}>
                        +{points} pts
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Pending</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "trophy" | "grass" }) {
  const c = accent === "trophy" ? "text-trophy" : accent === "grass" ? "text-grass" : "text-white";
  return (
    <div className="bg-pitch-surface border border-border rounded-xl px-4 py-2 text-right">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-xl font-black tabular-nums ${c}`}>{value}</p>
    </div>
  );
}
