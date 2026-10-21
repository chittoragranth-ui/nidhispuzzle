import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Image as ImageIcon, LogOut, MessageCircle, PanelRightClose } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PuzzleBoard, type PieceState } from "@/components/twofold/PuzzleBoard";
import { ChatPanel } from "@/components/twofold/ChatPanel";
import { VideoCall } from "@/components/twofold/VideoCall";
import { RoomBus, type PresenceUser } from "@/lib/room-bus";
import { ensureIdentity, getInvite, inviteUrl } from "@/lib/twofold";

export const Route = createFileRoute("/room/$roomId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Puzzle room — Twofold" },
      { name: "description", content: "Your private two-person jigsaw room." },
      { property: "og:title", content: "Puzzle room — Twofold" },
      { property: "og:description", content: "Your private two-person jigsaw room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

interface Room { id: string; creator_id: string; current_session_id: string | null; status: string; expires_at: string }
interface Participant { user_id: string; nickname: string }
interface Session { id: string; image_path: string; aspect: number; seed: number; cols: number; rows: number; started_at: string; completed_at: string | null }

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [meId, setMeId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [bus, setBus] = useState<RoomBus | null>(null);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [conn, setConn] = useState("connecting");
  const [panel, setPanel] = useState(true);
  const [ref, setRef] = useState(false);
  const [copied, setCopied] = useState(false);

  const me = participants.find((p) => p.user_id === meId);
  const partner = participants.find((p) => p.user_id !== meId);
  const partnerOnline = !!partner && online.some((u) => u.user_id === partner.user_id);
  const isHost = room?.creator_id === meId;

  const loadSession = useCallback(async (sid: string | null) => {
    if (!sid) { setSession(null); setPieces([]); return; }
    const [{ data: s }, { data: ps }] = await Promise.all([
      supabase.from("puzzle_sessions").select("*").eq("id", sid).single(),
      supabase.from("pieces").select("idx,x,y,locked,held_by,version").eq("session_id", sid).order("idx"),
    ]);
    if (!s) return;
    setSession((prev) => {
      if (prev?.image_path !== s.image_path) {
        void supabase.storage.from("puzzle-images").createSignedUrl(s.image_path, 60 * 60 * 6).then(({ data }) => {
          if (!data) return;
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => setImage(img);
          img.onerror = () => toast("We couldn't load the puzzle picture.");
          img.src = data.signedUrl;
        });
      }
      return s as Session;
    });
    setPieces((ps ?? []) as PieceState[]);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const uid = await ensureIdentity();
      setMeId(uid);
      const { data: r } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
      if (!r) { setState("denied"); return; }
      setRoom(r as Room);
      const { data: parts } = await supabase.from("participants").select("user_id,nickname").eq("room_id", roomId);
      setParticipants(parts ?? []);
      await loadSession(r.current_session_id);
      setState("ready");
    } catch { setState("error"); }
  }, [roomId, loadSession]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Realtime: transient bus + durable room/session/participant changes
  useEffect(() => {
    if (state !== "ready" || !meId || !me) return;
    const b = new RoomBus(roomId, { user_id: meId, nickname: me.nickname });
    let wasDown = false;
    const offS = b.onStatus((s) => {
      setConn(s === "SUBSCRIBED" ? "live" : "reconnecting");
      if (s !== "SUBSCRIBED") wasDown = true;
      else if (wasDown) { wasDown = false; void loadAll(); }
    });
    const offP = b.onPresence(setOnline);
    setBus(b);
    const ch = supabase.channel(`roomdb:${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (p) => {
        const r = p.new as Room;
        setRoom(r);
        void loadSession(r.current_session_id);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter: `room_id=eq.${roomId}` }, (p) => {
        const n = p.new as Participant;
        setParticipants((ps) => (ps.some((x) => x.user_id === n.user_id) ? ps : [...ps, n]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "puzzle_sessions", filter: `room_id=eq.${roomId}` }, (p) => {
        const s = p.new as Session;
        setSession((cur) => (cur && cur.id === s.id ? { ...cur, completed_at: s.completed_at } : cur));
      })
      .subscribe();
    const onOnline = () => void loadAll();
    window.addEventListener("online", onOnline);
    return () => { offS(); offP(); b.close(); setBus(null); void supabase.removeChannel(ch); window.removeEventListener("online", onOnline); };
  }, [state, meId, me?.nickname, roomId, loadAll, loadSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const placed = useMemo(() => pieces.filter((p) => p.locked).length, [pieces]);
  const token = typeof window !== "undefined" ? getInvite(roomId) : null;

  const copyInvite = async () => {
    if (!token) return toast("Only the original invitation link can be shared — ask the host.");
    await navigator.clipboard.writeText(inviteUrl(roomId, token));
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };

  if (state === "loading") return <Centered><p className="text-muted-foreground">Opening your room…</p></Centered>;
  if (state === "denied") return (
    <Centered>
      <h1 className="text-4xl">This room is private.</h1>
      <p className="mt-3 text-muted-foreground">Open it with the invitation link you were sent.</p>
      <Link to="/" className="btn-outline mt-8">Back to Twofold</Link>
    </Centered>
  );
  if (state === "error") return (
    <Centered>
      <h1 className="text-4xl">We lost the connection.</h1>
      <button className="btn-primary mt-8" onClick={() => { setState("loading"); void loadAll(); }}>Try again</button>
    </Centered>
  );

  const completed = !!session?.completed_at;
  const minutes = session?.completed_at ? Math.max(1, Math.round((+new Date(session.completed_at) - +new Date(session.started_at)) / 60000)) : 0;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <Link to="/" className="wordmark mr-2">Twofold</Link>
        <div className="flex items-center gap-3 text-sm">
          {[me, partner].map((p, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${i === 0 ? "bg-primary" : partnerOnline ? "presence-dot bg-partner" : "bg-border"}`} />
              <span className={i === 1 && !partnerOnline ? "text-muted-foreground" : ""}>
                {p ? (i === 0 ? `${p.nickname} (you)` : p.nickname) : "Waiting for partner"}
              </span>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {session && <span className="mr-3 hidden text-sm tabular-nums text-muted-foreground sm:inline">{placed}/{pieces.length} placed</span>}
          <span className={`mr-2 hidden text-xs md:inline ${conn === "live" ? "text-success" : "text-destructive"}`}>{conn === "live" ? "Connected" : "Reconnecting…"}</span>
          {session && <button className={`btn-icon ${ref ? "btn-icon-active" : ""}`} aria-label="Toggle reference picture" onClick={() => setRef(!ref)}><ImageIcon className="h-4 w-4" /></button>}
          <button className="btn-icon" aria-label="Copy invitation link" onClick={copyInvite}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
          <button className={`btn-icon ${panel ? "btn-icon-active" : ""}`} aria-label="Toggle chat and call" onClick={() => setPanel(!panel)}>{panel ? <PanelRightClose className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}</button>
          {isHost && (
            <button className="btn-ghost px-2 text-xs" onClick={async () => {
              if (!confirm("Close the invitation? The link will stop working for new visitors.")) return;
              await supabase.rpc("revoke_invite", { _room: roomId }); toast("Invitation closed.");
            }}>Close invite</button>
          )}
          <button className="btn-icon" aria-label="Leave room" onClick={() => navigate({ to: "/" })}><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      {session && (
        <div className="h-0.5 bg-secondary"><div className="h-full bg-primary transition-all duration-500" style={{ width: `${pieces.length ? (placed / pieces.length) * 100 : 0}%` }} /></div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {session && image && bus && meId ? (
            <PuzzleBoard key={session.id} sessionId={session.id} aspect={session.aspect} seed={session.seed} cols={session.cols} rows={session.rows}
              image={image} pieces={pieces} setPieces={setPieces} bus={bus} meId={meId} partnerName={partner?.nickname} showReference={ref} />
          ) : session ? (
            <Centered><p className="text-muted-foreground">Loading the picture…</p></Centered>
          ) : (
            <Centered>
              <h2 className="text-3xl">{isHost ? "Pick a picture to begin." : "Waiting for the host to choose a picture."}</h2>
              {isHost && <Link to="/create" search={{ room: roomId }} className="btn-primary mt-6">Choose a picture</Link>}
            </Centered>
          )}

          {completed && image && (
            <div className="fade-up absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm">
              <div className="surface max-w-lg p-6 text-center">
                <img src={image.src} alt="Completed puzzle" className="w-full rounded-md" />
                <h2 className="mt-6 text-4xl">Finished, together.</h2>
                <p className="mt-2 text-muted-foreground">{me?.nickname} and {partner?.nickname ?? "friend"} placed all 100 pieces in {minutes} minute{minutes === 1 ? "" : "s"}.</p>
                {isHost ? (
                  <Link to="/create" search={{ room: roomId }} className="btn-primary mt-6">Start a new puzzle</Link>
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground">Your host can start a new puzzle in this room.</p>
                )}
              </div>
            </div>
          )}
        </main>

        {panel && bus && meId && me && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-xs flex-col border-l border-border bg-card md:static">
            <VideoCall bus={bus} meId={meId} partnerName={partner?.nickname} partnerOnline={partnerOnline} />
            <ChatPanel roomId={roomId} meId={meId} nickname={me.nickname} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-6 text-center">{children}</div>;
}
