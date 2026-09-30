"use client";

import type { CustomiserProps } from "@/lib/widgets/types";
import { str } from "@/lib/widgets/style";
import { SOCIAL_PLATFORMS } from "@/lib/widgets/social";
import { Group, Note } from "./shared";
import { inputCls } from "@/lib/editor/controls";

/**
 * The social customiser.
 *
 * One field per platform, because that is what people actually know: you know
 * your Instagram, you do not "know row 2 of a textarea". The generic form could
 * only offer a single newline-separated text setting, which meant reading a list
 * back out of a string to change the third link — and a handle that did not fit
 * the `Label | Handle` shape silently became the label.
 *
 * The platform list is imported from the widget rather than repeated, so a key
 * can never be added to one side and forgotten on the other: that would not throw,
 * it would swallow the handle.
 */
export function SocialCustomizer({ style, onChange }: CustomiserProps) {
  const filled = SOCIAL_PLATFORMS.filter((p) => str(style, p.key, "").trim()).length;

  return (
    <div className="space-y-4">
      <Group title="Platforms">
        <div className="space-y-2.5">
          {SOCIAL_PLATFORMS.map((p) => (
            <label key={p.key} className="block">
              <span className="mb-1.5 flex items-baseline gap-1.5 text-xs text-neutral-500">
                <span aria-hidden>{p.icon}</span>
                {p.label}
              </span>
              <input
                value={str(style, p.key, "")}
                onChange={(e) => onChange(p.key, e.target.value)}
                placeholder={p.placeholder}
                spellCheck={false}
                autoCapitalize="none"
                className={inputCls}
              />
            </label>
          ))}
        </div>
        <Note>
          {filled === 0
            ? "Empty ones are left off the overlay — the widget draws nothing until at least one is filled in."
            : `${filled} of ${SOCIAL_PLATFORMS.length} filled in. They draw in this order, and anything left empty is skipped.`}
        </Note>
      </Group>
    </div>
  );
}