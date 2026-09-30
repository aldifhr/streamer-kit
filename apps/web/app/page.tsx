import Link from "next/link";
import { ScenePreview } from "@/lib/landing/ScenePreview";
import { heroScene } from "@/lib/landing/scenes";
import { ThemeSwatch } from "@/lib/editor/ThemeSwatch";

import { THEMES } from "@/lib/scene";
import { WIDGET_LIST } from "@/lib/widgets/registry";

const STEPS = [
  {
    step: "01",
    title: "Pick a starting point",
    body: "Choose a template — chat only, chat plus alerts, the full kit, or a pixel-art scene your viewers walk around in.",
  },
  {
    step: "02",
    title: "Arrange your widgets",
    body: "Move each one, restyle it, or add another. Every value is adjustable, and you can test any event before you go live.",
  },
  {
    step: "03",
    title: "Paste into OBS",
    body: "Copy the overlay URL into a Browser Source and size it to your canvas. That is the whole integration.",
  },
];

const FAQ = [
  {
    q: "Do I need to install anything?",
    a: "No. There is no bot, no extension and no streaming-plugin integration. The overlay is a web page you point OBS at, and it connects itself using the streamer's @username.",
  },
  {
    q: "Does it work with other streaming software?",
    a: "Anything that supports a browser source works — OBS, Streamlabs Desktop, XSplit, vMix, and a plain browser tab if you are testing.",
  },
  {
    q: "Why is nothing showing in my overlay?",
    a: "Usually because the streamer is not live yet. The overlay connects on its own and starts rendering as soon as the room goes live. If it stays blank with a red notice, the API rejected the request — that is a token mismatch, not a connection problem.",
  },
  {
    q: "Can I test an alert without going live?",
    a: "Yes. The editor fires any event straight into the overlay — a follow, a share, a gift of a chosen value — so you can check an alert card or walk a goal bar up before a real stream.",
  },
  {
    q: "Can something other than TikTok put things on my overlay?",
    a: "Yes. There is a webhook endpoint, so a donation alert, a Stream Deck button or a cron job can push an event with no backend change. The same path the test button uses.",
  },
  {
    q: "Can I run more than one overlay?",
    a: "Yes. Each overlay has its own URL, its own scene and its own live connection, so several streams can run side by side.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 text-[13px] font-bold">
              SK
            </span>
            <span className="text-[17px] font-semibold tracking-tight">StreamKit</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-neutral-400 md:flex">
            <a href="#widgets" className="transition hover:text-white">
              Widgets
            </a>
            <a href="#themes" className="transition hover:text-white">
              Themes
            </a>
            <a href="#faq" className="transition hover:text-white">
              FAQ
            </a>
          </nav>

          <Link
            href="/dashboard"
            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            Open dashboard
          </Link>
        </div>
      </header>

      <main>
        {/* Hero — copy beside the real thing rather than above a mock of it */}
        <section className="px-6 pb-20 pt-20 sm:pt-28">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div>
              <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-[13px] text-neutral-400">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                Free · self-hosted · TikTok Live
              </span>

              <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                Your overlay, built
                <br />
                <span className="text-neutral-500">out of widgets.</span>
              </h1>

              <p className="mt-6 max-w-lg text-pretty text-lg leading-relaxed text-neutral-400">
                Chat, alert cards, a live viewer count, a goal bar, or a pixel-art scene where your
                viewers float around as astronauts. Pick the pieces, style each one, and paste a
                single URL into OBS.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard"
                  className="rounded-full bg-white px-7 py-3.5 text-base font-semibold text-black transition hover:bg-neutral-200"
                >
                  Create an overlay
                </Link>
                <a
                  href="#widgets"
                  className="rounded-full border border-white/20 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/5"
                >
                  See the widgets
                </a>
              </div>

              <p className="mt-7 text-sm text-neutral-600">
                No bot account. Nothing installed on the streamer side.
              </p>
            </div>

            {/* The actual renderer, showing the actual scene a new overlay gets. */}
            <div className="relative">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#08080a] shadow-2xl shadow-black/60">
                <div className="flex items-center gap-2 border-b border-white/10 bg-neutral-950 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full border border-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full border border-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full border border-white/20" />
                  <span className="ml-2 font-mono text-[10px] text-neutral-600">Browser Source</span>
                </div>
                <ScenePreview scene={heroScene()} />
              </div>
              <p className="mt-3 text-center text-xs text-neutral-600">
                Chat, alerts, a viewer count and a goal bar — one scene, one URL.
              </p>
            </div>
          </div>
        </section>

        {/* Widgets — straight from the registry */}
        <section id="widgets" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {WIDGET_LIST.length} widgets. One scene.
              </h2>
              <p className="mt-4 text-neutral-500">
                A scene is a list of widgets, and each one owns its own settings. Add a second chat
                column, put alerts in the centre while chat sits in the corner, or drop the chat
                entirely.
              </p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WIDGET_LIST.map((w) => (
                <div
                  key={w.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/25"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{w.icon}</span>
                    <h3 className="text-base font-semibold">{w.label}</h3>
                    {w.fill ? (
                      <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        full frame
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{w.blurb}</p>
                </div>
              ))}
            </div>

            {/* No templates any more. Each overlay is one widget with its own URL,
                so the thing to choose is the widget — and the grid above already
                is that list, with each one's description. */}
          </div>
        </section>

        {/* Themes — the real list, rendered by the real swatch */}
        <section id="themes" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Themes, then make it yours</h2>
              <p className="mt-4 text-neutral-500">
                A theme sets the chat widget and the scene&apos;s shared typography; every widget keeps
                its own controls afterwards. Or skip it and write your own CSS against the same
                custom properties.
              </p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {THEMES.map((t) => (
                <div
                  key={t.id}
                  className="overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/30"
                >
                  <ThemeSwatch theme={t} />
                  <div className="flex items-center justify-between bg-neutral-950 px-4 py-3">
                    <h3 className="text-sm font-semibold">{t.name}</h3>
                    <span className="text-[10px] text-neutral-600">{t.id}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Live in three steps</h2>

            <ol className="mt-12 grid gap-8 sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.step}>
                  <span className="font-mono text-sm text-neutral-600">{s.step}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Questions</h2>

            <div className="mt-12 divide-y divide-white/10 border-y border-white/10">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                    {f.q}
                    <span className="shrink-0 text-neutral-500 transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-500">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to go live?</h2>
            <p className="mt-4 text-neutral-500">Your overlay is one URL away.</p>
            <Link
              href="/dashboard"
              className="mt-9 inline-block rounded-full bg-white px-8 py-3.5 text-base font-semibold text-black transition hover:bg-neutral-200"
            >
              Open dashboard
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-neutral-600 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded border border-white/25 text-[10px] font-bold text-white">
              SK
            </span>
            <span>StreamKit</span>
          </div>
          <p>Widget-based TikTok Live overlay</p>
        </div>
      </footer>
    </div>
  );
}
