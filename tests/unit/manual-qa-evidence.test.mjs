import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const VERIFIER = join(ROOT, "scripts", "verify-manual-qa-evidence.mjs");
const AUTOMATED_EVIDENCE = join(ROOT, "release-artifacts", "release-qa-automated.json");
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "src", "manifest.json"), "utf8"));
const emptyGitWorkingTree = {
  sha256: createHash("sha256").digest("hex"),
  fileCount: 0,
  statusSha256: createHash("sha256").update("").digest("hex"),
};

const REQUIRED_COMMANDS = [
  "lint",
  "format:check",
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

const REQUIRED_CHECKS = [
  "fresh_install_no_account_or_paid_gates",
  "recording_recovery_real_short_recordings",
  "offline_transcription_real_speakers",
  "timeline_editing_persistence",
  "export_cancel_retry_reveal_real_recordings",
  "audio_silence_real_codecs_and_noise",
  "zoom_preview_export_real_recordings",
  "crop_preview_export_real_recordings",
  "project_audio_real_inputs_and_long_sync",
  "local_library_recovery",
  "final_surface_no_paid_cloud_or_remote_claims",
];
const CHECK_RECORDING_REFS = {
  fresh_install_no_account_or_paid_gates: [],
  recording_recovery_real_short_recordings: [
    "qa-tab-demo-20260716-a",
    "qa-desktop-terminal-20260716-b",
  ],
  offline_transcription_real_speakers: ["qa-tab-demo-20260716-a", "qa-desktop-terminal-20260716-b"],
  timeline_editing_persistence: ["qa-tab-demo-20260716-a"],
  export_cancel_retry_reveal_real_recordings: ["qa-desktop-terminal-20260716-b"],
  audio_silence_real_codecs_and_noise: ["qa-tab-demo-20260716-a", "qa-desktop-terminal-20260716-b"],
  zoom_preview_export_real_recordings: ["qa-tab-demo-20260716-a", "qa-region-zoom-20260716-c"],
  crop_preview_export_real_recordings: ["qa-tab-demo-20260716-a", "qa-region-zoom-20260716-c"],
  project_audio_real_inputs_and_long_sync: ["qa-desktop-terminal-20260716-b"],
  local_library_recovery: ["qa-tab-demo-20260716-a", "qa-desktop-terminal-20260716-b"],
  final_surface_no_paid_cloud_or_remote_claims: [],
};

const EXPORT_FORMATS = [
  "mp4",
  "webm",
  "gif",
  "wav",
  "m4a",
  "vtt",
  "transcript-json",
  "sayless-project-json",
];
const exportFileNameForFormat = (format, index) => {
  if (format === "transcript-json") return `sayless-qa-transcript-${index + 1}.transcript.json`;
  if (format === "sayless-project-json")
    return `sayless-qa-project-${index + 1}.sayless-project.json`;
  return `sayless-qa-${format}-${index + 1}.${format}`;
};

const walkFiles = (dir, root = dir) => {
  if (!existsSync(dir)) return [];
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

const dirFingerprint = (dir) => {
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
  return { sha256: hash.digest("hex"), fileCount: files.length };
};

const dirSize = (dir) => walkFiles(dir).reduce((total, file) => total + file.size, 0);

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const releaseSurface = {
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

const makeFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-manual-qa-"));
  const buildDir = join(dir, "build");
  const assetsDir = join(buildDir, "assets", "whisper");
  const artifactsDir = join(dir, "release-artifacts");
  const automatedPath = join(artifactsDir, "release-qa-automated.json");
  const manualPath = join(dir, "manual.json");
  const recordingA = "qa-tab-demo-20260716-a";
  const recordingB = "qa-desktop-terminal-20260716-b";
  const recordingC = "qa-region-zoom-20260716-c";

  writeFileSync(join(dir, "keep"), "fixture");
  writeFileSync(join(dir, "note.txt"), "fixture");
  writeFileSync(join(dir, "unused.txt"), "fixture");
  writeFileSync(join(dir, "cleanup.txt"), "fixture");
  writeFileSync(join(dir, "metadata.txt"), "fixture");
  writeFileSync(join(dir, "readme.txt"), "fixture");
  writeFileSync(join(dir, "source.txt"), "fixture");
  writeFileSync(join(dir, "artifact.txt"), "fixture");
  writeFileSync(join(dir, "observations.txt"), "fixture");
  writeFileSync(join(dir, "recordings.txt"), "fixture");
  writeFileSync(join(dir, "exports.txt"), "fixture");
  writeFileSync(join(dir, "publication.txt"), "fixture");
  writeFileSync(join(dir, "transcription.txt"), "fixture");
  writeFileSync(join(dir, "silence.txt"), "fixture");
  writeFileSync(join(dir, "zoom.txt"), "fixture");
  writeFileSync(join(dir, "library.txt"), "fixture");
  writeFileSync(join(dir, "checks.txt"), "fixture");
  writeFileSync(join(dir, "commands.txt"), "fixture");
  writeFileSync(join(dir, "versions.txt"), "fixture");
  writeFileSync(join(dir, "done.txt"), "fixture");
  writeFileSync(join(dir, "ok.txt"), "fixture");
  writeFileSync(join(dir, "pass.txt"), "fixture");
  writeFileSync(join(dir, "surface.txt"), "fixture");
  writeFileSync(join(dir, "final.txt"), "fixture");
  writeFileSync(join(dir, "summary.txt"), "fixture");
  writeFileSync(join(dir, "context.txt"), "fixture");
  writeFileSync(join(dir, "details.txt"), "fixture");
  writeFileSync(join(dir, "audio.txt"), "fixture");
  writeFileSync(join(dir, "video.txt"), "fixture");
  writeFileSync(join(dir, "timing.txt"), "fixture");
  writeFileSync(join(dir, "network.txt"), "fixture");
  writeFileSync(join(dir, "browser.txt"), "fixture");
  writeFileSync(join(dir, "notes.txt"), "fixture");
  writeFileSync(join(dir, "tmp.txt"), "fixture");

  // Build fixture.
  writeFileSync(join(dir, ".placeholder"), "fixture");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ version: packageJson.version }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    `${JSON.stringify(
      {
        version: packageLock.version,
        packages: {
          "": {
            version: packageLock.packages[""].version,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "src", "manifest.json"),
    `${JSON.stringify({ version: manifest.version }, null, 2)}\n`,
  );
  writeFileSync(join(buildDir, "manifest.json"), JSON.stringify({ version: packageJson.version }));
  writeFileSync(join(buildDir, "editor.html"), "<html>SayLess</html>");
  writeFileSync(join(assetsDir, "model.bin"), "local model bytes");

  const build = dirFingerprint(buildDir);
  const bundledWhisper = dirFingerprint(assetsDir);
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const testedAt = new Date(Date.now() - 30_000).toISOString();
  const automated = {
    kind: "sayless.releaseQaAutomated",
    status: "passed",
    generatedAt,
    startedAt: new Date(Date.parse(generatedAt) - 1_000).toISOString(),
    durationMs: 1_000,
    git: {
      branch: "release-fixture",
      commit: "b".repeat(40),
      dirty: false,
      workingTree: emptyGitWorkingTree,
    },
    releaseVersion: packageJson.version,
    packageLockVersion: packageLock.version,
    packageLockRootVersion: packageLock.packages[""].version,
    manifestVersion: manifest.version,
    buildManifestVersion: packageJson.version,
    commands: REQUIRED_COMMANDS.map((label) => ({
      label,
      status: "passed",
      command: `npm run ${label}`,
      durationMs: 1,
    })),
    skippedCommands: [
      {
        label: "test:e2e:offline-transcription-speech",
        reason: "unit fixture",
      },
    ],
    build: {
      path: "build",
      bytes: dirSize(buildDir),
      formattedBytes: formatBytes(dirSize(buildDir)),
      fileCount: build.fileCount,
      sha256: build.sha256,
    },
    bundledWhisper: {
      path: "build/assets/whisper",
      bytes: statSync(join(assetsDir, "model.bin")).size,
      formattedBytes: formatBytes(statSync(join(assetsDir, "model.bin")).size),
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
  };
  const probeGeneratedAt = new Date(Date.now() - 45_000).toISOString();
  const fixtureSha256 = (seed) =>
    createHash("sha256").update(`manual QA fixture ${seed}`).digest("hex");
  const recordingProbeFiles = [
    {
      fileName: "qa-tab-demo.webm",
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
  const exportProbeFiles = EXPORT_FORMATS.map((format, index) => ({
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

  const manual = {
    kind: "sayless.manualQaEvidence",
    status: "passed",
    version: 1,
    releaseVersion: packageJson.version,
    automatedEvidencePath: "release-artifacts/release-qa-automated.json",
    automatedEvidenceGeneratedAt: generatedAt,
    manualSession: {
      kind: "sayless.manualQaSessionProvenance",
      profileCreatedAt: new Date(Date.parse(generatedAt) + 10_000).toISOString(),
      releaseVersion: packageJson.version,
      automatedEvidenceGeneratedAt: generatedAt,
      buildSha256: build.sha256,
      buildFileCount: build.fileCount,
      buildBytes: dirSize(buildDir),
      unpackedExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operatingSystem: "macOS 15.5 on Apple Silicon QA laptop",
      browserVersion: "Chrome 126.0.6478.127 stable",
    },
    probeReports: {
      media: "release-artifacts/manual-qa-media-probe.json",
      sidecars: "release-artifacts/manual-qa-sidecar-probe.json",
    },
    testedAt,
    tester: { name: "Release QA Operator", email: "qa-operator@sayless.local" },
    environment: {
      os: "macOS 15.5 on Apple Silicon QA laptop",
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
        source: "tab capture of local documentation page",
        durationSeconds: 132,
        byteSize: 15_000_000,
        width: 1280,
        height: 720,
        container: "webm",
        microphone: "MacBook Air internal array serial QA-A",
        speakerProfile: "adult speaker with quiet office narration",
        noiseProfile: "low HVAC noise measured during recording",
        notes:
          "Recorded and opened this local tab recording for library reopen, offline transcript timing, word deletion, and MP4 preview checks.",
      },
      {
        id: recordingB,
        fileName: recordingProbeFiles[1].fileName,
        sha256: recordingProbeFiles[1].sha256,
        source: "desktop capture of terminal and browser workflow",
        durationSeconds: 315,
        byteSize: 75_000_000,
        width: 1920,
        height: 1080,
        container: "mp4",
        microphone: "USB headset microphone model QA-B",
        speakerProfile: "adult speaker with faster technical narration",
        noiseProfile: "keyboard clicks and fan noise present throughout",
        notes:
          "Recorded and inspected this local desktop recording for export cancellation, retry, reveal action, M4A export, silence suggestions, and zoom checks.",
      },
      {
        id: recordingC,
        fileName: recordingProbeFiles[2].fileName,
        sha256: recordingProbeFiles[2].sha256,
        source: "region recording of local documentation page",
        durationSeconds: 96,
        byteSize: 12_000_000,
        width: 1024,
        height: 768,
        container: "webm",
        microphone: "MacBook Air internal array serial QA-A",
        speakerProfile: "adult speaker with quiet office narration",
        noiseProfile: "low HVAC noise measured during recording",
        notes:
          "Recorded and opened this local region recording for varied-aspect click zoom preview and MP4 checks.",
      },
    ],
    exports: {
      files: EXPORT_FORMATS.map((format, index) => ({
        format,
        fileName: exportFileNameForFormat(format, index),
        byteSize: exportProbeFiles[index].byteSize,
        sha256: exportProbeFiles[index].sha256,
        sourceRecordingId: index % 2 ? recordingA : recordingB,
        notes: `Opened or imported this ${format} export and confirmed local content matched the edited project.`,
      })),
      workflow: {
        captionBurnInVerified: true,
        cancelRetryCompleted: true,
        cancelRetryRecordingId: recordingB,
        cancelledExportFormat: "mp4",
        retryCompletedExportFormat: "mp4",
        revealActionVerified: true,
        revealDownloadIdObserved:
          "Chrome downloads id 321 completed and reveal opened the exported MP4.",
        saveToFileVerifiedOrUnavailable: "verified",
        saveDialogCancellationVerified: true,
        notes:
          "Long export was cancelled, retried, completed, revealed, saved to a user-chosen local folder, and save dialog cancellation stayed retryable.",
      },
    },
    offlineTranscription: {
      recordingIds: [recordingA, recordingB],
      networkDisabledMethod:
        "Disabled Wi-Fi and confirmed Chrome failed external fetches before transcription.",
      externalNetworkProbe: {
        url: "https://example.com/",
        result: "failed",
        observedError:
          "Browser fetch failed with ERR_INTERNET_DISCONNECTED in the QA Chrome profile.",
        sameChromeProfile: true,
      },
      networkProbeResult:
        "Fetch to https://example.com failed with ERR_INTERNET_DISCONNECTED while local bundled model stayed ready.",
      bundledModelReadyObserved: true,
      transcriptQualityNotes:
        "Both real speakers produced usable word timing for delete and mute edits.",
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
            "Suggested a quiet pause between narration sections in the WebM tab recording.",
        },
        {
          recordingId: recordingB,
          startSeconds: 142.2,
          endSeconds: 146.1,
          observation: "Suggested a quiet pause after command output in the MP4 desktop recording.",
        },
      ],
      ignoredNoiseRanges: [
        {
          recordingId: recordingB,
          startSeconds: 198.5,
          endSeconds: 203.8,
          observation:
            "Keyboard clicks and fan noise remained audible and were not suggested as silence.",
        },
      ],
      notes: "Quiet pauses were suggested while keyboard and fan noise were not marked as silence.",
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
            "Opened the wide exported MP4 and confirmed the click target stayed framed during the zoom.",
          notes:
            "Kept, removed, previewed, reopened, and exported click-derived zoom on the wide tab recording.",
        },
        {
          recordingId: recordingC,
          sourceHadClickMetadata: true,
          previewVerified: true,
          mp4ExportVerified: true,
          keepRemoveVerified: true,
          persistedAfterReopen: true,
          exportInspection:
            "Opened the 4:3 exported MP4 and confirmed the click target stayed framed during the zoom.",
          notes:
            "Kept, removed, previewed, reopened, and exported click-derived zoom on the region recording.",
        },
      ],
      notes:
        "Compared click-derived zoom preview and MP4 framing across wide and 4:3 real recordings.",
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
            "Verified native controls, edge preview, reopen persistence, and unchanged source media on the wide tab recording.",
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
            "Verified native controls, edge preview, reopen persistence, and unchanged source media on the 4:3 region recording.",
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
          notes: "Decoded stereo 48 kHz WAV metadata and heard the real music bed in preview.",
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
          notes: "Decoded mono 44.1 kHz M4A metadata and heard the real voice note in preview.",
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
            "Duplicated the tab recording, opened the duplicate, and confirmed media plus project state loaded.",
        },
        {
          type: "sidecar-import",
          recordingIds: [recordingB],
          observation:
            "Imported the desktop recording with its project sidecar and confirmed timeline settings restored.",
        },
        {
          type: "bulk-export-delete",
          recordingIds: [recordingA, recordingB],
          observation:
            "Bulk exported both listed recordings, deleted them, and confirmed the library index updated.",
        },
        {
          type: "orphan-cleanup",
          recordingIds: [],
          observation:
            "Triggered orphan cleanup and confirmed unreferenced local media was removed without deleting listed entries.",
        },
        {
          type: "missing-media-repair",
          recordingIds: [recordingB],
          observation:
            "Removed media for the desktop recording, saw the repairable state, and restored it by reimporting media.",
        },
      ],
      notes:
        "Duplicate reopen, sidecar import, bulk export/delete, orphan cleanup, and repair were exercised.",
    },
    publicationSurface: {
      reviewedArtifacts: [
        {
          type: "release-notes",
          name: "GitHub release draft local-first QA notes",
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
            "cloud upload",
            "Google Drive",
            "remote transcription",
          ],
          notes:
            "Reviewed copy for paid tiers, cloud upload, remote transcription, and overclaims.",
          residualRisk: "No residual release-note risk found after the forbidden-claim search.",
        },
        {
          type: "screenshots",
          name: "Chrome Web Store screenshot set",
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
            "Google Drive",
          ],
          notes:
            "Reviewed screenshots for account prompts, hosted dashboard claims, and auto-zoom claims.",
          residualRisk:
            "No residual screenshot risk found; visible surfaces showed local-only flows.",
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
            "Reviewed listing text for local-only positioning, no paid features, and no Google Drive path.",
          residualRisk:
            "No residual store-listing risk found after checking no-paid and no-cloud wording.",
        },
      ],
      noPaidOrAccountGateClaims: true,
      noHostedDashboardOrCloudUploadClaims: true,
      noGoogleDriveClaims: true,
      noDefaultRemoteTranscriptionClaims: true,
      noUnverifiedMultiSceneAutoZoomClaims: true,
      notes:
        "Final publication review found no paid gates, hosted dashboard claims, or remote defaults.",
    },
    checks: Object.fromEntries(
      REQUIRED_CHECKS.map((id, index) => [
        id,
        {
          status: "pass",
          notes: `QA pass ${
            index + 1
          }: observed release checklist behavior on named recordings with local files only.`,
          evidence: [
            {
              artifact: `qa-evidence-${index + 1}.png plus checklist report for ${id}`,
              recordingIds: CHECK_RECORDING_REFS[id],
              observation: `Observed ${id} on the required release checklist path and recorded concrete local-only evidence.`,
            },
          ],
        },
      ]),
    ),
  };

  const mediaReportFiles = [
    ...recordingProbeFiles,
    ...exportProbeFiles.filter((file) =>
      ["mp4", "webm", "gif", "wav", "m4a"].includes(file.format),
    ),
    ...projectAudioProbeFiles,
  ];
  writeFileSync(
    join(artifactsDir, "manual-qa-media-probe.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
  );
  const sidecarReportFiles = exportProbeFiles
    .filter((file) => ["vtt", "transcript-json", "sayless-project-json"].includes(file.format))
    .map((file) => ({
      ...file,
      exportFields: {
        format: file.format,
        fileName: file.fileName,
        byteSize: file.byteSize,
        sha256: file.sha256,
      },
    }));
  writeFileSync(
    join(artifactsDir, "manual-qa-sidecar-probe.json"),
    `${JSON.stringify(
      {
        kind: "sayless.manualQaSidecarProbe",
        status: "inspected",
        generatedAt: probeGeneratedAt,
        fileCount: sidecarReportFiles.length,
        requireComplete: true,
        reportPath: "release-artifacts/manual-qa-sidecar-probe.json",
        coverage: { status: "structurally-complete", completeSetCount: 1 },
        files: sidecarReportFiles,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(automatedPath, `${JSON.stringify(automated, null, 2)}\n`);
  writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
  return { dir, automatedPath, manualPath, manual, automated, buildDir };
};

const runVerifier = (path) =>
  spawnSync(process.execPath, [VERIFIER, path], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: dirname(path) },
  });

const runProgress = (path, args = []) =>
  spawnSync(process.execPath, [VERIFIER, "--progress", ...args, path], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: dirname(path) },
  });

