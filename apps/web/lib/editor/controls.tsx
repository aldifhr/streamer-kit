"use client";

import { useState } from "react";
import { withAlpha } from "@/lib/css";
import type { Control } from "@/lib/widgets/types";

export const inputCls =
  "w-full rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm outline-none transition focus:border-white/40";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

export function Range({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full"
    />
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; style?: React.CSSProperties }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-white/15 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={o.style}
          className={`flex-1 rounded-md py-1.5 text-[11px] transition ${
            value === o.value ? "bg-white text-black" : "text-neutral-400 hover:bg-white/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-400">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
          checked ? "bg-white" : "bg-neutral-800"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-4 bg-black" : "translate-x-0 bg-white"
          }`}
        />
      </button>
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={normaliseHex(value)}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-11 shrink-0 cursor-pointer rounded border border-white/15 bg-neutral-950"
    />
  );
}

/**
 * `<input type="color">` only accepts `#rrggbb`, so a migrated config that
 * stored an `rgba()` string would render as black and silently rewrite the
 * user's colour on first interaction. Fall back to the last opaque value.
 */
function normaliseHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return value;
  return "#ffffff";
}

/** Swatch plus an opacity slider, the pair every surface colour uses. */
export function ColorField({
  label,
  color,
  opacityKey,
  opacity,
  onColor,
  onOpacity,
}: {
  label: string;
  color: string;
  opacityKey?: string;
  opacity: number;
  onColor: (v: string) => void;
  onOpacity: (v: number) => void;
}) {
  return (
    <Field label={opacityKey ? `${label} — ${Math.round(opacity)}%` : label}>
      <div className="flex items-center gap-3">
        <ColorInput value={color} onChange={onColor} />
        {opacityKey ? <Range min={0} max={100} value={opacity} onChange={onOpacity} /> : null}
      </div>
    </Field>
  );
}

export function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className={inputCls}
    />
  );
}

/** The swatch a colour field shows for a translucent surface. */
export function AlphaSwatch({ color, opacity }: { color: string; opacity: number }) {
  return (
    <span
      aria-hidden
      className="h-4 w-4 rounded border border-white/15"
      style={{ background: withAlpha(color, opacity) }}
    />
  );
}

/** Progressive disclosure for the long tail of a widget's controls. */
export function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-600 transition hover:text-neutral-400"
      >
        {title}
        <span className="text-neutral-700">{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="space-y-4 pt-2">{children}</div> : null}
    </div>
  );
}

export type { Control };
