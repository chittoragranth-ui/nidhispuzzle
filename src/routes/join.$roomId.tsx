import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ensureIdentity, friendlyError, getNickname, saveInvite, saveNickname } from "@/lib/twofold";

export const Route = createFileRoute("/join/$roomId")({
  ssr: false,
  validateSearch: z.object({ t: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "You're invited — Twofold" },
      { name: "description", content: "Someone invited you to solve a jigsaw puzzle together." },
      { property: "og:title", content: "You're invited to a Twofold puzzle" },
      { property: "og:description", content: "Someone invited you to solve a jigsaw puzzle together." },
    ],
  }),
  component: JoinPage,
});

const REASONS: Record<string, string> = {
  invalid: "This invitation link isn't valid. Ask for a fresh link.",
  expired: "This invitation has expired.",
  revoked: "The host has closed this invitation.",
  full: "This room already has two people in it.",
};

function JoinPage() {
  const { roomId } = Route.useParams();
  const { t } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "form" | "error">("loading");
  const [host, setHost] = useState("");
  const [reason, setReason] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setNickname(getNickname());
    (async () => {
      try {
        await ensureIdentity();
        const { data, error } = await supabase.rpc("check_invite", { _room: roomId, _token: t ?? "" });
        if (error) throw error;
        const r = data as { ok: boolean; reason?: string; member?: boolean; host?: string };
        if (!r.ok) { setReason(REASONS[r.reason ?? "invalid"]); setState("error"); return; }
        if (t) saveInvite(roomId, t);
        if (r.member) { navigate({ to: "/room/$roomId", params: { roomId }, replace: true }); return; }
        setHost(r.host ?? "Your partner");
        setState("form");
      } catch (e) { setReason(friendlyError(e)); setState("error"); }
    })();
  }, [roomId, t, navigate]);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nickname.trim();
    if (!n || n.length > 24) return setErr("Choose a name between 1 and 24 characters.");
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.rpc("join_room", { _room: roomId, _token: t ?? "", _nickname: n });
      if (error) throw error;
      saveNickname(n);
      navigate({ to: "/room/$roomId", params: { roomId } });
    } catch (e) {
      const m = friendlyError(e);
      setErr(REASONS[m] ?? m);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-3xl px-6 py-6"><Link to="/" className="wordmark">Twofold</Link></header>
      <main className="mx-auto max-w-md px-6 pt-12">
        {state === "loading" && <p className="text-muted-foreground">Checking your invitation…</p>}
        {state === "error" && (
          <div className="fade-up">
            <h1 className="text-4xl">We couldn't open this room.</h1>
            <p className="mt-3 text-muted-foreground">{reason}</p>
            <Link to="/" className="btn-outline mt-8">Back to Twofold</Link>
          </div>
        )}
        {state === "form" && (
          <form onSubmit={join} className="fade-up">
            <p className="label">Invitation</p>
            <h1 className="mt-3 text-4xl">{host} wants to solve a puzzle with you.</h1>
            <label className="label mt-8 block" htmlFor="nick">Your name</label>
            <input id="nick" autoFocus className="field mt-2 text-base" maxLength={24} value={nickname}
              onChange={(e) => setNickname(e.target.value)} placeholder="Your name" />
            {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
            <button className="btn-primary mt-6 w-full py-3" disabled={busy}>{busy ? "Joining…" : "Join the room"}</button>
          </form>
        )}
      </main>
    </div>
  );
}
