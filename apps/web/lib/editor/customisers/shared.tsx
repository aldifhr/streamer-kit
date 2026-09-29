"use client";

import { useCallback, useState } from "react";

/**
 * Fires events at an overlay from the editor.
 *
 * The point of routing these through the same endpoint a webhook would use is
 * that a test button and a real donation take an identical path, so what the
 * preview shows is what a real event will do — including the reward tiers,
 * which are unreachable without an actual diamond value on the event.
 */
export function useFire(overlayId: string) {
  const [last, setLast] = useState<string | null>(null);

  const fire = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/overlays/${overlayId}/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setLast(res.ok ? null : `Failed (${res.status})`);
      } catch {
        setLast("Failed");
      }
      setTimeout(() => setLast(null), 2500);
    },
    [overlayId],
  );

  return { fire, last };
}

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">{title}</p>
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-neutral-600">{children}</p>;
}

export const pill =
  "rounded-md border border-white/15 px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-neutral-700";
