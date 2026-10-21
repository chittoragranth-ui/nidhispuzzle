import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Handler = (payload: any) => void;

export interface PresenceUser {
  user_id: string;
  nickname: string;
}

/** One realtime channel per room for transient state: drags, cursors, call signalling, presence. */
export class RoomBus {
  channel: RealtimeChannel;
  private handlers = new Map<string, Set<Handler>>();
  private statusHandlers = new Set<(s: string) => void>();
  private presenceHandlers = new Set<(users: PresenceUser[]) => void>();

  constructor(roomId: string, private me: PresenceUser) {
    this.channel = supabase.channel(`room:${roomId}`, {
      config: { broadcast: { self: false }, presence: { key: me.user_id } },
    });
    this.channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
      this.handlers.get(event)?.forEach((h) => h(payload));
    });
    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState<PresenceUser>();
      const users = Object.values(state).map((arr) => arr[0]).filter(Boolean);
      this.presenceHandlers.forEach((h) => h(users));
    });
    this.channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await this.channel.track(this.me);
      this.statusHandlers.forEach((h) => h(status));
    });
  }

  on(event: string, h: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(h);
    return () => this.handlers.get(event)?.delete(h);
  }
  onStatus(h: (s: string) => void) {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }
  onPresence(h: (u: PresenceUser[]) => void) {
    this.presenceHandlers.add(h);
    return () => this.presenceHandlers.delete(h);
  }
  send(event: string, payload: unknown) {
    void this.channel.send({ type: "broadcast", event, payload });
  }
  close() {
    void supabase.removeChannel(this.channel);
  }
}