const printTemplate = () =>
  spawnSync(process.execPath, [VERIFIER, "--print-template"], {
    cwd: ROOT,
    encoding: "utf8",
  });

const printTemplateForRoot = (root) =>
  spawnSync(process.execPath, [VERIFIER, "--print-template"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: root },
  });

const writeTemplateForRoot = (root, args = []) =>
  spawnSync(process.execPath, [VERIFIER, "--write-template", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: root },
  });

test("manual QA evidence verifier accepts complete structured evidence", () => {
  const fixture = makeFixture();
  try {
    const result = runVerifier(fixture.manualPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Manual QA evidence passed/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence requires tester attribution without contact data", () => {
  const fixture = makeFixture();
  try {
    const tester = { ...fixture.manual.tester };
    delete tester.email;
    writeFileSync(
      fixture.manualPath,
      `${JSON.stringify({ ...fixture.manual, tester }, null, 2)}\n`,
    );

    const result = runVerifier(fixture.manualPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Manual QA evidence passed/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires canonical strict probe reports", () => {
  const fixture = makeFixture();
  try {
    fixture.manual.probeReports.media = "alternate-media-report.json";
    writeFileSync(fixture.manualPath, `${JSON.stringify(fixture.manual, null, 2)}\n`);
    const alternatePath = runVerifier(fixture.manualPath);
    assert.equal(alternatePath.status, 1);
    assert.match(
      alternatePath.stderr,
      /probeReports\.media must point to release-artifacts\/manual-qa-media-probe\.json/,
    );

    fixture.manual.probeReports.media = "release-artifacts/manual-qa-media-probe.json";
    const mediaReportPath = join(fixture.dir, "release-artifacts", "manual-qa-media-probe.json");
    const mediaReport = JSON.parse(readFileSync(mediaReportPath, "utf8"));
    mediaReport.requireComplete = false;
    mediaReport.releaseCoverage.status = "incomplete";
    mediaReport.generatedAt = new Date(
      Date.parse(fixture.automated.generatedAt) - 1_000,
    ).toISOString();
    writeFileSync(mediaReportPath, `${JSON.stringify(mediaReport, null, 2)}\n`);
    writeFileSync(fixture.manualPath, `${JSON.stringify(fixture.manual, null, 2)}\n`);
    const incompleteReport = runVerifier(fixture.manualPath);
    assert.equal(incompleteReport.status, 1);
    assert.match(
      incompleteReport.stderr,
      /manual QA media probe report requireComplete must be true/,
    );
    assert.match(
      incompleteReport.stderr,
      /releaseCoverage\.status must be "measurable-set-complete"/,
    );
    assert.match(incompleteReport.stderr, /must be generated after automated QA evidence/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence measurable fields must match probe reports", () => {
  const fixture = makeFixture();
  try {
    fixture.manual.recordings[0].byteSize += 1;
    fixture.manual.exports.files[0].sha256 = "f".repeat(64);
    fixture.manual.projectAudio.inputs[0].sampleRate = 44100;
    writeFileSync(fixture.manualPath, `${JSON.stringify(fixture.manual, null, 2)}\n`);
    const result = runVerifier(fixture.manualPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recordings\[0\]\.byteSize must match probeReports\.media/);
    assert.match(result.stderr, /exports\.files\[0\]\.sha256 must match probeReports\.media/);
    assert.match(
      result.stderr,
      /projectAudio\.inputs\[0\]\.sampleRate must match probeReports\.media/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress routes machine-owned fields to measurement import", () => {
  const fixture = makeFixture();
  try {
    fixture.manual.recordings[0].byteSize += 1;
    fixture.manual.exports.files[0].sha256 = "f".repeat(64);
    fixture.manual.projectAudio.inputs[0].sampleRate = 44100;
    writeFileSync(fixture.manualPath, `${JSON.stringify(fixture.manual, null, 2)}\n`);

    const result = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sections = new Map(report.sections.map((section) => [section.id, section]));

    assert.equal(sections.get("recordings").status, "complete");
    assert.equal(sections.get("exports").status, "complete");
    assert.equal(sections.get("projectAudio").status, "complete");
    assert.deepEqual(sections.get("measurementImport").errorSamples, [
      `recordings[0].byteSize must match probeReports.media for ${fixture.manual.recordings[0].fileName}.`,
      `exports.files[0].sha256 must match probeReports.media for ${fixture.manual.exports.files[0].fileName}.`,
      `projectAudio.inputs[0].sampleRate must match probeReports.media for ${fixture.manual.projectAudio.inputs[0].fileName}.`,
    ]);
    assert.deepEqual(report.nextSection, {
      id: "measurementImport",
      label: "Probe measurements",
      workTargets: [
        "recordings[*].sha256/durationSeconds/byteSize/width/height/container",
        "exports.files[*].byteSize/sha256",
        "projectAudio.inputs[*].sha256/byteSize/durationSeconds/channels/sampleRate",
      ],
      errorCount: 3,
      command: "npm run qa:release:manual:measurements -- --json --write",
    });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress keeps tester-owned formats in human sections", () => {
  const fixture = makeFixture();
  try {
    fixture.manual.exports.files[0].format = "webm";
    fixture.manual.projectAudio.inputs[0].format = "m4a";
    writeFileSync(fixture.manualPath, `${JSON.stringify(fixture.manual, null, 2)}\n`);

    const result = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sections = new Map(report.sections.map((section) => [section.id, section]));

    assert.ok(sections.get("exports").errorCount > 0);
    assert.ok(sections.get("projectAudio").errorCount > 0);
    assert.equal(sections.get("measurementImport").errorCount, 0);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress groups the authoritative verifier errors by section", () => {
  const fixture = makeFixture();
  try {
    const completeResult = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(completeResult.status, 0, completeResult.stderr);
    const completeReport = JSON.parse(completeResult.stdout);
    assert.equal(completeReport.kind, "sayless.manualQaProgress");
    assert.equal(completeReport.status, "complete");
    assert.equal(completeReport.totalErrorCount, 0);
    assert.equal(completeReport.nextSection, null);
    assert.equal(completeReport.selectedSection, null);
    assert.equal(completeReport.completedSectionCount, completeReport.totalSectionCount);

    writeFileSync(
      fixture.manualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          status: "template",
          tester: { ...fixture.manual.tester, name: "Manual tester name" },
          recordings: [],
          zoom: { ...fixture.manual.zoom, observations: [] },
        },
        null,
        2,
      )}\n`,
    );
    const incompleteResult = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(incompleteResult.status, 0, incompleteResult.stderr);
    const incompleteReport = JSON.parse(incompleteResult.stdout);
    assert.equal(incompleteReport.status, "incomplete");
    assert.ok(incompleteReport.totalErrorCount > 0);
    const sections = new Map(incompleteReport.sections.map((section) => [section.id, section]));
    assert.ok(sections.get("metadata").errorCount > 0);
    assert.ok(sections.get("recordings").errorCount > 0);
    assert.ok(sections.get("zoom").errorCount > 0);
    assert.deepEqual(incompleteReport.nextSection, {
      id: "metadata",
      label: "Release and environment",
      workTargets: [
        "kind",
        "version",
        "releaseVersion",
        "automatedEvidencePath",
        "automatedEvidenceGeneratedAt",
        "manualSession",
        "tester.name",
        "environment",
      ],
      errorCount: sections.get("metadata").errorCount,
      command: "npm run qa:release:manual:progress -- --section=metadata",
    });
    assert.equal(
      incompleteReport.sections.reduce((total, section) => total + section.errorCount, 0),
      incompleteReport.totalErrorCount,
    );
    assert.ok(
      incompleteReport.sections.every(
        (section) => section.errorSamples.length <= 3 && section.workTargets.length > 0,
      ),
    );

    const humanResult = runProgress(fixture.manualPath);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /Manual QA progress: incomplete/);
    assert.match(humanResult.stdout, /Release and environment:/);
    assert.match(humanResult.stdout, /Real recordings:/);
    assert.match(humanResult.stdout, /Zoom:/);
    assert.match(humanResult.stdout, /Next section: Release and environment/);
    assert.match(
      humanResult.stdout,
      /Work targets: kind, version, releaseVersion, automatedEvidencePath/,
    );
    assert.match(
      humanResult.stdout,
      /Next command: npm run qa:release:manual:progress -- --section=metadata/,
    );

    const focusedResult = runProgress(fixture.manualPath, ["--json", "--section=recordings"]);
    assert.equal(focusedResult.status, 0, focusedResult.stderr);
    const focusedReport = JSON.parse(focusedResult.stdout);
    assert.equal(focusedReport.selectedSection.id, "recordings");
    assert.equal(focusedReport.selectedSection.label, "Real recordings");
    assert.deepEqual(focusedReport.selectedSection.workTargets, ["recordings"]);
    assert.equal(focusedReport.selectedSection.status, "incomplete");
    assert.equal(
      focusedReport.selectedSection.errors.length,
      focusedReport.selectedSection.errorCount,
    );
    assert.ok(focusedReport.selectedSection.errors.length > 3);
    assert.equal(focusedReport.sections.length, focusedReport.totalSectionCount);

    const focusedHumanResult = runProgress(fixture.manualPath, ["--section=recordings"]);
    assert.equal(focusedHumanResult.status, 0, focusedHumanResult.stderr);
    assert.match(focusedHumanResult.stdout, /Focused section: Real recordings/);
    assert.match(focusedHumanResult.stdout, /Work targets: recordings/);
    assert.doesNotMatch(focusedHumanResult.stdout, /Zoom: \d+ issues/);

    const unknownSectionResult = runProgress(fixture.manualPath, ["--section=not-a-section"]);
    assert.equal(unknownSectionResult.status, 1);
    assert.match(unknownSectionResult.stderr, /unknown manual QA progress section: not-a-section/);
    assert.match(unknownSectionResult.stderr, /Available sections: automation/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress routes missing probe reports to their strict collection commands", () => {
  const fixture = makeFixture();
  try {
    rmSync(join(fixture.dir, "release-artifacts", "manual-qa-media-probe.json"));
    rmSync(join(fixture.dir, "release-artifacts", "manual-qa-sidecar-probe.json"));

    const result = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sections = new Map(report.sections.map((section) => [section.id, section]));

    assert.equal(sections.get("automation").status, "complete");
    assert.equal(sections.get("mediaProbe").errorCount, 1);
    assert.equal(sections.get("sidecarProbe").errorCount, 1);
    assert.deepEqual(report.nextSection, {
      id: "mediaProbe",
      label: "Media probe report",
      workTargets: ["probeReports.media", "release-artifacts/manual-qa-media-probe.json"],
      errorCount: 1,
      command:
        "npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json /path/to/all-source-export-and-project-audio-files",
    });

    const focusedResult = runProgress(fixture.manualPath, ["--json", "--section=sidecarProbe"]);
    assert.equal(focusedResult.status, 0, focusedResult.stderr);
    const focusedReport = JSON.parse(focusedResult.stdout);
    assert.equal(focusedReport.selectedSection.id, "sidecarProbe");
    assert.deepEqual(focusedReport.selectedSection.workTargets, [
      "probeReports.sidecars",
      "release-artifacts/manual-qa-sidecar-probe.json",
    ]);
    assert.deepEqual(focusedReport.selectedSection.errors, [
      "probeReports.sidecars does not exist: release-artifacts/manual-qa-sidecar-probe.json",
    ]);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress defers status and testedAt until final verification", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      fixture.manualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          status: "template",
          testedAt: "YYYY-MM-DDTHH:mm:ss.sssZ",
        },
        null,
        2,
      )}\n`,
    );

    const result = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sections = new Map(report.sections.map((section) => [section.id, section]));

    assert.equal(sections.get("metadata").status, "complete");
    assert.equal(sections.get("mediaProbe").status, "complete");
    assert.equal(sections.get("sidecarProbe").status, "complete");
    assert.deepEqual(sections.get("finalization").errorSamples, [
      'manual QA evidence status must be "passed".',
      "testedAt must be an ISO UTC timestamp.",
    ]);
    assert.deepEqual(report.nextSection, {
      id: "finalization",
      label: "Final verification",
      workTargets: ["status", "testedAt"],
      errorCount: 2,
      command: "npm run qa:release:manual:progress -- --section=finalization",
    });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA progress routes network isolation to offline transcription", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      fixture.manualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          environment: {
            ...fixture.manual.environment,
            networkDisabledForOfflineTranscription: false,
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = runProgress(fixture.manualPath, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sections = new Map(report.sections.map((section) => [section.id, section]));

    assert.equal(sections.get("metadata").status, "complete");
    assert.deepEqual(sections.get("offlineTranscription").errorSamples, [
      "environment.networkDisabledForOfflineTranscription must be true.",
    ]);
    assert.deepEqual(report.nextSection, {
      id: "offlineTranscription",
      label: "Offline transcription",
      workTargets: ["environment.networkDisabledForOfflineTranscription", "offlineTranscription"],
      errorCount: 1,
      command: "npm run qa:release:manual:progress -- --section=offlineTranscription",
    });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence template pre-fills current automated evidence when present", () => {
  if (!existsSync(AUTOMATED_EVIDENCE)) return;
  const automated = JSON.parse(readFileSync(AUTOMATED_EVIDENCE, "utf8"));
  if (automated.kind !== "sayless.releaseQaAutomated" || automated.status !== "passed") return;
  const result = printTemplate();

  assert.equal(result.status, 0, result.stderr);
  const template = JSON.parse(result.stdout);
  assert.equal(template.status, "template");
  if (template.automatedEvidenceGeneratedAt === automated.generatedAt) {
    assert.equal(template.environment.extensionSource, automated.build.path);
  } else {
    assert.equal(template.automatedEvidenceGeneratedAt, "YYYY-MM-DDTHH:mm:ss.sssZ");
    assert.equal(template.environment.extensionSource, "build");
  }
  assert.equal(template.environment.cleanChromeProfile, false);
  assert.equal(template.environment.networkDisabledForOfflineTranscription, false);
  assert.equal(template.exports.workflow.captionBurnInVerified, false);
  assert.equal(template.offlineTranscription.bundledModelReadyObserved, false);
  assert.equal(template.zoom.observations.length, 2);
  assert.equal(
    template.zoom.observations.every((observation) => observation.previewVerified === false),
    true,
  );
  assert.equal(template.crop.observations.length, 2);
  assert.equal(
    template.crop.observations.every((observation) => observation.edgeCropVerified === false),
    true,
  );
  assert.deepEqual(
    template.projectAudio.inputs.map((input) => input.format),
    ["wav", "m4a", "mp3"],
  );
  assert.equal(template.projectAudio.playback.longRecordingSyncVerified, false);
  assert.equal(template.projectAudio.persistence.relinkHashMatched, false);
  assert.equal(template.localLibraryRecovery.duplicateReopenVerified, false);
  assert.equal(template.publicationSurface.noPaidOrAccountGateClaims, false);
  assert.equal(template.checks.fresh_install_no_account_or_paid_gates.status, "template");
  assert.equal(template.testedAt, "YYYY-MM-DDTHH:mm:ss.sssZ");
});

test("manual QA evidence template honors alternate release root", () => {
  const fixture = makeFixture();
  try {
    const result = printTemplateForRoot(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    const template = JSON.parse(result.stdout);
    assert.equal(template.status, "template");
    assert.equal(template.releaseVersion, packageJson.version);
    assert.equal(template.automatedEvidenceGeneratedAt, fixture.automated.generatedAt);
    assert.equal(template.environment.extensionSource, "build");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence template writer is atomic and refuses accidental overwrite", () => {
  const fixture = makeFixture();
  try {
    const manualPath = join(fixture.dir, "release-artifacts", "manual-qa-evidence.json");
    const first = writeTemplateForRoot(fixture.dir);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Manual QA evidence template written/);
    assert.ok(existsSync(manualPath));
    assert.ok(!existsSync(`${manualPath}.tmp`));
    const template = JSON.parse(readFileSync(manualPath, "utf8"));
    assert.equal(template.status, "template");
    assert.equal(template.releaseVersion, packageJson.version);
    assert.equal(template.automatedEvidenceGeneratedAt, fixture.automated.generatedAt);
    assert.equal(template.environment.extensionSource, "build");

    const second = writeTemplateForRoot(fixture.dir);

    assert.equal(second.status, 1);
    assert.match(second.stderr, /manual QA evidence file already exists/);
    assert.match(second.stderr, /qa:release:manual:template:force/);

    writeFileSync(manualPath, '{"kind":"stale"}\n');
    const forced = writeTemplateForRoot(fixture.dir, ["--force"]);

    assert.equal(forced.status, 0, forced.stderr);
    const forcedTemplate = JSON.parse(readFileSync(manualPath, "utf8"));
    assert.equal(forcedTemplate.kind, "sayless.manualQaEvidence");
    assert.equal(forcedTemplate.status, "template");
    assert.equal(forcedTemplate.automatedEvidenceGeneratedAt, fixture.automated.generatedAt);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence template does not prefill stale automated evidence", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.buildDir, "editor.html"),
      "<html>SayLess changed after automated QA</html>",
    );

    const result = printTemplateForRoot(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    const template = JSON.parse(result.stdout);
    assert.equal(template.status, "template");
    assert.equal(template.automatedEvidenceGeneratedAt, "YYYY-MM-DDTHH:mm:ss.sssZ");
    assert.equal(template.environment.extensionSource, "build");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence template ignores non-passing automated evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-manual-qa-nonpassing-"));
  try {
    const packageVersion = "9.8.7";
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "release-artifacts"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ version: packageVersion }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, "package-lock.json"),
      `${JSON.stringify(
        {
          version: packageVersion,
          packages: { "": { version: packageVersion } },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, "src", "manifest.json"),
      `${JSON.stringify({ version: packageVersion }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, "release-artifacts", "release-qa-automated.json"),
      `${JSON.stringify(
        {
          kind: "sayless.releaseQaAutomatedFailed",
          status: "failed",
          generatedAt: "2026-07-16T12:34:56.789Z",
          build: { path: "stale-build" },
        },
        null,
        2,
      )}\n`,
    );

    const result = printTemplateForRoot(dir);

    assert.equal(result.status, 0, result.stderr);
    const template = JSON.parse(result.stdout);
    assert.equal(template.status, "template");
    assert.equal(template.releaseVersion, packageVersion);
    assert.equal(template.automatedEvidenceGeneratedAt, "YYYY-MM-DDTHH:mm:ss.sssZ");
    assert.equal(template.environment.extensionSource, "build");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects non-passing automated status", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      status: "failed",
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence status must be "passed"/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects non-passing manual status", () => {
  const fixture = makeFixture();
  try {
    const badManualPath = join(fixture.dir, "bad-manual-status.json");
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          status: "failed",
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /manual QA evidence status must be "passed"/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects placeholders and detached export sources", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      tester: { ...fixture.manual.tester, name: "Manual tester name" },
      exports: {
        ...fixture.manual.exports,
        files: [
          {
            ...fixture.manual.exports.files[0],
            fileName: "wrong-export.webm",
            sourceRecordingId: "missing-recording",
          },
          ...fixture.manual.exports.files.slice(1),
        ],
      },
    };
    const badPath = join(fixture.dir, "bad-manual.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tester\.name still contains template or fixture placeholder text/);
    assert.match(result.stderr, /exports\.files\[0\]\.fileName must match the mp4 export format/);
    assert.match(result.stderr, /exports\.files\[0\]\.sourceRecordingId must reference/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects duplicate export filenames and vague export notes", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      exports: {
        ...fixture.manual.exports,
        files: fixture.manual.exports.files.map((exportedFile, index) => {
          if (index === 1) {
            return {
              ...exportedFile,
              fileName: fixture.manual.exports.files[0].fileName,
              notes: "Release QA confirms this artifact matched the project state.",
            };
          }
          return exportedFile;
        }),
      },
    };
    const badPath = join(fixture.dir, "bad-duplicate-export-files.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /exports\.files\[1\]\.fileName must be unique within exports\.files/,
    );
    assert.match(result.stderr, /exports\.files\[1\]\.notes must describe opening/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects duplicate recording ids", () => {
  const fixture = makeFixture();
  try {
    const badManual = {
      ...fixture.manual,
      recordings: [
        fixture.manual.recordings[0],
        {
          ...fixture.manual.recordings[1],
          id: fixture.manual.recordings[0].id,
        },
      ],
    };
    const badPath = join(fixture.dir, "bad-duplicate-recording-id.json");
    writeFileSync(badPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /recordings\[1\]\.id must be unique/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak recording metadata", () => {
  const fixture = makeFixture();
  try {
    const badManual = {
      ...fixture.manual,
      recordings: fixture.manual.recordings.map((recording, index) =>
        index === 0
          ? {
              ...recording,
              source: "QA workflow",
              container: "mov",
              microphone: "",
              noiseProfile: "",
              width: 0,
              height: 1.5,
              notes: "Release QA covered this scenario.",
            }
          : recording,
      ),
    };
    const badPath = join(fixture.dir, "bad-weak-recording-metadata.json");
    writeFileSync(badPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /recordings\[0\]\.source must describe a tab/);
    assert.match(result.stderr, /recordings\[0\]\.container must identify an MP4 or WebM/);
    assert.match(result.stderr, /recordings\[0\]\.notes must describe observed/);
    assert.match(result.stderr, /recordings\[0\]\.microphone is required/);
    assert.match(result.stderr, /recordings\[0\]\.noiseProfile is required/);
    assert.match(
      result.stderr,
      /recordings\[0\]\.width must be a positive integer source-video dimension/,
    );
    assert.match(
      result.stderr,
      /recordings\[0\]\.height must be a positive integer source-video dimension/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires exact positive recording byte sizes", () => {
  const fixture = makeFixture();
  try {
    const badManual = {
      ...fixture.manual,
      recordings: fixture.manual.recordings.map((recording, index) =>
        index === 0 ? { ...recording, byteSize: 12.5 } : recording,
      ),
    };
    const badPath = join(fixture.dir, "bad-recording-byte-size.json");
    writeFileSync(badPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /recordings\[0\]\.byteSize must be a positive integer source-file byte count/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires one recording to be both long and large", () => {
  const fixture = makeFixture();
  try {
    const badManual = {
      ...fixture.manual,
      recordings: fixture.manual.recordings.map((recording, index) =>
        index === 0
          ? { ...recording, byteSize: 75_000_000 }
          : { ...recording, byteSize: 20_000_000 },
      ),
    };
    const badPath = join(fixture.dir, "bad-split-long-large-recordings.json");
    writeFileSync(badPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /recordings must include at least one recording that is both 180 seconds or longer and at least 25 MiB/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA cancel and retry must use the long large recording", () => {
  const fixture = makeFixture();
  try {
    const badManual = {
      ...fixture.manual,
      exports: {
        ...fixture.manual.exports,
        workflow: {
          ...fixture.manual.exports.workflow,
          cancelRetryRecordingId: fixture.manual.recordings[0].id,
        },
      },
    };
    const badPath = join(fixture.dir, "bad-cancel-retry-recording.json");
    writeFileSync(badPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /exports\.workflow\.cancelRetryRecordingId must reference a listed recording that is both 180 seconds or longer and at least 25 MiB/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects stale timestamps and lockfile mismatch", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      packageLockVersion: "0.0.0",
    };
    const badAutomatedPath = join(fixture.dir, "bad-automated.json");
    const badManualPath = join(fixture.dir, "bad-timing.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
          testedAt: "2020-01-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /testedAt must be at or after automatedEvidenceGeneratedAt/);
    assert.match(result.stderr, /packageLockVersion must match package-lock\.json version/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects incomplete automated run timing", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      startedAt: "2099-01-01T00:00:00.000Z",
      generatedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 0,
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    const badManual = {
      ...fixture.manual,
      automatedEvidenceGeneratedAt: badAutomated.generatedAt,
    };
    const badManualPath = join(fixture.dir, "bad-automated-timing.json");
    writeFileSync(badManualPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence generatedAt must be at or after startedAt/);
    assert.match(result.stderr, /automated QA evidence startedAt must not be in the future/);
    assert.match(result.stderr, /automated QA evidence durationMs must be a positive number/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects inconsistent automated run duration", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      startedAt: "2026-07-16T10:00:00.000Z",
      generatedAt: "2026-07-16T10:00:10.000Z",
      durationMs: 120_000,
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    const badManual = {
      ...fixture.manual,
      automatedEvidenceGeneratedAt: badAutomated.generatedAt,
      testedAt: "2026-07-16T10:01:00.000Z",
    };
    writeFileSync(fixture.manualPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence durationMs must match the startedAt\/generatedAt run window/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects missing automated git provenance", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      git: {
        branch: "",
        commit: "not-a-commit",
        dirty: "no",
      },
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence git\.branch is required/);
    assert.match(
      result.stderr,
      /automated QA evidence git\.commit must be a 40-character SHA-1 commit/,
    );
    assert.match(result.stderr, /automated QA evidence git\.dirty must be a boolean/);
    assert.match(result.stderr, /automated QA evidence git\.workingTree is required/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects automated git worktree drift", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      git: {
        ...fixture.automated.git,
        workingTree: {
          ...fixture.automated.git.workingTree,
          sha256: "f".repeat(64),
        },
      },
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence git\.workingTree\.sha256 must match the current git worktree/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak automated command evidence", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      commands: fixture.automated.commands.map((command) =>
        command.label === "verify:release"
          ? { label: command.label, status: "failed", durationMs: -1 }
          : command,
      ),
    };
    const badAutomatedPath = join(fixture.dir, "bad-automated-command.json");
    const badManualPath = join(fixture.dir, "bad-automated-command-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence command verify:release must have status "passed"/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence command verify:release must include the executed command/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence command verify:release must include a non-negative durationMs/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects substituted automated command strings", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      commands: fixture.automated.commands.map((command) =>
        command.label === "build:release"
          ? { ...command, command: "node scripts/fake-release-build.mjs" }
          : command,
      ),
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence command build:release must be "npm run build:release"/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects duplicate and unexpected automated commands", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      durationMs: 1_000,
      commands: [
        ...fixture.automated.commands,
        { ...fixture.automated.commands[0], durationMs: 10 },
        {
          label: "test:e2e:hosted-dashboard",
          status: "passed",
          command: "npm run test:e2e:hosted-dashboard",
          durationMs: 10,
        },
      ],
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence contains duplicate command: lint/);
    assert.match(
      result.stderr,
      /automated QA evidence contains unexpected command: test:e2e:hosted-dashboard/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects command durations longer than the automated run", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      durationMs: 1_000,
      commands: fixture.automated.commands.map((command) =>
        command.label === "test:unit" ? { ...command, durationMs: 10_000 } : command,
      ),
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence command durations must not exceed total durationMs/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects alternate automated evidence paths", () => {
  const fixture = makeFixture();
  try {
    const alternateAutomatedPath = join(fixture.dir, "alternate-automated.json");
    writeFileSync(alternateAutomatedPath, readFileSync(fixture.automatedPath));
    const badManual = {
      ...fixture.manual,
      automatedEvidencePath: alternateAutomatedPath,
    };
    const badManualPath = join(fixture.dir, "bad-automated-path.json");
    writeFileSync(badManualPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automatedEvidencePath must point to release-artifacts\/release-qa-automated\.json/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects absolute automated evidence and build paths", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      build: {
        ...fixture.automated.build,
        path: fixture.buildDir,
      },
      bundledWhisper: {
        ...fixture.automated.bundledWhisper,
        path: join(fixture.buildDir, "assets", "whisper"),
      },
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    const badManual = {
      ...fixture.manual,
      automatedEvidencePath: fixture.automatedPath,
      environment: {
        ...fixture.manual.environment,
        extensionSource: fixture.buildDir,
      },
    };
    const badManualPath = join(fixture.dir, "bad-absolute-paths.json");
    writeFileSync(badManualPath, `${JSON.stringify(badManual, null, 2)}\n`);

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automatedEvidencePath must point to release-artifacts\/release-qa-automated\.json/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence build\.path must be the canonical relative build path/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence bundledWhisper\.path must be the canonical relative build\/assets\/whisper path/,
    );
    assert.match(
      result.stderr,
      /environment\.extensionSource must reference the automated QA build path/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects forbidden automated release manifest surface", () => {
  const fixture = makeFixture();
  try {
    const badManifest = {
      version: packageJson.version,
      oauth2: {
        client_id: "forbidden-client",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      },
      externally_connectable: { matches: ["https://app.example.invalid/*"] },
      permissions: ["identity"],
      optional_permissions: ["drive.file"],
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'self'; connect-src 'self' https://api.example.invalid",
      },
    };
    writeFileSync(
      join(fixture.buildDir, "manifest.json"),
      `${JSON.stringify(badManifest, null, 2)}\n`,
    );
    const badBuild = dirFingerprint(fixture.buildDir);
    const bad = {
      ...fixture.automated,
      build: {
        ...fixture.automated.build,
        bytes: dirSize(fixture.buildDir),
        formattedBytes: formatBytes(dirSize(fixture.buildDir)),
        fileCount: badBuild.fileCount,
        sha256: badBuild.sha256,
      },
      releaseSurface: {
        permissions: ["identity"],
        optionalPermissions: ["drive.file"],
        hostPermissions: [],
        hasOauth2: true,
        hasExternallyConnectable: true,
        hasIdentityPermission: true,
        hasGoogleDrivePermission: true,
        hasRemoteConnectSrc: true,
        contentSecurityPolicyExtensionPages: badManifest.content_security_policy.extension_pages,
      },
    };
    writeFileSync(fixture.automatedPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(fixture.manualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence releaseSurface\.hasOauth2 must be false/);
    assert.match(
      result.stderr,
      /automated QA evidence releaseSurface\.hasExternallyConnectable must be false/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence releaseSurface\.hasIdentityPermission must be false/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence releaseSurface\.hasGoogleDrivePermission must be false/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence releaseSurface\.hasRemoteConnectSrc must be false/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects ambiguous generated-speech automation evidence", () => {
  const fixture = makeFixture();
  try {
    const speechCommand = {
      label: "test:e2e:offline-transcription-speech",
      status: "failed",
      command: "",
      durationMs: -1,
    };
    const badAutomated = {
      ...fixture.automated,
      commands: [...fixture.automated.commands, speechCommand],
      skippedCommands: [{ label: speechCommand.label, reason: "" }],
    };
    const badAutomatedPath = join(fixture.dir, "bad-generated-speech-command.json");
    const badManualPath = join(fixture.dir, "bad-generated-speech-command-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence command test:e2e:offline-transcription-speech cannot be both completed and skipped/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects skipped generated-speech evidence without a useful reason", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      skippedCommands: [{ label: "test:e2e:offline-transcription-speech", reason: "" }],
    };
    const badAutomatedPath = join(fixture.dir, "bad-generated-speech-skip.json");
    const badManualPath = join(fixture.dir, "bad-generated-speech-skip-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence skipped command test:e2e:offline-transcription-speech must include a useful reason/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects stale bundled Whisper evidence", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      bundledWhisper: {
        ...fixture.automated.bundledWhisper,
        bytes: fixture.automated.bundledWhisper.bytes + 1,
        fileCount: fixture.automated.bundledWhisper.fileCount + 1,
        sha256: "0".repeat(64),
      },
    };
    const badAutomatedPath = join(fixture.dir, "bad-bundled-whisper.json");
    const badManualPath = join(fixture.dir, "bad-bundled-whisper-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /current bundled Whisper fingerprint does not match/);
    assert.match(result.stderr, /current bundled Whisper file count .* does not match/);
    assert.match(result.stderr, /current bundled Whisper byte size .* does not match/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects stale automated build size evidence", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      build: {
        ...fixture.automated.build,
        bytes: fixture.automated.build.bytes + 1,
        formattedBytes: formatBytes(fixture.automated.build.bytes + 1),
      },
    };
    const badAutomatedPath = join(fixture.dir, "bad-build-size.json");
    const badManualPath = join(fixture.dir, "bad-build-size-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /current build byte size .* does not match/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects stale automated formatted sizes", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      build: {
        ...fixture.automated.build,
        formattedBytes: "1.0 TB",
      },
      bundledWhisper: {
        ...fixture.automated.bundledWhisper,
        formattedBytes: "1.0 TB",
      },
    };
    const badAutomatedPath = join(fixture.dir, "bad-formatted-sizes.json");
    const badManualPath = join(fixture.dir, "bad-formatted-sizes-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automated QA evidence build\.formattedBytes must match build\.bytes/,
    );
    assert.match(
      result.stderr,
      /automated QA evidence bundledWhisper\.formattedBytes must match bundledWhisper\.bytes/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects non-clean-profile or wrong build source evidence", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      environment: {
        ...fixture.manual.environment,
        extensionSource: join(fixture.dir, "different-build"),
        cleanChromeProfile: false,
        unpackedExtensionId: "not-a-chrome-extension-id",
      },
    };
    const badPath = join(fixture.dir, "bad-environment.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /environment\.extensionSource must reference the automated QA build path/,
    );
    assert.match(result.stderr, /environment\.cleanChromeProfile must be true/);
    assert.match(
      result.stderr,
      /environment\.unpackedExtensionId must be a 32-character Chrome extension id/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires the browser-observed automated extension id", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      environment: {
        ...fixture.manual.environment,
        unpackedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    };
    const badPath = join(fixture.dir, "mismatched-extension-id.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /environment\.unpackedExtensionId must match the browser-observed automated extension id/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires matching launched-session provenance", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      manualSession: {
        ...fixture.manual.manualSession,
        buildSha256: "c".repeat(64),
        operatingSystem: "different operating system",
      },
    };
    const badPath = join(fixture.dir, "mismatched-session.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /manualSession\.buildSha256 must match automated QA build\.sha256/);
    assert.match(result.stderr, /manualSession\.operatingSystem must match environment\.os/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects malformed built-extension browser provenance", () => {
  const fixture = makeFixture();
  try {
    const badAutomated = {
      ...fixture.automated,
      builtExtension: {
        id: "not-an-extension-id",
        buildPath: "/tmp/alternate-build",
        cleanChromeProfile: false,
        observedAt: "2020-01-01T00:00:00.000Z",
        summaryCount: 0,
      },
    };
    const badAutomatedPath = join(fixture.dir, "bad-built-extension-evidence.json");
    const badManualPath = join(fixture.dir, "bad-built-extension-manual.json");
    writeFileSync(badAutomatedPath, `${JSON.stringify(badAutomated, null, 2)}\n`);
    writeFileSync(
      badManualPath,
      `${JSON.stringify(
        {
          ...fixture.manual,
          automatedEvidencePath: badAutomatedPath,
        },
        null,
        2,
      )}\n`,
    );

    const result = runVerifier(badManualPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /builtExtension\.id must be a browser-observed/);
    assert.match(result.stderr, /builtExtension\.buildPath must be/);
    assert.match(result.stderr, /builtExtension\.cleanChromeProfile must be true/);
    assert.match(
      result.stderr,
      /builtExtension\.observedAt must fall within the automated QA run window/,
    );
    assert.match(result.stderr, /builtExtension\.summaryCount must be a positive integer/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak offline transcription proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      offlineTranscription: {
        ...fixture.manual.offlineTranscription,
        networkDisabledMethod: "QA profile prepared before transcription.",
        externalNetworkProbe: {
          url: "http://127.0.0.1/offline-check",
          result: "passed",
          observedError: "Request completed normally.",
          sameChromeProfile: false,
        },
        networkProbeResult: "The check was recorded in the QA notes.",
        bundledModelReadyObserved: false,
        transcriptQualityNotes: "Transcript looked okay.",
      },
    };
    const badPath = join(fixture.dir, "bad-offline-transcription.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /offlineTranscription\.externalNetworkProbe\.url must be an external http\(s\) URL/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.networkDisabledMethod must describe disabled/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.externalNetworkProbe\.result must be "failed"/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.externalNetworkProbe\.observedError must include/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.externalNetworkProbe\.sameChromeProfile must be true/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.networkProbeResult must include the failed external probe/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.networkProbeResult must mention that the bundled\/local Whisper model stayed ready/,
    );
    assert.match(result.stderr, /offlineTranscription\.bundledModelReadyObserved must be true/);
    assert.match(
      result.stderr,
      /offlineTranscription\.transcriptQualityNotes must mention real-speaker/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires unique offline transcription recording references", () => {
  const fixture = makeFixture();
  try {
    const duplicateRecordingId = fixture.manual.recordings[0].id;
    const bad = {
      ...fixture.manual,
      offlineTranscription: {
        ...fixture.manual.offlineTranscription,
        recordingIds: [duplicateRecordingId, duplicateRecordingId],
      },
    };
    const badPath = join(fixture.dir, "bad-offline-duplicate-recording-refs.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /offlineTranscription\.recordingIds\[1\] must be a unique recording id/,
    );
    assert.match(
      result.stderr,
      /offlineTranscription\.recordingIds must reference at least 2 unique listed recording ids/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak export workflow proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      exports: {
        ...fixture.manual.exports,
        workflow: {
          ...fixture.manual.exports.workflow,
          cancelRetryRecordingId: "missing-recording",
          cancelledExportFormat: "wav",
          retryCompletedExportFormat: "m4a",
          revealDownloadIdObserved: "Reveal button was visible in the export panel.",
          notes: "Long export retry was observed in the panel.",
        },
      },
    };
    const badPath = join(fixture.dir, "bad-export-workflow.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exports\.workflow\.cancelRetryRecordingId must reference/);
    assert.match(result.stderr, /exports\.workflow\.cancelledExportFormat must be one of/);
    assert.match(result.stderr, /exports\.workflow\.retryCompletedExportFormat must be one of/);
    assert.match(
      result.stderr,
      /exports\.workflow\.revealDownloadIdObserved must mention a completed/,
    );
    assert.match(result.stderr, /exports\.workflow\.notes must describe the verified Save to file/);
    assert.match(
      result.stderr,
      /exports\.workflow\.notes must describe the save dialog cancellation/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak silence suggestion proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      silenceSuggestions: {
        ...fixture.manual.silenceSuggestions,
        suggestedQuietRanges: [
          {
            recordingId: "missing-recording",
            startSeconds: 42,
            endSeconds: 41,
            observation: "",
          },
        ],
        ignoredNoiseRanges: [],
      },
    };
    const badPath = join(fixture.dir, "bad-silence-suggestions.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /silenceSuggestions\.suggestedQuietRanges must include at least 2/);
    assert.match(
      result.stderr,
      /silenceSuggestions\.suggestedQuietRanges\[0\]\.recordingId must reference/,
    );
    assert.match(
      result.stderr,
      /silenceSuggestions\.suggestedQuietRanges\[0\]\.endSeconds must be greater/,
    );
    assert.match(
      result.stderr,
      /silenceSuggestions\.suggestedQuietRanges\[0\]\.observation must describe/,
    );
    assert.match(result.stderr, /silenceSuggestions\.ignoredNoiseRanges must include at least 1/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires unique silence suggestion recording references", () => {
  const fixture = makeFixture();
  try {
    const duplicateRecordingId = fixture.manual.recordings[0].id;
    const bad = {
      ...fixture.manual,
      silenceSuggestions: {
        ...fixture.manual.silenceSuggestions,
        recordingIds: [duplicateRecordingId, duplicateRecordingId],
      },
    };
    const badPath = join(fixture.dir, "bad-silence-duplicate-recording-refs.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /silenceSuggestions\.recordingIds\[1\] must be a unique recording id/,
    );
    assert.match(
      result.stderr,
      /silenceSuggestions\.recordingIds must reference at least 2 unique listed recording ids/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA silence evidence is linked to real container and noise diversity", () => {
  const fixture = makeFixture();
  try {
    const recordingA = fixture.manual.recordings[0];
    const recordingB = fixture.manual.recordings[1];
    const bad = {
      ...fixture.manual,
      recordings: [
        recordingA,
        {
          ...recordingB,
          container: "webm",
          noiseProfile: recordingA.noiseProfile,
        },
      ],
      silenceSuggestions: {
        ...fixture.manual.silenceSuggestions,
        codecsOrContainers: ["webm", "mp4", "m4a"],
        suggestedQuietRanges: fixture.manual.silenceSuggestions.suggestedQuietRanges.map(
          (range) => ({ ...range, recordingId: recordingA.id }),
        ),
        ignoredNoiseRanges: fixture.manual.silenceSuggestions.ignoredNoiseRanges.map((range) => ({
          ...range,
          recordingId: recordingA.id,
        })),
      },
    };
    const badPath = join(fixture.dir, "bad-unlinked-silence-diversity.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /silenceSuggestions\.recordingIds must reference at least one listed MP4 recording/,
    );
    assert.match(
      result.stderr,
      /silenceSuggestions\.recordingIds must reference recordings with at least two distinct noise profiles/,
    );
    assert.match(
      result.stderr,
      new RegExp(
        `silenceSuggestions\\.suggestedQuietRanges must include an observed range for referenced recording ${recordingB.id}`,
      ),
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA silence ranges must belong to the declared recording set", () => {
  const fixture = makeFixture();
  try {
    const recordingA = fixture.manual.recordings[0];
    const recordingB = fixture.manual.recordings[1];
    const recordingC = {
      ...recordingA,
      id: "real-tab-speaker-c",
      speakerProfile: "third QA narrator",
      noiseProfile: "quiet treated room",
      notes: "Recorded and opened this local tab recording for an additional transcript check.",
    };
    const bad = {
      ...fixture.manual,
      recordings: [recordingA, recordingB, recordingC],
      silenceSuggestions: {
        ...fixture.manual.silenceSuggestions,
        suggestedQuietRanges: fixture.manual.silenceSuggestions.suggestedQuietRanges.map(
          (range, index) => (index === 0 ? { ...range, recordingId: recordingC.id } : range),
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-silence-range-recording-set.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /silenceSuggestions\.suggestedQuietRanges\[0\]\.recordingId must also appear in silenceSuggestions\.recordingIds/,
    );
    assert.match(
      result.stderr,
      new RegExp(
        `silenceSuggestions\\.suggestedQuietRanges must include an observed range for referenced recording ${recordingA.id}`,
      ),
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak zoom proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      zoom: {
        ...fixture.manual.zoom,
        observations: fixture.manual.zoom.observations.map((observation, index) =>
          index === 0
            ? {
                ...observation,
                sourceHadClickMetadata: false,
                persistedAfterReopen: false,
                exportInspection: "",
              }
            : observation,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-zoom.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /zoom\.observations\[0\]\.sourceHadClickMetadata must be true/);
    assert.match(result.stderr, /zoom\.observations\[0\]\.persistedAfterReopen must be true/);
    assert.match(result.stderr, /zoom\.observations\[0\]\.exportInspection must describe/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA zoom evidence requires eligible varied sources and one observation each", () => {
  const fixture = makeFixture();
  try {
    const zoomRecordingId = fixture.manual.zoom.recordingIds[1];
    const bad = {
      ...fixture.manual,
      recordings: fixture.manual.recordings.map((recording) =>
        recording.id === zoomRecordingId
          ? {
              ...recording,
              source: "desktop recording of local documentation",
              width: 1920,
              height: 1080,
            }
          : recording,
      ),
      zoom: {
        ...fixture.manual.zoom,
        observations: fixture.manual.zoom.observations.map((observation, index) =>
          index === 1
            ? {
                ...observation,
                recordingId: fixture.manual.zoom.recordingIds[0],
              }
            : observation,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-zoom-variety.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /zoom\.recordingIds must reference tab, browser, or region recordings/,
    );
    assert.match(
      result.stderr,
      /zoom\.recordingIds must reference recordings with at least two distinct dimension pairs and aspect ratios/,
    );
    assert.match(
      result.stderr,
      /zoom\.observations\[1\]\.recordingId must be unique within zoom\.observations/,
    );
    assert.match(
      result.stderr,
      new RegExp(`zoom\\.observations must include referenced recording ${zoomRecordingId}`),
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA crop evidence requires edge bounds matching inspected output", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      crop: {
        ...fixture.manual.crop,
        observations: fixture.manual.crop.observations.map((observation, index) =>
          index === 0
            ? {
                ...observation,
                crop: {
                  xRatio: 0.1,
                  yRatio: 0.1,
                  widthRatio: 0.5,
                  heightRatio: 0.5,
                },
                exportWidth: 1000,
                exportHeight: 720,
                nativePlaybackControlsVerified: false,
                edgeCropVerified: false,
                sourceBlobUnchanged: false,
                exportInspection: "",
              }
            : observation,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-crop-observation.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /crop\.observations\[0\]\.crop must exercise at least one source edge/,
    );
    assert.match(
      result.stderr,
      /crop\.observations\[0\] exported dimensions must match the normalized crop aspect ratio within 3%/,
    );
    assert.match(
      result.stderr,
      /crop\.observations\[0\]\.nativePlaybackControlsVerified must be true/,
    );
    assert.match(result.stderr, /crop\.observations\[0\]\.edgeCropVerified must be true/);
    assert.match(result.stderr, /crop\.observations\[0\]\.sourceBlobUnchanged must be true/);
    assert.match(result.stderr, /crop\.observations\[0\]\.exportInspection must describe/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA crop evidence requires varied sources and one observation each", () => {
  const fixture = makeFixture();
  try {
    const cropRecordingId = fixture.manual.crop.recordingIds[1];
    const bad = {
      ...fixture.manual,
      recordings: fixture.manual.recordings.map((recording) =>
        recording.id === cropRecordingId ? { ...recording, width: 1920, height: 1080 } : recording,
      ),
      crop: {
        ...fixture.manual.crop,
        observations: fixture.manual.crop.observations.map((observation, index) =>
          index === 1
            ? {
                ...observation,
                recordingId: fixture.manual.crop.recordingIds[0],
              }
            : observation,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-crop-variety.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /crop\.recordingIds must reference recordings with at least two distinct dimension pairs and aspect ratios/,
    );
    assert.match(
      result.stderr,
      /crop\.observations\[1\]\.recordingId must be unique within crop\.observations/,
    );
    assert.match(
      result.stderr,
      new RegExp(`crop\\.observations must include referenced recording ${cropRecordingId}`),
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA project audio requires valid real WAV M4A and MP3 inputs", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      projectAudio: {
        ...fixture.manual.projectAudio,
        inputs: fixture.manual.projectAudio.inputs.map((input, index) =>
          index === 2
            ? {
                ...input,
                format: "wav",
                fileName: "wrong-extension.txt",
                byteSize: 0,
                durationSeconds: 0,
                channels: 0,
                sampleRate: 1000,
                decodeVerified: false,
                audiblePreviewVerified: false,
                notes: "",
              }
            : input,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-project-audio-inputs.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /projectAudio\.inputs\[2\]\.format must be unique within projectAudio\.inputs/,
    );
    assert.match(
      result.stderr,
      /projectAudio\.inputs\[2\]\.fileName must match its declared wav format/,
    );
    assert.match(result.stderr, /projectAudio\.inputs\[2\]\.byteSize must be at least 1/);
    assert.match(result.stderr, /projectAudio\.inputs\[2\]\.decodeVerified must be true/);
    assert.match(result.stderr, /projectAudio\.inputs must include mp3/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA project audio is tied to long sync cancellation and cleanup", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      projectAudio: {
        ...fixture.manual.projectAudio,
        recordingId: fixture.manual.recordings[0].id,
        playback: {
          ...fixture.manual.projectAudio.playback,
          longRecordingSyncVerified: false,
          cancelRetryVerified: false,
          gainPerceptionNotes: "Playback sounded okay.",
        },
        persistence: {
          ...fixture.manual.projectAudio.persistence,
          duplicateDeletedOriginalIntact: false,
          sidecarMissingAssetVerified: false,
          relinkHashMatched: false,
          applyEditsCleanupVerified: false,
          notes: "",
        },
      },
    };
    const badPath = join(fixture.dir, "bad-project-audio-workflow.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /projectAudio\.recordingId must reference a listed recording that is both 180 seconds or longer and at least 25 MiB/,
    );
    assert.match(
      result.stderr,
      /projectAudio\.recordingId must match exports\.workflow\.cancelRetryRecordingId/,
    );
    assert.match(result.stderr, /projectAudio\.playback\.longRecordingSyncVerified must be true/);
    assert.match(
      result.stderr,
      /projectAudio\.playback\.gainPerceptionNotes must mention mix or replace behavior/,
    );
    assert.match(result.stderr, /projectAudio\.persistence\.relinkHashMatched must be true/);
    assert.match(result.stderr, /projectAudio\.persistence\.notes must describe reopen/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak local library recovery proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      localLibraryRecovery: {
        ...fixture.manual.localLibraryRecovery,
        operations: [
          {
            type: "duplicate-reopen",
            recordingIds: ["missing-recording"],
            observation: "",
          },
          {
            type: "bulk-export-delete",
            recordingIds: [fixture.manual.recordings[0].id],
            observation: "Bulk operation only named one recording.",
          },
        ],
      },
    };
    const badPath = join(fixture.dir, "bad-local-library-recovery.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /localLibraryRecovery\.operations must include duplicate-reopen/);
    assert.match(
      result.stderr,
      /localLibraryRecovery\.operations\[0\]\.recordingIds\[0\] must reference/,
    );
    assert.match(result.stderr, /localLibraryRecovery\.operations\[0\]\.observation must describe/);
    assert.match(
      result.stderr,
      /localLibraryRecovery\.operations\[1\]\.recordingIds must include at least 2/,
    );
    assert.match(result.stderr, /localLibraryRecovery\.operations must include sidecar-import/);
    assert.match(result.stderr, /localLibraryRecovery\.operations must include orphan-cleanup/);
    assert.match(
      result.stderr,
      /localLibraryRecovery\.operations must include missing-media-repair/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires unique bulk recovery recording references", () => {
  const fixture = makeFixture();
  try {
    const duplicateRecordingId = fixture.manual.recordings[0].id;
    const bad = {
      ...fixture.manual,
      localLibraryRecovery: {
        ...fixture.manual.localLibraryRecovery,
        operations: fixture.manual.localLibraryRecovery.operations.map((operation) =>
          operation.type === "bulk-export-delete"
            ? {
                ...operation,
                recordingIds: [duplicateRecordingId, duplicateRecordingId],
              }
            : operation,
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-recovery-duplicate-recording-refs.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /localLibraryRecovery\.operations\[2\]\.recordingIds\[1\] must be unique within this operation/,
    );
    assert.match(
      result.stderr,
      /localLibraryRecovery\.operations\[2\]\.recordingIds must reference at least 2 unique listed recording ids/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak publication surface proof", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      publicationSurface: {
        ...fixture.manual.publicationSurface,
        reviewedArtifacts: fixture.manual.publicationSurface.reviewedArtifacts.map(
          (artifact, index) => ({
            ...artifact,
            name: index === 2 ? "Reviewed artifact" : artifact.name,
            notes: index === 0 ? "Reviewed the artifact." : artifact.notes,
            searchedTerms: index === 0 ? ["cloud"] : artifact.searchedTerms,
            residualRisk: index === 1 ? "Looks fine." : artifact.residualRisk,
          }),
        ),
      },
    };
    const badPath = join(fixture.dir, "bad-publication-surface.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /publicationSurface\.reviewedArtifacts\[0\]\.searchedTerms must include paid\/subscription, premium\/trial\/entitlement\/license\/upgrade, plan\/membership\/locked-feature, locked-behind\/pay-to-unlock\/upgrade-required gates, account-tier\/license-key\/activation\/contact-sales gates/,
    );
    assert.match(
      result.stderr,
      /publicationSurface\.reviewedArtifacts\[0\]\.notes must describe reviewing/,
    );
    assert.match(
      result.stderr,
      /publicationSurface\.reviewedArtifacts\[1\]\.residualRisk must explicitly state no residual risk/,
    );
    assert.match(
      result.stderr,
      /publicationSurface\.reviewedArtifacts\[2\]\.name must identify the store-text artifact reviewed/,
    );
    assert.match(
      result.stderr,
      /publicationSurface\.reviewedArtifacts\[2\]\.name must include docs\/STORE_LISTING\.md/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier rejects weak checklist evidence", () => {
  const fixture = makeFixture();
  try {
    const bad = {
      ...fixture.manual,
      checks: {
        ...fixture.manual.checks,
        fresh_install_no_account_or_paid_gates: {
          ...fixture.manual.checks.fresh_install_no_account_or_paid_gates,
          evidence: ["generic screenshot confirms fresh install"],
        },
        offline_transcription_real_speakers: {
          ...fixture.manual.checks.offline_transcription_real_speakers,
          notes: "Manual result was acceptable.",
          evidence: [
            {
              artifact: "artifact bundle",
              recordingIds: ["missing-recording"],
              observation: "The result looked acceptable.",
            },
          ],
        },
      },
    };
    const badPath = join(fixture.dir, "bad-checklist-evidence.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /checks\.fresh_install_no_account_or_paid_gates\.evidence\[0\] must be an object/,
    );
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.evidence\[0\]\.recordingIds\[0\] must reference/,
    );
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.notes must describe observed/,
    );
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.evidence\[0\]\.artifact must identify a screenshot/,
    );
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.evidence\[0\]\.observation must describe observed/,
    );
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.evidence must reference at least 2 listed recording ids/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA evidence verifier requires unique checklist recording references", () => {
  const fixture = makeFixture();
  try {
    const duplicateRecordingId = fixture.manual.recordings[0].id;
    const bad = {
      ...fixture.manual,
      checks: {
        ...fixture.manual.checks,
        offline_transcription_real_speakers: {
          ...fixture.manual.checks.offline_transcription_real_speakers,
          evidence: [
            {
              artifact: "offline-transcription-report.txt",
              recordingIds: [duplicateRecordingId, duplicateRecordingId],
              observation:
                "Offline transcription was checked against duplicate recording evidence.",
            },
          ],
        },
      },
    };
    const badPath = join(fixture.dir, "bad-checklist-duplicate-recording-refs.json");
    writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);

    const result = runVerifier(badPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /checks\.offline_transcription_real_speakers\.evidence must reference at least 2 unique listed recording ids/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
