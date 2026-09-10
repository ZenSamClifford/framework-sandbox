/**
 * Renders every property available to routing into the page, server-side.
 *
 * This is the verification instrument for `packages/routing`: the resolver's inputs are
 * request headers, which exist only on the server, so the panel is assembled for the
 * page request itself and injected into the shell. A `/__routing` endpoint the client
 * fetched would be a different request carrying different headers, so it would report
 * its own identity rather than the page's, and would look correct locally while being
 * wrong by construction.
 *
 * The panel deliberately shows absent values as visible rows. The divergence between
 * local dev and a deployed block is the thing being verified, and a panel listing only
 * what arrived would hide exactly that.
 */

import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";

import { IDENTITY_HEADERS } from "routing";
import type { Resolution } from "routing";

/** Named rather than a bare tuple, so an absent value stays distinguishable from "". */
export type HeaderRow = { name: string; value: string | null };

export type PanelData = {
  request: {
    method: string;
    /** As received, path and query together. Displayed for comparison, never routed on. */
    url: string;
    pathname: string;
    /** Present only so "the resolver discards the query" is visible rather than asserted. */
    search: string;
    httpVersion: string;
  };
  /** The resolver's actual inputs, from the package rather than restated here. */
  identityHeaders: HeaderRow[];
  /** Seen arriving behind a real handler. Not identity. */
  observedHeaders: HeaderRow[];
  /** These can never arrive. A value here means the handler's denylist changed. */
  deniedHeaders: HeaderRow[];
  /** Forwarded, but they carry no inbound value: they request response headers. */
  requiresHints: HeaderRow[];
  /** Names only. Values are withheld so `cookie` and `authorization` are never echoed. */
  otherHeaderNames: string[];
  config: {
    source: string;
    values: HeaderRow[];
    /** Names only, credential-looking ones dropped. Catches config set under a name
     * CONFIG_ENV does not list, which is the whole risk with env casing. */
    otherEnvNames: string[];
    manifest: Record<string, unknown> | { error: string };
  };
  /** The whole point: what `resolveIdentity` returned for this request. */
  resolution: Resolution;
  notes: string[];
};

/** From the package, so the app does not restate what the resolver reads. */
const IDENTITY = Object.values(IDENTITY_HEADERS);

// Confirmed to arrive at a sink behind a locally run handler:
// packages/routing/src/fixtures/inboundHeaders.capture.log. `traceparent` is on the
// denylist yet arrived anyway, most likely the .NET HttpClient adding its own, which is
// why it appears in both lists.
// `x-alias` is here rather than in DENIED because the handler source's
// DisallowedRequestHeaderMappings does not contain it, contrary to
// .knowledge/contensis-request-handler-contract.md. Showing its value is what turns that
// into evidence rather than a claim about source.
const OBSERVED = [
  "host",
  "user-agent",
  "accept",
  "accept-language",
  "traceparent",
  "x-debug",
  "x-alias",
];

// The routing-relevant slice of RequestHeaderMappingService.DisallowedRequestHeaderMappings.
// See .knowledge/contensis-request-handler-contract.md. Note that `x-alias` is NOT in the
// source list, contrary to that document: only the project ones are.
const DENIED = [
  "accept-encoding",
  "x-site-type",
  "x-project-api-id",
  "x-project-uuid",
  "x-block-config",
  "x-proxy-config",
  "x-renderer-config",
  "x-iis-hostname",
  "x-loadbalancer-vip",
  "x-forwarded-proto",
  // Denied in source, yet observed arriving behind a local handler, so it is in both
  // lists deliberately. A value here is the evidence of that anomaly, not a contract change.
  "traceparent",
];

// Forwarded to the block, but they are a request for RESPONSE headers and carry no
// inbound value. Confirmed live.
const REQUIRES = [
  "x-requires-alias",
  "x-requires-project-api-id",
  "x-requires-node-id",
  "x-requires-entry-id",
  "x-requires-entry-language",
  "x-requires-block-id",
  "x-requires-version-no",
];

