import Link from "next/link";
import { HeroPreviews } from "@/lib/landing/HeroPreviews";
import { WidgetGrid } from "@/lib/landing/WidgetGrid";

import { WIDGET_LIST } from "@/lib/widgets/registry";

const STEPS = [
  {
    step: "01",
    title: "Pick a widget",
    body: "Chat, alerts, a viewer count, a goal bar, or a pixel-art scene your viewers drift around in. Each one is its own overlay.",
  },
  {
    step: "02",
    title: "Style it",
    body: "Colours, sizes, spacing, what each event card looks like — all adjustable, and you can fire a test event to see it before you go live.",
  },
  {
    step: "03",
    title: "Paste into OBS",
    body: "Copy the overlay URL into a Browser Source, size it to your canvas, and place it in the source's properties. That is the whole integration.",
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
    a: "Yes. Each overlay has its own URL, its own widget and its own live connection, so several streams can run side by side.",
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
                viewers float around as astronauts. Every widget is its own overlay with its own URL,
                and you paste that URL into OBS.
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

            {/* The actual renderer, showing the actual overlays a streamer ends up
                holding — one widget per Browser Source, not one composed scene. */}
            <div className="relative">
              <HeroPreviews />
              <p className="mt-3 text-center text-xs text-neutral-600">
                Four overlays, four URLs — one Browser Source each.
              </p>
            </div>
          </div>
        </section>

        {/* Widgets — straight from the registry */}
        <section id="widgets" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {WIDGET_LIST.length} widgets. One overlay each.
              </h2>
              <p className="mt-4 text-neutral-500">
                A widget is the whole overlay: its own URL, its own Browser Source, its own
                settings. Chat in the corner and a goal bar along the bottom is two overlays, not
                one scene to arrange — you place each one in OBS, where the rest of your layout
                already lives.
              </p>
            </div>

            <WidgetGrid />
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
