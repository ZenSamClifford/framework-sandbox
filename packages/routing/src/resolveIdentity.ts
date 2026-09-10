/**
 * Works out which site view node a request is for.
 *
 * The request path is the least reliable input a Contensis block gets: it is `/`
 * under local dev, the friendly URL when the block has `enableFullUriRouting` on,
 * and a declared endpoint path otherwise. `x-node-id` and `x-entry-id` are set
 * unconditionally in all three cases, so they are the primary channel and the path
 * is only a fallback.
 *
 * CRB routes on the path alone, which is why every page renders as the homepage
 * behind `contensis dev requests`. See `../.knowledge/routing-design.md`.
 *
 * This is step 1a: pure, no network. Turning an identity into a node is 1b.
 */

export type Identity =
  | { kind: "id"; value: string; source: "header" }
  | { kind: "path"; value: string; source: "path" };

export type Diagnostic = {
  code: "malformed-node-id" | "malformed-entry-id";
  from: "header";
  value: string;
};

export type Resolution = {
  identity: Identity;
  /**
   * Supplementary only, never the dispatch key. Useful for preview state and as a
   * `nodes.getByEntry` fallback in 1b.
   */
  entryId?: string;
  diagnostics: Diagnostic[];
};

export type ResolveIdentityInput = {
  headers: Record<string, string | string[] | undefined>;
  /** Path and query together, as Node's `req.url` and Fetch's `new URL(req.url)` both give. */
  url: string;
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request headers this resolver reads, so a consumer can display or forward them
 * without restating the list. Referenced at the call sites in `resolveIdentity` below,
 * which is what stops the constant and the behaviour drifting apart.
 *
 * Only these two are set unconditionally in all three path shapes. The handler's
 * request denylist and its `x-requires-*` response hints are facts about the handler
 * rather than about this resolver, so they are deliberately not here. See
 * `../.knowledge/request-path-contract.md`.
 */
export const IDENTITY_HEADERS = {
  nodeId: "x-node-id",
  entryId: "x-entry-id",
} as const;

export type IdentityHeaderName = (typeof IDENTITY_HEADERS)[keyof typeof IDENTITY_HEADERS];

/**
 * Headers arrive lowercased from Node, but not from every runtime, and a repeated
 * header comes through as an array. Normalise both.
 */
function readHeader(headers: ResolveIdentityInput["headers"], name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * Blank counts as absent rather than malformed: an empty header is a header that
 * was not really set, and warning about it would be noise. A non-blank value that
 * is not a GUID is a real problem and must not reach the Delivery API, so it is
 * reported and then treated as absent.
 */
function validGuid(
  value: string | undefined,
  code: Diagnostic["code"],
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!GUID.test(trimmed)) {
    diagnostics.push({ code, from: "header", value: trimmed });
    return undefined;
  }
  return trimmed;
}

/**
 * Mirrors the handler's own normalisation, from `RouteService.GetRouteForRequest`:
 *
 *   originUri.AbsolutePath.Length > 1
 *     ? originUri.AbsolutePath.TrimEnd('/')
 *     : originUri.AbsolutePath
 *
 * Matching their rule matters more than picking a tidier one, so that a path we
 * fall back to is the same string the handler looked the node up with.
 */
function normalisePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

export function resolveIdentity(input: ResolveIdentityInput): Resolution {
  const diagnostics: Diagnostic[] = [];

  // A base is required for relative URLs and is otherwise unused.
  const url = new URL(input.url, "http://placeholder");

  const node = validGuid(
    readHeader(input.headers, IDENTITY_HEADERS.nodeId),
    "malformed-node-id",
    diagnostics,
  );
  const entry = validGuid(
    readHeader(input.headers, IDENTITY_HEADERS.entryId),
    "malformed-entry-id",
    diagnostics,
  );

  const identity: Identity = node
    ? { kind: "id", value: node, source: "header" }
    : { kind: "path", value: normalisePath(url.pathname), source: "path" };

  return entry ? { identity, entryId: entry, diagnostics } : { identity, diagnostics };
}
