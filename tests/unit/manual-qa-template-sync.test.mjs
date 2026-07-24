import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeManualTemplateSync,
  buildSynchronizedManualTemplate,
} from "../../scripts/manual-qa-template-sync.mjs";

const canonicalTemplate = {
  kind: "sayless.manualQaEvidence",
  status: "template",
  version: 1,
  releaseVersion: "4.6.0",
  automatedEvidencePath: "release-artifacts/release-qa-automated.json",
  automatedEvidenceGeneratedAt: "2026-07-22T20:00:00.000Z",
  manualSession: {
    kind: "sayless.manualQaSessionProvenance",
    profileCreatedAt: "YYYY-MM-DDTHH:mm:ss.sssZ",
    releaseVersion: "4.6.0",
    automatedEvidenceGeneratedAt: "YYYY-MM-DDTHH:mm:ss.sssZ",
    buildSha256: "replace-with-build-sha256",
    buildFileCount: 0,
    buildBytes: 0,
    unpackedExtensionId: "replace-with-extension-id",
    operatingSystem: "replace-with-os",
    browserVersion: "replace-with-chrome-version",
  },
  tester: {
    name: "Manual tester name",
  },
  environment: {
    os: "replace-with-os",
    chromeVersion: "replace-with-chrome-version",
    extensionSource: "build",
    cleanChromeProfile: false,
    unpackedExtensionId: "replace-with-extension-id",
    networkDisabledForOfflineTranscription: false,
  },
  zoom: {
    recordingIds: ["replace-with-recording-a", "replace-with-recording-b"],
    observations: [{ recordingId: "replace-with-recording-a" }],
    notes: "Replace with observed varied-dimension zoom behavior across both recordings.",
  },
};

const automatedEvidence = {
  releaseVersion: "4.6.0",
  generatedAt: "2026-07-22T20:00:00.000Z",
};

test("shared manual template synchronization converges after nested merge and placeholder migration", () => {
  const evidence = {
    kind: "sayless.manualQaEvidence",
    status: "template",
    releaseVersion: "stale",
    automatedEvidencePath: "stale.json",
    automatedEvidenceGeneratedAt: "stale",
    tester: {
      name: "Manual tester name",
      email: "tester@example.com",
    },
    environment: {
      unpackedExtensionId: "preserve-user-extension-id",
    },
    zoom: {
      recordingId: "replace-with-tab-or-region-recording-id",
      sourceHadClickMetadata: false,
      previewVerified: false,
      mp4ExportVerified: false,
      keepRemoveVerified: false,
      persistedAfterReopen: false,
      exportInspection: "Replace with how the MP4 export was inspected for the saved zoom framing.",
      notes: "Replace with observed zoom suggestion, preview, and export behavior.",
      legacyTesterComment: "Preserve this entered note",
    },
  };

  const before = analyzeManualTemplateSync({
    canonicalTemplate,
    evidence,
    automatedEvidence,
  });
  assert.equal(before.required, true);
  assert.match(before.reasons.join("\n"), /canonical template fields are missing/);
  assert.match(before.reasons.join("\n"), /retired template placeholders are still present/);
  assert.match(before.reasons.join("\n"), /release version is stale/);

  const synchronized = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence,
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  });
  assert.equal(synchronized.environment.os, "replace-with-os");
  assert.equal(synchronized.environment.chromeVersion, "replace-with-chrome-version");
  assert.equal(synchronized.environment.unpackedExtensionId, "preserve-user-extension-id");
  assert.equal(synchronized.environment.extensionSource, "build");
  assert.equal(synchronized.environment.cleanChromeProfile, true);
  assert.deepEqual(synchronized.manualSession, canonicalTemplate.manualSession);
  assert.equal("email" in synchronized.tester, false);
  assert.deepEqual(synchronized.zoom.recordingIds, [
    "replace-with-recording-a",
    "replace-with-recording-b",
  ]);
  assert.equal(synchronized.zoom.notes, canonicalTemplate.zoom.notes);
  assert.equal(synchronized.zoom.legacyTesterComment, "Preserve this entered note");
  for (const retiredField of [
    "recordingId",
    "sourceHadClickMetadata",
    "previewVerified",
    "mp4ExportVerified",
    "keepRemoveVerified",
    "persistedAfterReopen",
    "exportInspection",
  ]) {
    assert.equal(retiredField in synchronized.zoom, false);
  }

  const after = analyzeManualTemplateSync({
    canonicalTemplate,
    evidence: synchronized,
    automatedEvidence,
  });
  assert.deepEqual(after, { required: false, reasons: [] });
  assert.deepEqual(
    buildSynchronizedManualTemplate({
      canonicalTemplate,
      evidence: synchronized,
      releaseVersion: automatedEvidence.releaseVersion,
      automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    }),
    synchronized,
  );
});

