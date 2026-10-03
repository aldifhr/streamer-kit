/**
 * What the editor shows for an overlay it has just loaded.
 *
 * The bug this is here to prevent is a single conditional:
 *
 *     if (data.username) setUsername(data.username);
 *
 * `setUsername` is only called when the incoming overlay actually has a channel,
 * so an overlay without one never clears the field. Open an overlay, type a
 * channel, open a second one, and the second still shows the first one's handle
 * as though it had been typed there — the editor asserting something the user
 * never did. It reads as a backend that kept connecting the old channel, which
 * sends you looking in the wrong place entirely.
 *
 * Per-overlay state is replaced on every load. "Not present" means empty, not
 * "keep whatever was there".
 */

export interface OverlayPayload {
  username?: string | null;
  [key: string]: unknown;
}

/** The platforms an overlay can be pointed at. */
export type SourceKind = "tiktok" | "youtube";

export const SOURCE_LABELS: Record<SourceKind, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** What to call the channel box, since "username" is only right for one of them. */
export const SOURCE_CHANNEL_LABEL: Record<SourceKind, string> = {
  tiktok: "TikTok username",
  youtube: "YouTube channel",
};

export interface OverlayIdentity {
  /** The channel this overlay is pointed at, or "" when it has none. */
  username: string;
  /** Which platform that channel is on. */
  source: SourceKind;
  /** Any error from the previous overlay, cleared once this one loads. */
  error: string | null;
}

export const EMPTY_IDENTITY: OverlayIdentity = { username: "", source: "tiktok", error: null };

/**
 * The identity to show after loading `payload`.
 *
 * `previous` is taken so the rule can be stated as a replacement rather than an
 * omission: whatever the previous overlay said is discarded either way.
 */
export function loadedIdentity(
  payload: OverlayPayload | null,
  previous: OverlayIdentity = EMPTY_IDENTITY,
): OverlayIdentity {
  if (!payload) return { username: "", source: "tiktok", error: previous.error };
  // `typeof` rather than truthiness, so a username of "0" is kept and anything
  // that is not a string at all is treated as absent.
  const username = typeof payload.username === "string" ? payload.username : "";
  // A stored record written before the picker existed has no source. TikTok is
  // what every one of them was, so that is the only honest reading.
  const source = payload.source === "youtube" ? "youtube" : "tiktok";
  return { username, source, error: null };
}