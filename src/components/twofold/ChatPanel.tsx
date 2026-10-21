import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Msg { id: string; user_id: string; nickname: string; body: string; created_at: string; status?: "sending" | "failed" }

export function ChatPanel({ roomId, meId, nickname }: { roomId: string; meId: string; nickname: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("messages").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => alive && data && setMsgs(data.reverse()));
    const ch = supabase.channel(`chat:${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (p) => {
        const m = p.new as Msg;
        setMsgs((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      })
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
  }, [roomId]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

  const send = async (body: string, retryId?: string) => {
    const id = retryId ?? crypto.randomUUID();
    const optimistic: Msg = { id, user_id: meId, nickname, body, created_at: new Date().toISOString(), status: "sending" };
    setMsgs((ms) => (retryId ? ms.map((m) => (m.id === id ? optimistic : m)) : [...ms, optimistic]));
    const { error } = await supabase.from("messages").insert({ id, room_id: roomId, body, nickname });
    setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, status: error ? "failed" : undefined } : m)));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const b = text.trim().slice(0, 500);
    if (!b) return;
    setText("");
    void send(b);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && <p className="pt-6 text-center text-sm text-muted-foreground">Say hello while you sort the edges.</p>}
        {msgs.map((m) => {
          const mine = m.user_id === meId;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <span className="text-[11px] text-muted-foreground">{mine ? "You" : m.nickname}</span>
              <p className={`mt-0.5 max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${mine ? "bg-accent" : "bg-secondary"} ${m.status === "sending" ? "opacity-60" : ""}`}>{m.body}</p>
              {m.status === "failed" && (
                <button className="mt-0.5 text-[11px] text-destructive underline" onClick={() => send(m.body, m.id)}>Not sent — tap to retry</button>
              )}
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-border p-3">
        <input className="field" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" />
        <button className="btn-primary px-3" aria-label="Send" disabled={!text.trim()}><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
