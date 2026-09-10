import { describe, expect, it } from "vite-plus/test";

import {
  ACCESSIBILITY_ENTRY_ID,
  ACCESSIBILITY_NODE_ID,
  loadCapturedRequests,
} from "./fixtures/inboundHeaders.ts";
import { resolveIdentity } from "./resolveIdentity.ts";

const A = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const E = "44444444-4444-4444-8444-444444444444";

describe("the header/path chain", () => {
  it("takes the x-node-id header", () => {
    const { identity, diagnostics } = resolveIdentity({
      headers: { "x-node-id": A },
      url: "/",
    });
    expect(identity).toEqual({ kind: "id", value: A, source: "header" });
    expect(diagnostics).toEqual([]);
  });

  it("falls back to the path when no id is present", () => {
    const { identity } = resolveIdentity({
      headers: {},
      url: "/accessibility",
    });
    expect(identity).toEqual({
      kind: "path",
      value: "/accessibility",
      source: "path",
    });
  });

  it("falls back to the root path", () => {
    const { identity } = resolveIdentity({ headers: {}, url: "/" });
    expect(identity).toEqual({ kind: "path", value: "/", source: "path" });
  });
});

describe("blank and malformed ids", () => {
  it("treats a blank header as absent, without complaining", () => {
    const { identity, diagnostics } = resolveIdentity({
      headers: { "x-node-id": "" },
      url: "/about",
    });
    expect(identity).toEqual({
      kind: "path",
      value: "/about",
      source: "path",
    });
    expect(diagnostics).toEqual([]);
  });

  it("treats a whitespace-only header as absent, without complaining", () => {
    const { identity, diagnostics } = resolveIdentity({
      headers: { "x-node-id": "   " },
      url: "/about",
    });
    expect(identity.kind).toBe("path");
    expect(diagnostics).toEqual([]);
  });

  it("reports a malformed header and falls through to the path", () => {
    const { identity, diagnostics } = resolveIdentity({
      headers: { "x-node-id": "not-a-guid" },
      url: "/about",
    });
    expect(identity).toEqual({
      kind: "path",
      value: "/about",
      source: "path",
    });
    expect(diagnostics).toEqual([
      { code: "malformed-node-id", from: "header", value: "not-a-guid" },
    ]);
  });

  it("reports a malformed entry id separately from the node id", () => {
    const { identity, entryId, diagnostics } = resolveIdentity({
      headers: { "x-node-id": A, "x-entry-id": "nope" },
      url: "/",
    });
    expect(identity.kind).toBe("id");
    expect(entryId).toBeUndefined();
    expect(diagnostics).toEqual([{ code: "malformed-entry-id", from: "header", value: "nope" }]);
  });
});

describe("header quirks", () => {
  it("matches header names case-insensitively", () => {
    const { identity } = resolveIdentity({
      headers: { "X-Node-Id": A },
      url: "/",
    });
    expect(identity).toEqual({ kind: "id", value: A, source: "header" });
  });

  // Reachable only from a Fetch-style runtime. `node:http` arrays `set-cookie` alone and
  // joins every other repeated header with ", ", which lands in the malformed branch
  // rather than here, so a unit test is the only cover this has.
  it("takes the first value of a repeated header", () => {
    const { identity } = resolveIdentity({
      headers: { "x-node-id": [A, C] },
      url: "/",
    });
    expect(identity).toEqual({ kind: "id", value: A, source: "header" });
  });

  it("trims surrounding whitespace", () => {
    const { identity } = resolveIdentity({
      headers: { "x-node-id": ` ${A} ` },
      url: "/",
    });
    expect(identity).toEqual({ kind: "id", value: A, source: "header" });
  });
});

describe("the entry id", () => {
  it("comes back alongside a node id", () => {
    const { identity, entryId } = resolveIdentity({
      headers: { "x-node-id": A, "x-entry-id": E },
      url: "/",
    });
    expect(identity.kind).toBe("id");
    expect(entryId).toBe(E);
  });

  it("comes back alongside a path identity too", () => {
    const { identity, entryId } = resolveIdentity({
      headers: { "x-entry-id": E },
      url: "/about",
    });
    expect(identity.kind).toBe("path");
    expect(entryId).toBe(E);
  });

  it("is absent when not supplied", () => {
    const { entryId } = resolveIdentity({
      headers: { "x-node-id": A },
      url: "/",
    });
    expect(entryId).toBeUndefined();
  });
});

describe("path normalisation, mirroring the handler", () => {
  it("trims a trailing slash", () => {
    const { identity } = resolveIdentity({ headers: {}, url: "/about/" });
    expect(identity.value).toBe("/about");
  });

  it("leaves the root path alone", () => {
    const { identity } = resolveIdentity({ headers: {}, url: "/" });
    expect(identity.value).toBe("/");
  });

  it("ignores the query string", () => {
    const { identity } = resolveIdentity({
      headers: {},
      url: "/accessibility?a=1&b=2",
    });
    expect(identity.value).toBe("/accessibility");
  });
});

describe("real captures from behind a local Request Handler", () => {
  const captures = loadCapturedRequests();

  it("reads three captured requests", () => {
    expect(captures).toHaveLength(3);
  });

  it("falls back to the path when the handler sent no node id", () => {
    const capture = captures[0]!;
    const { identity } = resolveIdentity({
      headers: capture.headers,
      url: capture.path,
    });
    expect(identity).toEqual({ kind: "path", value: "/", source: "path" });
  });

  // The case that matters. The handler dropped the friendly path, so CRB renders
  // the homepage here. Identity has to come from the header instead.
  it.each([1, 2])("recovers the node id from capture %i even though the path is /", (index) => {
    const capture = captures[index]!;
    expect(capture.path).toBe("/");

    const { identity, entryId, diagnostics } = resolveIdentity({
      headers: capture.headers,
      url: capture.path,
    });

    expect(identity).toEqual({
      kind: "id",
      value: ACCESSIBILITY_NODE_ID,
      source: "header",
    });
    expect(entryId).toBe(ACCESSIBILITY_ENTRY_ID);
    expect(diagnostics).toEqual([]);
  });
});
