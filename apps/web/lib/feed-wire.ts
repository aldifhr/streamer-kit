/**
 * Wire payload to feed entry.
 *
 * Separated from the socket hook because this is a contract and nothing about it
 * needs a browser: every field here is something the backend decided to send, or
 * something it did not. Two of the bugs this file was written for were fields
 * this table dropped on the way past — the donation amount, and a like's repeat
 * count — and neither was visible from the widget that suffered for it, because
 * the widget can only report what it was given.
 *
 * No imports, deliberately. A contract that can be compiled and called on its own
 * is one that can be tested end to end from a real payload to the number a widget
 * would add.
 */

import type { Entry, EventKind } from "@/lib/widgets/types";

export interface WirePayload {
  [key: string]: unknown;
}

/**
 * Wire payload to feed entry.
 *
 * Exported because it is a contract, and a contract that cannot be called from a
 * test is a contract that gets broken quietly: two of the bugs fixed here were
 * fields this table dropped, and neither was visible from the widget that
 * suffered for it.
 */
export const FROM_WIRE: Record<
  string,
  (d: Record<string, unknown>) => {
    kind: EventKind;
    user: string;
    userId: string;
    value: string;
    meta: Record<string, unknown>;
  }
> = {
  comment: (d) => ({ kind: "comment", user: String(d.user), userId: id(d), value: String(d.text), meta: {} }),
  // `count` is carried through because a like run really is several likes: the
  // wire says `x10`, and a widget that only sees the event counts one. It is not
  // money, so it is a count in its own right rather than something to multiply a
  // total by — which is exactly the distinction the gift mapping above makes.
  like: (d) => ({
    kind: "like",
    user: String(d.user),
    userId: id(d),
    value: `x${d.count}`,
    meta: { totalLikes: d.totalLikes, ...countMeta(d.count) },
  }),
  gift: (d) => ({
    kind: "gift",
    user: String(d.user),
    userId: id(d),
    value: `${d.giftName} x${d.count}`,
    meta: { diamonds: d.value },
  }),
  join: (d) => ({ kind: "join", user: String(d.user), userId: id(d), value: "", meta: { viewers: d.viewers } }),
  // The room's own size, sent on every heartbeat. This entry has existed in the
  // `EventKind` union since the beginning and had no mapping behind it, so the
  // feed's `if (!build) return;` dropped every frame of it on the floor — which
  // is why a full room rendered as an empty village: nothing downstream was ever
  // wrong, the number simply never arrived.
  viewers: (d) => ({
    kind: "viewers",
    user: "",
    userId: "",
    value: "",
    meta: { count: countMetaValue(d.count ?? d.total_user ?? d.viewers) },
  }),
  follow: (d) => ({ kind: "follow", user: String(d.user), userId: id(d), value: "", meta: {} }),
  share: (d) => ({ kind: "share", user: String(d.user), userId: id(d), value: d.count ? `+${d.count}` : "", meta: {} }),
  alert: (d) => ({
    kind: "alert",
    user: String(d.user ?? ""),
    userId: id(d),
    value: String(d.text ?? ""),
    // `amount` is a number the backend went to the trouble of forwarding, and
    // the only reason a webhook donation is worth anything to the jar. Dropping
    // it here left the widget reading 0 for every donation: the request arrived,
    // the number crossed the wire, and it was discarded before anything could
    // count it. Anything that is not a finite non-negative number is left out
    // entirely rather than passed on as a string, so a widget that asks for
    // `meta.amount` gets a number or nothing — never a truthy string.
    meta: { title: d.title ?? "", icon: d.icon ?? "★", ...amountMeta(d.amount) },
  }),
};

/**
 * The backend sends a stable handle as `userId` and already falls back to the
 * nickname server-side, so the only case left to cover here is a payload that
 * carries neither.
 */
/**
 * The donation amount from a hook, if there is a usable one.
 *
 * Returning nothing rather than a zero is the point: a jar decides whether an
 * event counts by asking whether the amount is positive, and an alert with no
 * amount is an ordinary editor test that must not tip the pot.
 */
/** A non-negative whole number from a field that may be absent or a string. */
const countMetaValue = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/** How many likes a run stands for, when the wire said a usable number. */
const countMeta = (raw: unknown): { count?: number } => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return {};
  return { count: Math.floor(n) };
};

const amountMeta = (raw: unknown): { amount?: number } => {
  if (raw === undefined || raw === null || raw === "") return {};
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return {};
  return { amount: n };
};

const id = (d: Record<string, unknown>): string => {
  const stable = d.userId;
  if (typeof stable === "string" && stable) return stable;
  return typeof d.user === "string" ? d.user : "anon";
};
