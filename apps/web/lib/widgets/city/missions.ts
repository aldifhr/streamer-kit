/**
 * The pixel city — shared missions.
 *
 * One thing for the whole room to do, and one thing for the whole room to see
 * when they have done it. The reward is a decoration that stays up for the rest
 * of the stream: likes that light the street and then leave it lit are a shared
 * achievement, and the point of it being permanent is that everyone who arrives
 * ten minutes later can see it too.
 */

/** What the room has to do, and what the street looks like when they do. */
export type MissionGoal = "likes" | "comments" | "joins" | "gifts";
export type Decoration = "lights" | "banners" | "flags";

export interface MissionSpec {
  id: string;
  /** What the room has to do, in the words shown on the board. */
  label: string;
  goal: MissionGoal;
  target: number;
  reward: Decoration;
}

/**
 * The board, smallest first.
 *
 * A room of forty people needs a number it can actually see moving, so nothing
 * here is past a few hundred. A target that takes ten minutes of a busy stream
 * to reach is a target nobody watches, and one that takes thirty seconds is one
 * everybody clears before it is finished being read.
 */
export const MISSIONS: MissionSpec[] = [
  { id: "likes", label: "NYALAKAN LAMPU FESTIVAL", goal: "likes", target: 100, reward: "lights" },
  { id: "comments", label: "PASANG SPANDUK KOTA", goal: "comments", target: 60, reward: "banners" },
  { id: "joins", label: "HANGGAR KOLABORASI", goal: "joins", target: 40, reward: "flags" },
  { id: "gifts", label: "BUKA PASAR KOTA", goal: "gifts", target: 25, reward: "banners" },
];

export interface MissionState {
  /** The mission on the board. */
  index: number;
  progress: number;
  /** Set when the current one has just been cleared, for the banner. */
  justCleared: boolean;
  /** Cleared until this many milliseconds have passed. */
  holdUntil: number;
}

export interface MissionOptions {
  /** How long a cleared mission stays cleared before the next one goes up. */
  holdMs: number;
  now: () => number;
  onCleared?: (spec: MissionSpec) => void;
}

export interface Missions {
  /** The mission on the board, and how far along the room is. */
  current: () => { spec: MissionSpec; progress: number; ratio: number };
  /** Counts one thing towards the current mission. Ignores a cleared one. */
  credit: (what: MissionGoal, n: number) => boolean;
  /** Ticks the cleared hold. Call once per update. */
  update: () => void;
  /** What the room has lit up, for the rest of the stream. */
  lit: () => Decoration[];
  /** For the editor and for tests. */
  state: () => MissionState;
}

/**
 * Creates the mission board.
 *
 * Progress is per mission rather than cumulative, so clearing one does not
 * carry over into the next: the second task should be a task, not a head start
 * on a task.
 */
export function createMissions(opts: MissionOptions): Missions {
  const state: MissionState = { index: 0, progress: 0, justCleared: false, holdUntil: 0 };

  const spec = () => MISSIONS[state.index % MISSIONS.length];

  return {
    current: () => {
      const s = spec();
      return {
        spec: s,
        progress: Math.min(state.progress, s.target),
        ratio: clamp01(state.progress / s.target),
      };
    },

    credit(what, n) {
      const s = spec();
      if (what !== s.goal) return false;
      // A cleared board is a board nobody is reading yet, so it takes nothing.
      if (state.justCleared) return false;
      const before = state.progress;
      state.progress = Math.min(state.progress + n, s.target);
      if (state.progress >= s.target && before < s.target) {
        state.justCleared = true;
        state.holdUntil = opts.now() + opts.holdMs;
        opts.onCleared?.(s);
        return true;
      }
      return false;
    },

    update() {
      if (!state.justCleared) return;
      if (opts.now() < state.holdUntil) return;
      state.justCleared = false;
      state.progress = 0;
      // Rotate rather than restart, so four rooms in do not all see the same
      // task in the same order.
      state.index = (state.index + 1) % MISSIONS.length;
    },

    /**
     * Everything cleared so far, not just the last one.
     *
     * Held as a set of decoration names rather than a flag per mission, because
     * two missions can hand out the same decoration and lit twice is still lit
     * once. The board is the record; the street is the set.
     */
    lit: () => {
      const out = new Set<Decoration>();
      for (let i = 0; i < state.index; i++) out.add(MISSIONS[i % MISSIONS.length].reward);
      if (state.justCleared) out.add(spec().reward);
      return [...out];
    },

    state: () => ({ ...state }),
  };
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}