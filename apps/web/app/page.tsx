import Link from "next/link";

const THEMES = [
  { name: "Minimal Clean", swatch: "from-white/12 to-white/5" },
  { name: "Dark Mode", swatch: "from-zinc-800 to-zinc-950" },
  { name: "High Contrast", swatch: "from-white/25 to-white/5" },
  { name: "Monochrome", swatch: "from-neutral-500/40 to-neutral-900/40" },
  { name: "Frosted Glass", swatch: "from-white/15 to-white/[0.02]" },
  { name: "Soft Grey", swatch: "from-neutral-700/50 to-neutral-900/50" },
];

const FEATURES = [
  {
    title: "Build it from widgets",
    body: "Chat, big alert cards, a live viewer count, a goal bar, a caption strip — or a pixel-art scene where your viewers become astronauts. One URL shows the whole scene.",
  },
  {
    title: "Real TikTok Live events",
    body: "Comments, likes, gifts, joins, follows and shares — streamed straight from the live room, keyed to each viewer rather than to a nickname.",
  },
  {
    title: "No bot account",
    body: "Connect with just the streamer's @username. Nothing to install on the streamer side, no account to link.",
  },
  {
    title: "OBS ready in 3 steps",
    body: "Paste one URL into a Browser Source. Works in OBS, Streamlabs, XSplit and anything else that renders a browser.",
  },
  {
    title: "Fire alerts from anything",
    body: "A built-in trigger, plus a webhook endpoint. A donation alert, a Stream Deck button or a cron job can put something on stream with no backend change.",
  },
  {
    title: "Auto-reconnecting",
    body: "The overlay rides out restarts and network drops on its own. You never have to refresh the source.",
  },
];

const STEPS = [
  { step: "01", title: "Pick a starting point", body: "Choose a template — chat only, chat plus alerts, or the full kit — and enter your @username." },
  { step: "02", title: "Arrange your widgets", body: "Move each widget, restyle it, or add more. Every value is adjustable." },
  { step: "03", title: "Paste into OBS", body: "Copy the overlay URL into a Browser Source and size it to your canvas." },
];

const FAQ = [
  {
    q: "Do I need to install anything?",
    a: "No. There is no bot, no extension and no streaming-plugin integration. The overlay is a web page you point OBS at.",
  },
  {
    q: "Does it work with other streaming software?",
    a: "Anything that supports a browser source works — OBS, Streamlabs Desktop, XSplit, vMix and even a plain browser tab.",
  },
  {
    q: "Why is nothing showing in my overlay?",
    a: "Almost always because the streamer is not live yet. The overlay connects on its own and starts rendering as soon as the room goes live.",
  },
  {
    q: "Can I test it without going live?",
    a: "Yes. The editor has a test panel that fires any event straight into the overlay — a follow, a share, a gift of any size — so you can check an alert or a goal bar before a real stream.",
  },
  {
    q: "Can I run more than one overlay?",
    a: "Yes. Each overlay you create has its own URL, its own theme and its own connection, so they can run side by side.",
  },
  {
    q: "Is it free?",
    a: "Yes — free to run and free to self-host.",
  },
];

const MOCK = [
  { name: "dayone", text: "halo semuanya", tone: "text-white" },
  { name: "louvve3", text: "ggwp streamernya", tone: "text-neutral-400" },
  { name: "savior", text: "konten kombeksh", tone: "text-neutral-500" },
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
            <a href="#features" className="transition hover:text-white">
              Features
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
        {/* Hero */}
        <section className="px-6 pb-16 pt-24 sm:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-[13px] text-neutral-400">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Free · self-hosted · TikTok Live
            </span>

            <h1 className="text-balance text-5xl font-bold leading-[1.08] tracking-tight sm:text-7xl">
              One URL.
              <br />
              <span className="text-neutral-500">A whole overlay scene.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-neutral-400">
              Build your TikTok Live overlay out of widgets — chat, alerts, viewer count, goals, or a
              pixel-art scene your viewers walk around in. No bots, no plugins — just a URL you paste
              into OBS.
            </p>

            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="rounded-full bg-white px-8 py-3.5 text-base font-semibold text-black transition hover:bg-neutral-200"
              >
                Create your overlay
              </Link>
              <a
                href="#themes"
                className="rounded-full border border-white/20 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/5"
              >
                Browse themes
              </a>
            </div>
          </div>
        </section>

        {/* Live preview mock */}
        <section className="px-6 pb-24">
          <div className="mx-auto max-w-3xl">
            <div className="overflow-hidden rounded-2xl border border-white/10 p-px">
              <div className="rounded-[15px] bg-neutral-950 p-6">
                <div className="mb-5 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full border border-white/25" />
                  <span className="h-3 w-3 rounded-full border border-white/25" />
                  <span className="h-3 w-3 rounded-full border border-white/25" />
                  <span className="ml-3 font-mono text-[11px] text-neutral-600">Browser Source</span>
                </div>

                <div className="space-y-2.5">
                  {MOCK.map((m) => (
                    <div key={m.name} className="flex items-baseline gap-2 text-sm">
                      <span className={`shrink-0 font-semibold ${m.tone}`}>{m.name}</span>
                      <span className="truncate text-white/80">{m.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Built for TikTok streamers
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-neutral-500">
              Everything you need to build the overlay you actually want, without touching your
              streaming setup.
            </p>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/25"
                >
                  <h3 className="text-base font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Themes */}
        <section id="themes" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Themes, then make it yours
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-neutral-500">
              Pick a starting point, adjust every colour and size in the browser, or write your own CSS.
            </p>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {THEMES.map((t) => (
                <div
                  key={t.name}
                  className="overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/30"
                >
                  <div className={`flex h-28 items-end bg-gradient-to-br p-4 ${t.swatch}`}>
                    <div className="space-y-1.5">
                      <div className="h-1.5 w-16 rounded-full bg-white/30" />
                      <div className="h-1.5 w-24 rounded-full bg-white/20" />
                    </div>
                  </div>
                  <div className="bg-neutral-950 p-4">
                    <h3 className="text-sm font-semibold text-white">{t.name}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Live in three steps</h2>

            <div className="mt-14 grid gap-10 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.step}>
                  <span className="font-mono text-sm text-neutral-500">{s.step}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Questions</h2>

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
