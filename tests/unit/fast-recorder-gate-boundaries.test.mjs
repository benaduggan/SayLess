import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFastRecorderProbeResult } from "../../src/media/fastRecorderGate.ts";

test("fast recorder cached probes reject malformed outer fields", () => {
  assert.equal(normalizeFastRecorderProbeResult(null), null);
  assert.equal(
    normalizeFastRecorderProbeResult({
      ok: true,
      reasons: "none",
      details: {},
    }),
    null
  );
  assert.equal(
    normalizeFastRecorderProbeResult({
      ok: true,
      reasons: [],
      details: [],
      at: 1,
    }),
    null
  );
});

test("fast recorder cached probes normalize trusted detail fields", () => {
  const result = normalizeFastRecorderProbeResult({
    ok: true,
    reasons: [],
    at: 123,
    details: {
      selectedVideoConfig: {
        codec: "avc1.42E028",
        width: 1280,
        height: 720,
        bitrate: 4_000_000,
        hardwareAcceleration: "prefer-hardware",
      },
      containerKind: "webm",
      userAgent: "test-agent",
      gateVersion: "ladder-v1",
    },
  });

  assert.equal(result?.details.selectedVideoConfig?.codec, "avc1.42E028");
  assert.equal(result?.details.selectedVideoConfig?.width, 1280);
  assert.equal(result?.details.containerKind, "webm");
  assert.equal(result?.details.userAgent, "test-agent");
});

test("fast recorder cached probes discard invalid typed detail fields", () => {
  const result = normalizeFastRecorderProbeResult({
    ok: true,
    reasons: [],
    details: {
      selectedVideoConfig: { codec: "avc1", width: "1280", height: 720 },
      containerKind: "avi",
      userAgent: 42,
      gateVersion: null,
    },
  });

  assert.equal(result?.details.selectedVideoConfig, undefined);
  assert.equal(result?.details.containerKind, undefined);
  assert.equal(result?.details.userAgent, undefined);
  assert.equal(result?.details.gateVersion, undefined);
});
