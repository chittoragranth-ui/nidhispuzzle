import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import hero from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Twofold — solve a jigsaw together, wherever you are" },
      { name: "description", content: "Upload a photo, invite one person, and assemble the same 100-piece jigsaw together in real time — with chat and video." },
      { property: "og:title", content: "Twofold — a jigsaw for two" },
      { property: "og:description", content: "One picture. Two people. One puzzle to complete together." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const u = new URL(link.trim());
      const m = u.pathname.match(/^\/join\/([0-9a-f-]{36})$/);
      const t = u.searchParams.get("t");
      if (!m || !t) throw new Error();
      navigate({ to: "/join/$roomId", params: { roomId: m[1] }, search: { t } });
    } catch {
      setErr("That doesn't look like a Twofold invitation link.");
    }
  };

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="wordmark">Twofold</span>
        <Link to="/create" className="btn-ghost">Create a room</Link>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-4 lg:grid-cols-[1fr_1.1fr]">
        <section className="fade-up">
          <p className="label">A jigsaw for two</p>
          <h1 className="mt-4 text-5xl leading-[1.05] md:text-6xl">
            One picture. Two people. One puzzle to finish together.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            Upload a photo you both love, send one private link, and build the same 100‑piece jigsaw
            side by side — from anywhere. Talk while you puzzle.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/create" className="btn-primary px-6 py-3 text-base">Create a room</Link>
          </div>
          <form onSubmit={join} className="mt-8 max-w-md">
            <label className="label" htmlFor="invite">Have an invitation?</label>
            <div className="mt-2 flex gap-2">
              <input id="invite" className="field" placeholder="Paste the link here" value={link}
                onChange={(e) => { setLink(e.target.value); setErr(""); }} />
              <button className="btn-outline shrink-0" type="submit">Join</button>
            </div>
            {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
          </form>
        </section>

        <figure className="fade-up overflow-hidden rounded-lg" style={{ animationDelay: "120ms" }}>
          <img src={hero} alt="Two people's hands assembling a coastal photo jigsaw on a linen table" width={1280} height={1024} className="h-full w-full object-cover" />
        </figure>
      </main>

      <section className="border-t border-border">
        <ol className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-3">
          {[
            ["Choose a picture", "A trip, a pet, a place you both remember. We turn it into 100 interlocking pieces."],
            ["Send one link", "Your room is private and holds exactly two. No account needed to join."],
            ["Solve it together", "Move any piece, see each other's moves instantly, and chat or call as you go."],
          ].map(([t, d], i) => (
            <li key={t}>
              <span className="font-serif text-3xl text-primary">{i + 1}</span>
              <h3 className="mt-2 text-xl">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto max-w-6xl px-6 pb-12 text-xs text-muted-foreground">
          Private by design: rooms are never listed, photos are stored privately and only visible to the two people in the room, and invitations expire after 7 days.
        </p>
      </section>
    </div>
  );
}
