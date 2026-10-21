import { supabase } from "@/integrations/supabase/client";

/** Ensures the visitor has a temporary private identity (no account needed). */
export async function ensureIdentity(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) throw new Error(error?.message ?? "Could not start a session");
  return anon.user.id;
}

const NICK_KEY = "twofold:nickname";
export const getNickname = () =>
  typeof window === "undefined" ? "" : localStorage.getItem(NICK_KEY) ?? "";
export const saveNickname = (n: string) => localStorage.setItem(NICK_KEY, n);

export const inviteKey = (roomId: string) => `twofold:invite:${roomId}`;
export const saveInvite = (roomId: string, token: string) =>
  localStorage.setItem(inviteKey(roomId), token);
export const getInvite = (roomId: string) => localStorage.getItem(inviteKey(roomId));
export const inviteUrl = (roomId: string, token: string) =>
  `${window.location.origin}/join/${roomId}?t=${token}`;

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return msg.replace(/^Cannot join: /, "");
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Validates real file signature, decodes safely and re-encodes to a bounded JPEG. */
export async function prepareImage(file: File): Promise<{ blob: Blob; aspect: number; previewUrl: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That image is over 10 MB. Please choose a smaller one.");
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp = String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new Error("Please choose a JPEG, PNG or WebP photo.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("We couldn't read that image. Try another one.");
  }
  const aspect = bmp.width / bmp.height;
  if (aspect < 0.34 || aspect > 2.9) throw new Error("That picture is too long and narrow for a puzzle.");
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not process image"))), "image/jpeg", 0.9),
  );
  return { blob, aspect: w / h, previewUrl: URL.createObjectURL(blob) };
}

/** Upload with real progress reporting. */
export async function uploadWithProgress(path: string, blob: Blob, onProgress: (p: number) => void) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/puzzle-images/${path}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("Content-Type", "image/jpeg");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("Upload failed. Please try again.")));
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(blob);
  });
}
