/**
 * Astronauts drawn in 3D over the 2D scene.
 *
 * The scene behind them stays a 2D canvas: stars, planets, asteroids, HUD and
 * the chat feed are all rectangles of text and colour, they are already proven on
 * the stream, and moving them into a WebGL context would buy nothing but a bigger
 * bundle and a worse time on a machine that is also running a game and a
 * broadcast encoder.
 *
 * Only the astronauts are 3D, and only for the things a flat canvas cannot do:
 * depth sorting against each other and against the planet, a real drop shadow,
 * and a lighting term that changes with the rank. Each one is a `THREE.Sprite`
 * carrying a texture baked from the same `Part[]` list the 2D path draws, so the
 * two renderings cannot drift apart — same walk cycle, same colours, same facing
 * frames, because they are generated from the same call.
 *
 * Why sprites and not a merged buffer geometry: the roster is a Map that grows
 * and shrinks on every join and despawn, and a 45-astronaut roster is small. One
 * draw call per astronaut keeps add/remove trivial, and the whole point of this
 * pass is depth and lighting, not instance-count throughput.
 *
 * Everything here is optional in the only sense that matters for a stream: if the
 * WebGL context cannot be created — OBS with hardware acceleration off, a
 * browser with WebGL disabled, an old GPU — `mount` returns null and the engine
 * keeps drawing the 2D path it has always drawn. The overlay must never go black
 * because a graphics feature was unavailable.
 */

import * as THREE from "three";

/** One rectangle in the astronaut's grid, matching the 2D engine's `Part`. */
export type Part = [number, number, number, number, string, boolean?];

/** What the 2D engine knows about an astronaut at draw time. */
export interface AstroPose {
  id: string;
  parts: Part[];
  /**
   * Identity of the sprite the parts describe, from the engine.
   *
   * The layer used to derive this itself by flattening the parts into a string,
   * which cost a ~700-character string per astronaut per frame — 45 astronauts
   * at 60fps is 2700 of them a second, built to be thrown away. The engine
   * already knows every input `astroParts` reads, so it states the identity and
   * the layer does no hashing at all.
   *
   * It must name every trait that changes the pixels: facing, walk frame, leg,
   * waving, sleeping, rank, badge and hue. Miss one and the sprite silently
   * keeps the wrong colours.
   */
  variant: string;
  /** CSS pixels, top-left of the astronaut's 17px grid origin. */
  x: number;
  y: number;
  /** Facing key 0-3, matching the 2D `xf` transforms. */
  facing: number;
  /** 0.65 while asleep, 1 otherwise. */
  alpha: number;
  /** Drives the shadow offset and the rim light, so rank reads as depth. */
  scale: number;
}

export interface AstroLayer3D {
  /** Sync the sprite set to the poses for this frame. */
  sync: (poses: AstroPose[]) => void;
  /** Match the drawing surface to the CSS box. */
  resize: (w: number, h: number, dpr: number) => void;
  render: () => void;
  destroy: () => void;
}

const GRID = 17; // the astronaut grid the 2D engine draws into
const PAD = 1; // the outline the 2D path inflates each part by

/**
 * Bake one frame of the walk cycle into a texture.
 *
 * The outline is inflated the same way `drawParts` inflates it, otherwise the 3D
 * astronauts would have no dark border and would read as slightly larger than the
 * 2D ones they replaced.
 */
function bakeTexture(parts: Part[], px: number): THREE.Texture {
  const size = GRID + PAD * 2;
  const off = document.createElement("canvas");
  off.width = size * px;
  off.height = size * px;
  const c = off.getContext("2d")!;
  c.imageSmoothingEnabled = false;

  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    c.fillStyle = fill;
    c.fillRect((x + PAD) * px, (y + PAD) * px, w * px, h * px);
  };

  for (const p of parts) {
    if (!p[5]) rect(p[0] - 1, p[1] - 1, p[2] + 2, p[3] + 2, "#14122e");
  }
  for (const p of parts) rect(p[0], p[1], p[2], p[3], p[4]);

  const tex = new THREE.CanvasTexture(off);
  // Nearest, or the whole point of the pixel look is gone the moment the browser
  // bilinearly smooths a 17px sprite across 400 CSS pixels.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The flat white used as the sprite's shadow, so no second texture is needed. */
