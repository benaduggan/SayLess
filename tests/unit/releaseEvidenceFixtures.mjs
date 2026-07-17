import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const REQUIRED_AUTOMATED_COMMANDS = [
  "test:unit",
  "test:e2e:offline-whisper-assets",
  "test:e2e:offline-transcription-smoke",
  "test:e2e:local-recordings",
  "build:release",
  "test:e2e:built-extension-surface",
  "verify:release",
];

export const walkFiles = (dir, root = dir) => {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path, root));
    } else if (stat.isFile()) {
      files.push({ path, relativePath: relative(root, path), size: stat.size });
    }
  }
  return files;
};

export const dirFingerprint = (dir) => {
  const hash = createHash("sha256");
  const files = walkFiles(dir);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(readFileSync(file.path));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex") };
};

export const dirSize = (dir) =>
  walkFiles(dir).reduce((total, file) => total + file.size, 0);

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const releaseSurface = {
  permissions: [],
  optionalPermissions: [],
  hostPermissions: [],
  hasOauth2: false,
  hasExternallyConnectable: false,
  hasIdentityPermission: false,
  hasGoogleDrivePermission: false,
  hasRemoteConnectSrc: false,
  contentSecurityPolicyExtensionPages: "",
};

export const emptyGitWorkingTree = {
  sha256: createHash("sha256").digest("hex"),
  fileCount: 0,
  statusSha256: createHash("sha256").update("").digest("hex"),
};