test("shared manual template synchronization preserves only current session provenance", () => {
  const currentSession = {
    kind: "sayless.manualQaSessionProvenance",
    profileCreatedAt: "2026-07-22T20:01:00.000Z",
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    buildSha256: "a".repeat(64),
    buildFileCount: 10,
    buildBytes: 2048,
    unpackedExtensionId: "a".repeat(32),
    operatingSystem: "macOS 15.5",
    browserVersion: "Chrome 126.0.6478.127",
  };
  const current = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: { ...canonicalTemplate, manualSession: currentSession },
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  });
  assert.deepEqual(current.manualSession, currentSession);

  const stale = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: {
      ...canonicalTemplate,
      automatedEvidenceGeneratedAt: "2026-07-22T19:00:00.000Z",
      manualSession: currentSession,
    },
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  });
  assert.deepEqual(stale.manualSession, canonicalTemplate.manualSession);
});

test("shared manual template migration preserves entered values in retired fields", () => {
  const synchronized = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: {
      ...canonicalTemplate,
      tester: {
        ...canonicalTemplate.tester,
        email: "entered-release-operator@example.test",
      },
      environment: {
        ...canonicalTemplate.environment,
        cleanChromeProfile: true,
      },
      zoom: {
        ...canonicalTemplate.zoom,
        recordingId: "user-entered-legacy-recording-id",
        sourceHadClickMetadata: true,
        notes: "Observed legacy zoom evidence that must remain intact.",
      },
    },
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  });

  assert.equal(synchronized.zoom.recordingId, "user-entered-legacy-recording-id");
  assert.equal(synchronized.zoom.sourceHadClickMetadata, true);
  assert.equal(synchronized.zoom.notes, "Observed legacy zoom evidence that must remain intact.");
  assert.equal(synchronized.tester.email, "entered-release-operator@example.test");
});

test("shared manual template synchronization prefills only untouched machine environment placeholders", () => {
  const detectedEnvironment = {
    os: "macOS 15.5",
    chromeVersion: "Google Chrome 138.0.7204.101",
    unpackedExtensionId: "abcdefghijklmnopabcdefghijklmnop",
  };
  const synchronized = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: canonicalTemplate,
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    environmentPrefill: detectedEnvironment,
  });
  assert.equal(synchronized.environment.os, detectedEnvironment.os);
  assert.equal(synchronized.environment.chromeVersion, detectedEnvironment.chromeVersion);
  assert.equal(
    synchronized.environment.unpackedExtensionId,
    detectedEnvironment.unpackedExtensionId,
  );

  const preserved = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: {
      ...canonicalTemplate,
      environment: {
        ...canonicalTemplate.environment,
        os: "Tester-confirmed macOS 15.4",
        chromeVersion: "Tester-confirmed Chrome 137 stable",
        unpackedExtensionId: "pppppppppppppppppppppppppppppppp",
      },
    },
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    environmentPrefill: detectedEnvironment,
  });
  assert.equal(preserved.environment.os, "Tester-confirmed macOS 15.4");
  assert.equal(preserved.environment.chromeVersion, "Tester-confirmed Chrome 137 stable");
  assert.equal(preserved.environment.unpackedExtensionId, "pppppppppppppppppppppppppppppppp");

  const withoutChromeDetection = buildSynchronizedManualTemplate({
    canonicalTemplate,
    evidence: canonicalTemplate,
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    environmentPrefill: { os: "Linux 6.8", chromeVersion: null },
  });
  assert.equal(withoutChromeDetection.environment.os, "Linux 6.8");
  assert.equal(
    withoutChromeDetection.environment.chromeVersion,
    canonicalTemplate.environment.chromeVersion,
  );

  const migratedRetiredIdPlaceholder = buildSynchronizedManualTemplate({
    canonicalTemplate: {
      ...canonicalTemplate,
      environment: {
        ...canonicalTemplate.environment,
        unpackedExtensionId: detectedEnvironment.unpackedExtensionId,
      },
    },
    evidence: canonicalTemplate,
    releaseVersion: automatedEvidence.releaseVersion,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    environmentPrefill: detectedEnvironment,
  });
  assert.equal(
    migratedRetiredIdPlaceholder.environment.unpackedExtensionId,
    detectedEnvironment.unpackedExtensionId,
  );
});
