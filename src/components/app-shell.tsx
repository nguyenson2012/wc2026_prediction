import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Trophy, ClipboardList, Settings, LogOut, X, User, Check } from "lucide-react";
import { toast } from "sonner";

export function AppShell({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<{ display_name: string; avatar_url: string | null } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: rankInfo } = useQuery({
    queryKey: ["my-rank"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("leaderboard").select("user_id,total_points").order("total_points", { ascending: false });
      if (!data) return null;
      const idx = data.findIndex((r) => r.user_id === u.user!.id);
      return { rank: idx + 1, total: data.length };
    },
    refetchInterval: 30000,
  });

  async function loadProfile() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: p }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("display_name,avatar_url").eq("id", u.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
    ]);
    setProfile(p);
    setIsAdmin(!!roles?.some((r) => r.role === "admin"));
  }

  useEffect(() => { loadProfile(); }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems = [
    { to: "/today", label: "Today", Icon: Calendar },
    { to: "/leaderboard", label: "Leaderboard", Icon: Trophy },
    { to: "/predictions", label: "History", Icon: ClipboardList },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", Icon: Settings }] : []),
  ] as const;

  return (
    <div className="min-h-screen bg-pitch-dark text-white pb-24 md:pb-0">
      <nav className="sticky top-0 z-40 bg-pitch-surface/80 backdrop-blur-md border-b border-white/10 px-4 py-3 md:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <Link to="/today" className="flex items-center gap-3">
            <div className="size-9 bg-grass rounded-xl grid place-items-center shadow-lg shadow-grass/30">
              <span className="text-pitch-dark font-black text-sm">W26</span>
            </div>
            <h1 className="hidden md:block font-extrabold tracking-tight text-lg">PREDICTION LEAGUE</h1>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                  pathname.startsWith(to) ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
                }`}
              >{label}</Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {rankInfo && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Your Rank</p>
                <p className="text-sm font-bold text-trophy">#{rankInfo.rank} / {rankInfo.total}</p>
              </div>
            )}
            {/* Clickable avatar — opens Edit Profile modal */}
            <button
              onClick={() => setShowProfileModal(true)}
              title="Edit profile"
              className="size-10 rounded-full bg-pitch-elevated border-2 border-grass grid place-items-center overflow-hidden hover:border-white/60 transition"
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-xs font-black text-grass">{initials(profile?.display_name)}</span>
              )}
            </button>
            <button onClick={signOut} className="p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 bg-pitch-surface border-t border-white/10 px-4 py-2 md:hidden flex justify-around z-40">
        {navItems.map(({ to, label, Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={`flex flex-col items-center gap-1 px-3 py-1.5 ${active ? "text-grass" : "text-muted-foreground"}`}>
              <Icon className="size-5" />
              <span className="text-[10px] font-bold uppercase tracking-tight">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Edit Profile Modal */}
      {showProfileModal && (
        <EditProfileModal
          profile={profile}
          onClose={() => setShowProfileModal(false)}
          onSaved={(updated) => {
            setProfile(updated);
            setShowProfileModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ─── Edit Profile Modal ─────────────────────────────────────────────────── */

type ProfileData = { display_name: string; avatar_url: string | null };

function EditProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: ProfileData | null;
  onClose: () => void;
  onSaved: (p: ProfileData) => void;
}) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const overlayRef = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const trimmed = displayName.trim();
      if (!trimmed) throw new Error("Display name cannot be empty");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed, avatar_url: avatarUrl.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", u.user.id);
      if (error) throw error;
      return { display_name: trimmed, avatar_url: avatarUrl.trim() || null };
    },
    onSuccess: (updated) => {
      toast.success("Profile updated!");
      onSaved(updated);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Close on backdrop click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = avatarUrl.trim();

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-md bg-pitch-surface rounded-2xl border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <User className="size-4 text-grass" />
            <h2 className="font-extrabold text-base">Edit Profile</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition">
            <X className="size-4" />
          </button>
        </div>

        {/* Avatar preview */}
        <div className="flex justify-center pt-6 pb-2">
          <div className="size-20 rounded-full bg-pitch-elevated border-2 border-grass grid place-items-center overflow-hidden shadow-lg shadow-grass/20">
            {preview ? (
              <img
                src={preview}
                alt="Avatar preview"
                className="size-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <span className="text-2xl font-black text-grass">{initials(displayName || "?")}</span>
            )}
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="px-6 pb-6 pt-4 space-y-4"
        >
          {/* Display Name */}
          <label className="block">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Display Name</span>
            <input
              id="profile-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              className="mt-1.5 w-full rounded-xl bg-pitch-dark border border-border px-4 py-2.5 text-sm text-white placeholder:text-muted-foreground/50 focus:border-grass focus:ring-1 focus:ring-grass outline-none transition"
            />
          </label>

          {/* Avatar URL */}
          <label className="block">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Avatar URL <span className="normal-case text-muted-foreground/60">(optional)</span></span>
            <input
              id="profile-avatar-url"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              className="mt-1.5 w-full rounded-xl bg-pitch-dark border border-border px-4 py-2.5 text-sm text-white placeholder:text-muted-foreground/50 focus:border-grass focus:ring-1 focus:ring-grass outline-none transition"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/60">Paste a public image URL. Leave blank to show initials.</p>
          </label>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm font-bold text-muted-foreground hover:text-white hover:border-white/30 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="flex-1 rounded-xl bg-grass text-pitch-dark font-black py-2.5 text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition disabled:opacity-50"
            >
              {save.isPending ? (
                <span className="flex items-center gap-2"><span className="size-3.5 border-2 border-pitch-dark/40 border-t-pitch-dark rounded-full animate-spin" />Saving…</span>
              ) : (
                <><Check className="size-4" /> Save Changes</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}

