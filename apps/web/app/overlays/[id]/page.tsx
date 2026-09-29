"use client";

import { use } from "react";
import { EditorShell } from "@/lib/editor/EditorShell";

/**
 * Route wrapper only. The editor itself lives in lib/editor so it is not
 * entangled with Next's routing — the same split keeps it usable from a
 * different route later without moving code again.
 */
export default function OverlayEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <EditorShell overlayId={id} />;
}
