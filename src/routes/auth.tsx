import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/today", replace: true });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "sign_up") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: name } },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/today", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      if (msg.toLowerCase().includes("password is known to be weak")) {
        toast.error(
          "That password is too common or has appeared in data breaches. Try a passphrase like \'horse-battery-staple\' or generate a random one with your password manager.",
          { duration: 8000 }
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      toast.error(msg);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-pitch-dark text-white grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-pitch-surface via-pitch-dark to-pitch-dark relative overflow-hidden">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-grass/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 size-96 rounded-full bg-trophy/5 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="size-10 rounded-xl bg-grass grid place-items-center shadow-lg shadow-grass/30">
            <span className="font-black text-pitch-dark">W26</span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-widest font-bold">FIFA World Cup</div>
            <div className="font-extrabold tracking-tight">Prediction League</div>
          </div>
        </div>
        <div className="relative space-y-6">
          <h1 className="text-5xl font-black tracking-tight leading-[1.05]">
            Predict every match. <span className="text-grass">Climb the table.</span>
          </h1>
          <p className="text-muted-foreground max-w-md">
            Daily fixtures, instant scoring, live leaderboard. Built for the company that lives and breathes football.
          </p>
          <div className="flex gap-6 pt-4">
            <Stat label="Outcome" value="+100" />
            <Stat label="Exact score" value="+200" />
            <Stat label="Lock" value="Daily" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden flex items-center gap-3 mb-4">
            <div className="size-9 rounded-xl bg-grass grid place-items-center"><span className="font-black text-pitch-dark text-sm">W26</span></div>
            <span className="font-extrabold tracking-tight">PREDICTION LEAGUE</span>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold">{mode === "sign_in" ? "Welcome back" : "Join the league"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "sign_in" ? "Sign in to lock in your predictions." : "Create your account in seconds."}
            </p>
          </div>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 rounded-xl bg-white text-pitch-dark py-3 font-bold hover:bg-white/90 transition disabled:opacity-50"
          >
            <GoogleIcon /> Continue with Google
          </button>

          <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            <div className="h-px flex-1 bg-border" /> or email <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === "sign_up" && (
              <Field label="Display name" value={name} onChange={setName} placeholder="Alex Rivera" />
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" required />
            <div className="space-y-1.5">
              <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
              {mode === "sign_up" && <PasswordChecklist password={password} />}
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-grass text-pitch-dark py-3 font-black hover:scale-[1.01] active:scale-95 transition shadow-lg shadow-grass/20 disabled:opacity-50"
            >
              {busy ? "Please wait…" : mode === "sign_in" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
            className="w-full text-xs font-bold text-muted-foreground hover:text-white uppercase tracking-widest"
          >
            {mode === "sign_in" ? "No account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  const hasLength = password.length >= 8;
  // A very rough common-password heuristic: flag if it's all lowercase letters only
  // (real check happens server-side; this is a gentle reminder).
  const looksCommon =
    password.length > 0 &&
    /^[a-z]+$/.test(password) &&
    password.length < 12;

  const rules: { label: string; ok: boolean; warn?: boolean }[] = [
    { label: "At least 8 characters", ok: hasLength },
    {
      label: "Avoid common words, names, or previously leaked passwords",
      ok: !looksCommon,
      warn: looksCommon,
    },
  ];

  if (password.length === 0) return null;

  return (
    <ul className="space-y-1 pt-0.5">
      {rules.map((r) => (
        <li key={r.label} className="flex items-start gap-2 text-[11px] leading-tight">
          <span
            className={[
              "mt-px shrink-0 size-3.5 rounded-full flex items-center justify-center text-[9px] font-black",
              r.ok
                ? "bg-grass/20 text-grass"
                : r.warn
                ? "bg-amber-500/20 text-amber-400"
                : "bg-border text-muted-foreground",
            ].join(" ")}
          >
            {r.ok ? "✓" : r.warn ? "!" : "○"}
          </span>
          <span
            className={[
              r.ok
                ? "text-grass/80"
                : r.warn
                ? "text-amber-400/80"
                : "text-muted-foreground",
            ].join("")}
          >
            {r.label}
          </span>
        </li>
      ))}
      <li className="flex items-start gap-2 text-[11px] leading-tight text-muted-foreground/60 italic">
        <span className="mt-px shrink-0 size-3.5" />
        Tip: use a passphrase or generate one with a password manager.
      </li>
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-black text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1.5 w-full rounded-xl bg-pitch-surface border border-border px-4 py-2.5 text-sm text-white focus:border-grass focus:ring-1 focus:ring-grass outline-none transition"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  );
}