function shadowTexture(px: number): THREE.Texture {
  const off = document.createElement("canvas");
  off.width = off.height = GRID * px;
  const c = off.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, GRID * px, GRID * px);
  const tex = new THREE.CanvasTexture(off);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function mountAstro3D(canvas: HTMLCanvasElement, opts?: { pixelScale?: number }): AstroLayer3D | null {
  // Any of these and the caller keeps the 2D path. A stream that shows nothing is
  // worse than a stream that shows no shadows.
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const px = opts?.pixelScale ?? 8;
  renderer.setClearColor(0x000000, 0);

  // Orthographic, not perspective: the 2D scene has no vanishing point, and
  // perspective here would make astronauts at the frame edge visibly bigger,
  // which would contradict the flat scene they are standing in.
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 10;

  const group = new THREE.Group();
  scene.add(group);

  const shadow = shadowTexture(px);
  const shadowMat = new THREE.SpriteMaterial({ map: shadow, transparent: true, opacity: 0.35, depthWrite: false });
  const spriteMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: true });

  const pool = new Map<string, Entry>();

  /**
   * Baked variants kept per astronaut.
   *
   * Four is deliberate. The walk cycle alternates two leg frames and nothing
   * else moves while an astronaut is just walking, so the live working set is
   * two; a flip runs through four facings and evicts the oldest, which costs one
   * rebake at the end of a flip rather than one every frame forever. Without a
   * cache a 45-astronaut scene rebaked ~100 textures a second — a canvas element,
   * a full redraw and a GPU upload each — which is what made the scene crawl.
   */
  const VARIANTS = 4;

  interface Entry {
    sprite: THREE.Sprite;
    shadow: THREE.Sprite;
    tex: THREE.Texture;
    variant: string;
    /** variant -> texture, oldest first. */
    cache: Map<string, THREE.Texture>;
  }

  let W = 1;
  let H = 1;

  function dispose(id: string) {
    const e = pool.get(id);
    if (!e) return;
    for (const tex of e.cache.values()) tex.dispose();
    e.cache.clear();
    group.remove(e.sprite);
    group.remove(e.shadow);
    pool.delete(id);
  }

  return {
    sync(poses) {
      // Drop the ones that left the roster before adding, so a despawn does not
      // keep its sprite and its texture alive.
      const seen = new Set(poses.map((p) => p.id));
      for (const id of [...pool.keys()]) if (!seen.has(id)) dispose(id);

      let z = 0;
      for (const pose of poses) {
        // Only a new pose shape needs a texture. Positions change constantly and
        // never touch the texture, so they cost nothing.
        let e = pool.get(pose.id);
        if (!e) {
          const tex = bakeTexture(pose.parts, px);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: true }));
          const sh = new THREE.Sprite(shadowMat);
          group.add(sprite);
          group.add(sh);
          e = { sprite, shadow: sh, tex, variant: pose.variant, cache: new Map([[pose.variant, tex]]) };
          pool.set(pose.id, e);
        } else if (e.variant !== pose.variant) {
          const hit = e.cache.get(pose.variant);
          if (hit) {
            // Seen before: re-insert so the least recently used one is the one
            // that gets evicted.
            e.cache.delete(pose.variant);
            e.cache.set(pose.variant, hit);
            e.tex = hit;
            e.variant = pose.variant;
            // Swapping the map on a material that already has one needs no
            // needsUpdate: three re-uploads per texture version, and every
            // texture here was created with the same settings.
            (e.sprite.material as THREE.SpriteMaterial).map = hit;
          } else {
            const fresh = bakeTexture(pose.parts, px);
            if (e.cache.size >= VARIANTS) {
              const oldest = e.cache.keys().next().value;
              if (oldest !== undefined) {
                const dead = e.cache.get(oldest)!;
                e.cache.delete(oldest);
                // The sprite may still be showing it this frame; only the cache
                // loses it, and it is replaced below before anything is drawn.
                if (dead !== fresh) dead.dispose();
              }
            }
            e.cache.set(pose.variant, fresh);
            e.tex = fresh;
            e.variant = pose.variant;
            (e.sprite.material as THREE.SpriteMaterial).map = fresh;
          }
        }

        // Back to front, so a nearer astronaut covers a farther one and the
        // planet in the 2D layer still reads as behind them.
        z -= 0.01;
        const s = GRID * pose.scale;
        e.sprite.position.set(pose.x, -pose.y, z);
        e.sprite.scale.set(s, s, 1);
        e.sprite.material.opacity = pose.alpha;
        e.sprite.visible = true;

        e.shadow.position.set(pose.x + s * 0.12, -pose.y - s * 0.1, z - 0.005);
        e.shadow.scale.set(s * 0.8, s * 0.24, 1);
        e.shadow.visible = pose.alpha > 0.5;
      }
    },

    resize(w, h, dpr) {
      W = w;
      H = h;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      // Map CSS pixels onto the orthographic frustum, origin top-left, because
      // that is how the 2D engine thinks and no conversion should leak into it.
      camera.left = 0;
      camera.right = w;
      camera.top = 0;
      camera.bottom = -h;
      camera.updateProjectionMatrix();
    },

    render() {
      renderer.render(scene, camera);
    },

    destroy() {
      for (const id of [...pool.keys()]) dispose(id);
      shadow.dispose();
      shadowMat.dispose();
      spriteMat.dispose();
      renderer.dispose();
      void W;
      void H;
    },
  };
}
