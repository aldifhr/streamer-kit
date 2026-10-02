/**
 * The pixel city engine — part three of three: state, residents, the loop.
 *
 * Two things here are deliberate departures from the standalone original, and
 * both came from watching it rather than reading it:
 *
 * - The frame loop steps by the time it is owed, not by the gap since the last
 *   frame that ran. See `tick` for the whole reason.
 * - Every transient effect has an age and a ceiling. The original had neither,
 *   and a room that sent a few large gifts put tens of thousands of sprites on
 *   screen and took the frame rate with it.
 */

import type { Entry } from "../types";
import { CITY_RANKS, DEFAULT_CITY_CONFIG } from "./config";
import type { CityConfig, CityEngine } from "./config";
import {
  BAY,
  OUT,
  PLATE,
  R,
  clamp,
  ease,
  hash32,
  lerp,
  lighten,
  lookFor,
  mulberry32,
  personParts,
  poseOf,
  rand,
  rankFor,
  sanitize,
  shade,
  levelFor,
} from "./sprites";
import type { Emote, Look, Part, Pose } from "./sprites";
import type { Activity } from "./activities";
import {
  buildLayers,
  drawPartsOn,
  genCity,
  mk,
  plateOn,
  txtOn,
  txtOutlineOn,
} from "./scenery";
import type { CityLayout, Ctx, Door, ShopOwners, Sprite } from "./scenery";
import { NO_COS, cosFor, decorate, isCos } from "./cosmetics";
import type { Cos } from "./cosmetics";
import { buildLocal, pickLocalType, speedFor, trailsConfetti } from "./local";
import { createShops, SHOP_SLOTS } from "./shops";
import { createActivities } from "./activities";
import type { Spot } from "./activities";
import { createStaging, stagedKindFor } from "./staging";
import { createWeather, drawPuddles, drawRain, drawRainWash, drawRainbow } from "./weather";
import { createMissions } from "./missions";
import type { MissionGoal } from "./missions";
import { createMayor, ESCORT } from "./mayor";
import { drawDecorations } from "./decor";
import type { Weather } from "./weather";

interface Resident {
  id: string;
  name: string;
  xp: number;
  rank: number;
  badge: boolean;
  look: Look;
  friends: { look: Look; x: number; y: number; dir: number; moving: boolean; t: number; k: number }[];
  x: number;
  y: number;
  dir: number;
  /** Per-walk stride offset, so a crowd is not in lockstep. */
  t: number;
  speed: number;
  state: "enter" | "walk" | "idle" | "exit";
  /** What they are doing when they are not walking. */
  activity: Activity;
  /** Seconds left in the current activity. */
  actT: number;
  /** The mayor they are walking with, or null when they are nobody's escort. */
  escortOf: string | null;
  /** Where an activity takes them, or null. */
  spot: Spot | null;
  /** The other resident they are greeting, if any. */
  partnerId: string | null;
  /** The wardrobe their gifts bought. */
  cos: Cos;
  /** Diamonds they have given, which is what a shopfront and a hat are for. */
  given: number;
  tx: number;
  ty: number;
  wait: number;
  moving: boolean;
  enterT: number;
  exitPhase: number;
  exitT: number;
  exitMode: "edge" | "door";
  door: Door | null;
  lastActive: number;
  bubble: string;
  bubbleUntil: number;
  emote: Emote | null;
  /** Bayer threshold: 0 is fully dissolved, 1 is fully solid. */
  dissolve: number;
}

interface Car {
  cv: Sprite;
  dir: number;
  type: string;
  x: number;
  base: number;
  speed: number;
  ph: number;
  nextConf: number;
}

interface Coin { x: number; y: number; vy: number; vx: number; ground: number; life: number; bounced: number; ph: number; born: number }
interface Heart { x: number; y: number; vy: number; ph: number; life: number; delay: number; born: number }
interface Confetti { x: number; y: number; vx: number; vy: number; c: string; ph: number; vertical: boolean; life: number; born: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; decay: number; c: string; s: number; g: number; born: number }
interface Rocket { x: number; y: number; vy: number; ty: number; hue: number; delay: number; heart: boolean }
interface Floater { text: string; x: number; y: number; t: number; c: string }
interface Toast { text: string; color: string; t0: number }
interface ChatLine { name: string; msg: string; color: string; t0: number }
interface Spotlight { id: string; until: number }
interface Plane { dir: number; x: number; y: number; speed: number; ph: number; banner: HTMLCanvasElement }

interface StoreRecord {
  name: string;
  xp: number;
  rank: number;
  badge: boolean;
  friends: number;
  /** Total diamonds given, kept so the wardrobe and the shop survive a reload. */
  given?: number;
  cos?: Cos;
}

/**
 * Ceilings for the live effects.
 *
 * Sized so a busy room looks busy rather than broken. The original had no
 * ceilings, and the rocket launcher alone could put ninety-four rockets and
 * several thousand sparks on screen from a single gift, which is what turned a
 * generous donation into a slideshow.
 */
const CAP = { coins: 220, hearts: 160, confetti: 420, sparks: 700 } as const;
/** Rockets are staggered by a delay, so the cap is on the queue as a whole. */
const ROCKET_CAP = 24;

/**
 * Vehicles on the road at once.
 *
 * Every other transient in this scene has a ceiling and the traffic did not. A
 * burst of large gifts queued a limo per gift, all of them appearing at the same
 * point on the same lane with independently randomised speeds, so the faster
 * ones drove through the slower ones and the lane became one unbroken line of
 * eighteen vehicles with confetti stacked on the roofs.
 */
const CAR_CAP = 10;
/** Seconds between the limos in a gift procession. */
const LIMO_GAP = 1.4;
/**
 * How many parade vehicles one run of gifts can put on the road.
 *
 * The queue is short on purpose. A deep queue does not look like a bigger
 * parade, it looks like traffic that never stops: at one vehicle every 1.4
 * seconds, a burst of sixty gifts kept the road busy for the better part of a
 * minute after the last one arrived.
 */
const LIMO_QUEUE_CAP = 3;

export interface CityEngineOptions {
  canvas: HTMLCanvasElement;
  config: Partial<CityConfig>;
}

