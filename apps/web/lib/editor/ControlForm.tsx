"use client";

import { useCallback } from "react";
import type { StyleMap, StyleValue } from "@/lib/css";
import type { Control } from "@/lib/widgets/types";
import {
  ColorField,
  Field,
  NumberInput,
  Range,
  Segmented,
  Toggle,
  inputCls,
} from "./controls";

/**
 * Renders one control descriptor against a style bag.
 *
 * This is the whole reason a new widget needs no editor code: the widget
 * declares its settings as data, and the editor turns that data into a form.
 * `onChange(key, value)` writes a single style key, so a widget's config stays
 * a flat map and two controls writing different keys cannot conflict.
 */
export function ControlField({
  control,
  style,
  onChange,
}: {
  control: Control;
  style: StyleMap;
  onChange: (key: string, value: StyleValue) => void;
}) {
  const set = useCallback((v: StyleValue) => onChange(control.key, v), [control.key, onChange]);
  const current = style[control.key];

  switch (control.kind) {
    case "range": {
      const value = typeof current === "number" ? current : control.min;
      return (
        <Field label={`${control.label} — ${value}${control.suffix ?? ""}`}>
          <Range
            min={control.min}
            max={control.max}
            step={control.step}
            value={value}
            onChange={set}
          />
        </Field>
      );
    }

    case "color": {
      const color = typeof current === "string" ? current : "#000000";
      const opacityKey = control.opacityKey;
      const opacity = opacityKey && typeof style[opacityKey] === "number" ? (style[opacityKey] as number) : 100;
      return (
        <ColorField
          label={control.label}
          color={color}
          opacityKey={opacityKey}
          opacity={opacity}
          onColor={set}
          onOpacity={opacityKey ? (v) => onChange(opacityKey, v) : () => {}}
        />
      );
    }

    case "segmented":
      return (
        <Field label={control.label}>
          <Segmented
            options={control.options}
            value={typeof current === "string" ? current : control.options[0]?.value ?? ""}
            onChange={set}
          />
        </Field>
      );

    case "select":
      return (
        <Field label={control.label}>
          <select
            value={typeof current === "string" ? current : control.options[0]?.value ?? ""}
            onChange={(e) => set(e.target.value)}
            className={inputCls}
          >
            {control.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );

    case "toggle":
      return (
        <Toggle
          label={control.label}
          checked={current === true}
          onChange={set}
        />
      );

    case "numericToggle":
      return (
        <Toggle
          label={control.label}
          checked={current === control.on}
          onChange={(v) => onChange(control.key, v ? control.on : control.off)}
        />
      );

    case "text":
      return (
        <Field label={control.label}>
          <input
            value={typeof current === "string" ? current : ""}
            placeholder={control.placeholder}
            onChange={(e) => set(e.target.value)}
            className={inputCls}
          />
        </Field>
      );

    case "number":
      return (
        <Field label={control.label}>
          <NumberInput
            value={typeof current === "number" ? current : 0}
            min={control.min}
            max={control.max}
            onChange={set}
          />
        </Field>
      );
  }
}

/**
 * A widget's full settings form, read straight off its registry entry.
 *
 * Groups map one-to-one onto the control descriptors above, which is why the
 * editor has no per-feature branch to maintain.
 */
export function WidgetForm({
  groups,
  style,
  onChange,
}: {
  groups: { title?: string; controls: Control[] }[];
  style: StyleMap;
  onChange: (key: string, value: StyleValue) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group, i) => (
        <div key={group.title ?? i} className="space-y-4">
          {group.title ? (
            <p className="border-t border-white/10 pt-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
              {group.title}
            </p>
          ) : null}
          {group.controls.map((c, j) => (
            <ControlField key={`${c.kind}-${c.key}-${j}`} control={c} style={style} onChange={onChange} />
          ))}
        </div>
      ))}
    </div>
  );
}
