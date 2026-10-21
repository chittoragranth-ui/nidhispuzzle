import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Check, Copy, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildGeometry, initialLayout, COLS, ROWS } from "@/lib/jigsaw";
import {
  ensureIdentity, friendlyError, getInvite, getNickname, inviteUrl, prepareImage,
  saveInvite, saveNickname, uploadWithProgress,
} from "@/lib/twofold";

export const Route = createFileRoute("/create")({
  ssr: false,
  validateSearch: z.object({ room: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Create a room — Twofold" },
      { name: "description", content: "Start a private two-person jigsaw room with your own photo." },
      { property: "og:title", content: "Create a room — Twofold" },
      { property: "og:description", content: "Start a private two-person jigsaw room with your own photo." },
    ],
  }),
  component: CreatePage,
});

type Step = "name" | "image" | "invite";

function CreatePage() {
  const { room } = Route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(room ? "image" : "name");
  const [roomId, setRoomId] = useState<string | null>(room ?? null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prepared, setPrepared] = useState<{ blob: Blob; aspect: number; previewUrl: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNickname(getNickname()), []);

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nickname.trim();
    if (n.length < 1 || n.length > 24) return setErr("Choose a name between 1 and 24 characters.");
    setBusy(true); setErr("");
    try {
      await ensureIdentity();
      const { data, error } = await supabase.rpc("create_room", { _nickname: n });
      if (error) throw error;
      const r = data as { room_id: string; token: string };
      saveNickname(n);
      saveInvite(r.room_id, r.token);
      setRoomId(r.room_id);
      setStep("image");
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  const pick = async (file?: File) => {
    if (!file) return;
    setErr("");
    try { setPrepared(await prepareImage(file)); } catch (e) { setErr(friendlyError(e)); }
  };

  const confirm = async () => {
    if (!prepared || !roomId) return;
    setBusy(true); setErr(""); setProgress(0);
    try {
      await ensureIdentity();
      const path = `${roomId}/${crypto.randomUUID()}.jpg`;
      await uploadWithProgress(path, prepared.blob, setProgress);
      const seed = Math.floor(Math.random() * 2 ** 31);
      const g = buildGeometry({ aspect: prepared.aspect, seed, cols: COLS, rows: ROWS });
      const { error } = await supabase.rpc("create_session", {
        _room: roomId, _image_path: path, _aspect: prepared.aspect, _seed: seed,
        _positions: initialLayout(g, seed),
      });
      if (error) throw error;
      if (room) navigate({ to: "/room/$roomId", params: { roomId } });
      else setStep("invite");
    } catch (e) { setErr(friendlyError(e)); setProgress(null); } finally { setBusy(false); }
  };

  const link = roomId && getInvite(roomId) ? inviteUrl(roomId, getInvite(roomId)!) : "";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link to="/" className="wordmark">Twofold</Link>
        <span className="label">{step === "name" ? "1 / 3" : step === "image" ? "2 / 3" : "3 / 3"}</span>
      </header>
      <main className="mx-auto max-w-xl px-6 pb-20 pt-8">
        {step === "name" && (
          <form onSubmit={createRoom} className="fade-up">
            <h1 className="text-4xl">What should your partner call you?</h1>
            <p className="mt-3 text-muted-foreground">Just a first name or nickname — no account needed.</p>
            <input autoFocus className="field mt-8 text-base" maxLength={24} value={nickname}
              onChange={(e) => setNickname(e.target.value)} placeholder="Your name" />
            {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
            <button className="btn-primary mt-6 w-full py-3" disabled={busy}>{busy ? "Creating room…" : "Continue"}</button>
          </form>
        )}

        {step === "image" && (
          <div className="fade-up">
            <h1 className="text-4xl">{room ? "Choose a new picture" : "Choose your picture"}</h1>
            <p className="mt-3 text-muted-foreground">JPEG, PNG or WebP, up to 10 MB. It becomes a 100‑piece puzzle.</p>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => pick(e.target.files?.[0])} />
            {!prepared ? (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="surface mt-8 flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 border-dashed text-muted-foreground transition-colors hover:bg-secondary">
                <ImagePlus className="h-7 w-7" strokeWidth={1.5} />
                <span className="text-sm">Select a photo</span>
              </button>
            ) : (
              <div className="mt-8">
                <img src={prepared.previewUrl} alt="Selected puzzle picture" className="surface max-h-[55vh] w-full object-contain p-2" />
                {progress !== null && (
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                )}
                <div className="mt-6 flex gap-3">
                  <button className="btn-outline flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>Replace</button>
                  <button className="btn-primary flex-1" disabled={busy} onClick={confirm}>
                    {busy ? (progress !== null && progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Cutting pieces…") : "Use this picture"}
                  </button>
                </div>
              </div>
            )}
            {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
          </div>
        )}

        {step === "invite" && roomId && (
          <div className="fade-up">
            <h1 className="text-4xl">Your room is ready.</h1>
            <p className="mt-3 text-muted-foreground">Send this private link to the one person you'd like to puzzle with. It expires in 7 days.</p>
            <div className="surface mt-8 flex items-center gap-2 p-2">
              <input readOnly value={link} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" onFocus={(e) => e.target.select()} />
              <button className="btn-outline shrink-0" onClick={async () => {
                await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800);
              }}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button className="btn-primary mt-6 w-full py-3" onClick={() => navigate({ to: "/room/$roomId", params: { roomId } })}>
              Enter the room
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
