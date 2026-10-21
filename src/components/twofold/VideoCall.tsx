import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import type { RoomBus } from "@/lib/room-bus";

const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

type Status = "idle" | "starting" | "waiting" | "connecting" | "live" | "error";

/** Peer-to-peer call for exactly two people, signalled over the private room channel. */
export function VideoCall({ bus, meId, partnerName, partnerOnline }: { bus: RoomBus; meId: string; partnerName?: string; partnerOnline: boolean }) {
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const inCall = useRef(false);

  const makePc = () => {
    pc.current?.close();
    const p = new RTCPeerConnection({ iceServers: ICE });
    stream.current?.getTracks().forEach((t) => p.addTrack(t, stream.current!));
    p.onicecandidate = (e) => e.candidate && bus.send("rtc", { from: meId, kind: "ice", candidate: e.candidate.toJSON() });
    p.ontrack = (e) => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
      setRemoteHasVideo(e.streams[0].getVideoTracks().length > 0);
    };
    p.onconnectionstatechange = () => {
      if (p.connectionState === "connected") setStatus("live");
      if (p.connectionState === "failed") { setStatus("error"); setErr("The call connection dropped. Try again."); }
      if (p.connectionState === "disconnected") setStatus("connecting");
    };
    pc.current = p;
    return p;
  };

  const offer = async () => {
    const p = makePc();
    setStatus("connecting");
    await p.setLocalDescription(await p.createOffer());
    bus.send("rtc", { from: meId, kind: "offer", sdp: p.localDescription });
  };

  useEffect(() => {
    const off = bus.on("rtc", async (m) => {
      if (m.from === meId) return;
      if (m.kind === "leave") {
        pc.current?.close(); pc.current = null;
        if (remoteRef.current) remoteRef.current.srcObject = null;
        if (inCall.current) setStatus("waiting");
        return;
      }
      if (!inCall.current) return;
      try {
        if (m.kind === "hello") {
          if (meId < m.from) await offer();
          else bus.send("rtc", { from: meId, kind: "hello-ack" });
        } else if (m.kind === "hello-ack") {
          if (meId < m.from) await offer();
        } else if (m.kind === "offer") {
          const p = makePc();
          setStatus("connecting");
          await p.setRemoteDescription(m.sdp);
          await p.setLocalDescription(await p.createAnswer());
          bus.send("rtc", { from: meId, kind: "answer", sdp: p.localDescription });
        } else if (m.kind === "answer") {
          await pc.current?.setRemoteDescription(m.sdp);
        } else if (m.kind === "ice") {
          await pc.current?.addIceCandidate(m.candidate).catch(() => {});
        }
      } catch {
        setStatus("error"); setErr("Couldn't connect the call.");
      }
    });
    return off;
  }, [bus, meId]);

  const join = async (withVideo: boolean) => {
    setErr(""); setStatus("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? { width: 640, height: 480 } : false });
    } catch (e) {
      const name = (e as DOMException).name;
      setStatus("error");
      setErr(name === "NotAllowedError" ? "Camera or microphone access was blocked. Allow it in your browser settings." : name === "NotFoundError" ? "No camera or microphone found." : "Couldn't start your camera or microphone.");
      return;
    }
    setCam(withVideo); setMic(true);
    if (localRef.current) localRef.current.srcObject = stream.current;
    inCall.current = true;
    setStatus("waiting");
    bus.send("rtc", { from: meId, kind: "hello" });
  };

  const leave = () => {
    inCall.current = false;
    bus.send("rtc", { from: meId, kind: "leave" });
    pc.current?.close(); pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    setStatus("idle");
  };
  useEffect(() => () => { if (inCall.current) leave(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = () => { stream.current?.getAudioTracks().forEach((t) => (t.enabled = !mic)); setMic(!mic); };
  const toggleCam = () => {
    const vt = stream.current?.getVideoTracks();
    if (!vt?.length) return;
    vt.forEach((t) => (t.enabled = !cam)); setCam(!cam);
  };

  if (status === "idle" || (status === "error" && !inCall.current)) {
    return (
      <div className="border-b border-border p-4">
        <p className="label">Call</p>
        <div className="mt-3 flex gap-2">
          <button className="btn-outline flex-1" onClick={() => join(true)}><Video className="h-4 w-4" /> Video</button>
          <button className="btn-outline flex-1" onClick={() => join(false)}><Phone className="h-4 w-4" /> Audio</button>
        </div>
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
      </div>
    );
  }

  const label = { starting: "Starting…", waiting: partnerOnline ? `Waiting for ${partnerName ?? "partner"} to join the call` : "Waiting for your partner", connecting: "Connecting…", live: "On call", error: err, idle: "" }[status];

  return (
    <div className="border-b border-border p-3">
      <div className="relative aspect-video overflow-hidden rounded-md bg-foreground/90">
        <video ref={remoteRef} autoPlay playsInline className={`h-full w-full object-cover ${remoteHasVideo ? "" : "opacity-0"}`} />
        {(!remoteHasVideo || status !== "live") && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-primary-foreground/80">{status === "live" ? `${partnerName} · audio only` : label}</div>
        )}
        <video ref={localRef} autoPlay playsInline muted className={`absolute bottom-2 right-2 w-1/4 rounded border border-card/40 object-cover ${cam ? "" : "hidden"}`} />
      </div>
      <div className="mt-2 flex items-center justify-center gap-1">
        <button className={`btn-icon ${!mic ? "btn-icon-active" : ""}`} aria-label={mic ? "Mute" : "Unmute"} onClick={toggleMic}>{mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</button>
        <button className={`btn-icon ${!cam ? "btn-icon-active" : ""}`} aria-label={cam ? "Turn camera off" : "Turn camera on"} onClick={toggleCam} disabled={!stream.current?.getVideoTracks().length}>{cam ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</button>
        <button className="btn-icon text-destructive" aria-label="End call" onClick={leave}><PhoneOff className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
