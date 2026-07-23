import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

export const REQUIRED_AUTOMATED_COMMANDS = [
  "typecheck",
  "test:unit",
  "test:e2e:offline-whisper-assets",
  "test:e2e:offline-transcription-smoke",
  "test:e2e:local-recordings",
  "test:e2e:editor-layout",
  "build:release",
  "test:e2e:editor-editing-proof",
  "test:e2e:built-extension-surface",
  "verify:release",
];
const REQUIRED_EXPORT_FORMATS = [
  "mp4",
  "webm",
  "gif",
  "wav",
  "m4a",
  "vtt",
  "transcript-json",
  "sayless-project-json",
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
  const recordingC = "qa-region-zoom-20260716-c";
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
    if (format === "transcript-json")
      return `sayless-qa-transcript-${index + 1}.transcript.json`;
    if (format === "sayless-project-json")
      return `sayless-qa-project-${index + 1}.sayless-project.json`;
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
    builtExtension: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      buildPath: "build",
      cleanChromeProfile: true,
      observedAt: generatedAt,
      summaryCount: 10,
    },
    releaseSurface,
  });

  const probeGeneratedAt = new Date(Date.now() - 45_000).toISOString();
  const fixtureSha256 = (seed) =>
    createHash("sha256").update(`manual QA fixture ${seed}`).digest("hex");
  const recordingProbeFiles = [
    {
      fileName: "qa-tab-local-docs.webm",
      format: "webm",
      byteSize: 15_000_000,
      sha256: fixtureSha256("recording-a"),
      durationSeconds: 132,
      video: { width: 1280, height: 720 },
    },
    {
      fileName: "qa-desktop-terminal.mp4",
      format: "mp4",
      byteSize: 75_000_000,
      sha256: fixtureSha256("recording-b"),
      durationSeconds: 315,
      video: { width: 1920, height: 1080 },
    },
    {
      fileName: "qa-region-zoom.webm",
      format: "webm",
      byteSize: 12_000_000,
      sha256: fixtureSha256("recording-c"),
      durationSeconds: 96,
      video: { width: 1024, height: 768 },
    },
  ].map((file) => ({
    ...file,
    recordingFields: {
      fileName: file.fileName,
      sha256: file.sha256,
      durationSeconds: file.durationSeconds,
      byteSize: file.byteSize,
      width: file.video.width,
      height: file.video.height,
      container: file.format,
    },
  }));
  const exportProbeFiles = REQUIRED_EXPORT_FORMATS.map((format, index) => ({
    format,
    fileName: exportFileNameForFormat(format, index),
    byteSize: 10_000 + index,
    sha256: fixtureSha256(`export-${format}`),
  }));
  const projectAudioProbeFiles = [
    {
      format: "wav",
      fileName: "field-music-bed.wav",
      byteSize: 2_304_000,
      durationSeconds: 24,
      channels: 2,
      sampleRate: 48000,
    },
    {
      format: "m4a",
      fileName: "phone-voice-note.m4a",
      byteSize: 486_000,
      durationSeconds: 31.2,
      channels: 1,
      sampleRate: 44100,
    },
    {
      format: "mp3",
      fileName: "podcast-intro.mp3",
      byteSize: 912_000,
      durationSeconds: 38,
      channels: 2,
      sampleRate: 44100,
    },
  ].map((file) => {
    const sha256 = fixtureSha256(`project-audio-${file.format}`);
    return {
      ...file,
      sha256,
      audio: { channels: file.channels, sampleRate: file.sampleRate },
      projectAudioInputFields: { ...file, sha256 },
    };
  });
  const mediaReportFiles = [
    ...recordingProbeFiles,
    ...exportProbeFiles.filter((file) =>
      ["mp4", "webm", "gif", "wav", "m4a"].includes(file.format)
    ),
    ...projectAudioProbeFiles,
  ];
  writeJson(join(artifactsDir, "manual-qa-media-probe.json"), {
    kind: "sayless.manualQaMediaProbe",
    status: "measured",
    generatedAt: probeGeneratedAt,
    fileCount: mediaReportFiles.length,
    requireComplete: true,
    reportPath: "release-artifacts/manual-qa-media-probe.json",
    releaseCoverage: {
      status: "measurable-set-complete",
      passedCheckCount: 5,
      totalCheckCount: 5,
    },
    files: mediaReportFiles,
  });
  const sidecarReportFiles = exportProbeFiles
    .filter((file) =>
      ["vtt", "transcript-json", "sayless-project-json"].includes(file.format)
    )
    .map((file) => ({
      ...file,
      exportFields: {
        format: file.format,
        fileName: file.fileName,
        byteSize: file.byteSize,
        sha256: file.sha256,
      },
    }));
  writeJson(join(artifactsDir, "manual-qa-sidecar-probe.json"), {
    kind: "sayless.manualQaSidecarProbe",
    status: "inspected",
    generatedAt: probeGeneratedAt,
    fileCount: sidecarReportFiles.length,
    requireComplete: true,
    reportPath: "release-artifacts/manual-qa-sidecar-probe.json",
    coverage: { status: "structurally-complete", completeSetCount: 1 },
    files: sidecarReportFiles,
  });

  writeJson(manualEvidencePath, {
    kind: "sayless.manualQaEvidence",
    status: "passed",
    version: 1,
    releaseVersion: version,
    automatedEvidencePath: "release-artifacts/release-qa-automated.json",
    automatedEvidenceGeneratedAt: generatedAt,
    manualSession: {
      kind: "sayless.manualQaSessionProvenance",
      profileCreatedAt: new Date(
        Date.parse(generatedAt) + 10_000
      ).toISOString(),
      releaseVersion: version,
      automatedEvidenceGeneratedAt: generatedAt,
      buildSha256: buildFingerprint.sha256,
      buildFileCount: buildFingerprint.fileCount,
      buildBytes: dirSize(buildDir),
      unpackedExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operatingSystem: "macOS 15.5 QA workstation",
      browserVersion: "Chrome 126.0.6478.127 stable",
    },
    probeReports: {
      media: "release-artifacts/manual-qa-media-probe.json",
      sidecars: "release-artifacts/manual-qa-sidecar-probe.json",
    },
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
        fileName: recordingProbeFiles[0].fileName,
        sha256: recordingProbeFiles[0].sha256,
        source: "tab capture of local documentation",
        durationSeconds: 132,
        byteSize: 15_000_000,
        width: 1280,
        height: 720,
        container: "webm",
        microphone: "internal QA microphone",
        speakerProfile: "slow technical narrator",
        noiseProfile: "quiet office with low fan noise",
        notes:
          "Recorded and opened this local tab recording for transcript, timeline, zoom, and library checks.",
      },
      {
        id: recordingB,
        fileName: recordingProbeFiles[1].fileName,
        sha256: recordingProbeFiles[1].sha256,
        source: "desktop capture of terminal workflow",
        durationSeconds: 315,
        byteSize: 75_000_000,
        width: 1920,
        height: 1080,
        container: "mp4",
        microphone: "USB headset QA microphone",
        speakerProfile: "fast technical narrator",
        noiseProfile: "keyboard noise and room fan",
        notes:
          "Recorded and inspected this local desktop recording for long export cancellation, retry, reveal, and noisy silence checks.",
      },
      {
        id: recordingC,
        fileName: recordingProbeFiles[2].fileName,
        sha256: recordingProbeFiles[2].sha256,
        source: "region recording of local documentation",
        durationSeconds: 96,
        byteSize: 12_000_000,
        width: 1024,
        height: 768,
        container: "webm",
        microphone: "internal QA microphone",
        speakerProfile: "slow technical narrator",
        noiseProfile: "quiet office with low fan noise",
        notes:
          "Recorded and opened this local region recording for varied-aspect click zoom preview and export checks.",
      },
    ],
    exports: {
      files: [
        "mp4",
        "webm",
        "gif",
        "wav",
        "m4a",
        "vtt",
        "transcript-json",
        "sayless-project-json",
      ].map((format, index) => ({
        format,
        fileName: exportFileNameForFormat(format, index),
        byteSize: exportProbeFiles[index].byteSize,
        sha256: exportProbeFiles[index].sha256,
        sourceRecordingId: index % 2 === 0 ? recordingA : recordingB,
        notes: `Opened and inspected the ${format} export against the local project state.`,
      })),
      workflow: {
        captionBurnInVerified: true,
        cancelRetryCompleted: true,
        cancelRetryRecordingId: recordingB,
        cancelledExportFormat: "mp4",
        retryCompletedExportFormat: "mp4",
        revealActionVerified: true,
        revealDownloadIdObserved:
          "Chrome download id 321 completed and reveal opened the exported MP4.",
        saveToFileVerifiedOrUnavailable: "verified",
        saveDialogCancellationVerified: true,
        notes:
          "Cancelled a long MP4 export, retried it, revealed the completed download, saved to a user-chosen local folder, and cancelled the save dialog safely.",
      },
    },
    offlineTranscription: {
      recordingIds: [recordingA, recordingB],
      networkDisabledMethod:
        "Disabled network before opening the editor and kept it disabled during transcription.",
      externalNetworkProbe: {
        url: "https://example.com/",
        result: "failed",
        observedError:
          "Chrome fetch failed with ERR_INTERNET_DISCONNECTED in the same QA profile.",
        sameChromeProfile: true,
      },
      networkProbeResult:
        "External fetch failed with ERR_INTERNET_DISCONNECTED while bundled model stayed ready.",
      bundledModelReadyObserved: true,
      transcriptQualityNotes:
        "Both speakers produced usable word timing for delete and mute edits.",
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
          observation:
            "Suggested a quiet narration pause in the WebM tab recording.",
        },
        {
          recordingId: recordingB,
          startSeconds: 142.2,
          endSeconds: 146.1,
          observation:
            "Suggested a quiet pause after terminal output in the MP4 desktop recording.",
        },
      ],
      ignoredNoiseRanges: [
        {
          recordingId: recordingB,
          startSeconds: 198.5,
          endSeconds: 203.8,
          observation:
            "Keyboard and fan noise remained audible and was not suggested as silence.",
        },
      ],
      notes:
        "Quiet regions were suggested and noisy keyboard regions were ignored.",
    },
    zoom: {
      recordingIds: [recordingA, recordingC],
      observations: [
        {
          recordingId: recordingA,
          sourceHadClickMetadata: true,
          previewVerified: true,
          mp4ExportVerified: true,
          keepRemoveVerified: true,
          persistedAfterReopen: true,
          exportInspection:
            "Opened the wide MP4 export and confirmed the clicked target stayed framed.",
          notes:
            "Kept, removed, previewed, reopened, and exported click-derived zoom keyframes on the wide tab recording.",
        },
        {
          recordingId: recordingC,
          sourceHadClickMetadata: true,
          previewVerified: true,
          mp4ExportVerified: true,
          keepRemoveVerified: true,
          persistedAfterReopen: true,
          exportInspection:
            "Opened the 4:3 MP4 export and confirmed the clicked target stayed framed.",
          notes:
            "Kept, removed, previewed, reopened, and exported click-derived zoom keyframes on the region recording.",
        },
      ],
      notes:
        "Compared saved click-derived zoom framing across wide and 4:3 real recordings.",
    },
    crop: {
      recordingIds: [recordingA, recordingC],
      observations: [
        {
          recordingId: recordingA,
          crop: { xRatio: 0, yRatio: 0, widthRatio: 0.75, heightRatio: 1 },
          exportWidth: 960,
          exportHeight: 720,
          nativePlaybackControlsVerified: true,
          edgeCropVerified: true,
          previewVerified: true,
          mp4ExportVerified: true,
          persistedAfterReopen: true,
          sourceBlobUnchanged: true,
          exportInspection:
            "Opened the 960x720 MP4 and inspected the saved left/top edge crop against preview.",
          notes:
            "Verified native controls, edge crop preview, reopen persistence, and unchanged source media on the wide tab recording.",
        },
        {
          recordingId: recordingC,
          crop: {
            xRatio: 0.25,
            yRatio: 0,
            widthRatio: 0.75,
            heightRatio: 0.75,
          },
          exportWidth: 768,
          exportHeight: 576,
          nativePlaybackControlsVerified: true,
          edgeCropVerified: true,
          previewVerified: true,
          mp4ExportVerified: true,
          persistedAfterReopen: true,
          sourceBlobUnchanged: true,
          exportInspection:
            "Opened the 768x576 MP4 and inspected the saved top/right edge crop against preview.",
          notes:
            "Verified native controls, edge crop preview, reopen persistence, and unchanged source media on the 4:3 region recording.",
        },
      ],
      notes:
        "Compared non-destructive edge crops and matching MP4 dimensions across wide and 4:3 real recordings.",
    },
    projectAudio: {
      recordingId: recordingB,
      inputs: [
        {
          format: "wav",
          fileName: "field-music-bed.wav",
          sha256: projectAudioProbeFiles[0].sha256,
          byteSize: 2_304_000,
          durationSeconds: 24,
          channels: 2,
          sampleRate: 48000,
          decodeVerified: true,
          audiblePreviewVerified: true,
          notes:
            "Decoded stereo 48 kHz WAV metadata and heard the real music bed in preview.",
        },
        {
          format: "m4a",
          fileName: "phone-voice-note.m4a",
          sha256: projectAudioProbeFiles[1].sha256,
          byteSize: 486_000,
          durationSeconds: 31.2,
          channels: 1,
          sampleRate: 44100,
          decodeVerified: true,
          audiblePreviewVerified: true,
          notes:
            "Decoded mono 44.1 kHz M4A metadata and heard the real voice note in preview.",
        },
        {
          format: "mp3",
          fileName: "podcast-intro.mp3",
          sha256: projectAudioProbeFiles[2].sha256,
          byteSize: 912_000,
          durationSeconds: 38,
          channels: 2,
          sampleRate: 44100,
          decodeVerified: true,
          audiblePreviewVerified: true,
          notes:
            "Decoded stereo 44.1 kHz MP3 metadata and heard the real podcast intro in preview.",
        },
      ],
      playback: {
        seekPlayPauseVerified: true,
        reorderedTimelineVerified: true,
        playbackRateVerified: true,
        longRecordingSyncVerified: true,
        mixVerified: true,
        replaceVerified: true,
        loopOnOffVerified: true,
        cancelRetryVerified: true,
        gainPerceptionNotes:
          "Compared mix and replace modes: source and project volume levels remained audible without clipping at the chosen gains.",
      },
      persistence: {
        reopenVerified: true,
        sourceBlobUnchanged: true,
        duplicatePreviewVerified: true,
        duplicateDeletedOriginalIntact: true,
        sidecarMissingAssetVerified: true,
        relinkHashMatched: true,
        applyEditsCleanupVerified: true,
        notes:
          "Verified reopen, duplicate preview/delete isolation, explicit missing sidecar asset, SHA-256 relink, and Apply-edits asset cleanup.",
      },
      notes:
        "Tested real WAV, M4A, and MP3 inputs on the long recording with no remaining project-audio risk observed.",
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
          observation:
            "Duplicated the tab recording and reopened the duplicate with project state intact.",
        },
        {
          type: "sidecar-import",
          recordingIds: [recordingB],
          observation:
            "Imported media with its sidecar and confirmed timeline settings restored.",
        },
        {
          type: "bulk-export-delete",
          recordingIds: [recordingA, recordingB],
          observation:
            "Bulk exported and deleted both selected recordings, then verified library index updates.",
        },
        {
          type: "orphan-cleanup",
          recordingIds: [],
          observation:
            "Triggered orphan cleanup and removed unreferenced local media only.",
        },
        {
          type: "missing-media-repair",
          recordingIds: [recordingB],
          observation:
            "Observed repairable missing-media state and restored the recording by reimporting media.",
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
          notes:
            "Reviewed release copy for paid, account, cloud, and remote claims.",
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
          notes:
            "Reviewed screenshots for account prompts and hosted dashboard claims.",
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
          notes:
            "Reviewed listing text for local-only positioning and no paid features.",
          residualRisk: "No residual store-listing risk found.",
        },
      ],
      noPaidOrAccountGateClaims: true,
      noHostedDashboardOrCloudUploadClaims: true,
      noGoogleDriveClaims: true,
      noDefaultRemoteTranscriptionClaims: true,
      noUnverifiedMultiSceneAutoZoomClaims: true,
      notes:
        "Publication review found no paid gates, hosted dashboard claims, or remote defaults.",
    },
    checks: {
      fresh_install_no_account_or_paid_gates: check(
        "fresh install surfaces showed no paid or account gates",
        []
      ),
      recording_recovery_real_short_recordings: check(
        "recordings opened and recovered locally",
        [recordingA, recordingB]
      ),
      offline_transcription_real_speakers: check(
        "offline transcription worked for both speakers",
        [recordingA, recordingB]
      ),
      timeline_editing_persistence: check(
        "timeline edits persisted after reopen",
        [recordingA]
      ),
      export_cancel_retry_reveal_real_recordings: check(
        "cancel, retry, and reveal worked for long export",
        [recordingB]
      ),
      audio_silence_real_codecs_and_noise: check(
        "silence suggestions covered quiet and noisy regions",
        [recordingA, recordingB]
      ),
      zoom_preview_export_real_recordings: check(
        "zoom preview and export matched click metadata",
        [recordingA, recordingC]
      ),
      crop_preview_export_real_recordings: check(
        "crop preview and export matched normalized edge bounds",
        [recordingA, recordingC]
      ),
      project_audio_real_inputs_and_long_sync: check(
        "real project audio inputs stayed synchronized on the long recording",
        [recordingB]
      ),
      local_library_recovery: check("library recovery operations completed", [
        recordingA,
        recordingB,
      ]),
      final_surface_no_paid_cloud_or_remote_claims: check(
        "final publication surface had no paid cloud remote claims",
        []
      ),
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
