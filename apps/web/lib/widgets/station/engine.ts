/**
 * The station engine — passengers, events, and the loop.
 *
 * The one behaviour worth reading is the arrival. A viewer who joins does not
 * fade in on the platform: they are added to the queue, the next train is
 * called if none is coming, and they step out of a door when it opens. Leaving
 * runs the same line in reverse. Everything else here is the city, minus the
 * parts that are about streets.
 */

import type { Entry } from "../types";
import {
  BAY,
  OUT,
  PLATE,
  R,
  clamp,
  ease,
  levelFor,
  lookFor,
  personParts,
  poseOf,
  rand,
  rankFor,
  sanitize,
  textW,
} from "../city/sprites";
import type { Emote, Look, Pose } from "../city/sprites";
import { drawPartsOn, mk, plateOn, txtOn, txtOutlineOn } from "../city/scenery";
import type { Ctx } from "../city/scenery";
import { DEFAULT_STATION_CONFIG, RANKS, RANK_XP } from "./config";
import { audienceTier, easeAudience, formatAudience, settledTier } from "../city/audience";
import type { StationConfig } from "./config";
import {
  CAR_H,
  buildStationScene,
  clockStr,
  clouds,
  computeLayout,
  drawBoards,
  drawCanopyLights,
  drawPillarClock,
  glowCanvas,
  nightWash,
  paintSky,
  skyAt,
  stars,
} from "./scene";
import type { Prop, StationLayout, StationScene } from "./scene";
import {
  ambientFor,
  drawBannerOn,
  drawCars,
  gapFor,
  drawDoors,
  drawPasserLights,
  drawTrainLights,
  dwelling,
  nearestDoor,
  newTrain,
  spawnPasser,
  updatePasser,
  updateTrain,
  carsFor,
} from "./train";
import type { Passer, Train } from "./train";

export type PassengerState = "queued" | "enter" | "walk" | "idle" | "exit";

export interface Passenger {
  id: string;
  name: string;
  xp: number;
  rank: number;
  badge: boolean;
  look: Look;
  x: number;
  y: number;
  dir: 1 | -1;
  t: number;
  speed: number;
  state: PassengerState;
  queuedAt: number;
  /** Waiting for a door because they are talking, not because they just arrived. */
  forceEdge: boolean;
  tx: number;
  ty: number;
  wait: number;
  moving: boolean;
  enterT: number;
  exitPhase: number;
  exitT: number;
  exitMode: "train" | "edge";
  lastActive: number;
  bubble: string;
  bubbleUntil: number;
  emote: Emote | null;
  dissolve: number;
  /**
   * Background passengers, not viewers.
   *
   * They exist so a quiet room still looks like a station, and they are tagged
   * because two things must never confuse them for people in the room: the
   * platform cap evicts them before it evicts anyone real, and the head count
   * never counts them.
   */
  ambient: boolean;
}

interface Coin {
  x: number;
  y: number;
  vy: number;
  vx: number;
  ground: number;
  life: number;
  bounced: number;
  ph: number;
}
interface Heart {
  x: number;
  y: number;
  vy: number;
  ph: number;
  life: number;
  delay: number;
}
interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  ph: number;
  vertical: boolean;
  life: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  c: string;
  s: number;
  g: number;
}
interface Floater {
  text: string;
  x: number;
  y: number;
  t: number;
  c: string;
}
interface Toast {
  text: string;
  color: string;
  t0: number;
}
interface ChatLine {
  name: string;
  msg: string;
  color: string;
  t0: number;
}
interface Spotlight {
  id: string;
  until: number;
}

const demoNames = ["BUDI", "SARI", "DIMAS", "RINA", "ANDI", "PUTRI", "FAJAR", "NADIA", "YOGA", "MAYA"];

export interface StationEngine {
  cfg: StationConfig;
  /** Everything a build leaves behind, for the harness to compare. */
  snapshot(): Record<string, unknown>;
  handle(e: Entry): void;
  resize(w: number, h: number): void;
  start(): void;
  /** Advances the world without drawing. For tests and for catch-up. */
  step(dt: number): void;
}

