/**
 * Which feed entries still need to be handed to the engine.
 *
 * Generic over the entry type on purpose: the caller needs the whole `Entry`,
 * not a `{ seq }` shell, and a signature that returned only the sequence number
 * would make every caller cast its way back to something it already had.
 *
 * The feed is a ring buffer: it keeps the most recent N events and drops the
 * rest. The engine must therefore be told "everything I have not seen", and the
 * only durable marker for that is the highest sequence number handled so far.
 *
 * The buffer is **newest first**. `setEntries` prepends, so `entries[0]` is the
 * most recent message and `entries[entries.length - 1]` is the oldest still
 * retained.
 *
 * That ordering was the bug this file existed to fix, and it fixed it backwards.
 * It scanned from the end and read its marker off the last element, which under
 * a prepend is the oldest: after a first pass the marker sat on the oldest
 * entry, so the scan matched it immediately, `fresh` came back empty, and the
 * engine was never told about anything again. Nothing threw. The room simply
 * stopped growing — the city froze at the one resident present when the widget
 * mounted, and every scene using this helper did the same.
 *
 * The tests agreed with the bug because they built their buffers oldest first,
 * so they exercised a shape the feed never produces. Both sides have to be the
 * real order for this to mean anything.
 *
 * Isolated here so the arithmetic can be tested without a canvas, a socket or a
 * room. The cases that matter are the ones the ring buffer creates: entries
 * arriving after a trim, entries arriving out of order, and a first run over a
 * buffer that is already full.
 */

export interface Sequenced {
  seq: number;
}

/**
 * The entries not yet handled, and the new marker to remember.
 *
 * Returns an empty list when there is nothing new, which is the common case on
 * a re-render caused by anything other than a message.
 */
export function takeNew<T extends Sequenced>(entries: T[], consumed: number): { fresh: T[]; consumed: number } {
  if (!entries.length) return { fresh: [], consumed };

  // Walk forward from the newest while the entry has not been seen. On a
  // re-render with no new messages the very first comparison ends the walk, so
  // a busy room replays nothing.
  let i = 0;
  while (i < entries.length && entries[i].seq > consumed) i++;

  // Handed over oldest first: the engine applies effects in the order they
  // happened, and reversing a newest-first buffer is what puts them back.
  const fresh = entries.slice(0, i).reverse();
  const newest = entries[0].seq;
  return { fresh, consumed: Math.max(consumed, newest) };
}