export function createCityEngine(opts: CityEngineOptions): CityEngine {
  const { canvas } = opts;
  const doc = canvas.ownerDocument;
  // The caller's config is the starting config, not a value to be read later.
  // Dropping it here meant every control in the editor did nothing and the
  // engine always ran on its defaults — which is exactly how a roster cap that
  // the editor exposes can be absent at runtime.
  let config: CityConfig = { ...DEFAULT_CITY_CONFIG, ...opts.config };
  const mainCtx = canvas.getContext("2d")!;
  // A second store, so the sky, the tint and the shake can be composited
  // without touching what the browser finally shows.
  const sc = mk(1, 1, doc);
  const scCtx = sc.getContext("2d")!;

  let W = 0, H = 0, PX = 3, LW = 320, LH = 180, SY0 = 100, SY1 = 140, ROAD0 = 146;
  let layout: CityLayout = { buildings: [], doors: [], wins: [], signs: [], props: [] };
  let layers = buildLayers(doc, layout, LW, LH, SY0, SY1, ROAD0);
  let ready = false;

  const people = new Map<string, Resident>();
  const cars: Car[] = [];
  const coins: Coin[] = [], hearts: Heart[] = [], confetti: Confetti[] = [], sparks: Spark[] = [];
  const rockets: Rocket[] = [], floaters: Floater[] = [], toasts: Toast[] = [], chatlog: ChatLine[] = [];
  const spotlights: Spotlight[] = [];
  let plane: Plane | null = null;

  const dissolveCv = mk(26, 30, doc);
  const dissolveCtx = dissolveCv.getContext("2d", { willReadFrequently: true })!;
  const carCache = new Map<string, Sprite>();
  const localCache = new Map<string, Sprite>();
  const glowCache = new Map<number, HTMLCanvasElement>();

  /**
   * The scene's residents hold their wardrobe and their diamonds on their own
   * record, and the shopfronts are the one piece of state that is not per-person:
   * it belongs to the row of buildings, so it lives here and is re-baked into the
   * layer whenever the ranking changes.
   */
  const shops = createShops({
    max: SHOP_SLOTS,
    onChanged: (owners: ShopOwners) => {
      // The signs are baked into the building layer, so a change of owner means
      // the layer has to be built again. Rare, and cheaper than drawing the
      // whole row live every frame.
      rebakeCity(owners);
    },
  });

  const activities = createActivities({
    spots: () => ({
      bench: layout.props.filter((q) => q.type === "bench").map((q) => ({ x: q.x, y: q.y - 1, room: 2 })),
      shop: layout.buildings
        .filter((b) => b.x > 0 && b.x < LW)
        .slice(0, 8)
        .map((b) => ({ x: clamp(b.x + b.w / 2, 6, LW - 6), y: SY0 + 3, room: 1 })),
      shelter: layout.props.filter((q) => q.type === "busstop").map((q) => ({ x: q.x, y: q.y - 1, room: 3 })),
    }),
    greetRange: () => 10,
  });

  /**
   * The staged effects.
   *
   * A gift over the bar does not fire anything here: it goes on this queue and
   * runs when the stage is free. A run of them used to land in the same second
   * and read as a still frame.
   */
  const staging = createStaging({
    max: 12,
    run: (effect) => beginStaged(effect.kind, effect.by, effect.amount),
    onRefused: (_kind, total) => {
      addToast(`ANTREAN PENUH  +${Math.round(total)}`, "#ff8a8a");
    },
  });

  const weather = createWeather({
    LW: () => LW,
    LH: () => LH,
    SY1: () => SY1,
    ROAD0: () => ROAD0,
    lamps: () => layout.props.filter((q) => q.type === "lamp").map((q) => ({ x: q.x, y: q.y })),
    onLightning: () => {
      shake(0.2, 1);
    },
  });

  let totalDiamonds = 0, flashUntil = 0, shakeUntil = 0, shakeAmp = 0;
  let partyUntil = 0, searchUntil = 0, todOffset = 0, nextCar = 0;

  /**
   * The engine's own time, in milliseconds, as of the last tick.
   *
   * Anything on a timer reads this rather than `performance.now()`, because the
   * two are not the same thing: the tick carries a timestamp the harness and the
   * frame budget can both shape, and a module that kept its own real-time clock
   * would hold a board "cleared" forever whenever the two drifted apart.
   */
  let clock = 0;

  /** Maps an event kind onto the board's counter, if it feeds it at all. */
  function missionGoalFor(kind: string): MissionGoal | "none" {
    if (kind === "like") return "likes";
    if (kind === "comment") return "comments";
    if (kind === "join") return "joins";
    if (kind === "gift") return "gifts";
    return "none";
  }

  /** How long a cleared mission stays on the board before the next goes up. */
  const MISSION_HOLD_MS = 7000;

  const missions = createMissions({
    holdMs: MISSION_HOLD_MS,
    now: () => clock,
    onCleared: (spec) => {
      addToast(`KOTA MENYELESAIKAN ${spec.label}`, "#ffd95d");
      sparkle(LW / 2, SY0, 24, "#ffd95d");
    },
  });

  const mayor = createMayor({
    now: () => clock,
    onChange: (m, tookFrom) => {
      // The handover is the whole point of a contested title, so it gets said
      // out loud rather than just changing who is standing next to the car.
      addToast(
        tookFrom ? `${m.name} GANTI ${tookFrom.name} SEBAGAI WALIKOTA` : `${m.name} JADI WALIKOTA`,
        "#7da8ff",
      );
      escortMayor(m.id);
      escortRetryIn = 0.5;
    },
  });
  /**
   * When the next attempt at staffing the convoy is due.
   *
   * Escorts are borrowed from the crowd, and the crowd is often mid-greeting or
   * mid-activity at the exact moment a title changes hands. Asking once meant the
   * occasional mayor arriving alone with an empty space beside the car, which
   * read as a bug rather than as a crowd that was busy. So the ask repeats until
   * it succeeds, and stops the moment it does.
   */
  let escortRetryIn = 0;
  let paradeQueue = 0, paradeCooldown = 0, bazaarUntil = 0, fireUntil = 0;
  /** Limos still owed, and how long until the next one is let out. */
  let limoQueue = 0, limoCooldown = 0;
  /** Where the day starts when nothing has pinned it. */
  const START_TIME = 0.2;
  let TOD = START_TIME;

  let store: Record<string, StoreRecord> = {};
  try {
    store = JSON.parse(globalThis.localStorage?.getItem(config.storeKey) || "{}") || {};
  } catch {
    store = {};
  }
  let storeDirty = false;
  const storeTimer = setInterval(() => {
    if (!storeDirty) return;
    try {
      globalThis.localStorage?.setItem(config.storeKey, JSON.stringify(store));
      storeDirty = false;
    } catch {
      // A full or disabled storage is not a reason to stop the city.
    }
  }, 10e3);

  /* ---------------------------------------------------------------------
   * time of day
   * ------------------------------------------------------------------ */

  // [tod, sky top RGB, horizon RGB, tint RGB, tint alpha, night]
  const KF = [
    [0.00, 58, 74, 138, 242, 160, 90, 240, 140, 90, 0.20, 0.55],
    [0.12, 90, 160, 224, 191, 224, 240, 255, 230, 200, 0.04, 0.10],
    [0.25, 63, 143, 224, 168, 216, 245, 0, 0, 0, 0, 0],
    [0.45, 74, 150, 224, 207, 230, 240, 0, 0, 0, 0, 0],
    [0.58, 58, 63, 138, 240, 122, 74, 250, 120, 70, 0.22, 0.35],
    [0.66, 21, 26, 74, 90, 58, 106, 40, 40, 110, 0.45, 0.80],
    [0.80, 7, 10, 36, 20, 26, 68, 15, 25, 85, 0.58, 1],
    [0.92, 10, 14, 48, 26, 32, 80, 15, 25, 85, 0.55, 0.95],
    [1.00, 58, 74, 138, 242, 160, 90, 240, 140, 90, 0.20, 0.55],
  ] as const;

  function kfAt(tod: number): number[] {
    for (let i = 0; i < KF.length - 1; i++) {
      const a = KF[i], b = KF[i + 1];
      if (tod >= a[0] && tod <= b[0]) {
        const t = (tod - a[0]) / (b[0] - a[0]);
        return a.map((v, j) => (j === 0 ? tod : lerp(v, b[j], t)));
      }
    }
    return KF[0].slice() as unknown as number[];
  }
  let KFN = kfAt(TOD);
  const nightF = () => KFN[11];

  const stars = Array.from({ length: 90 }, () => ({
    x: Math.random(), y: Math.random() * 0.6, ph: Math.random() * 6, sp: 0.6 + Math.random() * 2,
  }));
  const clouds = Array.from({ length: 5 }, (_, i) => ({
    x: i * 0.22, y: 0.08 + Math.random() * 0.2, s: 0.7 + Math.random() * 0.8, v: 1.5 + Math.random() * 2,
  }));

  /* ---------------------------------------------------------------------
   * transient effects
   * ------------------------------------------------------------------ */

  /**
   * Trims an effect list to its ceiling, dropping the oldest.
   *
   * Dropping the newest instead would mean a burst could never get in once the
   * list was full, and the tail of a gift would silently stop appearing. Oldest
   * first keeps the effect responsive to what is happening now.
   */
  function trim<T>(list: T[], cap: number) {
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  function sparkle(x: number, y: number, n: number, c: string) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      sparks.push({
        x, y, vx: rand(-28, 28), vy: rand(-34, 10),
        life: 1, decay: 1.2, c, s: Math.random() < 0.3 ? 2 : 1, g: 30, born: now,
      });
    }
    trim(sparks, CAP.sparks);
  }

  function addCoins(p: Resident, n: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      coins.push({
        x: p.x + rand(-14, 14), y: p.y - rand(40, 70), vy: rand(10, 25), vx: rand(-4, 4),
        ground: p.y + rand(-2, 3), life: 4, bounced: 0, ph: rand(0, 6), born: now,
      });
    }
    trim(coins, CAP.coins);
  }

  function addHearts(x: number, y: number, n: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      hearts.push({ x: x + rand(-6, 6), y: y - rand(0, 6), vy: -rand(14, 26), ph: rand(0, 6), life: 2.2, delay: i * 0.1, born: now });
    }
    trim(hearts, CAP.hearts);
  }

  function addConfetti(n: number, fromTop: boolean, ox = 0, oy = 0) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      confetti.push(
        fromTop
          ? { x: rand(0, LW), y: rand(-60, -2), vx: rand(-6, 6), vy: rand(16, 34),
              c: `hsl(${Math.floor(rand(0, 360))},90%,62%)`, ph: rand(0, 6), vertical: Math.random() < 0.5, life: 8, born: now }
          : { x: ox, y: oy, vx: rand(-30, 30), vy: rand(-45, -10),
              c: `hsl(${Math.floor(rand(0, 360))},90%,62%)`, ph: rand(0, 6), vertical: Math.random() < 0.5, life: 5, born: now },
      );
    }
    trim(confetti, CAP.confetti);
  }

  function launchRocket(delay: number) {
    if (rockets.length >= ROCKET_CAP) return;
    rockets.push({
      x: rand(LW * 0.1, LW * 0.9), y: SY0 - 20, vy: -rand(70, 100),
      ty: rand(LH * 0.08, LH * 0.32), hue: Math.floor(rand(0, 360)), delay: delay || 0,
      heart: Math.random() < 0.25,
    });
  }

  function burst(r: Rocket) {
    const col = (o: number) => `hsl(${(r.hue + o) % 360},92%,66%)`;
    const now = performance.now();
    if (r.heart) {
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * 6.283;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        sparks.push({ x: r.x, y: r.y, vx: hx * 1.5, vy: hy * 1.5, life: 1.2, decay: 0.8, c: "#ff6aa0", s: 1, g: 6, born: now });
      }
    } else {
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 6.283, sp = rand(18, 42);
        sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.3, decay: 0.85, c: col(i % 3 ? 0 : 40), s: i % 5 === 0 ? 2 : 1, g: 22, born: now });
      }
    }
    sparks.push({ x: r.x, y: r.y, vx: 0, vy: 0, life: 0.3, decay: 3, c: "#ffffff", s: 2, g: 0, born: now });
    trim(sparks, CAP.sparks);
  }

  function floatText(text: string, x: number, y: number, c: string) {
    floaters.push({ text, x, y, t: 0, c });
    if (floaters.length > 24) floaters.shift();
  }

  function shake(sec: number, amp: number) {
    shakeUntil = performance.now() + sec * 1000;
    shakeAmp = amp;
  }

  function spotlight(p: Resident, sec: number) {
    spotlights.push({ id: p.id, until: performance.now() + sec * 1000 });
  }

  function addToast(text: string, color: string) {
    toasts.push({ text: sanitize(text), color, t0: performance.now() });
    if (toasts.length > 6) toasts.shift();
  }

  function addChatLine(p: Resident, msg: string) {
    chatlog.push({
      name: sanitize(p.name).slice(0, 10) || "VIEWER",
      msg: sanitize(msg),
      color: lighten(p.look.shirt, 0.35),
      t0: performance.now(),
    });
    if (chatlog.length > 6) chatlog.shift();
  }

  /* ---------------------------------------------------------------------
   * shopfronts
   * ------------------------------------------------------------------ */

  /**
   * Rebuilds the building layer so a viewer's name appears on a sign.
   *
   * Only the sign plates change, but they are baked into the same canvas as a
   * hundred buildings' worth of walls, and splitting the signs out into their
   * own layer to avoid this would cost a blit every frame forever to save a
   * rebuild that happens a handful of times an evening.
   */
  let rebakeCount = 0;
  let bakedOwners: ShopOwners | null = null;
  function rebakeCity(owners: ShopOwners) {
    if (!ready) return;
    rebakeCount += 1;
    bakedOwners = owners;
    layout = genCity(doc, LW, LH, SY0, SY1, owners);
    layers = buildLayers(doc, layout, LW, LH, SY0, SY1, ROAD0);
    lastSkyUpdate = -1e9;
  }

  /* ---------------------------------------------------------------------
   * staged effects
   * ------------------------------------------------------------------ */

  /**
   * Starts one staged effect.
   *
   * Each of these is the thing a big gift is supposed to look like, and they run
   * one at a time. The parade lets its vehicles out on the queue's cadence rather
   * than all at once, which is the same reason the road is not a solid line.
   */
  function beginStaged(kind: "party" | "plane" | "parade" | "bazaar" | "fire" | "storm", by: string, amount: number) {
    const now = performance.now();
    const who = people.get(by);
    if (kind === "party") {
      partyUntil = now + 9000;
      flashUntil = now + 250;
      shake(1.2, 2);
      if (who) {
        who.rank = 2;
        who.xp = Math.max(who.xp, config.rankXP[2] ?? 0);
        savePerson(who);
        spotlight(who, 6);
        setEmote(who, "dance", 4000);
      }
      for (const p of people.values()) {
        if (p.state === "walk" || p.state === "idle") setEmote(p, Math.random() < 0.5 ? "cheer" : "clap", 4000);
      }
      // Staggered, and bounded: the rockets are the frame's most expensive
      // effect and twelve of them at once is twelve of them at once.
      for (let i = 0; i < 8; i++) launchRocket(0.4 + i * 0.7);
      addConfetti(90, true);
    } else if (kind === "plane") {
      launchPlane(`TERIMA KASIH ${by}!`);
      addConfetti(70, true);
      searchUntil = now + 7000;
      shake(0.5, 1);
      for (let i = 0; i < 4; i++) launchRocket(0.6 + i * 0.8);
    } else if (kind === "parade") {
      // The procession: a fire engine or a limo every second and a half, so it
      // is a parade rather than a traffic jam.
      for (let i = 0; i < 5; i++) paradeQueue = Math.max(paradeQueue, i + 1);
      paradeCooldown = 0;
      if (who) {
        spotlight(who, 5);
        setEmote(who, "dance", 4000);
      }
      shake(0.25, 1);
    } else if (kind === "bazaar") {
      bazaarUntil = now + 11000;
      addConfetti(40, true);
    } else if (kind === "fire") {
      fireUntil = now + 9000;
      shake(0.8, 2);
    } else if (kind === "storm") {
      weather.force("rain");
    }
    void amount;
  }

  /* ---------------------------------------------------------------------
   * residents
   * ------------------------------------------------------------------ */

  const laneY = () => R(rand(SY0 + 7, SY1 - 1));

  function clean(t: unknown): string {
    let s = String(t ?? "");
    for (const w of config.badWords) s = s.replace(new RegExp(w, "gi"), "*".repeat(w.length));
    return s;
  }

  function setEmote(p: Resident, type: Emote["type"], ms: number) {
    const n = performance.now();
    p.emote = { type, start: n, until: n + ms };
  }

  function savePerson(p: Resident) {
    store[p.id] = {
      name: p.name,
      xp: Math.round(p.xp * 10) / 10,
      rank: p.rank,
      badge: p.badge,
      friends: p.friends.length,
      given: p.given,
      cos: p.cos,
    };
    storeDirty = true;
  }

  function gainXP(p: Resident, n: number) {
    p.xp += n;
    const r = rankFor(p.xp, config.rankXP);
    if (r > p.rank) {
      p.rank = r;
      sparkle(p.x, p.y - 10, 20, "#ffe08a");
      addToast(`${p.name} NAIK JADI ${CITY_RANKS[r]}`, "#ffd23f");
    }
    savePerson(p);
  }

  function newFriend(p: Resident, i: number, instant: boolean) {
    return { look: lookFor(p.id + "#f" + i), x: p.x - 8, y: p.y, dir: 1, moving: false, t: rand(0, 5), k: instant ? 1 : 0 };
  }

  /**
   * The roster is keyed by user id, not by event id.
   *
   * Every event for a viewer has a different id, so keying on that gave every
   * comment its own resident and the city filled with the same person. The
   * nickname is only ever the display name.
   */
  function ensurePerson(id: string, nick: string, how?: string): Resident {
    const key = id || nick || "anon";
    const existing = people.get(key);
    if (existing) {
      const p = existing;
      if (nick) p.name = nick;
      // Someone who is still being talked about did not really leave.
      if (p.state === "exit") cancelExit(p);
      return p;
    }
    // The cap is on the roster itself, not on who is still walking around.
    //
    // Marking the oldest resident as leaving and then adding the newcomer
    // regardless — which is what this did — meant the cap was only ever a
    // suggestion: a burst of joins set that many exits running at once, none of
    // them finished for seconds, and the room spent that time animating a
    // backlog of dissolves. Fifty joins in a second produced fifty residents and
    // a frame rate to match. So the overflow is dropped here and now, and the
    // graceful walk-out is kept for the case that deserves it: someone who has
    // been idle long enough to be on their way home anyway.
    while (people.size >= config.maxPeople) {
      let oldest: Resident | null = null;
      for (const o of people.values()) {
        if (o.state !== "exit" && (!oldest || o.lastActive < oldest.lastActive)) oldest = o;
      }
      if (!oldest) {
        // Everything left is already leaving, so the roster is draining. Let
        // this one in rather than refusing the first person to arrive.
        break;
      }
      people.delete(oldest.id);
    }
    // Whatever is in storage was written by an older build, or by hand, so it is
    // read defensively rather than trusted to have the shape below.
    const rec = (store[key] || {}) as Partial<StoreRecord>;
    const p: Resident = {
      id: key,
      name: nick || rec.name || key,
      xp: rec.xp || 0,
      rank: Math.max(rec.rank || 0, rankFor(rec.xp || 0, config.rankXP)),
      badge: !!rec.badge,
      look: lookFor(key),
      friends: [],
      x: 0, y: 0, dir: 1, t: rand(0, 10), speed: rand(11, 17),
      state: "walk", tx: 0, ty: 0, wait: 0, moving: false,
      escortOf: null,
      enterT: 0, exitPhase: 0, exitT: 0, exitMode: "edge", door: null,
      lastActive: performance.now(), bubble: "", bubbleUntil: 0, emote: null, dissolve: 1,
      activity: "none", actT: rand(1, 8), spot: null, partnerId: null,
      cos: isCos(rec.cos) ? rec.cos : cosFor(rec.given || 0),
      given: rec.given || 0,
    };
    // A returning viewer keeps their shop and their hat, so the gifts that put
    // them there do not have to be re-sent.
    for (const sh of shops.list()) {
      if (sh.id === key) shops.donate(sh.id, sh.name, 0);
    }
    for (let i = 0; i < (rec.friends || 0); i++) p.friends.push(newFriend(p, i, true));
    // Door or street: 70% through a door in the original. Kept, because a city
    // where everyone walks in from off-frame reads as an empty backdrop.
    const useDoor = (how || (Math.random() < 0.7 ? "door" : "edge")) === "door" && layout.doors.length > 0;
    if (useDoor) {
      const d = layout.doors[Math.floor(Math.random() * layout.doors.length)];
      p.door = d;
      d.openUntil = performance.now() + 1500;
      p.x = d.x;
      p.y = SY0 + 1;
      p.state = "enter";
      p.enterT = 0;
      p.dissolve = 0;
      p.tx = clamp(d.x + rand(-30, 30), 10, LW - 10);
      p.ty = laneY();
    } else {
      const left = Math.random() < 0.5;
      p.x = left ? -8 : LW + 8;
      p.y = laneY();
      p.tx = clamp(rand(20, LW - 20), 10, LW - 10);
      p.ty = p.y;
      p.dir = left ? 1 : -1;
      // Solid from the first frame, unlike the door.
      //
      // Walking in from off the edge of the screen has nothing to dissolve out
      // of, and setting `dissolve` to 0 here left them at zero for good: the
      // enter branch is what walks `dissolve` up to 1, and it only runs while
      // the state is "enter", which this path never set. So every resident who
      // arrived at the kerb rather than through a door was drawn through the
      // dissolve buffer at zero threshold, which is to say not drawn at all.
      p.dissolve = 1;
    }
    people.set(key, p);
    sparkle(p.x, p.y - 8, 10, "#9dffb0");
    return p;
  }

  function pickTarget(p: Resident) {
    p.tx = clamp(p.x + rand(-170, 170), 10, LW - 10);
    p.ty = laneY();
    if (Math.abs(p.tx - p.x) < 25) p.tx = clamp(p.x + (Math.random() < 0.5 ? -1 : 1) * rand(40, 120), 10, LW - 10);
  }

  /**
   * Head home.
   *
   * The dissolve is the whole transition: `exitPhase` walks them to a door or an
   * edge first, then the Bayer threshold eats them away over 0.9s. There is no
   * alpha step anywhere in it, because a per-pixel threshold is what this scene
   * looks like and a uniform alpha over a dithered sprite reads as a flicker.
   */
  function startExit(p: Resident) {
    if (p.state === "exit") return;
    p.state = "exit";
    p.exitPhase = 0;
    p.exitT = 0;
    if (layout.doors.length > 0 && Math.random() < 0.65) {
      let best: Door | null = null, bd = 1e9;
      for (const d of layout.doors) {
        const dd = Math.abs(d.x - p.x);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) {
        p.exitMode = "door";
        p.door = best;
        p.tx = best.x;
        p.ty = SY0 + 1;
      } else {
        p.exitMode = "edge";
        p.tx = p.x < LW / 2 ? -14 : LW + 14;
        p.ty = p.y;
      }
    } else {
      p.exitMode = "edge";
      p.tx = p.x < LW / 2 ? -14 : LW + 14;
      p.ty = p.y;
    }
    savePerson(p);
    addToast(`${p.name} PULANG`, "#a9a7d0");
  }

  /** Someone who came back is made whole again, in place. */
  function cancelExit(p: Resident) {
    p.state = "walk";
    p.dissolve = 1;
    p.exitPhase = 0;
    p.wait = 0;
    p.tx = clamp(p.x + rand(-60, 60), 10, LW - 10);
    p.ty = laneY();
  }

  function stepToward(p: Resident, dt: number, spd: number): boolean {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 1.2) {
      p.moving = false;
      return true;
    }
    const s = Math.min(d, spd * dt);
    p.x += (dx / d) * s;
    p.y += (dy / d) * s * 0.7;
    p.moving = true;
    if (Math.abs(dx) > 0.8) p.dir = dx > 0 ? 1 : -1;
    return false;
  }

  function updatePerson(p: Resident, dt: number, now: number) {
    p.t += dt;
    const em = p.emote && now < p.emote.until ? p.emote : null;
    const frozen = !!em && em.type !== "cheer";

    if (p.state === "enter") {
      p.enterT += dt;
      // Linear in, because the Bayer threshold is linear. Easing it would make
      // the first few pixels take visibly longer than the last few.
      p.dissolve = clamp(p.enterT / 0.9, 0, 1);
      if (p.enterT > 0.5) {
        if (stepToward(p, dt, p.speed) || p.enterT > 8) {
          p.state = "walk";
          p.dissolve = 1;
          p.wait = rand(0.3, 1.5);
        }
      } else {
        p.y += 6 * dt;
        p.moving = true;
      }
    } else if (p.state === "walk") {
      if (!frozen) {
        if (stepToward(p, dt, p.speed)) {
          p.state = "idle";
          p.wait = rand(0.8, 3.5);
        }
      } else p.moving = false;
    } else if (p.state === "idle") {
      p.moving = false;
      p.wait -= dt;
      if (p.wait <= 0 && !frozen) {
        pickTarget(p);
        p.state = "walk";
      }
    } else if (p.state === "exit") {
      if (p.exitPhase === 0) {
        if (stepToward(p, dt, p.speed * 1.15)) {
          if (p.exitMode === "door" && p.door) {
            p.exitPhase = 1;
            p.exitT = 0;
            p.door.openUntil = now + 1400;
          } else {
            people.delete(p.id);
            return;
          }
        } else if (p.exitMode === "edge" && (p.x < -10 || p.x > LW + 10)) {
          people.delete(p.id);
          return;
        }
      } else {
        p.exitT += dt;
        p.dissolve = 1 - clamp(p.exitT / 0.9, 0, 1);
        p.y -= 5 * dt;
        p.moving = true;
        p.dir = 1;
        if (p.exitT > 0.95) {
          people.delete(p.id);
          return;
        }
      }
    }

    updateEscort(p);
    updateActivity(p, dt, now);

    if ((p.state === "walk" || p.state === "idle") && now - p.lastActive > config.leaveAfterMs) startExit(p);

    // Step around each other. Cheap, and it stops the crowd stacking into one
    // column on a busy chat.
    if (p.state !== "enter") {
      for (const o of people.values()) {
        if (o === p || o.state === "enter") continue;
        const dx = p.x - o.x, dy = p.y - o.y;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 3) p.y += (dy >= 0 ? 1 : -1) * 6 * dt;
      }
    }
    if (p.state !== "exit") p.y = clamp(p.y, SY0 + 2, SY1);

    p.friends.forEach((f, i) => {
      f.t += dt;
      f.k = Math.min(1, f.k + dt / 0.9);
      const tx = p.x - p.dir * (9 + i * 9), ty = p.y + (i ? 2 : -2);
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy);
      if (d > 1.5) {
        const s = Math.min(d, p.speed * 1.4 * dt);
        f.x += (dx / d) * s;
        f.y += (dy / d) * s;
        f.moving = true;
        if (Math.abs(dx) > 1) f.dir = dx > 0 ? 1 : -1;
      } else f.moving = false;
    });
  }

  /**
   * What a resident does when they are not walking.
   *
   * Two things take priority over a chosen activity: rain, and having somebody
   * to say hello to. Rain first, because a person standing at a bench in a
   * downpour is the one thing that would look wrong, and a greeting is worth
   * abandoning an errand for.
   */
  function updateActivity(p: Resident, dt: number, now: number) {
    if (p.state !== "walk" && p.state !== "idle") return;

    // Rain, unless they are already somewhere dry.
    if (weather.isWet() && p.activity !== "shelter") {
      const sh = activities.shelter(p);
      if (sh && p.activity === "none") {
        p.activity = "goto";
        p.spot = sh;
        p.actT = 12;
        return;
      }
    }
    if (p.activity === "shelter" && !weather.isWet()) {
      p.activity = "none";
      p.spot = null;
      p.actT = 0;
    }

    // A greeting, if somebody is standing right there.
    if (p.activity === "none" && rand(0, 1) < dt * 0.12) {
      const other = activities.partner(p, people.values(), greetingBusy);
      if (other) {
        const mate = people.get(other);
        if (mate) {
          p.activity = "goto";
          p.partnerId = other;
          p.spot = { x: mate.x + (mate.x > p.x ? 5 : -5), y: mate.y, room: 1 };
          p.actT = 6;
          greetingBusy.add(other);
          mate.activity = "goto";
          mate.partnerId = p.id;
          mate.spot = { x: p.x - (p.x > mate.x ? 5 : -5), y: p.y, room: 1 };
          mate.actT = 6;
          greetingBusy.add(p.id);
          return;
        }
      }
    }

    if (p.activity === "none") {
      p.actT -= dt;
      if (p.actT <= 0) {
        const want = activities.choose();
        if (want === "phone") {
          // A phone is something you do while walking, so it needs no trip.
          p.activity = "phone";
          p.actT = rand(4, 12);
        } else {
          const spot = activities.spotFor(want, takenSpots);
          if (spot) {
            p.activity = "goto";
            p.spot = spot;
            p.actT = 10;
            takenSpots.add(spot);
          } else {
            p.actT = 2;
          }
        }
      }
      return;
    }

    if (p.activity === "goto") {
      const target = p.spot;
      if (!target) {
        releaseActivity(p);
        return;
      }
      p.tx = clamp(target.x, 4, LW - 4);
      p.ty = clamp(target.y, SY0 + 2, SY1);
      if (stepToward(p, dt, p.speed)) {
        p.moving = false;
        p.actT -= dt;
        if (p.actT <= 0) {
          // Two people crossing to each other and *then* talking reads as a
          // conversation. Two people talking on opposite sides of the road
          // does not, which is why the greeting is a destination.
          if (p.partnerId) {
            setEmote(p, "wave", 1200);
            const mate = people.get(p.partnerId);
            if (mate) {
              setEmote(mate, "wave", 1200);
              mate.partnerId = null;
              greetingBusy.delete(mate.id);
            }
            releaseActivity(p);
          } else {
            // Settled: on a bench, at a shop, or out of the rain.
            p.activity = p.spot === activities.shelter(p) ? "shelter" : p.spot ? "sit" : "none";
            p.actT = p.spot ? rand(3, 9) : 0;
            if (!p.spot) {
              p.activity = "none";
              p.actT = rand(2, 9);
            }
          }
        }
      }
      return;
    }

    // Sitting, eating, sheltering, on the phone: just counting down.
    p.moving = false;
    p.actT -= dt;
    if (p.actT <= 0) releaseActivity(p);
  }

  /**
   * Walks the mayor's two nearest residents along with them.
   *
   * Escorts are borrowed from the crowd rather than created, because a mayor
   * who arrives with two bodyguards out of nowhere is a sprite that appears from
   * nowhere, and the crowd is already there.
   */
  function escortMayor(mayorId: string): boolean {
    const held = [...people.values()].filter((p) => p.escortOf === mayorId);
    if (held.length >= ESCORT) return true;
    const boss = [...people.values()].filter((p) => p.id !== mayorId && (p.state === "walk" || p.state === "idle"));
    const taken: string[] = [];
    const claim = (p: Resident) => {
      // Whoever is picked up stops what they were doing. A mayor who only ever
      // recruits the idle draws a convoy out of the empty, and in a busy room
      // that is most of the room, so the car would arrive alone.
      p.activity = "goto";
      p.escortOf = mayorId;
      p.spot = { x: p.x + (p.x < LW / 2 ? -6 : 6), y: p.y, room: 1 };
      p.actT = 999;
      p.partnerId = null;
      greetingBusy.delete(p.id);
      taken.push(p.id);
    };

    // First choice is someone with nothing to finish.
    for (const p of boss) {
      if (taken.length >= ESCORT - held.length) break;
      if (greetingBusy.has(p.id) || p.activity !== "none" || p.spot) continue;
      claim(p);
    }
    // Then anyone at all who is on their feet, mid errand or not.
    for (const p of boss) {
      if (taken.length >= ESCORT - held.length) break;
      if (p.spot || p.escortOf) continue;
      claim(p);
    }
    return held.length + taken.length >= ESCORT;
  }

  /** Keeps the escort beside the car, and lets go when the title moves on. */
  function updateEscort(p: Resident) {
    if (!p.escortOf) return;
    const boss = people.get(p.escortOf);
    // Two separate ways to stop: the mayor has left the room, or the title has
    // moved to somebody else. Both mean this escort goes back to the crowd.
    if (!boss || mayor.current()?.id !== p.escortOf) {
      p.escortOf = null;
      releaseActivity(p);
      return;
    }
    const side = p.x < boss.x ? -5 : 5;
    p.spot = { x: boss.x + side, y: p.y, room: 1 };
    p.tx = clamp(boss.x + side, 4, LW - 4);
    p.ty = boss.y;
    // Held in place until the car is out of range, which is the only thing that
    // makes an escort read as an escort rather than as somebody walking slowly.
    if (Math.abs(p.x - p.tx) > 2) p.actT = 999;
  }

  /** The activity that changes how somebody is drawn, or null. */
  function activityPose(p: Resident): "sit" | "eat" | "phone" | null {
    if (p.activity === "sit" || p.activity === "eat" || p.activity === "phone") return p.activity;
    return null;
  }

  /** Ends whatever a resident was doing and clears the bookkeeping with it. */
  function releaseActivity(p: Resident) {
    if (p.spot) takenSpots.delete(p.spot);
    if (p.partnerId) {
      const mate = people.get(p.partnerId);
      if (mate) {
        mate.partnerId = null;
        greetingBusy.delete(mate.id);
        releaseActivity(mate);
      }
      p.partnerId = null;
    }
    greetingBusy.delete(p.id);
    p.spot = null;
    p.activity = "none";
    p.actT = rand(2, 9);
  }

  /** The spots currently claimed, so two people do not sit on the same bench. */
  const takenSpots = new Set<Spot>();
  /** The residents currently walking somewhere to meet somebody. */
  const greetingBusy = new Set<string>();

  /* ---------------------------------------------------------------------
   * vehicles
   * ------------------------------------------------------------------ */

  function carCanvas(type: string, color: string, dir: number): Sprite {
    const key = type + color + dir;
    const hit = carCache.get(key);
    if (hit) return hit;
    let parts: Part[], w: number, h: number;
    const glass = "#bfe6f5", dk = "#1a1a22";
    if (type === "bus") {
      w = 46; h = 15;
      parts = [[0, 2, 46, 10, color], [0, 11, 46, 1, shade(color, 0.7), true],
        [40, 4, 5, 6, glass], [6, 11, 6, 4, dk], [34, 11, 6, 4, dk],
        [45, 9, 1, 2, "#ffe9a0", true], [0, 9, 1, 2, "#ff4a4a", true]];
      for (let i = 0; i < 6; i++) parts.push([3 + i * 6, 4, 4, 4, glass, true]);
    } else if (type === "van") {
      w = 28; h = 13;
      parts = [[0, 3, 28, 7, color], [19, 4, 7, 3, glass, true], [3, 4, 12, 3, shade(color, 0.85), true],
        [3, 9, 5, 4, dk], [20, 9, 5, 4, dk], [27, 6, 1, 2, "#ffe9a0", true], [0, 6, 1, 2, "#ff4a4a", true]];
    } else if (type === "limo") {
      w = 42; h = 10;
      parts = [[0, 4, 42, 4, color], [8, 1, 26, 4, shade(color, 1.08)],
        [9, 2, 4, 2, glass, true], [15, 2, 4, 2, glass, true], [21, 2, 4, 2, glass, true],
        [27, 2, 5, 2, glass, true], [4, 7, 5, 3, dk], [32, 7, 5, 3, dk],
        [41, 5, 1, 2, "#ffe9a0", true], [0, 5, 1, 2, "#ff4a4a", true]];
    } else {
      w = 26; h = 11;
      parts = [[0, 5, 26, 4, color], [6, 1, 13, 5, shade(color, 1.1)],
        [7, 2, 5, 3, glass, true], [13, 2, 5, 3, glass, true],
        [3, 8, 5, 3, dk], [18, 8, 5, 3, dk], [5, 9, 1, 1, "#9a9aa8", true],
        [20, 9, 1, 1, "#9a9aa8", true], [25, 5, 1, 2, "#ffe9a0", true], [0, 5, 1, 2, "#ff4a4a", true]];
      if (type === "taxi") parts.push([10, 0, 5, 1, "#ffffff"]);
    }
    let c: Sprite = mk(w + 2, h + 2, doc);
    {
      const g = c.getContext("2d")!;
      g.fillStyle = OUT;
      for (const p of parts) if (!p[5]) g.fillRect(1 + p[0] - 1, 1 + p[1] - 1, p[2] + 2, p[3] + 2);
      for (const p of parts) {
        g.fillStyle = p[4];
        g.fillRect(1 + p[0], 1 + p[1], p[2], p[3]);
      }
      c.carH = h;
    }
    if (dir < 0) {
      const f = mk(c.width, c.height, doc), fg = f.getContext("2d")!;
      fg.translate(c.width, 0);
      fg.scale(-1, 1);
      fg.drawImage(c, 0, 0);
      c = f;
    }
    (c as HTMLCanvasElement & { carH?: number }).carH = h;
    carCache.set(key, c);
    return c;
  }

  const CAR_COLORS = ["#d84a4a", "#4a7ad8", "#3aa86a", "#e8e8f0", "#2a2a3a", "#8a5ad8", "#e07a2a"];

  /** Types drawn by `local.ts` rather than by the generic car builder. */
  const LOCAL_TYPES = new Set(["ojek", "angkot", "becak", "bakso", "firetruck", "mayor"]);

  /**
   * The mayor's car, and the office that comes with it.
   *
   * One car for the title rather than one per handover: the room watches the
   * car move, not whoever is standing beside it. It is deliberately not spawned
   * through the traffic path, which is capped and recycled, because dropping the
   * car when the road got busy would drop the office with it.
   */
  let mayorCar: { x: number; base: number; dir: number; cv: Sprite } | null = null;

  /** Drives it, or parks it at the kerb, or puts it away when the title moves. */
  function syncMayorCar(now: number) {
    const m = mayor.current();
    if (!m) {
      mayorCar = null;
      return;
    }
    if (!mayorCar) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const rh = LH - ROAD0;
      mayorCar = { x: dir > 0 ? -40 : LW + 40, base: dir > 0 ? ROAD0 + R(rh * 0.42) : ROAD0 + R(rh * 0.84), dir, cv: localCanvas("mayor", dir) };
    }
    // Mostly parked, driving now and then: a car that crawls the whole time
    // stops reading as important and starts reading as traffic.
    mayorCar.x += mayorCar.dir * speedFor("mayor", 20) * (now % 9000 < 4200 ? 1 : 0.08);
    if (mayorCar.dir > 0 && mayorCar.x > LW + 40) mayorCar.x = -40;
    if (mayorCar.dir < 0 && mayorCar.x < -40) mayorCar.x = LW + 40;
  }

  function localCanvas(type: string, dir: number): Sprite {
    const key = type + dir;
    const hit = localCache.get(key);
    if (hit) return hit;
    const built = buildLocal(doc, type, dir) as Sprite;
    localCache.set(key, built);
    return built;
  }

  /**
   * Puts a vehicle on the road, if there is room for it.
   *
   * Returns whether one was added, so a caller with a queue can try again rather
   * than dropping the request.
   */
  function spawnCar(forceType?: string, forceDir?: number): boolean {
    if (cars.length >= CAR_CAP) return false;
    const dir = forceDir || (Math.random() < 0.5 ? 1 : -1);
    const r = Math.random();
    const type = forceType || (r < 0.5 ? "sedan" : r < 0.65 ? "van" : r < 0.8 ? "taxi" : r < 0.9 ? "bus" : "sedan");
    const color =
      type === "taxi" ? "#f0c030" : type === "bus" ? "#e0a030" :
      type === "limo" ? "#e8c040" : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    // The local vehicles carry their own colours inside their sprite, so the
    // traffic mix reads as a street rather than as a palette.
    const cv = LOCAL_TYPES.has(type) ? localCanvas(type, dir) : carCanvas(type, color, dir);
    const rh = LH - ROAD0;
    const base = dir > 0 ? ROAD0 + R(rh * 0.42) : ROAD0 + R(rh * 0.84);
    const x = dir > 0 ? -cv.width - 4 : LW + 4;
    // Headway at the entry point. Vehicles have no collision and no lane
    // discipline, so anything allowed out while another is still sitting on the
    // entry point ends up inside it, and a procession degenerates into a solid
    // line as soon as the speeds differ.
    const headway = cv.width + 10;
    for (const c of cars) {
      if (Math.abs(c.base - base) < 6 && Math.abs(c.x - x) < headway) return false;
    }
    cars.push({
      cv, dir, type, x, base,
      speed: speedFor(type, rand(26, 44) * (type === "bus" ? 0.8 : 1)),
      ph: rand(0, 6),
      nextConf: 0,
    });
    return true;
  }

  /* ---------------------------------------------------------------------
   * events
   * ------------------------------------------------------------------ */

  function cheerAll(ms: number) {
    const n = performance.now();
    for (const p of people.values()) {
      if (p.state === "walk" || p.state === "idle") setEmote(p, Math.random() < 0.5 ? "cheer" : "clap", n + ms - n);
    }
  }

  function makeBanner(text: string): HTMLCanvasElement {
    const s = sanitize(text).slice(0, 34);
    const w = s.length * 4 - 1 + 10;
    const c = mk(w, 11, doc);
    const g = c.getContext("2d")!;
    g.fillStyle = OUT; g.fillRect(0, 0, w, 11);
    g.fillStyle = "#fff4c2"; g.fillRect(1, 1, w - 2, 9);
    g.fillStyle = "#ffe08a"; g.fillRect(1, 1, w - 2, 1);
    txtOn(g, s, 5, 3, "#c03030");
    return c;
  }

  function launchPlane(text: string) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    plane = { dir, x: dir > 0 ? -30 : LW + 30, y: R(LH * 0.16), speed: 42, ph: 0, banner: makeBanner(text) };
  }

  /**
   * The diamonds in a gift.
   *
   * The original read `ev.diamonds` and nothing else, so a gift whose count
   * arrived without a diamond total produced no effect at all and the room saw
   * a toast for a gift that did nothing. `count` is the fallback, and a gift
   * with neither is worth nothing rather than worth an arbitrary number.
   */
  /**
   * How many likes a single event stands for.
   *
   * The feed writes the run as `x${count}`, so `Number("x40")` is NaN and a
   * plain `Number(value) || 1` silently turned every run of forty likes into one
   * like — the city credited events, not likes, which is the opposite of what
   * the board is for. The tests never caught it because they passed `"40"`
   * rather than the `"x40"` the wire actually carries.
   *
   * Ordered the same way `giftValue` reads a diamond count: an explicit number
   * first, then the count on the payload, then the digits inside the text.
   */
  function countValue(entry: Entry): number {
    const direct = Number(entry.value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const meta = Number(entry.meta?.count);
    if (Number.isFinite(meta) && meta > 0) return meta;
    const digits = /(\d[\d,]*)/.exec(String(entry.value ?? ""));
    if (digits) {
      const v = Number(digits[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 1;
  }

  function giftValue(meta: Record<string, unknown>, text: string): number {
    const raw = meta.diamonds ?? meta.diamondCount ?? meta.value;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    const c = Number(meta.count ?? meta.repeat);
    if (Number.isFinite(c) && c > 0) return c;
    const m = /(\d[\d,.]*)/.exec(text);
    if (m) {
      const v = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  function handle(entry: Entry) {
    const now = performance.now();
    const nick = clean(entry.user) || "viewer";
    const id = entry.userId || entry.user || "anon";

    // There is no leave event on the wire, so residents go home on the idle
    // timer in `updatePerson`. An explicit exit is still handled for the
    // `alert` kind, which the editor's test buttons can raise.
    if (entry.kind === "alert" && entry.value === "leave") {
      const leaving = people.get(id);
      if (leaving) startExit(leaving);
      return;
    }

    const isNew = !people.has(id);
    const p = ensurePerson(id, nick);
    if (isNew) addToast(`${nick} MASUK KOTA`, "#7dff9a");
    if (entry.kind === "join") return;
    p.lastActive = now;

    // Every kind of participation feeds the board, not just the one on it: the
    // room has to be able to progress at a moment when it is chatting rather
    // than liking, or the mission stalls for reasons nobody can see.
    const goal = missionGoalFor(entry.kind);
    // A like is worth the number of likes, not one. A run of x10 likes is ten
    // likes, and crediting the events instead of the value made the board
    // unreachable at any rate a room actually likes at.
    if (goal === "likes") missions.credit("likes", Math.max(1, countValue(entry)));
    else if (goal === "comments" || goal === "joins") missions.credit(goal, 1);
    // Gifts are credited below, where the diamond value is known.

    switch (entry.kind) {
      case "comment": {
        p.bubble = clean(entry.value).slice(0, 44);
        p.bubbleUntil = now + 4500;
        addChatLine(p, p.bubble);
        if (Math.random() < 0.6) setEmote(p, "wave", 1200);
        gainXP(p, 1);
        break;
      }
      case "like": {
        const n = clamp(countValue(entry), 1, 15);
        gainXP(p, n * 0.2);
        addHearts(p.x, p.y - 20, Math.min(n, 6));
        if (n >= 5) setEmote(p, "jump", 900);
        break;
      }
      case "follow": {
        p.badge = true;
        gainXP(p, 5);
        addHearts(p.x, p.y - 20, 10);
        setEmote(p, "wave", 1800);
        addToast(`${nick} FOLLOW`, "#ff7aa8");
        break;
      }
      case "share": {
        if (p.friends.length < 2) p.friends.push(newFriend(p, p.friends.length, false));
        gainXP(p, 3);
        sparkle(p.x - 8, p.y - 8, 12, "#9fe8ff");
        addToast(`${nick} AJAK TEMAN`, "#7da8ff");
        break;
      }
      case "gift": {
        const d = giftValue(entry.meta, entry.value);
        totalDiamonds += d;
        gainXP(p, Math.max(1, d * 0.5));

        // What the gift bought, before anything is shown for it. The wardrobe
        // and the shopfront are the permanent part; the fireworks are the part
        // that has to wait its turn.
        if (d > 0) {
          p.given += d;
          p.cos = cosFor(p.given);
          // Worth more than one tick of the board, and worth a car if it is
          // enough of it.
          missions.credit("gifts", Math.max(1, Math.round(d / 100)));
          mayor.donate(p.id, p.name, d);
          savePerson(p);
          shops.donate(p.id, p.name, d);
        }

        const label = clean(String(entry.meta.giftName ?? entry.value ?? "gift"));
        const count = Number(entry.meta.count) || 1;
        addToast(`${nick} KIRIM ${label}${count > 1 ? ` X${count}` : ""}`, "#ffd23f");
        if (d > 0) floatText(`+${d}`, p.x, p.y - 30, "#ffd23f");

        if (d < 10) {
          addCoins(p, clamp(6 + d * 2, 6, 20));
          setEmote(p, "jump", 1200);
          break;
        }

        // Under the plane threshold but still generous: this one is immediate,
        // because a spotlight and some coins do not stack into anything.
        if (d < config.planeGift) {
          if (p.rank < 1) {
            p.rank = 1;
            p.xp = Math.max(p.xp, config.rankXP[1] ?? 0);
            savePerson(p);
          }
          spotlight(p, 5);
          setEmote(p, "dance", 4000);
          addCoins(p, 14);
          launchRocket(0);
          shake(0.25, 1);
          break;
        }

        // At or over it, the gift is staged rather than fired.
        const kind = stagedKindFor(d, config.planeGift, config.partyGift) ?? "parade";
        staging.push(kind, p.id, d, now);
        break;
      }
      default:
        // An event kind the city has no animation for still counts as presence,
        // which is all it needs to be.
        break;
    }
  }

  /* ---------------------------------------------------------------------
   * world update
   * ------------------------------------------------------------------ */

  function updateWorld(dt: number, now: number) {
    missions.update();
    syncMayorCar(now);
    if (escortRetryIn > 0) {
      escortRetryIn -= dt;
      if (escortRetryIn <= 0) {
        const m = mayor.current();
        // Stop asking once the convoy is staffed, or once there is nobody to
        // staff it with: an empty street should not be retried forever.
        if (m && people.size > 1 && !escortMayor(m.id)) escortRetryIn = 0.5;
      }
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.x += c.dir * c.speed * dt;
      if (trailsConfetti(c.type)) {
        c.nextConf -= dt;
        if (c.nextConf <= 0) {
          c.nextConf = 0.07;
          addConfetti(3, false, c.x + c.cv.width / 2, c.base - 10);
        }
      }
      if ((c.dir > 0 && c.x > LW + 6) || (c.dir < 0 && c.x < -c.cv.width - 6)) cars.splice(i, 1);
    }
    nextCar -= dt;
    if (nextCar <= 0 && !config.transparent) {
      // A local street, not a car park: ojeks, angkot, becaks and a bakso cart
      // share the road with the sedans.
      spawnCar(pickLocalType(Math.random));
      nextCar = rand(1.4, 4.2);
    }
    // The procession is let out over time rather than all at once, so a burst of
    // gifts reads as a parade instead of a wall. A staged parade replaces the
    // old per-gift queue entirely: the effect queue decides that a parade is
    // happening, and this is the cadence it happens at.
    if (paradeQueue > 0) {
      paradeCooldown -= dt;
      if (paradeCooldown <= 0) {
        const kind = now < fireUntil ? "firetruck" : "limo";
        if (spawnCar(kind, 1)) paradeQueue -= 1;
        paradeCooldown = LIMO_GAP;
      }
    }

    // The weather runs on its own clock, and the staging queue decides when a
    // staged effect takes the stage.
    weather.update(dt, now);
    staging.update(now);

    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.vy += 90 * dt;
      c.y += c.vy * dt;
      c.x += c.vx * dt;
      c.life -= dt;
      if (c.y >= c.ground) {
        c.y = c.ground;
        if (c.bounced < 2) {
          c.vy = -c.vy * 0.45;
          c.bounced++;
        } else {
          c.vy = 0;
          c.vx = 0;
        }
      }
      if (c.life <= 0) coins.splice(i, 1);
    }
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      if (h.delay > 0) {
        h.delay -= dt;
        continue;
      }
      h.y += h.vy * dt;
      h.ph += dt * 4;
      h.life -= dt;
      if (h.life <= 0) hearts.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.ph += dt * 5;
      c.x += (c.vx + Math.sin(c.ph) * 10) * dt;
      c.vy += (c.vy < 28 ? 25 : 0) * dt;
      c.y += c.vy * dt;
      c.life -= dt;
      if (c.y > LH + 4 || c.life <= 0) confetti.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += s.g * dt;
      s.life -= dt * s.decay;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.y += r.vy * dt;
      // A trail spark per rocket per frame is the single biggest cost in this
      // scene during a party, so the trail is on a timer rather than per frame.
      if (sparks.length < CAP.sparks && Math.random() < 0.35) {
        sparks.push({
          x: r.x, y: r.y + 2, vx: rand(-3, 3), vy: rand(4, 10),
          life: 0.5, decay: 2.2, c: "#ffb347", s: 1, g: 0, born: now,
        });
      }
      if (r.y <= r.ty) {
        burst(r);
        rockets.splice(i, 1);
      }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      f.y -= 12 * dt;
      if (f.t > 1.8) floaters.splice(i, 1);
    }
    for (let i = spotlights.length - 1; i >= 0; i--) {
      if (now > spotlights[i].until || !people.has(spotlights[i].id)) spotlights.splice(i, 1);
    }
    if (plane) {
      plane.x += plane.dir * plane.speed * dt;
      plane.ph += dt;
      const bw = plane.banner.width;
      if ((plane.dir > 0 && plane.x > LW + bw + 30) || (plane.dir < 0 && plane.x < -bw - 40)) plane = null;
    }
    if (now < partyUntil && Math.random() < dt * 6) addConfetti(2, true);
  }

  /* ---------------------------------------------------------------------
   * draw
   * ------------------------------------------------------------------ */

  let lastSkyUpdate = -1e9;

  function updateSky(now: number) {
    if (now - lastSkyUpdate < 400) return;
    lastSkyUpdate = now;
    const k = KFN, h = SY1 + 2, d = layers.skyImg.data, L = 9;
    for (let y = 0; y < h; y++) {
      const t = Math.pow(y / h, 1.2);
      const rr = lerp(k[1], k[4], t), gg = lerp(k[2], k[5], t), bb = lerp(k[3], k[6], t);
      for (let x = 0; x < LW; x++) {
        const bay = BAY[(x & 3) + ((y & 3) << 2)] / 16;
        const i = (y * LW + x) * 4;
        d[i] = Math.floor((rr / 255) * (L - 1) + bay) * (255 / (L - 1));
        d[i + 1] = Math.floor((gg / 255) * (L - 1) + bay) * (255 / (L - 1));
        d[i + 2] = Math.floor((bb / 255) * (L - 1) + bay) * (255 / (L - 1));
        d[i + 3] = 255;
      }
    }
    layers.skyCtx.putImageData(layers.skyImg, 0, 0);
    mainCtx.drawImage(layers.sky, 0, 0);
  }

  function glowCanvas(r: number): HTMLCanvasElement {
    let c = glowCache.get(r);
    if (c) return c;
    c = mk(r * 2 + 1, r * 2 + 1, doc);
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffd98a";
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y) / r;
        if (d > 1) continue;
        const on = d < 0.35 ? true : d < 0.65 ? ((x + y) & 1) === 0 : x % 2 === 0 && y % 2 === 0;
        if (on) g.fillRect(x + r, y + r, 1, 1);
      }
    }
    glowCache.set(r, c);
    return c;
  }

  function drawSkyStuff(g: Ctx, t: number) {
    g.drawImage(layers.sky, 0, 0);
    const nf = nightF();
    if (nf > 0.25) {
      for (const s of stars) {
        if (Math.sin(t * s.sp + s.ph) < -0.4) continue;
        g.globalAlpha = clamp((nf - 0.25) / 0.5, 0, 1);
        g.fillStyle = "#ffffff";
        g.fillRect(s.x * LW, s.y * SY0, 1, 1);
      }
      g.globalAlpha = 1;
    }
    const sunU = (TOD - 0.04) / 0.56;
    const moonU = ((((TOD - 0.6) + 1) % 1) / 0.46);
    if (sunU >= 0 && sunU <= 1) {
      const x = LW * (0.08 + 0.84 * sunU);
      const y = SY0 * 0.95 - Math.sin(Math.PI * sunU) * SY0 * 0.7;
      g.drawImage(glowCanvas(9), R(x) - 9, R(y) - 9);
      g.fillStyle = "#fff2a8";
      g.fillRect(x - 4, y - 4, 9, 9);
      g.fillRect(x - 3, y - 5, 7, 11);
      g.fillRect(x - 5, y - 3, 11, 7);
    } else if (moonU >= 0 && moonU <= 1) {
      const x = LW * (0.08 + 0.84 * moonU);
      const y = SY0 * 0.9 - Math.sin(Math.PI * moonU) * SY0 * 0.6;
      g.fillStyle = "#f0f0e0";
      g.fillRect(x - 3, y - 4, 7, 9);
      g.fillRect(x - 4, y - 3, 9, 7);
      g.fillStyle = "#d0d0c0";
      g.fillRect(x + 1, y - 2, 2, 2);
      g.fillRect(x - 2, y + 1, 2, 2);
    }
    const cc = `rgb(${R(lerp(250, 70, nf))},${R(lerp(250, 80, nf))},${R(lerp(255, 130, nf))})`;
    for (const c of clouds) {
      const x = ((c.x * LW + t * c.v) % (LW + 60)) - 30;
      const y = c.y * SY0, s = c.s;
      g.fillStyle = cc;
      g.fillRect(x, y, 22 * s, 4 * s);
      g.fillRect(x + 4 * s, y - 3 * s, 12 * s, 4 * s);
      g.fillRect(x + 14 * s, y - 2 * s, 8 * s, 3 * s);
    }
  }

  function drawDoors(g: Ctx, now: number) {
    for (const d of layout.doors) {
      if (now >= d.openUntil) continue;
      g.fillStyle = "#2a1c12"; g.fillRect(d.x - 3, SY0 - 9, 6, 9);
      g.fillStyle = "#ffd98a"; g.fillRect(d.x - 2, SY0 - 8, 4, 8);
      g.fillStyle = "#7a4a2a"; g.fillRect(d.x - 3, SY0 - 9, 2, 9);
    }
  }

  /**
   * A resident, dissolved through the Bayer matrix.
   *
   * The threshold is anchored to the resident's own position, so the pattern
   * does not crawl as they walk. The original anchored it to the frame, which
   * made a moving sprite shimmer as the pattern shifted under it.
   */
  function drawDissolved(
    g: Ctx,
    look: Look,
    rank: number,
    pose: Pose,
    fx: number,
    fy: number,
    dir: number,
    k: number,
    cos: Cos,
  ) {
    const X0 = fx - 13, Y0 = fy - 22;
    dissolveCtx.clearRect(0, 0, 26, 30);
    // The dissolve buffer has to grow room for a hat and an umbrella, which sit
    // above the head. Without this the canopy was clipped off and tier three
    // looked like tier two whenever they dissolved.
    drawPartsOn(
      dissolveCtx,
      decorate(personParts(look, rank, pose), cos, pose, weather.isWet()),
      13 - 4 + (pose.dx || 0),
      22 - 15 + (pose.dy || 0),
      dir < 0,
    );
    const id = dissolveCtx.getImageData(0, 0, 26, 30);
    const d = id.data;
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 26; x++) {
        const i = (y * 26 + x) * 4;
        if (d[i + 3] && k <= BAY[((X0 + x) & 3) + (((Y0 + y) & 3) << 2)] / 16) d[i + 3] = 0;
      }
    }
    dissolveCtx.putImageData(id, 0, 0);
    g.drawImage(dissolveCv, X0, Y0);
  }

  function drawPersonAt(
    g: Ctx,
    look: Look,
    rank: number,
    pose: Pose,
    fx: number,
    fy: number,
    dir: number,
    cos: Cos,
  ) {
    // No shadow under someone who is sitting on a bench, and none under an
    // umbrella either: a shadow that ignores what the person is doing is worse
    // than no shadow.
    if (pose.kind !== "sit" && !cos.umbrella) {
      g.fillStyle = "rgba(0,0,0,.28)";
      g.fillRect(fx - 3, fy, 7, 1);
      g.fillStyle = "rgba(0,0,0,.16)";
      g.fillRect(fx - 2, fy + 1, 5, 1);
    }
    drawPartsOn(
      g,
      decorate(personParts(look, rank, pose), cos, pose, weather.isWet()),
      fx - 4 + (pose.dx || 0),
      fy - 15 + (pose.dy || 0),
      dir < 0,
    );
  }

  function drawPlane(g: Ctx, t: number) {
    if (!plane) return;
    const x = R(plane.x), y = R(plane.y + Math.sin(plane.ph * 2));
    const bw = plane.banner.width;
    const bx = plane.dir > 0 ? x - bw - 12 : x + 34;
    const by = y + 1;
    g.fillStyle = "#e8e8f0";
    g.fillRect(plane.dir > 0 ? x - 12 : x + 30, y + 5, 12, 1);
    for (let i = 0; i < bw; i++) {
      g.drawImage(plane.banner, i, 0, 1, 11, bx + i, by + R(Math.sin(t * 6 + i * 0.25) * 1.5), 1, 11);
    }
    const parts: Part[] = [[0, 3, 18, 4, "#f4f4ff"], [18, 4, 2, 2, "#f4f4ff"],
      [0, 0, 3, 4, "#d0403a"], [7, 6, 7, 2, "#aeb6c8"], [11, 3, 3, 2, "#3a56b8", true]];
    const M = (p: Part): Part => (plane!.dir > 0 ? p : [20 - (p[0] + p[2]), p[1], p[2], p[3], p[4], p[5]]);
    g.fillStyle = OUT;
    for (const q of parts) {
      if (q[5]) continue;
      const p = M(q);
      g.fillRect(x + p[0] - 1, y + p[1] - 1, p[2] + 2, p[3] + 2);
    }
    for (const q of parts) {
      const p = M(q);
      g.fillStyle = p[4];
      g.fillRect(x + p[0], y + p[1], p[2], p[3]);
    }
    g.fillStyle = "#c8c8d0";
    g.fillRect(plane.dir > 0 ? x + 20 : x - 1, y + 1 + (Math.floor(t * 20) % 2), 1, 5);
  }

  function drawScene(g: Ctx, now: number, t: number) {
    const drawables: { y: number; fn: () => void }[] = [];
    for (const p of layout.props) {
      drawables.push({ y: p.y, fn: () => g.drawImage(p.cv, p.x - p.anchorX, p.y - p.anchorY) });
    }
    for (const c of cars) {
      drawables.push({
        y: c.base,
        fn: () => g.drawImage(c.cv, R(c.x), c.base - (c.cv.carH ?? 11) - 1),
      });
    }
    // The mayor's car is drawn with the traffic but kept out of it: it is not
    // spawned, not capped, and not recycled, because dropping it when the road
    // gets busy would drop the office with it.
    if (mayorCar) {
      drawables.push({
        y: mayorCar.base,
        fn: () => g.drawImage(mayorCar!.cv, R(mayorCar!.x), mayorCar!.base - (mayorCar!.cv.carH ?? 10) - 1),
      });
    }
    for (const p of people.values()) {
      const fx = R(p.x), fy = R(p.y);
      const pose = poseOf(p.moving, p.t, p.emote, now, activityPose(p));
      drawables.push({
        y: p.y,
        fn: () => {
          if (p.dissolve < 1) drawDissolved(g, p.look, p.rank, pose, fx, fy, p.dir, p.dissolve, p.cos);
          else drawPersonAt(g, p.look, p.rank, pose, fx, fy, p.dir, p.cos);
        },
      });
      p.friends.forEach((f) => {
        const ffx = R(f.x), ffy = R(f.y);
        const fpose = poseOf(f.moving, f.t, p.emote && p.emote.type !== "wave" ? p.emote : null, now);
        const k = Math.min(f.k, p.dissolve);
        drawables.push({
          y: f.y,
          fn: () => {
            if (k < 1) drawDissolved(g, f.look, 0, fpose, ffx, ffy, f.dir, k, NO_COS);
            else drawPersonAt(g, f.look, 0, fpose, ffx, ffy, f.dir, NO_COS);
          },
        });
      });
    }
    drawables.sort((a, b) => a.y - b.y);

    if (!config.transparent) {
      const off = R((t * 1.2) % LW);
      g.drawImage(layers.far, -off, 0);
      g.drawImage(layers.far, LW - off, 0);
      g.drawImage(layers.mid, 0, 0);
      drawDoors(g, now);
      g.drawImage(layers.ground, 0, SY0, LW, LH - SY0, 0, SY0, LW, LH - SY0);
    }
    drawPlane(g, t);
    drawables.forEach((d) => d.fn());
  }

  function drawLights(g: Ctx, now: number, t: number) {
    if (config.transparent) return;
    const nf = nightF();
    if (nf <= 0.12) return;

    for (const w of layout.wins) {
      if (nf < w.thr) continue;
      if (Math.floor((t + w.ph) / 9) % 7 === 0) continue;
      g.fillStyle = w.warm ? "#ffd36a" : Math.floor((t + w.ph) * 3) % 2 ? "#8fd0ff" : "#b0e0ff";
      g.fillRect(w.x, w.y, 4, 5);
      g.fillStyle = "#fff2b0";
      g.fillRect(w.x, w.y, 4, 1);
    }
    for (const s of layout.signs) {
      const on = now < partyUntil || Math.floor(t * 2 + s.ph) % 9 !== 0;
      if (!on) continue;
      // A viewer's shopfront does not take the party's cycling colour. It is the
      // one sign in the row that means a specific person, so it stays legible as
      // a name rather than becoming a light show.
      const col = s.owned
        ? s.color
        : now < partyUntil
          ? `hsl(${Math.floor((t * 120 + s.ph * 40) % 360)},95%,65%)`
          : s.color;
      plateOn(g, s.x, s.y, s.w, 7, "#1c1830");
      txtOn(g, s.text, s.x + 2, s.y + 1, col);
    }
    for (const p of layout.props) {
      if (p.type !== "lamp") continue;
      g.globalAlpha = clamp(nf * 0.6, 0, 1);
      g.drawImage(glowCanvas(15), p.x - 13, p.y - 42);
      g.globalAlpha = clamp(nf * 0.35, 0, 1);
      g.fillStyle = "#ffd98a";
      for (let i = 0; i < 4; i++) {
        for (let x = -12 + i * 2; x <= 12 - i * 2; x += 2) g.fillRect(p.x + 3 + x, p.y - 2 + i, 1, 1);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "#ffe9a0";
    for (const c of cars) {
      g.globalAlpha = clamp(nf * 0.55, 0, 1);
      const fx = c.dir > 0 ? c.x + c.cv.width : c.x - 16;
      const y0 = c.base - 6;
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 2 + (i >> 2); j++) {
          if (((i + j) & 1) === 0) g.fillRect(R(c.dir > 0 ? fx + i : fx + 15 - i), y0 + j - ((i >> 2) >> 1), 1, 1);
        }
      }
    }
    g.globalAlpha = 1;
  }

  function drawEffects(g: Ctx, now: number, t: number) {
    for (const s of spotlights) {
      const p = people.get(s.id);
      if (!p) continue;
      g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 6);
      g.drawImage(layers.cone, 0, 0, 36, R(p.y), R(p.x) - 18, 0, 36, R(p.y));
      g.fillStyle = "#fff6c0";
      for (let x = -10; x <= 10; x++) {
        for (let y = 0; y < 3; y++) {
          if (((x + y) & 1) === 0 && Math.hypot(x / 10, y / 3) < 1) g.fillRect(R(p.x) + x, R(p.y) + y - 1, 1, 1);
        }
      }
      g.globalAlpha = 1;
    }
    if (now < searchUntil) {
      g.fillStyle = "#e8f4ff";
      g.globalAlpha = 0.38;
      for (let b = 0; b < 3; b++) {
        const ox = LW * (0.2 + b * 0.3), oy = SY0 - 2;
        const a = -Math.PI / 2 + Math.sin(t * 1.4 + b * 2) * 0.55;
        for (let i = 4; i < LH * 0.9; i++) {
          const x = ox + Math.cos(a) * i, y = oy + Math.sin(a) * i;
          if (y < 0) break;
          const w = 1 + (i >> 5);
          for (let k = 0; k < w; k++) {
            if (((i + k) & 1) === 0) g.fillRect(R(x) + k - (w >> 1), R(y), 1, 1);
          }
        }
      }
      g.globalAlpha = 1;
    }
    for (const r of rockets) {
      if (r.delay > 0) continue;
      g.fillStyle = "#ffe9a0";
      g.fillRect(r.x, r.y, 1, 3);
    }
    for (const c of confetti) {
      g.fillStyle = c.c;
      g.fillRect(c.x, c.y, c.vertical ? 1 : 2, c.vertical ? 2 : 1);
    }
    for (const c of coins) {
      const w = [3, 2, 1, 2][Math.floor((t * 8 + c.ph) % 4)];
      g.fillStyle = "#ffd23f";
      g.fillRect(c.x - (w >> 1), c.y - 3, w, 3);
      g.fillStyle = "#fff3a0";
      g.fillRect(c.x - (w >> 1), c.y - 3, w, 1);
    }
    for (const h of hearts) {
      if (h.delay > 0) continue;
      if (h.life < 0.6 && Math.floor(h.life * 20) % 2) continue;
      const x = R(h.x + Math.sin(h.ph) * 3), y = R(h.y);
      g.fillStyle = "#ff5d8a";
      g.fillRect(x + 1, y, 1, 1);
      g.fillRect(x + 3, y, 1, 1);
      g.fillRect(x, y + 1, 5, 1);
      g.fillRect(x + 1, y + 2, 3, 1);
      g.fillRect(x + 2, y + 3, 1, 1);
      g.fillStyle = "#ffc0d0";
      g.fillRect(x + 1, y + 1, 1, 1);
    }
    for (const s of sparks) {
      if (s.life < 0.25 && Math.floor(s.life * 40) % 2) continue;
      g.fillStyle = s.c;
      g.fillRect(s.x, s.y, s.s, s.s);
    }
    for (const f of floaters) {
      if (f.t > 1.3 && Math.floor(f.t * 12) % 2) continue;
      txtOutlineOn(g, f.text, R(f.x - (f.text.length * 4 - 1) / 2), f.y, f.c, OUT);
    }
    if (now < flashUntil) {
      g.globalAlpha = clamp((flashUntil - now) / 250, 0, 1) * 0.45;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, LW, LH);
      g.globalAlpha = 1;
    }
  }

  function drawLabels(g: Ctx, now: number) {
    const list = [...people.values()].filter((p) => !(p.state === "enter" && p.dissolve < 0.5));
    const top = new Set(
      list.slice().sort((a, b) => b.xp - a.xp).slice(0, config.labelTop).map((p) => p.id),
    );
    const hasB = (p: Resident) => p.bubble && now < p.bubbleUntil;
    const prio = (p: Resident) => (hasB(p) ? 0 : top.has(p.id) ? 1 : 2);
    list.sort((a, b) => prio(a) - prio(b) || b.lastActive - a.lastActive);

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      placed.some((q) => r.x < q.x + q.w + 1 && r.x + r.w + 1 > q.x && r.y < q.y + q.h + 1 && r.y + r.h + 1 > q.y);

    for (const p of list) {
      const pr = prio(p);
      // A label that is neither a message nor a top-5 rank is only worth drawing
      // while it is fresh.
      if (pr === 2 && now - p.lastActive >= config.labelActiveMs) continue;
      const fy = R(p.y);
      const nm = (sanitize(p.name).slice(0, 10) || "VIEWER") + ` L${levelFor(p.xp)}`;
      const w = nm.length * 4 - 1 + (p.badge ? 7 : 0);
      const lx = clamp(R(p.x - w / 2) - 2, 1, LW - w - 5);
      const ly = fy - 28;
      const rect = { x: lx, y: ly, w: w + 4, h: 9 };
      // A collision is only worth avoiding for the ambient labels: dropping one
      // of those is fine, dropping a message or a top rank is not.
      if (pr > 0 && hit(rect)) continue;
      placed.push(rect);
      plateOn(g, lx, ly, w + 4, 9, PLATE);
      let tx = lx + 2;
      if (p.badge) {
        g.fillStyle = "#ff5d8a";
        g.fillRect(tx + 1, ly + 2, 1, 1);
        g.fillRect(tx + 3, ly + 2, 1, 1);
        g.fillRect(tx, ly + 3, 5, 1);
        g.fillRect(tx + 1, ly + 4, 3, 1);
        g.fillRect(tx + 2, ly + 5, 1, 1);
        tx += 7;
      }
      txtOn(g, nm, tx, ly + 2, p.rank >= 2 ? "#ffd23f" : pr === 1 ? "#ffe08a" : "#ffffff");

      if (hasB(p)) {
        const s2 = sanitize(p.bubble).slice(0, 22);
        if (!s2) continue;
        const bw = s2.length * 4 - 1;
        const bx = clamp(R(p.x - bw / 2) - 2, 1, LW - bw - 5);
        const by = ly - 13;
        placed.push({ x: bx, y: by, w: bw + 4, h: 12 });
        plateOn(g, bx, by, bw + 4, 9, "#f7f7ff");
        const tpx = clamp(R(p.x), bx + 3, bx + bw);
        g.fillStyle = "#f7f7ff";
        g.fillRect(tpx - 1, by + 9, 3, 1);
        g.fillRect(tpx, by + 10, 1, 1);
        txtOn(g, s2, bx + 2, by + 2, "#15123a");
      }
    }
  }

  function drawHud(g: Ctx, now: number) {
    const hh = Math.floor((TOD * 24 + 6) % 24);
    const mm = Math.floor(((TOD * 24 + 6) % 1) * 60);
    const clock = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const head = `KOTA ${people.size}${totalDiamonds ? `  DIAMOND ${totalDiamonds}` : ""}  ${clock}`;
    plateOn(g, 3, 3, head.length * 4 - 1 + 6, 11, PLATE);
    txtOn(g, head, 6, 6, "#ffffff");

    const name = sanitize(config.cityName).slice(0, 24);
    if (name) {
      const w = name.length * 4 - 1;
      plateOn(g, LW - 3 - w - 4, 3, w + 4, 9, PLATE);
      txtOn(g, name, LW - 3 - w - 2, 5, "#ffe08a");
    }

    const maxC = Math.max(14, Math.min(34, Math.floor((LW * 0.6) / 4)));
    chatlog.forEach((e, i) => {
      const age = (now - e.t0) / 1000;
      if (age > 26) return;
      const s = `${e.name}: ${e.msg}`.slice(0, maxC);
      const w = s.length * 4 - 1 + 6;
      // Slides in and settles. Eased, not linear: a chat line that slides in at
      // a constant rate stops dead against its final position.
      const xoff = R((1 - ease(age / 0.3)) * -(w + 4));
      const y = 17 + i * 11;
      g.globalAlpha = age > 24 ? clamp((26 - age) / 2, 0, 1) : 1;
      plateOn(g, 3 + xoff, y, w, 9, PLATE);
      txtOn(g, `${e.name}:`, 6 + xoff, y + 2, e.color);
      txtOn(g, e.msg.slice(0, Math.max(0, maxC - e.name.length - 2)), 6 + xoff + (e.name.length + 1) * 4 + 1, y + 2, "#f3f2ff");
      g.globalAlpha = 1;
    });

    toasts.forEach((e, i) => {
      const age = (now - e.t0) / 1000;
      if (age > 5.4) return;
      const s = e.text.slice(0, Math.max(14, Math.floor((LW * 0.55) / 4)));
      const w = s.length * 4 - 1 + 9;
      const slide = age < 0.4 ? 1 - ease(age / 0.4) : age > 5 ? ease((age - 5) / 0.4) : 0;
      const x = R(LW - 3 - w + slide * (w + 6));
      const y = 17 + i * 11;
      plateOn(g, x, y, w, 9, PLATE);
      g.fillStyle = e.color;
      g.fillRect(x, y, 2, 9);
      txtOn(g, s, x + 5, y + 2, "#ffffff");
    });
  }

  /* ---------------------------------------------------------------------
   * loop
   * ------------------------------------------------------------------ */

  function layoutFor(w: number, h: number) {
    // OBS reports a zero-sized source while a scene is still opening. Treating
    // that as a real size gave a 1x1 backing store that then never recovered.
    if (w < 8 || h < 8) {
      ready = false;
      return;
    }
    W = w;
    H = h;
    PX = config.pixelSize > 0 ? config.pixelSize : Math.max(2, Math.round(Math.min(w, h) / 240));
    LW = Math.ceil(w / PX);
    LH = Math.ceil(h / PX);
    canvas.width = LW;
    canvas.height = LH;
    canvas.style.width = `${LW * PX}px`;
    canvas.style.height = `${LH * PX}px`;
    mainCtx.imageSmoothingEnabled = false;
    scCtx.imageSmoothingEnabled = false;
    sc.width = LW;
    sc.height = LH;

    SY0 = R(LH * 0.58);
    SY1 = R(LH * 0.78);
    ROAD0 = SY1 + 6;

    bakedOwners = shops.owners();
    layout = genCity(doc, LW, LH, SY0, SY1, bakedOwners);
    layers = buildLayers(doc, layout, LW, LH, SY0, SY1, ROAD0);
    lastSkyUpdate = -1e9;
    for (const p of people.values()) {
      p.x = clamp(p.x, 4, LW - 4);
      p.y = clamp(p.y, SY0 + 2, SY1);
    }
    cars.length = 0;
    glowCache.clear();
    ready = true;
  }

  const FRAME_BUDGET = 1000 / 60;
  let carry = 0;
  let last = performance.now();
  let frame = 0;
  let running = false;
  let simulated = 0;
  let wall = 0;

  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    carry += elapsed;
    if (carry < FRAME_BUDGET - 1) return;
    // Step by what the city is owed, not by the gap since the last frame that
    // ran. They are the same number on a display that holds 60 and nothing like
    // the same number on one that does not: on 144Hz nearly every tick arrived
    // inside the budget, every skipped tick threw its elapsed time away, and the
    // whole city ran at 42% of real time with nothing on screen to say so.
    const step = carry;
    carry = 0;
    const dt = Math.min(0.05, step / 1000);
    wall += step / 1000;
    simulated += dt;
    if (!ready) return;

    clock = now;
    const t = now / 1000;
    // A pinned clock does not move; otherwise the day runs on `dayLen` seconds
    // from wherever `todOffset` has shifted it to.
    TOD = config.fixedTime != null
      ? config.fixedTime
      : ((START_TIME + t / config.dayLen + todOffset) % 1 + 1) % 1;
    KFN = kfAt(TOD);

    updateWorld(dt, now);
    for (const p of [...people.values()]) updatePerson(p, dt, now);

    let sx = 0, sy = 0;
    if (now < shakeUntil) {
      const st = Math.floor(now / 50);
      sx = R(Math.sin(st * 12.9) * shakeAmp);
      sy = R(Math.cos(st * 7.7) * shakeAmp);
    }

    mainCtx.clearRect(0, 0, LW, LH);
    if (!config.transparent) {
      updateSky(now);
      drawSkyStuff(mainCtx, t);
    }

    scCtx.clearRect(0, 0, LW, LH);
    drawScene(scCtx, now, t);
    if (!config.transparent && KFN[10] > 0.005) {
      scCtx.globalCompositeOperation = "source-atop";
      scCtx.globalAlpha = 1;
      scCtx.fillStyle = `rgba(${R(KFN[7])},${R(KFN[8])},${R(KFN[9])},${KFN[10].toFixed(3)})`;
      scCtx.fillRect(0, 0, LW, LH);
      scCtx.globalCompositeOperation = "source-over";
    }

    mainCtx.save();
    mainCtx.translate(sx, sy);
    mainCtx.drawImage(sc, 0, 0);
    // Weather sits between the city and its people: the road is wet first, then
    // the residents put their umbrellas up, and the puddles come before the
    // residents rather than under them.
    drawPuddles(
      mainCtx,
      weather.full(),
      weather.puddles(),
      now,
      layout.props.filter((q) => q.type === "lamp").map((q) => ({ x: q.x, y: q.y })),
      nightF(),
    );
    // What the room has lit up, drawn between the city and the weather: the
    // decorations are lit by the street, and the rain falls in front of them.
    drawDecorations(mainCtx, missions.lit(), LW, SY0, ROAD0, t, nightF());
    drawLights(mainCtx, now, t);
    drawEffects(mainCtx, now, t);
    if (config.showLabels) drawLabels(mainCtx, now);
    drawRain(mainCtx, weather.drops(), weather.full().phase);
    drawRainbow(mainCtx, weather.full(), LW, SY0);
    drawRainWash(mainCtx, weather.full(), LW, LH);
    // Lightning goes over everything, including the rain: the whole frame goes
    // white for a moment, which is the only way it reads as lightning rather
    // than as a lamp.
    const flash = weather.flash(now);
    if (flash > 0) {
      mainCtx.globalAlpha = clamp(flash, 0, 1) * 0.55;
      mainCtx.fillStyle = "#e8ecff";
      mainCtx.fillRect(0, 0, LW, LH);
      mainCtx.globalAlpha = 1;
    }
    mainCtx.restore();
    if (config.showHud) drawHud(mainCtx, now);
  };

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    carry = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  // The source can be created before it has a size, and OBS in particular
  // reports zero on the first tick, so this retries rather than giving up.
  const layoutTimer = setInterval(() => {
    if (!ready) layoutFor(W || canvas.clientWidth || 0, H || canvas.clientHeight || 0);
  }, 300);

  start();

  return {
    handle,
    resize: layoutFor,
    configure(next: Partial<CityConfig>) {
      const prev = config;
      config = { ...config, ...next };
      if (
        prev.pixelSize !== config.pixelSize ||
        prev.transparent !== config.transparent ||
        prev.cityName !== config.cityName
      ) {
        layoutFor(W, H);
      }
    },
    residentCount: () => people.size,
    weather: (k: Weather) => weather.force(k),
    civic: () => {
      const m = missions.current();
      const may = mayor.current();
      return {
        mission: { label: m.spec.label, progress: m.progress, target: m.spec.target, cleared: missions.state().justCleared },
        lit: missions.lit(),
        mayor: may ? { id: may.id, name: may.name, diamonds: may.diamonds, from: may.from } : null,
        escorts: [...people.values()].filter((p) => p.escortOf).length,
        car: mayorCar ? { x: Math.round(mayorCar.x), onScreen: mayorCar.x > 0 && mayorCar.x < LW } : null,
      };
    },
    staging() {
      const a = staging.active();
      return { active: a ? a.kind : null, waiting: staging.waiting(), refused: staging.refused() };
    },
    world() {
      return {
        shops: shops.list().map((sh) => ({ name: sh.name, diamonds: Math.round(sh.diamonds), slot: sh.slot })),
        // What the baked layer was actually built from, which is not the same
        // question as what the ranking says: the signs are pixels, and pixels
        // only change when something re-bakes them.
        bakedOwners: bakedOwners ? JSON.parse(JSON.stringify(bakedOwners)) : null,
        rebakes: rebakeCount,
        weather: weather.state(),
        activities: [...people.values()].filter((p) => p.activity !== "none").map((p) => p.activity),
        wardrobe: [...people.values()].map((p) => ({ id: p.id, hat: p.cos.hat, bag: p.cos.bag, umbrella: p.cos.umbrella })),
        dissolve: [...people.values()].map((p) => ({ id: p.id, d: Number(p.dissolve.toFixed(2)), state: p.state })),
      };
    },
    vehicles() {
      const byType: Record<string, number> = {};
      for (const c of cars) byType[c.type] = (byType[c.type] || 0) + 1;
      return { total: cars.length, byType };
    },
    effectCounts: () => ({
      coins: coins.length,
      hearts: hearts.length,
      confetti: confetti.length,
      sparks: sparks.length,
    }),
    timeAccount: () => ({ simulated, wall }),
    residents: () =>
      [...people.values()].map((p) => ({ id: p.id, name: p.name, rank: p.rank, xp: p.xp })),
    reset() {
      store = {};
      storeDirty = true;
      try {
        globalThis.localStorage?.removeItem(config.storeKey);
      } catch {
        // Not being able to clear storage is not a reason to stop.
      }
      people.clear();
      totalDiamonds = 0;
    },
    destroy() {
      stop();
      clearInterval(storeTimer);
      clearInterval(layoutTimer);
    },
  };
}
