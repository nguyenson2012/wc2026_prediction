import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/today" : "/auth", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-pitch-dark">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="size-2 animate-pulse rounded-full bg-grass" />
        <span className="text-sm font-medium uppercase tracking-widest">Loading league…</span>
      </div>
    </div>
  );
}
