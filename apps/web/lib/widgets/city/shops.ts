/**
 * The pixel city — viewer shopfronts.
 *
 * The most visible thing a gift buys: a shop with the giver's own name on the
 * board, in the row of buildings, for as long as they are in the top of the
 * ranking. It is worth the pixels because it does not need to be read — a gold
 * board among the neon ones is the status, and the name is there for anyone who
 * looks closer.
 *
 * Slots are assigned by rank, not handed out in arrival order, so the street
 * re-sorts itself as the evening goes on and the biggest spender ends up with
 * the best address rather than the first one. Because the layout is seeded, a
 * slot index is the same shopfront forever, so a viewer keeps their shop across a
 * resize or a reload instead of watching their name walk down the street.
 */

import type { ShopOwners } from "./scenery";

/** How many shopfronts can be owned at once. */
export const SHOP_SLOTS = 6;
/**
 * The smallest total that earns a shopfront.
 *
 * On the same scale as the wardrobe's first tier, so a shop and a hat arrive
 * together rather than one viewer walking round in a hat their gift did not
 * pay for. Without a floor, a single rose bought a sign — which made the most
 * visible status in the scene mean almost nothing.
 */
export const SHOP_MIN = 50;

export interface Shop {
  id: string;
  name: string;
  diamonds: number;
  slot: number;
}

/** Slots are spread across the row rather than packed at one end. */
const SLOT_ORDER = [2, 5, 0, 7, 3, 9] as const;

export interface ShopsOptions {
  max?: number;
  onChanged?: (owners: ShopOwners, shops: Shop[]) => void;
}

export interface Shops {
  /** Records a gift and re-sorts. Returns true if the row changed. */
  donate: (id: string, name: string, diamonds: number) => boolean;
  owners: () => ShopOwners;
  list: () => Shop[];
  reset: () => void;
}

export function createShops(opts: ShopsOptions = {}): Shops {
  const max = opts.max ?? SHOP_SLOTS;
  const totals = new Map<string, { name: string; diamonds: number }>();
  let current: ShopOwners = {};
  let ordered: Shop[] = [];

  function sortAndAssign(): boolean {
    const ranked = [...totals.entries()]
      .filter(([, v]) => v.diamonds >= SHOP_MIN)
      .sort((a, b) => b[1].diamonds - a[1].diamonds)
      .slice(0, max);

    const next: ShopOwners = {};
    const shops: Shop[] = [];
    ranked.forEach(([id, v], rank) => {
      // The slot order is fixed, so a viewer holding rank 1 keeps their shop
      // while they stay first, rather than it shuffling every time someone
      // spends one diamond more and comes second.
      const slot = SLOT_ORDER[rank] ?? rank;
      next[slot] = { name: v.name, tier: rank };
      shops.push({ id, name: v.name, diamonds: v.diamonds, slot });
    });

    const same =
      Object.keys(next).length === Object.keys(current).length &&
      Object.keys(next).every((k) => {
        const a = current[Number(k)];
        const b = next[Number(k)];
        return !!a && !!b && a.name === b.name;
      });
    if (same) return false;

    current = next;
    ordered = shops;
    opts.onChanged?.(current, shops);
    return true;
  }

  return {
    donate(id, name, diamonds) {
      const prev = totals.get(id);
      totals.set(id, { name: name || prev?.name || id, diamonds: (prev?.diamonds || 0) + diamonds });
      return sortAndAssign();
    },
    owners: () => current,
    list: () => ordered,
    reset() {
      totals.clear();
      current = {};
      ordered = [];
    },
  };
}