export const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeCompleteReleaseEvidence = ({
  artifactsDir,
  automatedEvidencePath,
  buildDir,
  dir,
  manualEvidencePath,
  version = "9.9.9",
}) => {
  const recordingA = "qa-tab-local-docs-20260716-a";
  const recordingB = "qa-desktop-terminal-20260716-b";
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const testedAt = new Date(Date.now() - 30_000).toISOString();
  const whisperDir = join(buildDir, "assets", "whisper");

  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(whisperDir, { recursive: true });
  writeJson(join(dir, "package.json"), { version });
  writeJson(join(dir, "package-lock.json"), {
    version,
    packages: { "": { version } },
  });
  writeJson(join(dir, "src", "manifest.json"), { version });
  writeFileSync(join(whisperDir, "model.bin"), "bundled local whisper bytes");

  const buildFingerprint = dirFingerprint(buildDir);
  const bundledWhisper = dirFingerprint(whisperDir);
  const exportFileNameForFormat = (format, index) => {
    if (format === "transcript-json") return `sayless-qa-transcript-${index + 1}.transcript.json`;
    if (format === "sayless-project-json") return `sayless-qa-project-${index + 1}.sayless-project.json`;
    return `sayless-qa-${format}-${index + 1}.${format}`;
  };
  writeJson(automatedEvidencePath, {
    kind: "sayless.releaseQaAutomated",
    status: "passed",
    generatedAt,
    startedAt: new Date(Date.parse(generatedAt) - 1_000).toISOString(),
    durationMs: 1_000,
    git: {
      branch: "release-fixture",
      commit: "a".repeat(40),
      dirty: false,
      workingTree: emptyGitWorkingTree,
    },
    releaseVersion: version,
    packageLockVersion: version,
    packageLockRootVersion: version,
    manifestVersion: version,
    buildManifestVersion: version,
    commands: REQUIRED_AUTOMATED_COMMANDS.map((label) => ({
      label,
      status: "passed",
      command: `npm run ${label}`,
      durationMs: 1,
    })),
    skippedCommands: [
      {
        label: "test:e2e:offline-transcription-speech",
        reason: "fixture platform without speech synthesis tools",
      },
    ],
    build: {
      path: "build",
      bytes: dirSize(buildDir),
      formattedBytes: formatBytes(dirSize(buildDir)),
      fileCount: buildFingerprint.fileCount,
      sha256: buildFingerprint.sha256,
    },
    bundledWhisper: {
      path: "build/assets/whisper",
      bytes: dirSize(whisperDir),
      formattedBytes: formatBytes(dirSize(whisperDir)),
      fileCount: bundledWhisper.fileCount,
      sha256: bundledWhisper.sha256,
    },
    releaseSurface,
  });

  writeJson(manualEvidencePath, {
    kind: "sayless.manualQaEvidence",
    status: "passed",
    version: 1,
    releaseVersion: version,
    automatedEvidencePath: "release-artifacts/release-qa-automated.json",
    automatedEvidenceGeneratedAt: generatedAt,
    testedAt,
    tester: { name: "Release QA Operator", email: "qa-operator@sayless.local" },
    environment: {
      os: "macOS 15.5 QA workstation",
      chromeVersion: "Chrome 126.0.6478.127 stable",
      extensionSource: "build",
      cleanChromeProfile: true,
      unpackedExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      networkDisabledForOfflineTranscription: true,
    },
    recordings: [
      {
        id: recordingA,
        source: "tab capture of local documentation",
        durationSeconds: 132,
        container: "webm",
        microphone: "internal QA microphone",
        speakerProfile: "slow technical narrator",
        noiseProfile: "quiet office with low fan noise",
        notes:
          "Recorded and opened this local tab recording for transcript, timeline, zoom, and library checks.",
      },
      {
        id: recordingB,
        source: "desktop capture of terminal workflow",
        durationSeconds: 315,
        container: "mp4",
        microphone: "USB headset QA microphone",
        speakerProfile: "fast technical narrator",
        noiseProfile: "keyboard noise and room fan",
        notes:
          "Recorded and inspected this local desktop recording for long export cancellation, retry, reveal, and noisy silence checks.",
      },
    ],
    exports: {
      files: ["mp4", "webm", "gif", "wav", "m4a", "vtt", "transcript-json", "sayless-project-json"].map(
        (format, index) => ({
          format,
          fileName: exportFileNameForFormat(format, index),
          sourceRecordingId: index % 2 === 0 ? recordingA : recordingB,
          notes: `Opened and inspected the ${format} export against the local project state.`,
        }),
      ),
      workflow: {
        captionBurnInVerified: true,
        cancelRetryCompleted: true,
        cancelRetryRecordingId: recordingB,
        cancelledExportFormat: "mp4",
        retryCompletedExportFormat: "mp4",
        revealActionVerified: true,
        revealDownloadIdObserved: "Chrome download id 321 completed and reveal opened the exported MP4.",
        saveToFileVerifiedOrUnavailable: "verified",
        saveDialogCancellationVerified: true,
        notes:
          "Cancelled a long MP4 export, retried it, revealed the completed download, saved to a user-chosen local folder, and cancelled the save dialog safely.",
      },
    },
    offlineTranscription: {
      recordingIds: [recordingA, recordingB],
      networkDisabledMethod: "Disabled network before opening the editor and kept it disabled during transcription.",
      externalNetworkProbe: {
        url: "https://example.com/",
        result: "failed",
        observedError: "Chrome fetch failed with ERR_INTERNET_DISCONNECTED in the same QA profile.",
        sameChromeProfile: true,
      },
      networkProbeResult: "External fetch failed with ERR_INTERNET_DISCONNECTED while bundled model stayed ready.",
      bundledModelReadyObserved: true,
      transcriptQualityNotes: "Both speakers produced usable word timing for delete and mute edits.",
      cachedAfterReopen: true,
      regenerateVerified: true,
      deleteVerified: true,
    },
    silenceSuggestions: {
      recordingIds: [recordingA, recordingB],
      codecsOrContainers: ["webm", "mp4", "m4a"],
      noisyEnvironmentCovered: true,
      suggestedQuietRanges: [
        {
          recordingId: recordingA,
          startSeconds: 21.4,
          endSeconds: 24.9,
          observation: "Suggested a quiet narration pause in the WebM tab recording.",
        },
        {
          recordingId: recordingB,
          startSeconds: 142.2,
          endSeconds: 146.1,
          observation: "Suggested a quiet pause after terminal output in the MP4 desktop recording.",
        },
      ],
      ignoredNoiseRanges: [
        {
          recordingId: recordingB,
          startSeconds: 198.5,
          endSeconds: 203.8,
          observation: "Keyboard and fan noise remained audible and was not suggested as silence.",
        },
      ],
      notes: "Quiet regions were suggested and noisy keyboard regions were ignored.",
    },
    zoom: {
      recordingId: recordingA,
      sourceHadClickMetadata: true,
      previewVerified: true,
      mp4ExportVerified: true,
      keepRemoveVerified: true,
      persistedAfterReopen: true,
      exportInspection: "Opened the MP4 export and confirmed the clicked target stayed framed.",
      notes: "Kept, removed, previewed, reopened, and exported click-derived zoom keyframes.",
    },
    localLibraryRecovery: {
      duplicateReopenVerified: true,
      sidecarImportVerified: true,
      bulkExportDeleteVerified: true,
      orphanCleanupVerified: true,
      missingMediaRepairVerified: true,
      operations: [
        {
          type: "duplicate-reopen",
          recordingIds: [recordingA],
          observation: "Duplicated the tab recording and reopened the duplicate with project state intact.",
        },
        {
          type: "sidecar-import",
          recordingIds: [recordingB],
          observation: "Imported media with its sidecar and confirmed timeline settings restored.",
        },
        {
          type: "bulk-export-delete",
          recordingIds: [recordingA, recordingB],
          observation: "Bulk exported and deleted both selected recordings, then verified library index updates.",
        },
        {
          type: "orphan-cleanup",
          recordingIds: [],
          observation: "Triggered orphan cleanup and removed unreferenced local media only.",
        },
        {
          type: "missing-media-repair",
          recordingIds: [recordingB],
          observation: "Observed repairable missing-media state and restored the recording by reimporting media.",
        },
      ],
      notes: "Recovery operations were observed with local media only.",
    },
    publicationSurface: {
      reviewedArtifacts: [
        {
          type: "release-notes",
          name: "Release draft local-first notes",
          searchedTerms: [
            "paid",
            "premium",
            "free trial",
            "entitlement",
            "member only",
            "team plan",
            "account tier",
            "paid account",
            "license key",
            "contact sales",
            "locked behind",
            "pay to unlock",
            "account",
            "cloud",
            "Google Drive",
            "remote transcription",
          ],
          notes: "Reviewed release copy for paid, account, cloud, and remote claims.",
          residualRisk: "No residual release-note risk found.",
        },
        {
          type: "screenshots",
          name: "Store screenshot QA set",
          searchedTerms: [
            "sign in",
            "upgrade",
            "license required",
            "activation required",
            "account level",
            "enterprise-only",
            "locked feature",
            "upgrade required",
            "subscription-only",
            "membership",
            "paid membership",
            "subscription",
            "cloud upload",
            "dashboard",
          ],
          notes: "Reviewed screenshots for account prompts and hosted dashboard claims.",
          residualRisk: "No residual screenshot risk found.",
        },
        {
          type: "store-text",
          name: "docs/STORE_LISTING.md Chrome Web Store listing draft",
          searchedTerms: [
            "paid",
            "subscription",
            "paywall",
            "feature gate",
            "starter plan",
            "tier required",
            "locked behind",
            "pay to unlock",
            "upgrade required",
            "sales-gated",
            "member-only",
            "account",
            "cloud",
            "remote transcription",
          ],
          notes: "Reviewed listing text for local-only positioning and no paid features.",
          residualRisk: "No residual store-listing risk found.",
        },
      ],
      noPaidOrAccountGateClaims: true,
      noHostedDashboardOrCloudUploadClaims: true,
      noGoogleDriveClaims: true,
      noDefaultRemoteTranscriptionClaims: true,
      noUnverifiedMultiSceneAutoZoomClaims: true,
      notes: "Publication review found no paid gates, hosted dashboard claims, or remote defaults.",
    },
    checks: {
      fresh_install_no_account_or_paid_gates: check("fresh install surfaces showed no paid or account gates", []),
      recording_recovery_real_short_recordings: check("recordings opened and recovered locally", [
        recordingA,
        recordingB,
      ]),
      offline_transcription_real_speakers: check("offline transcription worked for both speakers", [
        recordingA,
        recordingB,
      ]),
      timeline_editing_persistence: check("timeline edits persisted after reopen", [recordingA]),
      export_cancel_retry_reveal_real_recordings: check("cancel, retry, and reveal worked for long export", [
        recordingB,
      ]),
      audio_silence_real_codecs_and_noise: check("silence suggestions covered quiet and noisy regions", [
        recordingA,
        recordingB,
      ]),
      zoom_preview_export_real_recordings: check("zoom preview and export matched click metadata", [recordingA]),
      local_library_recovery: check("library recovery operations completed", [recordingA, recordingB]),
      final_surface_no_paid_cloud_or_remote_claims: check("final publication surface had no paid cloud remote claims", []),
    },
  });
};

const check = (observation, recordingIds) => ({
  status: "pass",
  notes: `Verified local offline release behavior: ${observation} with structured release QA evidence.`,
  evidence: [
    {
      artifact: `${observation} QA report notes`,
      recordingIds,
      observation: `Observed local offline release behavior: ${observation}.`,
    },
  ],
});
