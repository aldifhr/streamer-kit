/**
 * What to say when the room cannot be reached.
 *
 * The raw string came straight off the socket:
 *
 *     Connection failed: TikTokLive v7.0.1 -> UserOfflineError
 *
 * which is a diagnosis written for whoever is fixing it, shown to the audience
 * on stream. `UserOfflineError` in particular says nothing to a viewer and a
 * great deal to whoever is wondering why their overlay is a red box.
 *
 * So the two are separated. What is on screen is short and about the situation:
 * the stream is not running. The technical detail stays in the document title,
 * which is where a person actually looks when something is wrong — the tab, or
 * OBS's log — and is not part of the picture.
 */

export type Notice = {
  /** Big line for the audience. */
  headline: string;
  /** Small line naming the channel, when one is known. */
  detail: string | null;
};

const CHANNEL = /@([A-Za-z0-9._-]+)/;

/**
 * Reduce a socket or source error to something a viewer should read.
 *
 * `UserOfflineError` and its relatives mean the room is not live, which is not
 * the same as "the overlay is broken" and reads completely differently to
 * someone watching. Everything else keeps a generic line rather than inventing
 * a specific one: a wrong guess about why a stream is down is worse than an
 * honest general statement.
 */
export function noticeFor(error: unknown, username?: string | null): Notice {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : String(error ?? "");

  // The channel can come from the caller or be sitting in the message itself,
  // which is where it usually is: the source reports a failure as
  // "UserOfflineError (@room.live)". Looking only at the argument found nothing
  // in the real string.
  const fromArg = username ? `@${String(username).replace(/^@/, "")}` : "";
  const channel = (fromArg.match(CHANNEL)?.[1] ?? raw.match(CHANNEL)?.[1]) || null;

  const offline =
    /useroffline|usernotexist|not\s*live|stream\s*(has\s*)?ended|roomnotfound/i.test(raw);

  // Never a blank second line. A headline alone across a 1280-wide source looks
  // like the overlay failed to render the rest of the notice, which is a worse
  // read than a line that is true and dull.
  const detail = channel
    ? `${channel} is not live`
    : offline
      ? "Belum ada live yang berjalan"
      : "Menunggu koneksi";

  return { headline: "STREAMER IS OFFLINE", detail };
}