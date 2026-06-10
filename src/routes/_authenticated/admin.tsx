import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stageLabel } from "@/lib/match-utils";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/today" });
  },
  component: AdminPage,
});

type Match = {
  id: string; home_team: string; away_team: string; home_flag: string | null; away_flag: string | null;
  kickoff_at: string; stadium: string | null; stage: string;
  home_score: number | null; away_score: number | null; is_finished: boolean;
};

const STAGES = ["group", "round_of_32", "round_of_16", "quarter_final", "semi_final", "third_place", "final"] as const;

function AdminPage() {
  const qc = useQueryClient();
  const { data: matches = [] } = useQuery<Match[]>({
    queryKey: ["admin-matches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("matches").select("*").order("kickoff_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Match[];
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ home_team: string; away_team: string; home_flag: string; away_flag: string; kickoff_at: string; stadium: string; stage: typeof STAGES[number] }>({ home_team: "", away_team: "", home_flag: "🏳️", away_flag: "🏳️", kickoff_at: "", stadium: "", stage: "group" });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("matches").insert({
        ...form,
        stage: form.stage as typeof STAGES[number],
        kickoff_at: new Date(form.kickoff_at).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Match added"); setOpen(false); qc.invalidateQueries({ queryKey: ["admin-matches"] }); qc.invalidateQueries({ queryKey: ["all-matches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold">Admin · Match Management</h2>
          <p className="text-sm text-muted-foreground mt-1">Create fixtures and enter final scores. Points recalculate automatically.</p>
        </div>
        <button onClick={() => setOpen(!open)} className="rounded-xl bg-grass text-pitch-dark font-black px-5 py-2.5 hover:scale-[1.02] active:scale-95 transition">
          {open ? "Close" : "+ New Match"}
        </button>
      </header>

      {open && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          className="bg-pitch-surface rounded-2xl border border-border p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <Input label="Home team" value={form.home_team} onChange={(v) => setForm({ ...form, home_team: v })} required />
          <Input label="Away team" value={form.away_team} onChange={(v) => setForm({ ...form, away_team: v })} required />
          <Input label="Home flag (emoji)" value={form.home_flag} onChange={(v) => setForm({ ...form, home_flag: v })} />
          <Input label="Away flag (emoji)" value={form.away_flag} onChange={(v) => setForm({ ...form, away_flag: v })} />
          <Input label="Kickoff (local)" type="datetime-local" value={form.kickoff_at} onChange={(v) => setForm({ ...form, kickoff_at: v })} required />
          <Input label="Stadium" value={form.stadium} onChange={(v) => setForm({ ...form, stadium: v })} />
          <label className="block md:col-span-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Stage</span>
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value as typeof STAGES[number] })}
              className="mt-1.5 w-full rounded-xl bg-pitch-dark border border-border px-4 py-2.5 text-sm"
            >
              {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={create.isPending} className="md:col-span-2 rounded-xl bg-grass text-pitch-dark font-black py-3 disabled:opacity-50">
            {create.isPending ? "Adding…" : "Add match"}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {matches.map((m) => <AdminMatchRow key={m.id} m={m} />)}
      </div>
    </div>
  );
}

function AdminMatchRow({ m }: { m: Match }) {
  const qc = useQueryClient();
  const [h, setH] = useState<string>(m.home_score?.toString() ?? "");
  const [a, setA] = useState<string>(m.away_score?.toString() ?? "");
  const [kickoff, setKickoff] = useState(new Date(m.kickoff_at).toISOString().slice(0, 16));

  const saveScore = useMutation({
    mutationFn: async () => {
      const home = h === "" ? null : parseInt(h);
      const away = a === "" ? null : parseInt(a);
      const finished = home !== null && away !== null;
      const { error } = await supabase.from("matches").update({ home_score: home, away_score: away, is_finished: finished }).eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Result saved & points recalculated"); qc.invalidateQueries({ queryKey: ["admin-matches"] }); qc.invalidateQueries({ queryKey: ["all-matches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveKickoff = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("matches").update({ kickoff_at: new Date(kickoff).toISOString() }).eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Kickoff updated"); qc.invalidateQueries({ queryKey: ["admin-matches"] }); qc.invalidateQueries({ queryKey: ["all-matches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="bg-pitch-surface rounded-2xl border border-border p-4 md:p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
      <div className="md:col-span-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{stageLabel(m.stage)}</p>
        <p className="font-bold mt-1">{m.home_flag} {m.home_team} <span className="text-muted-foreground">vs</span> {m.away_team} {m.away_flag}</p>
        <p className="text-xs text-muted-foreground">{m.stadium}</p>
      </div>
      <div className="md:col-span-4 flex items-end gap-2">
        <Input label="Kickoff" type="datetime-local" value={kickoff} onChange={setKickoff} />
        <button onClick={() => saveKickoff.mutate()} className="h-[42px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-widest">Save</button>
      </div>
      <div className="md:col-span-4 flex items-end gap-2">
        <Input label="Home" value={h} onChange={setH} />
        <Input label="Away" value={a} onChange={setA} />
        <button onClick={() => saveScore.mutate()} className="h-[42px] px-3 rounded-xl bg-grass text-pitch-dark text-xs font-black uppercase tracking-widest">Save</button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block flex-1">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl bg-pitch-dark border border-border px-3 py-2 text-sm text-white focus:border-grass focus:ring-1 focus:ring-grass outline-none"
      />
    </label>
  );
}
