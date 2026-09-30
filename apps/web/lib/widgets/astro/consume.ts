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
 * It used to advance on `entries[0].seq` instead. `entries[0]` is the *oldest*
 * entry still in the buffer, not the newest, so the marker trailed a long way
 * behind: after handling 1..5 it read 1, and the next render replayed 2..8.
 * Every replay called `handle()` again, and `handle()` awards XP — so a busy
 * room paid out the same comment several times over, in proportion to how long
 * the buffer took to fill. Nothing looked broken, which is why it survived.
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

  // The buffer is normally ordered, so this is a binary search in all but name.
  // Scanning from the end is deliberate: on a re-render with no new entries it
  // stops immediately, and a busy room replays nothing.
  let start = entries.length - 1;
  while (start >= 0 && entries[start].seq > consumed) start--;

  const fresh = entries.slice(start + 1);
  // The newest handled, not the oldest retained. Taking `entries[0]` here is what
  // made every later render replay the whole buffer.
  const newest = entries[entries.length - 1].seq;
  return { fresh, consumed: Math.max(consumed, newest) };
}
