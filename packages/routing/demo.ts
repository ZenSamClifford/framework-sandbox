/**
 * Replays the real captured requests through the resolver and prints what comes
 * out, so the behaviour can be eyeballed without reading the test assertions.
 *
 *   vp run demo
 */

import { loadCapturedRequests } from "./src/fixtures/inboundHeaders.ts";
import { resolveIdentity } from "./src/resolveIdentity.ts";

for (const [index, capture] of loadCapturedRequests().entries()) {
  const resolution = resolveIdentity({
    headers: capture.headers,
    url: capture.path,
  });

  const sent = capture.headers["x-node-id"] ?? "(none)";
  console.log(`capture ${index}: ${capture.method} ${capture.path}`);
  console.log(`  x-node-id sent : ${sent}`);
  console.log(
    `  resolved       : ${resolution.identity.kind}=${resolution.identity.value} (via ${resolution.identity.source})`,
  );
  console.log(`  entryId        : ${resolution.entryId ?? "(none)"}`);
  console.log(`  diagnostics    : ${JSON.stringify(resolution.diagnostics)}`);
  console.log();
}
