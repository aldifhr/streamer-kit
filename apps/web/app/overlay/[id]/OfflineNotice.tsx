import { noticeFor } from "@/lib/overlay/notice";

/**
 * The picture and the diagnosis are different sentences.
 *
 * What was on screen was the raw socket string — "Connection failed:
 * TikTokLive v7.0.1 -> UserOfflineError" — which told the audience nothing and
 * told whoever was watching it fail a great deal, inside a red box that looked
 * like the overlay was broken rather than the stream not running.
 *
 * The raw string is not lost: it is still in the document title, which is where
 * the person actually looks. These cases only pin down what is not shown.
 */
export function OfflineNotice({ error, username }: { error: unknown; username?: string | null }) {
  const { headline, detail } = noticeFor(error, username);
  return (
    <div className="sk-notice" role="status">
      <p className="sk-notice-head">{headline}</p>
      {detail ? <p className="sk-notice-detail">{detail}</p> : null}
    </div>
  );
}