// Alias, project and language come from here or from the manifest, never from the
// request. The deployed CRB entrypoint reads `alias`, `projectId` and `accessToken`, lowercase,
// and process.env is case-sensitive on Linux, so both casings are listed. accessToken is
// deliberately not here: it is a secret. Anything set under another name still shows up
// by name in otherEnvNames below, so the panel reports what the block actually got
// rather than only what this list guessed.
const CONFIG_ENV = [
  "alias",
  "ALIAS",
  "CONTENSIS_ALIAS",
  "projectId",
  "projectApiId",
  "PROJECT",
  "CONTENSIS_PROJECT",
  "PROJECT_API_ID",
  "PORT",
  "NODE_ENV",
];

/** Anything that looks like a credential is dropped rather than named. */
const SECRETISH = /token|secret|key|password|passwd|credential/i;

const NOTES = [
  "The URL path is shown for comparison only and is never dispatched on. It is `/` under `contensis dev requests`, the friendly URL when enableFullUriRouting is on, and a declared endpoint path otherwise.",
  "The query string is discarded by the resolver. ?nodeId and ?entryId are dead past the 2025-11-03 09:00 cutoff and are no longer injected at all.",
  "Denied headers are the ones the handler strips, so they are expected to be absent behind a handler. Served directly, as under `node server/index.ts`, they arrive normally: it is a value on a handler-served page that means the denylist changed.",
  "The x-requires-* headers are forwarded but carry no inbound value. They make the handler emit the corresponding response headers for the cache and CDN layer.",
  "Alias, project and language come from the environment or the block manifest. They can never arrive on the request.",
  "Preview state exists only client-side, in the window.Contensis* globals the handler injects. Absent below means this page was served directly rather than through a handler.",
];

/**
 * The manifest sits at the image root, confirmed against the deployed CRB block image.
 * Read once, and never throw: a panel that can take the block down is worse than no
 * panel.
 */