export function createStationEngine(
  doc: Document,
  canvas: HTMLCanvasElement,
  cfgIn?: Partial<StationConfig>,
): StationEngine {
  const cfg: StationConfig = { ...DEFAULT_STATION_CONFIG, ...cfgIn };
  const g = canvas.getContext("2d") as Ctx;
  const scratch = mk(1, 1, doc);
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true }) as Ctx;
  g.imageSmoothingEnabled = false;

  let LW = 640;
  let LH = 289;
  let scene: StationScene = buildStationScene(doc, LW, LH);
  let layout: StationLayout = scene.layout;

  const people = new Map<string, Passenger>();
  const coins: Coin[] = [];
  const hearts: Heart[] = [];
  const confetti: Confetti[] = [];
  const sparks: Spark[] = [];
  const floaters: Floater[] = [];
  const toasts: Toast[] = [];
  const chatlog: ChatLine[] = [];
  const spotlights: Spotlight[] = [];
  const passers: Passer[] = [];

  let train: Train | null = null;
  let nextTrainAt = 0;
  let wantTrain = false;
  let special: { gold: boolean; text: string } | null = null;
  let nextPasser = 0;
  let totalDiamonds = 0;
  let partyUntil = 0;
  /**
   * The room's own count, straight from TikTok, and the tier it settles into.
   *
   * Same shape as the city's, and for the same reason: the number arrives once
   * a second and wobbles around its own boundaries, so a raw threshold makes
   * the train length and the platform crowd flicker. `settledTier` holds it.
   */
  let audienceReal = 0;
  let audienceShown = 0;
  let bakedTier = audienceTier(0).index;
  let ambientSeq = 0;
  let todOffset = 0;
  let TOD = cfg.pinnedHour ?? 0.2;
  let KFN = skyAt(TOD);

  const tick = { x: 0, text: "", msgs: [] as string[], f: 0 };
  const fillers = () => [
    "SELAMAT DATANG DI STASIUN INI",
    "HARAP MENJAUHI GARIS KUNING",
    "LIKE DAN FOLLOW UNTUK NAIK PANGKAT",
    "KIRIM GIFT UNTUK KERETA SPESIAL",
  ];

  const now = () => performance.now();

  function clean(s: unknown): string {
    let out = String(s || "");
    if (cfg.badWords) {
      cfg.badWords.split(",").forEach((w) => {
        const t = w.trim();
        if (t) out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "*".repeat(t.length));
      });
    }
    return out;
  }

  function say(t: string): void {
    tick.msgs.push(sanitize(t));
    if (tick.msgs.length > 8) tick.msgs.shift();
  }

  function nextTick(): string {
    if (tick.msgs.length) return tick.msgs.splice(0, tick.msgs.length).join("   *   ");
    const f = fillers();
    return f[tick.f++ % f.length];
  }

  // --- effects, all with an age and a ceiling ------------------------------
  function sparkle(x: number, y: number, n: number, c: string): void {
    for (let i = 0; i < n && sparks.length < 400; i++) {
      sparks.push({ x, y, vx: rand(-28, 28), vy: rand(-34, 10), life: 1, decay: 1.2, c, s: Math.random() < 0.3 ? 2 : 1, g: 30 });
    }
  }
  function addCoins(p: Passenger, n: number): void {
    for (let i = 0; i < n && coins.length < 200; i++) {
      coins.push({ x: p.x + rand(-14, 14), y: p.y - rand(40, 70), vy: rand(10, 25), vx: rand(-4, 4), ground: p.y + rand(-2, 3), life: 4, bounced: 0, ph: rand(0, 6) });
    }
  }
  function addHearts(x: number, y: number, n: number): void {
    for (let i = 0; i < n && hearts.length < 200; i++) {
      hearts.push({ x: x + rand(-6, 6), y: y - rand(0, 6), vy: -rand(14, 26), ph: rand(0, 6), life: 2.2, delay: i * 0.1 });
    }
  }
  function floatText(text: string, x: number, y: number, c: string): void {
    if (floaters.length > 24) floaters.shift();
    floaters.push({ text, x, y, t: 0, c });
  }
  function addConfetti(n: number, fromTop: boolean, ox = 0, oy = 0): void {
    for (let i = 0; i < n && confetti.length < 320; i++) {
      confetti.push(
        fromTop
          ? { x: rand(0, LW), y: rand(-60, layout.CH), vx: rand(-6, 6), vy: rand(16, 34), c: `hsl(${Math.floor(rand(0, 360))},90%,62%)`, ph: rand(0, 6), vertical: Math.random() < 0.5, life: 8 }
          : { x: ox, y: oy, vx: rand(-30, 30), vy: rand(-45, -10), c: `hsl(${Math.floor(rand(0, 360))},90%,62%)`, ph: rand(0, 6), vertical: Math.random() < 0.5, life: 5 },
      );
    }
  }
  function addToast(text: string, color: string): void {
    toasts.push({ text: sanitize(text), color, t0: now() });
    if (toasts.length > 6) toasts.shift();
  }
  function addChatLine(p: Passenger, msg: string): void {
    chatlog.push({ name: sanitize(p.name).slice(0, 10) || "VIEWER", msg: sanitize(msg), color: "#ffe08a", t0: now() });
    if (chatlog.length > 6) chatlog.shift();
  }

  // --- passengers ----------------------------------------------------------
  function laneY(): number {
    return R(rand(layout.PY0 + 9, LH - 19));
  }

  function ensurePerson(idIn: unknown, nick?: string): Passenger {
    const id = String(idIn || "anon");
    const hit = people.get(id);
    if (hit) {
      if (nick) hit.name = nick;
      if (hit.state === "exit") cancelExit(hit);
      return hit;
    }
    if (people.size >= cfg.maxPeople) {
      // Ambient passengers give way first. A background commuter is scenery
      // and a viewer is not, so when the platform is full the one standing up
      // and walking into the next train is always one of ours.
      let oldest: Passenger | null = null;
      let oldestReal: Passenger | null = null;
      for (const o of people.values()) {
        if (o.state === "exit" || o.state === "queued") continue;
        if (o.ambient) {
          if (!oldest || o.lastActive < oldest.lastActive) oldest = o;
        } else if (!oldestReal || o.lastActive < oldestReal.lastActive) oldestReal = o;
      }
      const victim = oldest || oldestReal;
      if (victim) startExit(victim);
    }
    const t = now();
    const p: Passenger = {
      id,
      name: nick || id,
      xp: 0,
      rank: 0,
      badge: false,
      look: lookFor(id),
      x: -50,
      y: layout.PY0 + 20,
      dir: 1,
      t: rand(0, 10),
      speed: rand(11, 17),
      state: "queued",
      queuedAt: t,
      forceEdge: false,
      tx: 0,
      ty: 0,
      wait: 0,
      moving: false,
      enterT: 0,
      exitPhase: 0,
      exitT: 0,
      exitMode: "edge",
      lastActive: t,
      bubble: "",
      bubbleUntil: 0,
      emote: null,
      dissolve: 1,
      ambient: false,
    };
    people.set(id, p);
    // A new arrival pulls a train in. Without this a quiet room sits empty
    // until the next scheduled service and the platform looks broken.
    wantTrain = true;
    if (!train) nextTrainAt = Math.min(nextTrainAt, t + 800);
    return p;
  }

  function spawnAtDoor(p: Passenger, tr: Train): void {
    const d = tr.doors[Math.floor(Math.random() * tr.doors.length)];
    p.state = "enter";
    p.enterT = 0;
    p.dissolve = 0;
    p.x = d.x;
    p.y = layout.PY0 - 1;
    p.tx = clamp(d.x + rand(-40, 40), 12, LW - 12);
    p.ty = laneY();
    sparkle(p.x, p.y - 8, 8, "#9dffb0");
    say("PENUMPANG BARU " + p.name);
  }

  function spawnAtEdge(p: Passenger): void {
    const left = Math.random() < 0.5;
    p.state = "walk";
    p.dissolve = 1;
    p.x = left ? -8 : LW + 8;
    p.y = laneY();
    p.tx = clamp(rand(30, LW - 30), 12, LW - 12);
    p.ty = p.y;
    p.dir = left ? 1 : -1;
    say("PENUMPANG BARU " + p.name);
  }

  function startExit(p: Passenger): void {
    if (p.state === "exit") return;
    // Somebody still waiting on the platform has not arrived anywhere yet, so
    // there is nothing to send home. Dropping them silently is right: they were
    // never on screen.
    if (p.state === "queued") {
      people.delete(p.id);
      return;
    }
    p.state = "exit";
    p.exitPhase = 0;
    p.exitT = 0;
    const tr = dwelling(train);
    if (tr && tr.dwellMax - tr.dwellT > 3.5 && Math.random() < 0.8) {
      p.exitMode = "train";
      p.tx = nearestDoor(tr, p.x);
      p.ty = layout.PY0 + 1;
    } else {
      p.exitMode = "edge";
      p.tx = p.x < LW / 2 ? -14 : LW + 14;
      p.ty = p.y;
    }
    addToast(p.name + (p.exitMode === "train" ? " NAIK KERETA" : " PULANG"), "#a9a7d0");
    say("SELAMAT JALAN " + p.name);
  }

  function cancelExit(p: Passenger): void {
    p.state = "walk";
    p.dissolve = 1;
    p.exitPhase = 0;
    p.wait = 0;
    p.tx = clamp(p.x + rand(-60, 60), 12, LW - 12);
    p.ty = laneY();
  }

  function pickTarget(p: Passenger): void {
    p.tx = clamp(p.x + rand(-170, 170), 12, LW - 12);
    p.ty = laneY();
    if (Math.abs(p.tx - p.x) < 25) p.tx = clamp(p.x + (Math.random() < 0.5 ? -1 : 1) * rand(40, 120), 12, LW - 12);
  }

  function stepToward(p: Passenger, dt: number, spd: number): boolean {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
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

  function updatePerson(p: Passenger, dt: number, t: number): void {
    p.t += dt;
    if (p.state === "queued") {
      const tr = dwelling(train);
      if (tr && t >= tr.nextEmerge && !p.forceEdge) {
        tr.nextEmerge = t + 420;
        spawnAtDoor(p, tr);
      } else if (p.forceEdge || t - p.queuedAt > 11000) {
        spawnAtEdge(p);
      }
      return;
    }
    const em = p.emote && t < p.emote.until ? p.emote : null;
    const frozen = !!em && em.type !== "cheer";

    if (p.state === "enter") {
      p.enterT += dt;
      p.dissolve = clamp(p.enterT / 0.9, 0, 1);
      if (p.enterT > 0.5) {
        const done = stepToward(p, dt, p.speed);
        if (done || p.enterT > 8) {
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
        if (p.exitMode === "train") {
          const tr = dwelling(train);
          // The train can leave early. Re-aiming at the platform edge rather
          // than walking to a door that is no longer there is what stops a
          // departing passenger from converging on nothing.
          if (!tr) {
            p.exitMode = "edge";
            p.tx = p.x < LW / 2 ? -14 : LW + 14;
            p.ty = p.y;
          } else {
            p.tx = nearestDoor(tr, p.x);
            p.ty = layout.PY0 + 1;
          }
        }
        if (stepToward(p, dt, p.speed * 1.15)) {
          if (p.exitMode === "train") {
            p.exitPhase = 1;
            p.exitT = 0;
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
        p.moving = true;
        if (p.exitT > 0.95) {
          people.delete(p.id);
          return;
        }
      }
    }

    if ((p.state === "walk" || p.state === "idle") && t - p.lastActive > cfg.leaveAfter * 1000) startExit(p);

    if (p.state !== "enter") {
      for (const o of people.values()) {
        if (o === p || o.state === "enter" || o.state === "queued") continue;
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 3) p.y += (dy >= 0 ? 1 : -1) * 6 * dt;
      }
    }
    if (p.state !== "exit") p.y = clamp(p.y, layout.PY0 + 6, LH - 16);
  }

  /**
   * Keep roughly `ambientFor(tier)` background passengers on the platform.
   *
   * They are created through the same queue and the same doors as everyone
   * else, so they arrive by train and leave by train. A background passenger
   * that appeared at the edge of the frame would look exactly like the bug
   * this scene was built to avoid.
   */
  function topUpAmbient(): void {
    const want = ambientFor(bakedTier);
    let have = 0;
    for (const p of people.values()) if (p.ambient) have++;
    for (let i = have; i < want; i++) {
      const id = "amb-" + ambientSeq++;
      const p = ensurePerson(id, "PENUMPANG");
      p.ambient = true;
      p.name = "PENUMPANG";
    }
  }

  /** Sends background passengers home when the room empties out. */
  function trimAmbient(): void {
    const want = ambientFor(bakedTier);
    let have = 0;
    for (const p of people.values()) if (p.ambient) have++;
    for (const p of [...people.values()]) {
      if (p.ambient && have > want && (p.state === "walk" || p.state === "idle")) {
        have--;
        startExit(p);
      }
    }
  }

  // --- events --------------------------------------------------------------
  function gainXP(p: Passenger, n: number): void {
    p.xp += n;
    const r = rankFor(p.xp, RANK_XP);
    if (r > p.rank) {
      p.rank = r;
      sparkle(p.x, p.y - 10, 20, "#ffe08a");
      addToast(p.name + " NAIK JADI " + RANKS[r], "#ffd23f");
    }
  }

  function handle(e: Entry): void {
    const t = now();
    // The room's own count. Nothing derived from joins or idle timers: this is
    // the only number here that cannot drift from reality.
    if (e.kind === "viewers") {
      const n = Number(e.meta?.count ?? e.value);
      if (Number.isFinite(n) && n >= 0) audienceReal = Math.round(n);
      return;
    }
    const nick = clean(e.user || e.userId || "viewer") || "VIEWER";
    const isNew = !people.has(e.userId);
    const p = ensurePerson(e.userId, nick);
    if (isNew) addToast(nick + " MASUK STASIUN", "#7dff9a");
    if (e.kind === "join") return;
    if (p.state === "queued") p.forceEdge = true;
    p.lastActive = t;

    if (e.kind === "comment") {
      p.bubble = clean(e.value).slice(0, 44);
      p.bubbleUntil = t + 4500;
      addChatLine(p, p.bubble);
      if (Math.random() < 0.6) setEmote(p, "wave", 1200);
      gainXP(p, 1);
      return;
    }
    if (e.kind === "like") {
      const n = clamp(Number(e.meta?.count ?? 1) || 1, 1, 15);
      gainXP(p, n * 0.2);
      addHearts(p.x, p.y - 20, Math.min(n, 6));
      if (n >= 5) setEmote(p, "jump", 900);
      return;
    }
    if (e.kind === "follow") {
      p.badge = true;
      gainXP(p, 5);
      addHearts(p.x, p.y - 20, 10);
      setEmote(p, "wave", 1800);
      addToast(nick + " FOLLOW", "#ff7aa8");
      say("TERIMA KASIH " + nick + " SUDAH FOLLOW");
      return;
    }
    if (e.kind === "share") {
      gainXP(p, 3);
      sparkle(p.x - 8, p.y - 8, 12, "#9fe8ff");
      addToast(nick + " AJAK TEMAN", "#7da8ff");
      return;
    }
    if (e.kind === "gift") {
      const d = Math.max(0, Number(e.meta?.diamonds ?? 0) || 0);
      totalDiamonds += d;
      gainXP(p, Math.max(1, d * 0.5));
      const giftName = clean(String(e.meta?.giftName ?? "gift"));
      addToast(nick + " KIRIM " + giftName, "#ffd23f");
      say("TERIMA KASIH " + nick);
      floatText("+" + d, p.x, p.y - 30, "#ffd23f");
      if (d < 10) {
        addCoins(p, clamp(6 + d * 2, 6, 20));
        setEmote(p, "jump", 1200);
        return;
      }
      if (p.rank < 2) {
        p.rank++;
        p.xp = Math.max(p.xp, RANK_XP[p.rank]);
      }
      spotlights.push({ id: p.id, until: t + 5000 });
      setEmote(p, "dance", 4000);
      addCoins(p, 14);
      addConfetti(40, true);
      if (d >= cfg.expressGift) {
        passers.push(spawnPasser(doc, LW, false));
        say("PERHATIAN: KERETA EKSPRES LEWAT");
      }
      if (d >= cfg.partyGift) {
        p.rank = 2;
        p.xp = Math.max(p.xp, RANK_XP[2]);
        special = { gold: true, text: "TERIMA KASIH " + nick };
        wantTrain = true;
        nextTrainAt = Math.min(nextTrainAt, t + 2500);
        partyUntil = t + 9000;
        addConfetti(120, true);
        cheerAll(6000);
      }
    }
  }

  function setEmote(p: Passenger, type: Emote["type"], ms: number): void {
    const t = now();
    p.emote = { type, start: t, until: t + ms };
  }
  function cheerAll(ms: number): void {
    people.forEach((p) => {
      if (p.state === "walk" || p.state === "idle") setEmote(p, Math.random() < 0.5 ? "cheer" : "clap", ms);
    });
  }

  // --- world ---------------------------------------------------------------
  function updateWorld(dt: number, t: number): void {
    if (!train && (t >= nextTrainAt || wantTrain)) {
      train = newTrain(doc, LW, cfg.dwell * 1000, special || undefined, bakedTier);
      wantTrain = false;
      special = null;
      say("KERETA JALUR 1 TUJUAN " + train.dest + " SEGERA MASUK");
    }
    if (train) {
      let busy = false;
      for (const p of people.values()) {
        if ((p.state === "exit" && p.exitMode === "train" && p.exitPhase === 0) || p.state === "queued") busy = true;
      }
      const res = updateTrain(train, dt, LW, busy, t);
      if (res.announce === "arrived") floatText("TUUT", train.x + (train.dir > 0 ? train.len : 0), layout.TR0 - 34, "#ffffff");
      if (res.departed) {
        train = null;
        const [gapLo, gapHi] = gapFor(bakedTier, cfg.trainGapMin, cfg.trainGapMax);
        nextTrainAt = t + rand(gapLo, gapHi) * 1000;
      }
    }
    for (let i = passers.length - 1; i >= 0; i--) {
      const ps = passers[i];
      const gone = updatePasser(ps, dt, LW);
      if (gone) passers.splice(i, 1);
    }
    nextPasser -= dt;
    if (nextPasser <= 0) {
      if (passers.length === 0) passers.push(spawnPasser(doc, LW, false));
      nextPasser = rand(32, 60);
    }

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
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      f.y -= 12 * dt;
      if (f.t > 1.8) floaters.splice(i, 1);
    }
    for (let i = spotlights.length - 1; i >= 0; i--) {
      if (t > spotlights[i].until || !people.has(spotlights[i].id)) spotlights.splice(i, 1);
    }
    if (t < partyUntil && Math.random() < dt * 6) addConfetti(2, true);
    tick.x -= 30 * dt;
    if (tick.x < -textW(tick.text) - 4) {
      tick.text = nextTick();
      tick.x = LW;
    }
  }

  // --- drawing -------------------------------------------------------------
  function drawPerson(p: Passenger, t: number): void {
    const pose = poseOf(p.moving, p.t, p.emote && t < p.emote.until ? p.emote : null, t);
    const fx = R(p.x);
    const fy = R(p.y);
    if (p.dissolve < 1) {
      const X0 = fx - 13;
      const Y0 = fy - 22;
      scratchCtx.clearRect(0, 0, 26, 30);
      drawPersonInto(scratchCtx, p, pose);
      const id = scratchCtx.getImageData(0, 0, 26, 30);
      const d = id.data;
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 26; x++) {
          const i = (y * 26 + x) * 4;
          if (d[i + 3] && p.dissolve <= BAY[((X0 + x) & 3) + (((Y0 + y) & 3) << 2)] / 16) d[i + 3] = 0;
        }
      }
      scratchCtx.putImageData(id, 0, 0);
      g.drawImage(scratch, X0, Y0);
      return;
    }
    shadowAt(fx, fy);
    drawPersonInto(g, p, pose);
  }

  function drawPersonInto(target: Ctx, p: Passenger, pose: Pose): void {
    drawPartsOn(target, personParts(p.look, p.rank, pose), R(p.x) - 4 + (pose.dx || 0), R(p.y) - 15 + (pose.dy || 0), p.dir < 0);
  }

  function shadowAt(fx: number, fy: number): void {
    g.fillStyle = "rgba(0,0,0,.28)";
    g.fillRect(fx - 3, fy, 7, 1);
    g.fillStyle = "rgba(0,0,0,.16)";
    g.fillRect(fx - 2, fy + 1, 5, 1);
  }

  function drawScene(t: number, nowMs: number): void {
    const drawables: { y: number; fn: () => void }[] = [];
    for (const p of scene.props as Prop[]) {
      drawables.push({
        y: p.y,
        fn: () => {
          const c = p.cv as HTMLCanvasElement & { anchorX?: number; anchorY?: number };
          g.drawImage(c, p.x - (c.anchorX ?? 0), p.y - (c.anchorY ?? 0));
        },
      });
    }
    for (const p of people.values()) {
      if (p.state === "queued") continue;
      drawables.push({ y: p.y, fn: () => drawPerson(p, nowMs) });
    }
    drawables.sort((a, b) => a.y - b.y);

    const off = R((t * 1.2) % LW);
    g.drawImage(scene.far, -off, 0);
    g.drawImage(scene.far, LW - off, 0);
    g.drawImage(scene.mid, 0, 0);
    g.drawImage(scene.track, 0, 0);
    passers.forEach((ps) => {
      drawCars(doc, g, ps.n, ps.dir, ps.scheme, ps.x, layout.BT0);
      if (ps.banner) drawBannerOn(g, ps.banner, ps.x + ps.len / 2, layout.BT0 - CAR_H + 8);
    });
    if (train) {
      drawCars(doc, g, train.n, train.dir, train.scheme, train.x, layout.TR0);
      drawDoors(g, train, layout.TR0);
      if (train.banner && train.phase !== "arrive") drawBannerOn(g, train.banner, train.x + train.len / 2, layout.TR0 - CAR_H + 8);
    }
    g.drawImage(scene.platform, 0, 0);
    g.drawImage(scene.canopy, 0, 0);
    drawables.forEach((d) => d.fn());
  }

  function drawLights(t: number): void {
    drawBoards(
      g,
      LW,
      layout.CH,
      "STASIUN KOTA",
      train
        ? train.phase === "arrive"
          ? "MASUK"
          : train.phase === "dwell"
            ? "NAIK TURUN"
            : train.phase === "close"
              ? "SIAP PERGI"
              : "BERANGKAT"
        : "MENUNGGU",
      train ? train.dest : null,
      TOD,
      !!train && train.phase === "dwell" && Math.floor(t * 2) % 2 === 1,
    );
    const mid = scene.props.find((p) => p.type === "pillar" && p.idx === 2);
    if (mid) drawPillarClock(g, mid.x, layout.CH, TOD);

    const night = nightOfK();
    if (night <= 0.12) return;
    g.fillStyle = "#ffd36a";
    for (const w of scene.wins) {
      if (night < w.thr) continue;
      if (Math.floor((t + w.ph) / 9) % 7 === 0) continue;
      g.fillStyle = w.warm ? "#ffd36a" : "#8fd0ff";
      g.fillRect(w.x, w.y, 4, 5);
      g.fillStyle = "#fff2b0";
      g.fillRect(w.x, w.y, 4, 1);
    }
    drawCanopyLights(doc, g, LW, layout.CH, night);
    const vend = scene.props.find((p) => p.type === "vending");
    if (vend) {
      g.globalAlpha = clamp(night * 0.7, 0, 1);
      g.drawImage(glowCanvas(doc, 11), vend.x - 9, vend.y - 24);
      g.globalAlpha = 1;
    }
    if (train) drawTrainLights(g, train, layout.TR0, LW, night);
    passers.forEach((ps) => drawPasserLights(g, ps, layout.BT0, night));
  }

  function drawEffects(t: number): void {
    for (const s of spotlights) {
      const p = people.get(s.id);
      if (!p) continue;
      g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 6);
      g.drawImage(scene.cone, 0, 0, 36, R(p.y), R(p.x) - 18, 0, 36, R(p.y));
      g.fillStyle = "#fff6c0";
      for (let x = -10; x <= 10; x++) {
        for (let y = 0; y < 3; y++) {
          if (((x + y) & 1) === 0 && Math.hypot(x / 10, y / 3) < 1) g.fillRect(R(p.x) + x, R(p.y) + y - 1, 1, 1);
        }
      }
      g.globalAlpha = 1;
    }
    for (const c of confetti) {
      g.fillStyle = c.c;
      g.fillRect(R(c.x), R(c.y), c.vertical ? 1 : 2, c.vertical ? 2 : 1);
    }
    for (const c of coins) {
      const w = [3, 2, 1, 2][Math.floor((t * 8 + c.ph) % 4)];
      g.fillStyle = "#ffd23f";
      g.fillRect(R(c.x - (w >> 1)), R(c.y - 3), w, 3);
      g.fillStyle = "#fff3a0";
      g.fillRect(R(c.x - (w >> 1)), R(c.y - 3), w, 1);
    }
    for (const h of hearts) {
      if (h.delay > 0) continue;
      if (h.life < 0.6 && Math.floor(h.life * 20) % 2) continue;
      const x = R(h.x + Math.sin(h.ph) * 3);
      const y = R(h.y);
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
      g.fillRect(R(s.x), R(s.y), s.s, s.s);
    }
    for (const f of floaters) {
      if (f.t > 1.3 && Math.floor(f.t * 12) % 2) continue;
      txtOutlineOn(g, f.text, R(f.x - textW(f.text) / 2), f.y, f.c, OUT);
    }
  }

  function drawLabels(t: number): void {
    const list = [...people.values()].filter((p) => p.state !== "queued" && !(p.state === "enter" && p.dissolve < 0.5));
    const top = new Set(
      list
        .slice()
        .sort((a, b) => b.xp - a.xp)
        .slice(0, cfg.labelTop)
        .map((p) => p.id),
    );
    const hasB = (p: Passenger) => !!p.bubble && t < p.bubbleUntil;
    const prio = (p: Passenger) => (hasB(p) ? 0 : top.has(p.id) ? 1 : 2);
    list.sort((a, b) => prio(a) - prio(b) || b.lastActive - a.lastActive);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      placed.some((q) => r.x < q.x + q.w + 1 && r.x + r.w + 1 > q.x && r.y < q.y + q.h + 1 && r.y + r.h + 1 > q.y);
    for (const p of list) {
      const pr = prio(p);
      if (pr === 2 && t - p.lastActive >= cfg.labelActive * 1000) continue;
      const fy = R(p.y);
      const nm = (sanitize(p.name).slice(0, 10) || "VIEWER") + " L" + levelFor(p.xp);
      const w = textW(nm) + (p.badge ? 7 : 0);
      const lx = clamp(R(p.x - w / 2) - 2, 1, LW - w - 5);
      const ly = fy - 28;
      const rect = { x: lx, y: ly, w: w + 4, h: 9 };
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
        if (s2) {
          const bw = textW(s2);
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
  }

  function drawHud(t: number): void {
    const visible = [...people.values()].filter((p) => p.state !== "queued").length;
    // The room is the room and the platform is the platform. Reporting one as
    // the other is how a widget ends up claiming 400 people are watching a
    // station with four on it.
    const head = formatAudience(audienceShown, visible) + (totalDiamonds ? "  DIAMOND " + totalDiamonds : "") + "  " + clockStr(TOD);
    plateOn(g, 3, 3, textW(head) + 6, 11, PLATE);
    txtOn(g, head, 6, 6, "#ffffff");
    const maxC = Math.max(14, Math.min(34, Math.floor((LW * 0.6) / 4)));
    chatlog.forEach((e, i) => {
      const age = (t - e.t0) / 1000;
      if (age > 26) return;
      const s = (e.name + ": " + e.msg).slice(0, maxC);
      const w = textW(s) + 6;
      const xoff = R((1 - ease(age / 0.3)) * -(w + 4));
      const y = 17 + i * 11;
      g.globalAlpha = age > 24 ? clamp((26 - age) / 2, 0, 1) : 1;
      plateOn(g, 3 + xoff, y, w, 9, PLATE);
      txtOn(g, e.name + ":", 6 + xoff, y + 2, e.color);
      txtOn(g, e.msg.slice(0, Math.max(0, maxC - e.name.length - 2)), 6 + xoff + (e.name.length + 1) * 4 + 1, y + 2, "#f3f2ff");
      g.globalAlpha = 1;
    });
    toasts.forEach((e, i) => {
      const age = (t - e.t0) / 1000;
      if (age > 5.4) return;
      const s = e.text.slice(0, Math.max(14, Math.floor((LW * 0.55) / 4)));
      const w = textW(s) + 9;
      const slide = age < 0.4 ? 1 - ease(age / 0.4) : age > 5 ? ease((age - 5) / 0.4) : 0;
      const x = R(LW - 3 - w + slide * (w + 6));
      const y = 17 + i * 11;
      plateOn(g, x, y, w, 9, PLATE);
      g.fillStyle = e.color;
      g.fillRect(x, y, 2, 9);
      txtOn(g, s, x + 5, y + 2, "#ffffff");
    });
    g.fillStyle = "#0c0a1a";
    g.fillRect(0, LH - 11, LW, 11);
    g.fillStyle = "#f0c030";
    g.fillRect(0, LH - 12, LW, 1);
    txtOn(g, tick.text, tick.x, LH - 8, "#ffb830");
    g.fillStyle = "#c03030";
    g.fillRect(0, LH - 11, 23, 11);
    txtOn(g, "INFO", 3, LH - 8, "#ffffff");
  }

  function nightOfK(): number {
    return KFN[11];
  }

  function drawSkyStuff(t: number): void {
    g.drawImage(scene.sky, 0, 0);
    const night = KFN[11];
    const hz = layout.BG0;
    if (night > 0.25) {
      for (const s of stars) {
        if (Math.sin(t * s.sp + s.ph) < -0.4) continue;
        g.globalAlpha = clamp((night - 0.25) / 0.5, 0, 1);
        g.fillStyle = "#ffffff";
        g.fillRect(R(s.x * LW), R(layout.CH + 2 + s.y * (hz - layout.CH)), 1, 1);
      }
      g.globalAlpha = 1;
    }
    const sunU = (TOD - 0.04) / 0.56;
    const moonU = (((TOD - 0.6) + 1) % 1) / 0.46;
    if (sunU >= 0 && sunU <= 1) {
      const x = LW * (0.08 + 0.84 * sunU);
      const y = hz * 0.95 - Math.sin(Math.PI * sunU) * (hz - layout.CH) * 0.7;
      g.drawImage(glowCanvas(doc, 9), R(x) - 9, R(y) - 9);
      g.fillStyle = "#fff2a8";
      g.fillRect(R(x - 4), R(y - 4), 9, 9);
      g.fillRect(R(x - 3), R(y - 5), 7, 11);
      g.fillRect(R(x - 5), R(y - 3), 11, 7);
    } else if (moonU >= 0 && moonU <= 1) {
      const x = LW * (0.08 + 0.84 * moonU);
      const y = hz * 0.9 - Math.sin(Math.PI * moonU) * (hz - layout.CH) * 0.6;
      g.fillStyle = "#f0f0e0";
      g.fillRect(R(x - 3), R(y - 4), 7, 9);
      g.fillRect(R(x - 4), R(y - 3), 9, 7);
      g.fillStyle = "#d0d0c0";
      g.fillRect(R(x + 1), R(y - 2), 2, 2);
      g.fillRect(R(x - 2), R(y + 1), 2, 2);
    }
    const cc = "rgb(" + R(lerpN(250, 70, night)) + "," + R(lerpN(250, 80, night)) + "," + R(lerpN(255, 130, night)) + ")";
    g.fillStyle = cc;
    for (const c of clouds) {
      const x = ((c.x * LW + t * c.v) % (LW + 60)) - 30;
      const y = layout.CH + 4 + c.y * (hz - layout.CH) * 0.6;
      const s = c.s;
      g.fillRect(R(x), R(y), R(22 * s), R(4 * s));
      g.fillRect(R(x + 4 * s), R(y - 3 * s), R(12 * s), R(4 * s));
      g.fillRect(R(x + 14 * s), R(y - 2 * s), R(8 * s), R(3 * s));
    }
  }

  function lerpN(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  // --- layout --------------------------------------------------------------
  function resize(w: number, h: number): void {
    const px = cfg.pixelSize > 0 ? cfg.pixelSize : Math.max(2, Math.round(Math.min(w, h) / 240));
    LW = Math.ceil(w / px);
    LH = Math.ceil(h / px);
    canvas.width = LW;
    canvas.height = LH;
    canvas.style.width = LW * px + "px";
    canvas.style.height = LH * px + "px";
    g.imageSmoothingEnabled = false;
    scratch.width = 26;
    scratch.height = 30;
    layout = computeLayout(LW, LH);
    scene = buildStationScene(doc, LW, LH);
    paintSky(scene, KFN);
    people.forEach((p) => {
      p.x = clamp(p.x, -50, LW + 20);
      p.y = clamp(p.y, layout.PY0 + 2, LH - 14);
    });
    passers.length = 0;
    train = null;
    nextTrainAt = now() + 1500;
    tick.text = fillers()[0];
    tick.x = LW;
  }

  // --- loop ---------------------------------------------------------------
  let last = now();
  let ready = false;
  function frame(): void {
    if (!ready) {
      last = now();
      requestAnimationFrame(frame);
      return;
    }
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const secs = t / 1000;

    TOD = cfg.pinnedHour ?? ((0.2 + secs / cfg.dayLen + todOffset) % 1 + 1) % 1;
    KFN = skyAt(TOD);

    audienceShown = easeAudience(audienceShown, audienceReal, dt);
    const tier = settledTier(bakedTier, audienceShown);
    if (tier !== bakedTier) {
      bakedTier = tier;
      // Changing tier while a train is at the platform would leave a train of
      // one length standing under a platform sized for another, so the change
      // waits for the next service.
      topUpAmbient();
      trimAmbient();
    }

    updateWorld(dt, t);
    for (const p of [...people.values()]) updatePerson(p, dt, t);

    g.clearRect(0, 0, LW, LH);
    paintSky(scene, KFN);
    drawSkyStuff(secs);
    drawScene(secs, t);

    const wash = nightWash(KFN);
    if (wash) {
      g.save();
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = `rgba(${wash.r},${wash.g},${wash.b},${wash.a.toFixed(3)})`;
      g.fillRect(0, 0, LW, LH);
      g.restore();
      g.globalCompositeOperation = "source-over";
    }

    drawLights(secs);
    drawEffects(secs);
    drawLabels(t);
    drawHud(t);
    requestAnimationFrame(frame);
  }

  function start(): void {
    ready = true;
    // A station with nobody on it is a drawing, not a station. The background
    // crowd starts at the smallest tier and grows with the room from there.
    topUpAmbient();
    paintSky(scene, KFN);
    tick.text = fillers()[0];
    tick.x = LW;
    nextTrainAt = now() + 1500;
    requestAnimationFrame(frame);
  }

  if (cfg.demo) {
    // A stand-in feed, so the station can be looked at without a live room.
    let i = 0;
    const names = demoNames.map((n, k) => ({ id: n.toLowerCase() + (k + 1), user: n }));
    const timer = setInterval(() => {
      const n = names[i++ % names.length];
      const k = i % 4;
      if (k === 0) handle(entryOf("join", n));
      else if (k === 1) handle(entryOf("comment", n, "HALO"));
      else if (k === 2) handle(entryOf("like", n));
      else handle(entryOf("gift", n, "", { diamonds: 5 }));
    }, 1400);
    canvas.dataset.demoTimer = String(timer);
  }

  let demoSeq = 0;
  function entryOf(kind: Entry["kind"], u: { id: string; user: string }, value = "", meta: Record<string, unknown> = {}): Entry {
    return { id: `${kind}-${u.id}-${demoSeq}`, seq: demoSeq++, ts: now(), kind, user: u.user, userId: u.id, value, meta };
  }

  const engine: StationEngine = {
    cfg,
    snapshot() {
      return {
        people: people.size,
        onPlatform: [...people.values()].filter((p) => p.state !== "queued").length,
        ambient: [...people.values()].filter((p) => p.ambient).length,
        real: [...people.values()].filter((p) => !p.ambient && p.state !== "queued").length,
        audience: audienceReal,
        audienceShown: Math.round(audienceShown),
        tier: audienceTier(audienceShown).name,
        tierIndex: bakedTier,
        cars: train ? train.n : carsFor(LW, bakedTier),
        states: [...people.values()].reduce<Record<string, number>>((acc, p) => {
          acc[p.state] = (acc[p.state] ?? 0) + 1;
          return acc;
        }, {}),
        trainPhase: train ? train.phase : null,
        trainOpen: train ? Number(train.open.toFixed(3)) : 0,
        doors: train ? train.doors.length : 0,
        passers: passers.length,
        diamonds: totalDiamonds,
        sprites: coins.length + hearts.length + confetti.length + sparks.length,
        LW,
        LH,
      };
    },
    handle: (e: Entry) => handle(e),
    resize,
    start,
    step(dt: number) {
      const t = now();
      updateWorld(dt, t);
      for (const p of [...people.values()]) updatePerson(p, dt, t);
    },
  };
  return engine;
}
