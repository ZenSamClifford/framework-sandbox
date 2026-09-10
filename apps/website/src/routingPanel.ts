/**
 * Fills in the preview-globals section of the server-rendered routing panel.
 *
 * `window.Contensis*` is injected by the Request Handler before `</body>`, so it exists
 * only on a page that came through a handler. The server cannot know these values, which
 * is why this one section is client-filled while the rest of the panel is not.
 *
 * Absent means "served directly", not "broken". `ContensisEntryId` is emitted empty on
 * any block pushed after the 2025-11-03 cutoff, because the handler reads it from a query
 * string that is no longer appended, so that distinction is a finding worth showing
 * rather than a bug. Do not take identity from these: that is what x-node-id and
 * x-entry-id are for.
 */

declare global {
  interface Window {
    ContensisProjectApiId?: string;
    ContensisAlias?: string;
    ContensisSso?: string;
    ContensisEntryVersionStatus?: string;
    ContensisEntryId?: string;
    ContensisEntryLanguage?: string;
    ContensisVersionNumber?: string;
  }
}

const GLOBALS = [
  "ContensisProjectApiId",
  "ContensisAlias",
  "ContensisSso",
  "ContensisEntryVersionStatus",
  "ContensisEntryId",
  "ContensisEntryLanguage",
  "ContensisVersionNumber",
] as const;

export function fillRoutingPanelGlobals() {
  const panel = document.querySelector("#routing-panel");
  // The panel is only there when the block server injected it. Under `vp dev` it is not.
  if (!panel) return;

  for (const name of GLOBALS) {
    const slot = panel.querySelector<HTMLElement>(`[data-routing-global="${name}"]`);
    if (!slot) continue;

    const value = window[name];
    slot.textContent =
      value === undefined ? "absent (no handler)" : value === "" ? 'empty ("")' : value;
    slot.className = value === undefined ? "rp-absent" : value === "" ? "rp-empty" : "rp-value";
  }
}