function readManifest(): Record<string, unknown> | { error: string } {
  for (const path of ["/manifest.json", resolve(import.meta.dirname, "../manifest.json")]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return { error: "no manifest found at /manifest.json or ../manifest.json" };
}

const manifest = readManifest();

function readHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

const rows = (req: IncomingMessage, names: string[]): HeaderRow[] =>
  names.map((name) => ({ name, value: readHeader(req, name) }));

export function collectPanelData(req: IncomingMessage, resolution: Resolution): PanelData {
  const url = new URL(req.url ?? "/", "http://placeholder");
  const known = new Set([...IDENTITY, ...OBSERVED, ...DENIED, ...REQUIRES]);

  return {
    request: {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      pathname: url.pathname,
      search: url.search,
      httpVersion: req.httpVersion,
    },
    identityHeaders: rows(req, IDENTITY),
    observedHeaders: rows(req, OBSERVED),
    deniedHeaders: rows(req, DENIED),
    requiresHints: rows(req, REQUIRES),
    otherHeaderNames: Object.keys(req.headers)
      .filter((name) => !known.has(name.toLowerCase()))
      .sort(),
    config: {
      source: "environment variables and the block manifest",
      values: CONFIG_ENV.map((name) => ({ name, value: process.env[name] ?? null })),
      otherEnvNames: Object.keys(process.env)
        .filter((name) => !CONFIG_ENV.includes(name) && !SECRETISH.test(name))
        .sort(),
      manifest,
    },
    resolution,
    notes: NOTES,
  };
}

/** Header values are attacker-controlled, so nothing reaches the page unescaped. */
const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cell = (value: string | null) =>
  value === null
    ? `<span class="rp-absent">absent</span>`
    : value === ""
      ? `<span class="rp-empty">empty ("")</span>`
      : `<span class="rp-value">${esc(value)}</span>`;

const table = (caption: string, note: string, entries: HeaderRow[]) => `
<table class="rp-table">
  <caption>${esc(caption)}<span class="rp-note">${esc(note)}</span></caption>
  <tbody>
    ${entries
      .map((row) => `<tr><th scope="row">${esc(row.name)}</th><td>${cell(row.value)}</td></tr>`)
      .join("\n    ")}
  </tbody>
</table>`;

const STYLE = `
/* Sits below the starter content rather than floating over it, so the page reads as
   "the app, then its routing readout" and nothing is obscured. */
#routing-panel {
  display: block; margin: 0; width: 100%; clear: both;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #12151c; color: #d8dee9; border-top: 2px solid #4c78d4;
  text-align: left;
}
#routing-panel > summary {
  cursor: pointer; padding: 8px 14px; font-weight: 600; color: #fff;
  background: #1b2029; user-select: none;
}
#routing-panel > summary code { color: #9ec1ff; font-weight: 400; }
#routing-panel .rp-body {
  padding: 14px; min-width: 0;
  display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
}
/* table-layout: fixed and min-width: 0 together stop a long unbroken value (a
   user-agent, an accept list) from forcing the table wider than its grid column and
   overlapping the next one. A grid item will not shrink below min-content otherwise. */
#routing-panel .rp-table {
  border-collapse: collapse; width: 100%; table-layout: fixed; min-width: 0;
}
#routing-panel .rp-table th { width: 40%; }
#routing-panel caption {
  text-align: left; font-weight: 600; color: #fff; padding-bottom: 6px;
}
#routing-panel .rp-note {
  display: block; font-weight: 400; color: #8b95a7; padding-top: 2px;
}
#routing-panel th, #routing-panel td {
  border-bottom: 1px solid #262c38; padding: 3px 8px 3px 0; vertical-align: top;
}
/* No nowrap: x-requires-project-api-id is wider than its 40% column and would run
   over the value beside it. Note this block is a template literal, so no backticks. */
#routing-panel th { color: #8b95a7; font-weight: 400; overflow-wrap: anywhere; }
/* break-word rather than break-all: a long GUID still wraps, but ordinary words are
   not split mid-letter. */
#routing-panel td { overflow-wrap: anywhere; }
#routing-panel .rp-absent { color: #6b7382; font-style: italic; }
#routing-panel .rp-empty { color: #d9a441; font-style: italic; }
#routing-panel .rp-value { color: #a3e0a3; }
#routing-panel .rp-json {
  margin: 0; white-space: pre-wrap; overflow-wrap: break-word; color: #d8dee9;
}
#routing-panel .rp-diag { color: #e88; }
#routing-panel .rp-notes { margin: 0; padding-inline-start: 16px; color: #8b95a7; }
#routing-panel .rp-notes li { margin-bottom: 4px; }
#routing-panel .rp-wide { grid-column: 1 / -1; }
`;

function panelHtml(data: PanelData): string {
  const { identity, entryId, diagnostics } = data.resolution;

  const summary = `Routing panel: identity <code>${esc(identity.kind)}</code> = <code>${esc(
    identity.value,
  )}</code> from <code>${esc(identity.source)}</code>`;

  const diagnosticsHtml =
    diagnostics.length === 0
      ? `<span class="rp-absent">none</span>`
      : `<ul class="rp-notes">${diagnostics
          .map(
            (d) => `<li class="rp-diag">${esc(d.code)} from ${esc(d.from)}: ${esc(d.value)}</li>`,
          )
          .join("")}</ul>`;

  const resolverTable = `
<table class="rp-table">
  <caption>Resolver output<span class="rp-note">resolveIdentity() from packages/routing</span></caption>
  <tbody>
    <tr><th scope="row">identity.kind</th><td>${cell(identity.kind)}</td></tr>
    <tr><th scope="row">identity.value</th><td>${cell(identity.value)}</td></tr>
    <tr><th scope="row">identity.source</th><td>${cell(identity.source)}</td></tr>
    <tr><th scope="row">entryId</th><td>${
      entryId === undefined ? `<span class="rp-absent">key omitted</span>` : cell(entryId)
    }</td></tr>
    <tr><th scope="row">diagnostics</th><td>${diagnosticsHtml}</td></tr>
  </tbody>
</table>`;

  const requestTable = table("Request", "shown for comparison, never dispatched on", [
    { name: "method", value: data.request.method },
    { name: "url", value: data.request.url },
    { name: "pathname", value: data.request.pathname },
    { name: "search", value: data.request.search },
    { name: "httpVersion", value: data.request.httpVersion },
  ]);

  const configTable = table(
    "Environment and block config",
    "the only source for alias, project and language",
    [
      ...data.config.values,
      ...Object.entries(data.config.manifest).map(([name, value]) => ({
        name: `manifest.${name}`,
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    ],
  );

  const globalsRows = [
    "ContensisProjectApiId",
    "ContensisAlias",
    "ContensisSso",
    "ContensisEntryVersionStatus",
    "ContensisEntryId",
    "ContensisEntryLanguage",
    "ContensisVersionNumber",
  ]
    .map(
      (name) =>
        `<tr><th scope="row">window.${name}</th><td><span data-routing-global="${name}" class="rp-absent">not filled in</span></td></tr>`,
    )
    .join("\n    ");

  const globalsTable = `
<table class="rp-table">
  <caption>Preview globals<span class="rp-note">injected by the handler, filled in by the client</span></caption>
  <tbody>
    ${globalsRows}
  </tbody>
</table>`;

  // JSON.stringify escapes neither `<` nor `/`, so a header value containing
  // `</script>` would close this block early. Escaping `<` covers `</script>` and
  // `<!--` in one rule, and the output is still valid JSON for jq.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<details id="routing-panel" open>
<summary>${summary}</summary>
<div class="rp-body">
${resolverTable}
${requestTable}
${table("Identity headers", "the resolver's inputs, set unconditionally", data.identityHeaders)}
${table("Observed headers", "seen behind a real handler, not identity", data.observedHeaders)}
${table(
  "Denied headers",
  "expected absent behind a handler; served directly, they arrive normally",
  data.deniedHeaders,
)}
${table("x-requires-* hints", "forwarded, but no inbound value", data.requiresHints)}
${configTable}
${globalsTable}
<div class="rp-wide">
  <table class="rp-table">
    <caption>Other headers<span class="rp-note">names only, values withheld</span></caption>
    <tbody>
      <tr><td>${
        data.otherHeaderNames.length === 0
          ? `<span class="rp-absent">none</span>`
          : esc(data.otherHeaderNames.join(", "))
      }</td></tr>
    </tbody>
  </table>
</div>
<div class="rp-wide">
  <table class="rp-table">
    <caption>Other environment variables<span class="rp-note">names only, credential-looking names dropped</span></caption>
    <tbody>
      <tr><td>${
        data.config.otherEnvNames.length === 0
          ? `<span class="rp-absent">none</span>`
          : esc(data.config.otherEnvNames.join(", "))
      }</td></tr>
    </tbody>
  </table>
</div>
<div class="rp-wide">
  <table class="rp-table">
    <caption>Notes</caption>
    <tbody>
      <tr><td><ul class="rp-notes">${data.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></td></tr>
    </tbody>
  </table>
</div>
</div>
<style>${STYLE}</style>
<script id="routing-panel-data" type="application/json">${json}</script>
</details>`;
}

/**
 * Splice the panel in at the last `</body>`.
 *
 * The style is inline rather than a built asset on purpose: the panel has to work when
 * the built JS or CSS fails to load, and an emitted asset would need the handler's
 * per-version prefix rewrite. Nothing here contains a `/static` literal, which the
 * handler would rewrite and so make the JSON environment-dependent.
 */
export function injectPanel(html: string, data: PanelData): string {
  const marker = "</body>";
  const at = html.lastIndexOf(marker);
  // Serve the page unmodified rather than failing. Every path must answer.
  if (at === -1) return html;
  return html.slice(0, at) + panelHtml(data) + html.slice(at);
}
