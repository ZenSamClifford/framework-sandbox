/**
 * Real requests as they arrived at a sink behind a locally run Request Handler,
 * copied verbatim from `../../../../evidence/captures-uol/inbound-headers.capture.log`.
 *
 * Testing against actual handler output rather than hand-written headers is the
 * point: it checks the contract instead of our assumptions about it.
 *
 * The capture is **concatenated JSON objects, not a JSON array**: the sink
 * appended one object per request. It is kept byte-identical rather than tidied
 * into an array, so `splitConcatenatedJson` exists to read it. The `.log`
 * extension is deliberate: calling it `.json` makes every formatter and parser
 * choke on a file that is genuinely not a JSON document.
 */

import { readFileSync } from "node:fs";

export type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
};

/**
 * Splits `}{`-adjacent top-level objects by tracking brace depth outside strings.
 * Enough for this capture; not a general JSON stream parser.
 */
export function splitConcatenatedJson(raw: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        chunks.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return chunks;
}

export function loadCapturedRequests(): CapturedRequest[] {
  const raw = readFileSync(new URL("./inboundHeaders.capture.log", import.meta.url), "utf8");
  return splitConcatenatedJson(raw).map((chunk) => JSON.parse(chunk) as CapturedRequest);
}

/** The node the `/accessibility` captures resolve to, on uol / universityDemo. */
export const ACCESSIBILITY_NODE_ID = "b36fcb8a-5817-444e-b3f5-d361ba041ae6";
export const ACCESSIBILITY_ENTRY_ID = "5ba49eef-cff1-46b7-9767-1665f19257c2";
