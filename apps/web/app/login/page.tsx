/**
 * Login screen.
 *
 * Rendered on the server so the browser never holds the password: the field is
 * an uncontrolled input read at submit time, and the value goes straight to
 * `/api/session`. There is no client bundle here to inspect.
 *
 * The form is a native post, so a wrong password is answered by redirecting back
 * to `/login?error=1` rather than by a 401 body: a browser navigating to a 401
 * shows the raw JSON and loses the form, so the next attempt would start from
 * nothing. The error is rendered inline here, leaving the field and the cursor
 * where they were.
 */

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Only a same-site path: an absolute URL here would turn the login page into
  // an open redirect.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <main className="grid min-h-dvh place-items-center bg-neutral-950 px-6 text-neutral-100">
      <form method="post" action="/api/session" className="w-full max-w-xs space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold">StreamKit</h1>
          <p className="text-xs text-neutral-500">Masuk untuk mengelola overlay</p>
        </div>

        {/* A wrong password redirects back here with ?error=1. The flag is
            rendered, never the message: anything interpolated from the query
            would be reflected content, and the wording is not worth that. The
            field keeps focus, so the next attempt is one type-and-submit. */}
        {error ? (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            Password salah.
          </p>
        ) : null}

        <input type="hidden" name="next" value={target} />

        <label className="block space-y-1.5">
          <span className="text-xs text-neutral-400">Password</span>
          {/* formAction posts to the API, so this is a native form submit: no
              JS required, and the cookie is set by the same response. */}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="w-full rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-sm outline-none transition focus:border-white/40"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
        >
          Masuk
        </button>
      </form>
    </main>
  );
}
