/**
 * Guard for the one piece of authored markup in the overlay.
 *
 * `customCSS` is the only value in a config that reaches the DOM as raw text:
 * `overlay/[id]/page.tsx` injects it with `dangerouslySetInnerHTML` so a
 * streamer can style anything. A `<style>` element's content is CSS by grammar,
 * but the parser is only a parser until something closes the tag — a
 * `</style>` inside the string ends the element, and what follows is markup, not
 * CSS, with the page's privileges.
 *
 * So the fix is narrow on purpose. A style tag accepts no URLs to fetch on its
 * own and no script, so stripping `javascript:` here is security theatre: it
 * removes text that could never have executed in the first place. What actually
 * closes the hole is refusing to let the value terminate its own element, and
 * that is the whole of this function.
 *
 * The alternative — a real CSS parser — would be a large dependency to prevent
 * one string. Not worth it, and it would still have to be right.
 */

/** Anything that could end the <style> element or open a new one. */
const TAG_BREAK = /<\s*\/?\s*style/gi;

/** `expression()` and `-moz-binding` are the legacy script paths in old Gecko
 *  and IE. Neither engine is on the list this overlay has to run on, but they
 *  are two words long to reject, and leaving them is the kind of thing that
 *  becomes a finding later. */
const LEGACY_SCRIPT = /(expression\s*\(|-moz-binding\s*:)/gi;

export function safeCustomCSS(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";

  return value
    .replace(TAG_BREAK, "<\\$1style")
    .replace(LEGACY_SCRIPT, "/* blocked */ ");
}
