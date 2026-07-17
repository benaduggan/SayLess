#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_MANUAL_QA_ROOT
  ? resolve(process.env.SAYLESS_MANUAL_QA_ROOT)
  : DEFAULT_ROOT;
const DEFAULT_EVIDENCE_PATH = join(ROOT, "release-artifacts", "manual-qa-evidence.json");
const DEFAULT_AUTOMATED_EVIDENCE_PATH = join(ROOT, "release-artifacts", "release-qa-automated.json");
const PACKAGE_PATH = join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = join(ROOT, "package-lock.json");
const SOURCE_MANIFEST_PATH = join(ROOT, "src", "manifest.json");
const PACKAGE_VERSION = JSON.parse(readFileSync(PACKAGE_PATH, "utf8")).version;
const PACKAGE_LOCK = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8"));
const PACKAGE_LOCK_VERSION = PACKAGE_LOCK.version;
const PACKAGE_LOCK_ROOT_VERSION = PACKAGE_LOCK.packages?.[""]?.version;
const SOURCE_MANIFEST_VERSION = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8")).version;
const REQUIRED_AUTOMATED_COMMANDS = [
  "test:unit",
  "test:e2e:offline-whisper-assets",
  "test:e2e:offline-transcription-smoke",
  "test:e2e:local-recordings",
  "test:e2e:editor-layout",
  "build:release",
  "test:e2e:built-extension-surface",
  "verify:release",
];
const CONDITIONAL_AUTOMATED_COMMANDS = ["test:e2e:offline-transcription-speech"];
const AUTOMATED_RUN_WINDOW_TOLERANCE_MS = 5_000;
const EXPECTED_AUTOMATED_COMMANDS = new Map(
  [...REQUIRED_AUTOMATED_COMMANDS, ...CONDITIONAL_AUTOMATED_COMMANDS].map((label) => [
    label,
    `npm run ${label}`,
  ]),
);
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
const EXPORT_FILE_NAME_PATTERNS = {
  mp4: /\.mp4$/i,
  webm: /\.webm$/i,
  gif: /\.gif$/i,
  wav: /\.wav$/i,
  m4a: /\.m4a$/i,
  vtt: /\.vtt$/i,
  "transcript-json": /(?:\.transcript)?\.json$/i,
  "sayless-project-json": /\.sayless-project\.json$/i,
};
const EXPORT_INSPECTION_NOTE_PATTERN =
  /\b(opened?|played?|imported?|decoded?|inspected?|previewed?|viewed?|loaded?|listened)\b/i;
const EXPORT_REVEAL_COMPLETION_PATTERN = /\b(completed?|complete|finished?|succeeded?|done)\b/i;
const EXPORT_REVEAL_OBSERVATION_PATTERN = /\b(download(?:s)?\s*(?:id)?|reveal(?:ed)?|opened?|show(?:ed)?\s+in\s+folder)\b/i;
const EXPORT_SAVE_TO_FILE_VERIFIED_PATTERN =
  /\b(save to file|saved? to (?:a )?(?:(?:user-chosen|chosen|selected|local)\s+){0,3}(?:file|folder|directory)|showSaveFilePicker|file system access)\b/i;
const EXPORT_SAVE_TO_FILE_UNAVAILABLE_PATTERN =
  /\b(unavailable|not available|unsupported|not supported|no file system access|showSaveFilePicker missing)\b/i;
const EXPORT_SAVE_DIALOG_CANCELLATION_PATTERN =
  /\b(save dialog|file picker|showSaveFilePicker)\b.*\b(cancelled|canceled|cancellation|abort(?:ed)?)\b|\b(cancelled|canceled|cancellation|abort(?:ed)?)\b.*\b(save dialog|file picker|showSaveFilePicker)\b/i;
const OFFLINE_NETWORK_DISABLED_PATTERN =
  /\b(disabled|turned off|blocked|disconnected|offline|airplane|devtools|firewall)\b.*\b(network|wi-?fi|ethernet|internet|external|http)/i;
const OFFLINE_NETWORK_PROBE_FAILURE_PATTERN =
  /\b(failed|failure|err_|blocked|offline|disconnected|timed out|timeout|unreachable)\b/i;
const OFFLINE_MODEL_READY_PATTERN =
  /\b(bundled|local|extension)\b.*\b(whisper|model)\b.*\b(ready|loaded|available)\b|\b(ready|loaded|available)\b.*\b(bundled|local|extension)\b.*\b(whisper|model)\b/i;
const TRANSCRIPT_QUALITY_PATTERN =
  /\b(real[- ]?speakers?|speakers?|voices?|narration|microphone|recording)\b.*\b(word|timing|timestamp|accuracy|accurate|quality|usable)\b|\b(word|timing|timestamp|accuracy|accurate|quality|usable)\b.*\b(real[- ]?speakers?|speakers?|voices?|narration|microphone|recording)\b/i;
const PUBLICATION_REVIEW_NOTE_PATTERN =
  /\b(reviewed|checked|searched|scanned|inspected)\b.*\b(paid|account|sign.?in|cloud|remote|dashboard|drive|local-only|gate|tier|trial|license|upgrade|overclaim|claim)/i;
const PUBLICATION_RESIDUAL_RISK_PATTERN =
  /\b(no|none|zero|without)\b.*\b(residual|remaining)?\s*risk\b|\b(residual|remaining)\s+risk\b/i;
const CHECKLIST_EVIDENCE_PATTERN =
  /\b(observed|confirmed|verified|recorded|inspected|tested|opened|reviewed)\b.*\b(local|offline|no.?account|no.?paid|no.?cloud|recording|recordings|transcript|transcription|timeline|export|silence|zoom|library|recovery|surface|checklist)\b/i;
const CHECKLIST_ARTIFACT_PATTERN =
  /\b(screenshot|report|log|recording|export|transcript|video|image|json|vtt|mp4|webm|gif|wav|m4a|notes?)\b/i;
const RECORDING_SOURCE_PATTERN =
  /\b(tab|browser|region|desktop|screen|window)\b.*\b(capture|record(?:ed|ing)?)\b|\b(capture|record(?:ed|ing)?)\b.*\b(tab|browser|region|desktop|screen|window)\b/i;
const RECORDING_CONTAINER_PATTERN = /\b(mp4|webm)\b/i;
const RECORDING_NOTES_PATTERN =
  /\b(observed|confirmed|verified|recorded|inspected|tested|opened|reviewed)\b.*\b(local|offline|recording|transcript|timeline|export|silence|zoom|library|recovery|browser|chrome|microphone|speaker|capture)\b/i;
const REQUIRED_PUBLICATION_ARTIFACT_TYPES = ["release-notes", "screenshots", "store-text"];
const REQUIRED_STORE_LISTING_DRAFT_PATH = "docs/STORE_LISTING.md";
const PUBLICATION_ARTIFACT_NAME_PATTERNS = {
  "release-notes": /\b(release|notes?|changelog|draft)\b/i,
  screenshots: /\b(screenshot|image|visual|store)\b/i,
  "store-text": /\b(store|listing|description|summary|copy|draft|cws|chrome web store)\b/i,
};
const REQUIRED_LOCAL_LIBRARY_RECOVERY_OPERATIONS = [
  "duplicate-reopen",
  "sidecar-import",
  "bulk-export-delete",
  "orphan-cleanup",
  "missing-media-repair",
];
const REQUIRED_CHECKS = [
  "fresh_install_no_account_or_paid_gates",
  "recording_recovery_real_short_recordings",
  "offline_transcription_real_speakers",
  "timeline_editing_persistence",
  "export_cancel_retry_reveal_real_recordings",
  "audio_silence_real_codecs_and_noise",
  "zoom_preview_export_real_recordings",
  "local_library_recovery",
  "final_surface_no_paid_cloud_or_remote_claims",
];
const CHECK_RECORDING_REF_MINIMUMS = {
  recording_recovery_real_short_recordings: 2,
  offline_transcription_real_speakers: 2,
  timeline_editing_persistence: 1,
  export_cancel_retry_reveal_real_recordings: 1,
  audio_silence_real_codecs_and_noise: 2,
  zoom_preview_export_real_recordings: 1,
  local_library_recovery: 1,
};

const TEMPLATE = {
  kind: "sayless.manualQaEvidence",
  status: "template",
  version: 1,
  releaseVersion: PACKAGE_VERSION,
  automatedEvidencePath: "release-artifacts/release-qa-automated.json",
  automatedEvidenceGeneratedAt: "YYYY-MM-DDTHH:mm:ss.sssZ",
  testedAt: "YYYY-MM-DDTHH:mm:ss.sssZ",
  tester: {
    name: "Manual tester name",
    email: "tester@example.com",
  },
  environment: {
    os: "macOS 15.x / Windows 11 / Linux distro",
    chromeVersion: "Chrome 126.x",
    extensionSource: "build",
    cleanChromeProfile: false,
    unpackedExtensionId: "replace-with-32-character-unpacked-extension-id",
    networkDisabledForOfflineTranscription: false,
  },
  recordings: [
    {
      id: "real-tab-speaker-a",
      source: "tab",
      durationSeconds: 120,
      container: "webm",
      microphone: "built-in mic",
      speakerProfile: "speaker A",
      noiseProfile: "quiet room",
      notes: "Real recording used for transcript/edit/export checks.",
    },
    {
      id: "real-desktop-speaker-b",
      source: "desktop",
      durationSeconds: 300,
      container: "mp4",
      microphone: "external mic",
      speakerProfile: "speaker B",
      noiseProfile: "background noise",
      notes: "Longer recording used for export cancellation and noisy-room QA.",
    },
  ],
  exports: {
    files: REQUIRED_EXPORT_FORMATS.map((format) => ({
      format,
      fileName: `replace-with-${format}-export-file-name`,
      sourceRecordingId: "replace-with-recording-id",
      notes: "Replace with how this export was opened or inspected.",
    })),
    workflow: {
      captionBurnInVerified: false,
      cancelRetryCompleted: false,
      cancelRetryRecordingId: "replace-with-recording-id",
      cancelledExportFormat: "mp4",
      retryCompletedExportFormat: "mp4",
      revealActionVerified: false,
      revealDownloadIdObserved: "replace-with-completed-chrome-download-id-or-ui-observation",
      saveToFileVerifiedOrUnavailable: "verified",
      saveDialogCancellationVerified: false,
      notes: "Replace with export workflow observations and any browser limitations.",
    },
  },
  offlineTranscription: {
    recordingIds: ["replace-with-recording-id-a", "replace-with-recording-id-b"],
    networkDisabledMethod: "Replace with how network access was disabled.",
    externalNetworkProbe: {
      url: "https://example.com/",
      result: "failed",
      observedError: "Replace with the browser fetch/ping error observed in the same Chrome profile.",
      sameChromeProfile: false,
    },
    networkProbeResult:
      "Replace with the failed external fetch/ping observation while the browser profile was offline.",
    bundledModelReadyObserved: false,
    transcriptQualityNotes:
      "Replace with observed real-speaker accuracy, word timing quality, and any residual risk.",
    cachedAfterReopen: false,
    regenerateVerified: false,
    deleteVerified: false,
  },
  silenceSuggestions: {
    recordingIds: ["replace-with-recording-id-a", "replace-with-recording-id-b"],
    codecsOrContainers: ["webm", "mp4"],
    noisyEnvironmentCovered: false,
    suggestedQuietRanges: [
      {
        recordingId: "replace-with-recording-id-a",
        startSeconds: 12.4,
        endSeconds: 15.9,
        observation: "Replace with the quiet pause that was suggested for review.",
      },
      {
        recordingId: "replace-with-recording-id-b",
        startSeconds: 88.1,
        endSeconds: 91.2,
        observation: "Replace with the second quiet pause that was suggested for review.",
      },
    ],
    ignoredNoiseRanges: [
      {
        recordingId: "replace-with-recording-id-b",
        startSeconds: 132.0,
        endSeconds: 136.0,
        observation:
          "Replace with the keyboard/fan/background-noise section that was not suggested as silence.",
      },
    ],
    notes: "Replace with observed silence-suggestion behavior across real codecs and noise.",
  },
  zoom: {
    recordingId: "replace-with-tab-or-region-recording-id",
    sourceHadClickMetadata: false,
    previewVerified: false,
    mp4ExportVerified: false,
    keepRemoveVerified: false,
    persistedAfterReopen: false,
    exportInspection:
      "Replace with how the MP4 export was inspected for the saved zoom framing.",
    notes: "Replace with observed zoom suggestion, preview, and export behavior.",
  },
  localLibraryRecovery: {
    duplicateReopenVerified: false,
    sidecarImportVerified: false,
    bulkExportDeleteVerified: false,
    orphanCleanupVerified: false,
    missingMediaRepairVerified: false,
    operations: [
      {
        type: "duplicate-reopen",
        recordingIds: ["replace-with-recording-id"],
        observation: "Replace with the duplicated recording id and reopen result.",
      },
      {
        type: "sidecar-import",
        recordingIds: ["replace-with-recording-id"],
        observation: "Replace with the imported media plus .sayless-project.json result.",
      },
      {
        type: "bulk-export-delete",
        recordingIds: ["replace-with-recording-id-a", "replace-with-recording-id-b"],
        observation: "Replace with the bulk export/delete result for selected recordings.",
      },
      {
        type: "orphan-cleanup",
        recordingIds: [],
        observation: "Replace with the orphaned local media cleanup observation.",
      },
      {
        type: "missing-media-repair",
        recordingIds: ["replace-with-recording-id"],
        observation: "Replace with the missing-media repair state and recovery result.",
      },
    ],
    notes: "Replace with observed local library recovery behavior.",
  },
  publicationSurface: {
    reviewedArtifacts: [
      {
        type: "release-notes",
        name: "replace-with-release-notes-file-or-draft",
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
        notes: "Replace with what was reviewed.",
        residualRisk: "Replace with any remaining release-note publication risk or state none.",
      },
      {
        type: "screenshots",
        name: "replace-with-screenshot-set-name",
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
          "cloud upload",
          "dashboard",
          "Google Drive",
        ],
        notes: "Replace with what was reviewed.",
        residualRisk: "Replace with any remaining screenshot publication risk or state none.",
      },
      {
        type: "store-text",
        name: REQUIRED_STORE_LISTING_DRAFT_PATH,
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
        notes: "Replace with what was reviewed.",
        residualRisk: "Replace with any remaining store-listing publication risk or state none.",
      },
    ],
    noPaidOrAccountGateClaims: false,
    noHostedDashboardOrCloudUploadClaims: false,
    noGoogleDriveClaims: false,
    noDefaultRemoteTranscriptionClaims: false,
    noUnverifiedMultiSceneAutoZoomClaims: false,
    notes: "Replace with final publication surface observations.",
  },
  checks: Object.fromEntries(
    REQUIRED_CHECKS.map((id) => [
      id,
      {
        status: "template",
        notes: "Replace with what was verified and any residual risk.",
        evidence: [
          {
            artifact: "replace-with-screenshot-file-log-export-or-note",
            recordingIds: ["replace-with-recording-id-when-this-check-uses-recordings"],
            observation: "Replace with the specific observed result for this checklist item.",
          },
        ],
      },
    ]),
  ),
};

const buildTemplate = () => {
  const template = JSON.parse(JSON.stringify(TEMPLATE));
  if (!existsSync(DEFAULT_AUTOMATED_EVIDENCE_PATH)) return template;
  try {
    const automatedEvidence = JSON.parse(readFileSync(DEFAULT_AUTOMATED_EVIDENCE_PATH, "utf8"));
    if (!automatedEvidenceCanPrefillTemplate(automatedEvidence)) {
      return template;
    }
    if (isIsoDate(automatedEvidence?.generatedAt)) {
      template.automatedEvidenceGeneratedAt = automatedEvidence.generatedAt;
    }
    if (nonEmptyString(automatedEvidence?.build?.path)) {
      template.environment.extensionSource = automatedEvidence.build.path;
    }
  } catch {}
  return template;
};

const automatedEvidenceCanPrefillTemplate = (automatedEvidence) => {
  if (automatedEvidence?.kind !== "sayless.releaseQaAutomated" || automatedEvidence?.status !== "passed") {
    return false;
  }
  if (automatedEvidence.releaseVersion !== PACKAGE_VERSION) return false;
  if (automatedEvidence.packageLockVersion !== PACKAGE_LOCK_VERSION) return false;
  if (automatedEvidence.packageLockRootVersion !== PACKAGE_LOCK_ROOT_VERSION) return false;
  if (automatedEvidence.manifestVersion !== SOURCE_MANIFEST_VERSION) return false;
  if (automatedEvidence.buildManifestVersion !== automatedEvidence.releaseVersion) return false;

  const commandRecords = Array.isArray(automatedEvidence.commands) ? automatedEvidence.commands : [];
  const commandsByLabel = new Map(
    commandRecords.map((command) => [command?.label, command]).filter(([label]) => Boolean(label)),
  );
  for (const label of REQUIRED_AUTOMATED_COMMANDS) {
    const command = commandsByLabel.get(label);
    if (
      command?.status !== "passed" ||
      !commandMatchesExpected(command?.command, EXPECTED_AUTOMATED_COMMANDS.get(label)) ||
      !Number.isFinite(command?.durationMs) ||
      command.durationMs < 0
    ) {
      return false;
    }
  }
  for (const label of CONDITIONAL_AUTOMATED_COMMANDS) {
    const completedCommand = commandsByLabel.get(label);
    const skippedCommand = Array.isArray(automatedEvidence.skippedCommands)
      ? automatedEvidence.skippedCommands.find((command) => command?.label === label)
      : null;
    if (completedCommand && skippedCommand) return false;
    if (completedCommand) {
      if (
        completedCommand.status !== "passed" ||
        !commandMatchesExpected(completedCommand.command, EXPECTED_AUTOMATED_COMMANDS.get(label)) ||
        !Number.isFinite(completedCommand.durationMs) ||
        completedCommand.durationMs < 0
      ) {
        return false;
      }
      continue;
    }
    if (!usefulString(skippedCommand?.reason)) return false;
  }

  const currentWorkingTree = gitWorktreeFingerprint();
  const recordedWorkingTree = automatedEvidence.git?.workingTree;
  if (
    recordedWorkingTree?.sha256 !== currentWorkingTree.sha256 ||
    recordedWorkingTree?.fileCount !== currentWorkingTree.fileCount ||
    recordedWorkingTree?.statusSha256 !== currentWorkingTree.statusSha256
  ) {
    return false;
  }

  const buildPath = nonEmptyString(automatedEvidence?.build?.path)
    ? resolveRootPath(automatedEvidence.build.path)
    : null;
  if (!buildPath || !existsSync(buildPath) || !isCanonicalRelativePath(automatedEvidence.build.path, "build")) {
    return false;
  }
  const buildManifestPath = join(buildPath, "manifest.json");
  if (!existsSync(buildManifestPath)) return false;
  const buildManifest = readJson(buildManifestPath, "current build manifest", []);
  if (buildManifest?.version !== automatedEvidence.buildManifestVersion) return false;
  const expectedSurface = releaseManifestSurface(buildManifest);
  for (const [field, expectedValue] of Object.entries(expectedSurface)) {
    const actual = automatedEvidence.releaseSurface?.[field];
    if (Array.isArray(expectedValue)) {
      if (!arraysEqual(sortedStrings(actual), expectedValue)) return false;
    } else if (actual !== expectedValue) {
      return false;
    }
  }
  for (const field of [
    "hasOauth2",
    "hasExternallyConnectable",
    "hasIdentityPermission",
    "hasGoogleDrivePermission",
    "hasRemoteConnectSrc",
  ]) {
    if (automatedEvidence.releaseSurface?.[field] !== false) return false;
  }
  const build = dirFingerprint(buildPath);
  if (
    build.sha256 !== automatedEvidence.build.sha256 ||
    build.fileCount !== automatedEvidence.build.fileCount ||
    dirSize(buildPath) !== automatedEvidence.build.bytes ||
    automatedEvidence.build.formattedBytes !== formatBytes(automatedEvidence.build.bytes)
  ) {
    return false;
  }

  const bundledWhisperPath = nonEmptyString(automatedEvidence?.bundledWhisper?.path)
    ? resolveRootPath(automatedEvidence.bundledWhisper.path)
    : null;
  if (
    !bundledWhisperPath ||
    !existsSync(bundledWhisperPath) ||
    !isCanonicalRelativePath(automatedEvidence.bundledWhisper.path, "build/assets/whisper")
  ) {
    return false;
  }
  const bundledWhisper = dirFingerprint(bundledWhisperPath);
  return (
    bundledWhisper.sha256 === automatedEvidence.bundledWhisper.sha256 &&
    bundledWhisper.fileCount === automatedEvidence.bundledWhisper.fileCount &&
    dirSize(bundledWhisperPath) === automatedEvidence.bundledWhisper.bytes &&
    automatedEvidence.bundledWhisper.formattedBytes ===
      formatBytes(automatedEvidence.bundledWhisper.bytes)
  );
};

const printTemplate = () => {
  console.log(JSON.stringify(buildTemplate(), null, 2));
};

const writeFileAtomic = (path, bytes) => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const writeTemplate = ({ force = false } = {}) => {
  if (existsSync(DEFAULT_EVIDENCE_PATH) && !force) {
    fail([
      `manual QA evidence file already exists: ${relative(ROOT, DEFAULT_EVIDENCE_PATH)}`,
      "Use npm run qa:release:manual:template:force only when intentionally replacing an unsubmitted template.",
    ]);
  }
  mkdirSync(dirname(DEFAULT_EVIDENCE_PATH), { recursive: true });
  writeFileAtomic(DEFAULT_EVIDENCE_PATH, `${JSON.stringify(buildTemplate(), null, 2)}\n`);
  console.log(`Manual QA evidence template written: ${relative(ROOT, DEFAULT_EVIDENCE_PATH)}`);
};

const fail = (errors) => {
  for (const error of errors) {
    console.error(`MANUAL QA EVIDENCE FAIL: ${error}`);
  }
  process.exit(1);
};

const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const usefulString = (value) => typeof value === "string" && value.trim().length >= 10;
const timestampMs = (value) => (isIsoDate(value) ? Date.parse(value) : null);
const arrayFrom = (value) => (Array.isArray(value) ? value : []);
const PLACEHOLDER_PATTERNS = [
  /^manual tester name$/i,
  /^tester@example\.com$/i,
  /^macOS 15\.x \/ Windows 11 \/ Linux distro$/i,
  /^Chrome 126\.x$/i,
  /^replace-with-32-character-unpacked-extension-id$/i,
  /^real-tab-speaker-a$/i,
  /^real-desktop-speaker-b$/i,
  /^speaker [ab]$/i,
  /^quiet room$/i,
  /^background noise$/i,
  /^built-in mic$/i,
  /^external mic$/i,
  /^real recording used for transcript\/edit\/export checks\.$/i,
  /^longer recording used for export cancellation and noisy-room QA\.$/i,
  /^replace with /i,
  /^replace-with-/i,
  /^replace with how network access was disabled\.$/i,
  /^replace with observed /i,
  /^replace with what was reviewed\.$/i,
  /^replace with final publication surface observations\.$/i,
  /screenshot\/file name/i,
  /short observation/i,
  /how this export was opened or inspected/i,
  /export workflow observations/i,
  /schema validation fixture/i,
  /^YYYY-MM-DDTHH:mm:ss\.sssZ$/i,
];

const isPlaceholderString = (value) =>
  typeof value === "string" &&
  PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));

const rejectPlaceholder = (label, value, errors) => {
  if (isPlaceholderString(value)) {
    errors.push(`${label} still contains template or fixture placeholder text.`);
  }
};

const publicationArtifactNameMatchesType = (type, name) => {
  const pattern = PUBLICATION_ARTIFACT_NAME_PATTERNS[type];
  return !pattern || pattern.test(name);
};

const sortedStrings = (value) =>
  arrayFrom(value)
    .filter((item) => typeof item === "string")
    .slice()
    .sort();

const arraysEqual = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const releaseManifestSurface = (manifest) => {
  const permissions = sortedStrings(manifest?.permissions);
  const optionalPermissions = sortedStrings(manifest?.optional_permissions);
  const hostPermissions = sortedStrings(manifest?.host_permissions);
  const allPermissions = new Set([...permissions, ...optionalPermissions]);
  const csp =
    typeof manifest?.content_security_policy?.extension_pages === "string"
      ? manifest.content_security_policy.extension_pages
      : "";
  return {
    permissions,
    optionalPermissions,
    hostPermissions,
    hasOauth2: Boolean(manifest?.oauth2),
    hasExternallyConnectable: Boolean(manifest?.externally_connectable),
    hasIdentityPermission: allPermissions.has("identity"),
    hasGoogleDrivePermission: allPermissions.has("drive.file"),
    hasRemoteConnectSrc:
      /\bconnect-src\b[^;]*(?:https?:|wss?:)/i.test(csp) ||
      /\bconnect-src\b[^;]*\*/i.test(csp),
    contentSecurityPolicyExtensionPages: csp,
  };
};

const validateReleaseSurface = (actual, expected, errors) => {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    errors.push("automated QA evidence releaseSurface is required.");
    return;
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (Array.isArray(expectedValue)) {
      if (!arraysEqual(sortedStrings(actual[field]), expectedValue)) {
        errors.push(`automated QA evidence releaseSurface.${field} must match the current build manifest.`);
      }
      continue;
    }
    if (actual[field] !== expectedValue) {
      errors.push(`automated QA evidence releaseSurface.${field} must match the current build manifest.`);
    }
  }
  for (const field of [
    "hasOauth2",
    "hasExternallyConnectable",
    "hasIdentityPermission",
    "hasGoogleDrivePermission",
    "hasRemoteConnectSrc",
  ]) {
    if (actual[field] !== false) {
      errors.push(`automated QA evidence releaseSurface.${field} must be false.`);
    }
  }
};

const commandMatchesExpected = (actual, expected) =>
  actual === expected || actual === expected.replace(/^npm\b/, "npm.cmd");

const readJson = (path, label, errors) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
};

const resolveRootPath = (path) => (isAbsolute(path) ? path : resolve(ROOT, path));
const isCanonicalRelativePath = (value, expected) => value === expected;

const isExternalHttpUrl = (value) => {
  if (!nonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
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

const gitOutput = (args) => {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitLines = (args) => {
  const output = gitOutput(args);
  return output ? output.split("\n").map((line) => line.trim()).filter(Boolean) : [];
};

const gitWorktreeFingerprint = () => {
  const status = gitLines(["status", "--porcelain", "--untracked-files=all"]);
  const paths = new Set([
    ...gitLines(["ls-files", "-m", "-d", "-o", "--exclude-standard"]),
    ...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB"]),
  ]);
  const hash = createHash("sha256");
  const sortedPaths = [...paths].sort();
  for (const path of sortedPaths) {
    const absolutePath = join(ROOT, path);
    hash.update(path);
    hash.update("\0");
    if (!existsSync(absolutePath)) {
      hash.update("deleted");
      hash.update("\0");
      continue;
    }
    const stat = statSync(absolutePath);
    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  return {
    sha256: hash.digest("hex"),
    fileCount: sortedPaths.length,
    statusSha256: createHash("sha256").update(status.join("\n")).digest("hex"),
  };
};

const dirSize = (dir) =>
  walkFiles(dir).reduce((total, file) => total + file.size, 0);

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const validateAutomatedEvidence = (evidence, errors) => {
  if (!nonEmptyString(evidence?.automatedEvidencePath)) return null;

  const automatedEvidencePath = resolveRootPath(evidence.automatedEvidencePath);
  if (
    !isCanonicalRelativePath(
      evidence.automatedEvidencePath,
      "release-artifacts/release-qa-automated.json",
    ) ||
    automatedEvidencePath !== DEFAULT_AUTOMATED_EVIDENCE_PATH
  ) {
    errors.push(
      `automatedEvidencePath must point to ${relative(
        ROOT,
        DEFAULT_AUTOMATED_EVIDENCE_PATH,
      )}.`,
    );
  }
  if (!existsSync(automatedEvidencePath)) {
    errors.push(`automatedEvidencePath does not exist: ${relative(ROOT, automatedEvidencePath)}`);
    return null;
  }

  const automatedEvidence = readJson(automatedEvidencePath, "automated QA evidence", errors);
  if (!automatedEvidence) return null;

  if (automatedEvidence.kind !== "sayless.releaseQaAutomated") {
    errors.push('automated QA evidence kind must be "sayless.releaseQaAutomated".');
  }
  if (automatedEvidence.status !== "passed") {
    errors.push('automated QA evidence status must be "passed".');
  }
  if (!isIsoDate(automatedEvidence.generatedAt)) {
    errors.push("automated QA evidence generatedAt must be an ISO UTC timestamp.");
  } else if (automatedEvidence.generatedAt !== evidence.automatedEvidenceGeneratedAt) {
    errors.push(
      `automatedEvidenceGeneratedAt must match ${relative(ROOT, automatedEvidencePath)} generatedAt (${automatedEvidence.generatedAt}).`,
    );
  }
  if (!isIsoDate(automatedEvidence.startedAt)) {
    errors.push("automated QA evidence startedAt must be an ISO UTC timestamp.");
  }
  const automatedStartedAtMs = timestampMs(automatedEvidence.startedAt);
  const automatedGeneratedAtMs = timestampMs(automatedEvidence.generatedAt);
  if (
    automatedStartedAtMs !== null &&
    automatedGeneratedAtMs !== null &&
    automatedGeneratedAtMs < automatedStartedAtMs
  ) {
    errors.push("automated QA evidence generatedAt must be at or after startedAt.");
  }
  if (automatedStartedAtMs !== null && automatedStartedAtMs > Date.now() + 5 * 60 * 1000) {
    errors.push("automated QA evidence startedAt must not be in the future.");
  }
  if (!Number.isFinite(automatedEvidence.durationMs) || automatedEvidence.durationMs <= 0) {
    errors.push("automated QA evidence durationMs must be a positive number.");
  }
  if (
    automatedStartedAtMs !== null &&
    automatedGeneratedAtMs !== null &&
    Number.isFinite(automatedEvidence.durationMs) &&
    automatedEvidence.durationMs > 0
  ) {
    const runWindowMs = automatedGeneratedAtMs - automatedStartedAtMs;
    if (Math.abs(runWindowMs - automatedEvidence.durationMs) > AUTOMATED_RUN_WINDOW_TOLERANCE_MS) {
      errors.push("automated QA evidence durationMs must match the startedAt/generatedAt run window.");
    }
  }
  if (!nonEmptyString(automatedEvidence?.git?.branch)) {
    errors.push("automated QA evidence git.branch is required.");
  }
  if (!nonEmptyString(automatedEvidence?.git?.commit)) {
    errors.push("automated QA evidence git.commit is required.");
  } else if (!/^[0-9a-f]{40}$/i.test(automatedEvidence.git.commit)) {
    errors.push("automated QA evidence git.commit must be a 40-character SHA-1 commit.");
  }
  if (typeof automatedEvidence?.git?.dirty !== "boolean") {
    errors.push("automated QA evidence git.dirty must be a boolean.");
  }
  if (!automatedEvidence?.git?.workingTree || typeof automatedEvidence.git.workingTree !== "object") {
    errors.push("automated QA evidence git.workingTree is required.");
  } else {
    const workingTree = automatedEvidence.git.workingTree;
    if (!nonEmptyString(workingTree.sha256)) {
      errors.push("automated QA evidence git.workingTree.sha256 is required.");
    }
    if (!Number.isFinite(workingTree.fileCount) || workingTree.fileCount < 0) {
      errors.push("automated QA evidence git.workingTree.fileCount must be a non-negative number.");
    }
    if (!nonEmptyString(workingTree.statusSha256)) {
      errors.push("automated QA evidence git.workingTree.statusSha256 is required.");
    }
    const currentWorkingTree = gitWorktreeFingerprint();
    if (nonEmptyString(workingTree.sha256) && workingTree.sha256 !== currentWorkingTree.sha256) {
      errors.push("automated QA evidence git.workingTree.sha256 must match the current git worktree.");
    }
    if (
      Number.isFinite(workingTree.fileCount) &&
      workingTree.fileCount !== currentWorkingTree.fileCount
    ) {
      errors.push("automated QA evidence git.workingTree.fileCount must match the current git worktree.");
    }
    if (
      nonEmptyString(workingTree.statusSha256) &&
      workingTree.statusSha256 !== currentWorkingTree.statusSha256
    ) {
      errors.push("automated QA evidence git.workingTree.statusSha256 must match the current git status.");
    }
  }
  if (automatedEvidence.releaseVersion !== evidence.releaseVersion) {
    errors.push("automated QA evidence releaseVersion must match manual evidence releaseVersion.");
  }
  if (automatedEvidence.releaseVersion !== PACKAGE_VERSION) {
    errors.push(`automated QA evidence releaseVersion must match package.json version (${PACKAGE_VERSION}).`);
  }
  if (automatedEvidence.packageLockVersion !== PACKAGE_LOCK_VERSION) {
    errors.push(
      `automated QA evidence packageLockVersion must match package-lock.json version (${PACKAGE_LOCK_VERSION}).`,
    );
  }
  if (automatedEvidence.packageLockRootVersion !== PACKAGE_LOCK_ROOT_VERSION) {
    errors.push(
      `automated QA evidence packageLockRootVersion must match package-lock root version (${PACKAGE_LOCK_ROOT_VERSION}).`,
    );
  }
  if (automatedEvidence.packageLockVersion !== automatedEvidence.releaseVersion) {
    errors.push("automated QA evidence packageLockVersion must match releaseVersion.");
  }
  if (automatedEvidence.packageLockRootVersion !== automatedEvidence.releaseVersion) {
    errors.push("automated QA evidence packageLockRootVersion must match releaseVersion.");
  }
  if (automatedEvidence.manifestVersion !== SOURCE_MANIFEST_VERSION) {
    errors.push(
      `automated QA evidence manifestVersion must match src/manifest.json version (${SOURCE_MANIFEST_VERSION}).`,
    );
  }
  if (automatedEvidence.buildManifestVersion !== automatedEvidence.releaseVersion) {
    errors.push("automated QA evidence buildManifestVersion must match releaseVersion.");
  }

  const commandRecords = Array.isArray(automatedEvidence.commands) ? automatedEvidence.commands : [];
  const allowedCommandLabels = new Set([
    ...REQUIRED_AUTOMATED_COMMANDS,
    ...CONDITIONAL_AUTOMATED_COMMANDS,
  ]);
  const seenCommandLabels = new Set();
  let totalCommandDurationMs = 0;
  for (const [index, command] of commandRecords.entries()) {
    if (!nonEmptyString(command?.label)) {
      errors.push(`automated QA evidence commands[${index}].label is required.`);
      continue;
    }
    if (!allowedCommandLabels.has(command.label)) {
      errors.push(`automated QA evidence contains unexpected command: ${command.label}.`);
    }
    if (seenCommandLabels.has(command.label)) {
      errors.push(`automated QA evidence contains duplicate command: ${command.label}.`);
    }
    seenCommandLabels.add(command.label);
    if (Number.isFinite(command.durationMs) && command.durationMs >= 0) {
      totalCommandDurationMs += command.durationMs;
    }
  }
  if (
    Number.isFinite(automatedEvidence.durationMs) &&
    automatedEvidence.durationMs > 0 &&
    totalCommandDurationMs > automatedEvidence.durationMs + AUTOMATED_RUN_WINDOW_TOLERANCE_MS
  ) {
    errors.push("automated QA evidence command durations must not exceed total durationMs.");
  }
  const commandsByLabel = new Map(
    commandRecords.map((command) => [command?.label, command]).filter(([label]) => Boolean(label)),
  );
  for (const label of REQUIRED_AUTOMATED_COMMANDS) {
    const command = commandsByLabel.get(label);
    if (!command) {
      errors.push(`automated QA evidence is missing completed command: ${label}.`);
      continue;
    }
    if (command.status !== "passed") {
      errors.push(`automated QA evidence command ${label} must have status "passed".`);
    }
    if (!nonEmptyString(command.command)) {
      errors.push(`automated QA evidence command ${label} must include the executed command.`);
    } else if (!commandMatchesExpected(command.command, EXPECTED_AUTOMATED_COMMANDS.get(label))) {
      errors.push(
        `automated QA evidence command ${label} must be "${EXPECTED_AUTOMATED_COMMANDS.get(label)}".`,
      );
    }
    if (!Number.isFinite(command.durationMs) || command.durationMs < 0) {
      errors.push(`automated QA evidence command ${label} must include a non-negative durationMs.`);
    }
  }

  const skippedCommandRecords = Array.isArray(automatedEvidence.skippedCommands)
    ? automatedEvidence.skippedCommands
    : [];
  const skippedCommandsByLabel = new Map(
    skippedCommandRecords.map((command) => [command?.label, command]).filter(([label]) => Boolean(label)),
  );
  for (const label of CONDITIONAL_AUTOMATED_COMMANDS) {
    const completedCommand = commandsByLabel.get(label);
    const skippedCommand = skippedCommandsByLabel.get(label);
    if (completedCommand && skippedCommand) {
      errors.push(`automated QA evidence command ${label} cannot be both completed and skipped.`);
      continue;
    }
    if (completedCommand) {
      if (completedCommand.status !== "passed") {
        errors.push(`automated QA evidence command ${label} must have status "passed" when completed.`);
      }
      if (!nonEmptyString(completedCommand.command)) {
        errors.push(`automated QA evidence command ${label} must include the executed command when completed.`);
      } else if (
        !commandMatchesExpected(completedCommand.command, EXPECTED_AUTOMATED_COMMANDS.get(label))
      ) {
        errors.push(
          `automated QA evidence command ${label} must be "${EXPECTED_AUTOMATED_COMMANDS.get(label)}" when completed.`,
        );
      }
      if (!Number.isFinite(completedCommand.durationMs) || completedCommand.durationMs < 0) {
        errors.push(
          `automated QA evidence command ${label} must include a non-negative durationMs when completed.`,
        );
      }
      continue;
    }
    if (skippedCommand) {
      if (!usefulString(skippedCommand.reason)) {
        errors.push(`automated QA evidence skipped command ${label} must include a useful reason.`);
      }
      continue;
    }
    errors.push(`automated QA evidence must either run or explicitly skip ${label}.`);
  }
  if (!Number.isFinite(automatedEvidence?.build?.bytes) || automatedEvidence.build.bytes <= 0) {
    errors.push("automated QA evidence must include a positive build.bytes value.");
  }
  if (automatedEvidence?.build?.formattedBytes !== formatBytes(automatedEvidence?.build?.bytes || 0)) {
    errors.push("automated QA evidence build.formattedBytes must match build.bytes.");
  }
  if (!nonEmptyString(automatedEvidence?.build?.sha256)) {
    errors.push("automated QA evidence must include build.sha256.");
  }
  if (!Number.isFinite(automatedEvidence?.build?.fileCount) || automatedEvidence.build.fileCount <= 0) {
    errors.push("automated QA evidence must include a positive build.fileCount value.");
  }
  if (!nonEmptyString(automatedEvidence?.build?.path)) {
    errors.push("automated QA evidence must include build.path.");
  } else if (!isCanonicalRelativePath(automatedEvidence.build.path, "build")) {
    errors.push("automated QA evidence build.path must be the canonical relative build path.");
  }
  if (
    !Number.isFinite(automatedEvidence?.bundledWhisper?.bytes) ||
    automatedEvidence.bundledWhisper.bytes <= 0
  ) {
    errors.push("automated QA evidence must include a positive bundledWhisper.bytes value.");
  }
  if (
    automatedEvidence?.bundledWhisper?.formattedBytes !==
    formatBytes(automatedEvidence?.bundledWhisper?.bytes || 0)
  ) {
    errors.push("automated QA evidence bundledWhisper.formattedBytes must match bundledWhisper.bytes.");
  }
  if (!nonEmptyString(automatedEvidence?.bundledWhisper?.path)) {
    errors.push("automated QA evidence must include bundledWhisper.path.");
  } else if (
    !isCanonicalRelativePath(automatedEvidence.bundledWhisper.path, "build/assets/whisper")
  ) {
    errors.push("automated QA evidence bundledWhisper.path must be the canonical relative build/assets/whisper path.");
  }
  if (!nonEmptyString(automatedEvidence?.bundledWhisper?.sha256)) {
    errors.push("automated QA evidence must include bundledWhisper.sha256.");
  }
  if (
    !Number.isFinite(automatedEvidence?.bundledWhisper?.fileCount) ||
    automatedEvidence.bundledWhisper.fileCount <= 0
  ) {
    errors.push("automated QA evidence must include a positive bundledWhisper.fileCount value.");
  }

  const buildPath = nonEmptyString(automatedEvidence?.build?.path)
    ? resolveRootPath(automatedEvidence.build.path)
    : null;
  if (!buildPath || !existsSync(buildPath)) {
    errors.push("current build path from automated QA evidence does not exist.");
  } else if (nonEmptyString(automatedEvidence?.build?.sha256)) {
    const buildManifestPath = join(buildPath, "manifest.json");
    if (!existsSync(buildManifestPath)) {
      errors.push("current build/manifest.json is missing.");
    } else {
      const buildManifest = readJson(buildManifestPath, "current build manifest", errors);
      if (buildManifest?.version !== automatedEvidence.buildManifestVersion) {
        errors.push("current build manifest version does not match automated QA evidence.");
      }
      validateReleaseSurface(
        automatedEvidence.releaseSurface,
        releaseManifestSurface(buildManifest),
        errors,
      );
    }
    const currentBuild = dirFingerprint(buildPath);
    const currentBuildBytes = dirSize(buildPath);
    if (currentBuild.sha256 !== automatedEvidence.build.sha256) {
      errors.push(
        `current build fingerprint does not match automated QA evidence (${automatedEvidence.build.sha256}).`,
      );
    }
    if (currentBuild.fileCount !== automatedEvidence.build.fileCount) {
      errors.push(
        `current build file count (${currentBuild.fileCount}) does not match automated QA evidence (${automatedEvidence.build.fileCount}).`,
      );
    }
    if (currentBuildBytes !== automatedEvidence.build.bytes) {
      errors.push(
        `current build byte size (${currentBuildBytes}) does not match automated QA evidence (${automatedEvidence.build.bytes}).`,
      );
    }
  }
  const bundledWhisperPath = nonEmptyString(automatedEvidence?.bundledWhisper?.path)
    ? resolveRootPath(automatedEvidence.bundledWhisper.path)
    : null;
  if (!bundledWhisperPath || !existsSync(bundledWhisperPath)) {
    errors.push("current bundled Whisper path from automated QA evidence does not exist.");
  } else if (nonEmptyString(automatedEvidence?.bundledWhisper?.sha256)) {
    const currentBundledWhisper = dirFingerprint(bundledWhisperPath);
    const currentBundledWhisperBytes = dirSize(bundledWhisperPath);
    if (currentBundledWhisper.sha256 !== automatedEvidence.bundledWhisper.sha256) {
      errors.push(
        `current bundled Whisper fingerprint does not match automated QA evidence (${automatedEvidence.bundledWhisper.sha256}).`,
      );
    }
    if (currentBundledWhisper.fileCount !== automatedEvidence.bundledWhisper.fileCount) {
      errors.push(
        `current bundled Whisper file count (${currentBundledWhisper.fileCount}) does not match automated QA evidence (${automatedEvidence.bundledWhisper.fileCount}).`,
      );
    }
    if (currentBundledWhisperBytes !== automatedEvidence.bundledWhisper.bytes) {
      errors.push(
        `current bundled Whisper byte size (${currentBundledWhisperBytes}) does not match automated QA evidence (${automatedEvidence.bundledWhisper.bytes}).`,
      );
    }
  }
  return automatedEvidence;
};

const validate = (evidence) => {
  const errors = [];
  if (evidence?.kind !== "sayless.manualQaEvidence") {
    errors.push('kind must be "sayless.manualQaEvidence".');
  }
  if (evidence?.status !== "passed") {
    errors.push('manual QA evidence status must be "passed".');
  }
  if (evidence?.version !== 1) {
    errors.push("version must be 1.");
  }
  if (!nonEmptyString(evidence?.releaseVersion)) {
    errors.push("releaseVersion is required.");
  } else if (evidence.releaseVersion !== PACKAGE_VERSION) {
    errors.push(`releaseVersion must match package.json version (${PACKAGE_VERSION}).`);
  }
  if (!isIsoDate(evidence?.testedAt)) {
    errors.push("testedAt must be an ISO UTC timestamp.");
  }
  if (!isIsoDate(evidence?.automatedEvidenceGeneratedAt)) {
    errors.push("automatedEvidenceGeneratedAt must be an ISO UTC timestamp.");
  }
  const testedAtMs = timestampMs(evidence?.testedAt);
  const automatedEvidenceGeneratedAtMs = timestampMs(evidence?.automatedEvidenceGeneratedAt);
  if (
    testedAtMs !== null &&
    automatedEvidenceGeneratedAtMs !== null &&
    testedAtMs < automatedEvidenceGeneratedAtMs
  ) {
    errors.push("testedAt must be at or after automatedEvidenceGeneratedAt.");
  }
  if (testedAtMs !== null && testedAtMs > Date.now() + 5 * 60 * 1000) {
    errors.push("testedAt must not be in the future.");
  }
  if (!nonEmptyString(evidence?.automatedEvidencePath)) {
    errors.push("automatedEvidencePath is required.");
  }
  const automatedEvidence = validateAutomatedEvidence(evidence, errors);
  if (!nonEmptyString(evidence?.tester?.name)) {
    errors.push("tester.name is required.");
  } else {
    rejectPlaceholder("tester.name", evidence.tester.name, errors);
  }
  if (nonEmptyString(evidence?.tester?.email)) {
    rejectPlaceholder("tester.email", evidence.tester.email, errors);
  }
  if (!nonEmptyString(evidence?.environment?.os)) {
    errors.push("environment.os is required.");
  } else {
    rejectPlaceholder("environment.os", evidence.environment.os, errors);
  }
  if (!nonEmptyString(evidence?.environment?.chromeVersion)) {
    errors.push("environment.chromeVersion is required.");
  } else {
    rejectPlaceholder("environment.chromeVersion", evidence.environment.chromeVersion, errors);
  }
  if (!nonEmptyString(evidence?.environment?.extensionSource)) {
    errors.push("environment.extensionSource is required.");
  } else {
    rejectPlaceholder("environment.extensionSource", evidence.environment.extensionSource, errors);
    const expectedBuildPath = nonEmptyString(automatedEvidence?.build?.path)
      ? resolveRootPath(automatedEvidence.build.path)
      : null;
    const actualExtensionSource = resolveRootPath(evidence.environment.extensionSource);
    if (
      !isCanonicalRelativePath(evidence.environment.extensionSource, "build") ||
      expectedBuildPath &&
      (!isCanonicalRelativePath(evidence.environment.extensionSource, automatedEvidence.build.path) ||
        actualExtensionSource !== expectedBuildPath)
    ) {
      errors.push(
        `environment.extensionSource must reference the automated QA build path (${relative(ROOT, expectedBuildPath)}).`,
      );
    }
  }
  if (evidence?.environment?.cleanChromeProfile !== true) {
    errors.push("environment.cleanChromeProfile must be true.");
  }
  if (!nonEmptyString(evidence?.environment?.unpackedExtensionId)) {
    errors.push("environment.unpackedExtensionId is required.");
  } else {
    rejectPlaceholder(
      "environment.unpackedExtensionId",
      evidence.environment.unpackedExtensionId,
      errors,
    );
    if (!/^[a-p]{32}$/.test(evidence.environment.unpackedExtensionId)) {
      errors.push("environment.unpackedExtensionId must be a 32-character Chrome extension id.");
    }
  }
  if (evidence?.environment?.networkDisabledForOfflineTranscription !== true) {
    errors.push("environment.networkDisabledForOfflineTranscription must be true.");
  }

  const recordings = Array.isArray(evidence?.recordings) ? evidence.recordings : [];
  if (recordings.length < 2) {
    errors.push("recordings must include at least two real recordings.");
  }
  const speakerProfiles = new Set();
  const containers = new Set();
  const sources = new Set();
  const seenRecordingIds = new Set();
  let hasLongRecording = false;
  for (const [index, recording] of recordings.entries()) {
    if (!nonEmptyString(recording?.id)) {
      errors.push(`recordings[${index}].id is required.`);
    } else {
      rejectPlaceholder(`recordings[${index}].id`, recording.id, errors);
      if (seenRecordingIds.has(recording.id)) {
        errors.push(`recordings[${index}].id must be unique.`);
      }
      seenRecordingIds.add(recording.id);
    }
    if (!nonEmptyString(recording?.source)) {
      errors.push(`recordings[${index}].source is required.`);
    } else {
      rejectPlaceholder(`recordings[${index}].source`, recording.source, errors);
      if (!RECORDING_SOURCE_PATTERN.test(recording.source)) {
        errors.push(
          `recordings[${index}].source must describe a tab, browser, region, desktop, screen, or window capture/recording.`,
        );
      }
      sources.add(recording.source.toLowerCase());
    }
    if (!Number.isFinite(recording?.durationSeconds) || recording.durationSeconds < 30) {
      errors.push(`recordings[${index}].durationSeconds must be at least 30.`);
    } else if (recording.durationSeconds >= 180) {
      hasLongRecording = true;
    }
    if (!nonEmptyString(recording?.container)) {
      errors.push(`recordings[${index}].container is required.`);
    } else {
      rejectPlaceholder(`recordings[${index}].container`, recording.container, errors);
      if (!RECORDING_CONTAINER_PATTERN.test(recording.container)) {
        errors.push(`recordings[${index}].container must identify an MP4 or WebM recording container.`);
      }
      containers.add(recording.container.toLowerCase());
    }
    if (!nonEmptyString(recording?.speakerProfile)) {
      errors.push(`recordings[${index}].speakerProfile is required.`);
    } else {
      rejectPlaceholder(`recordings[${index}].speakerProfile`, recording.speakerProfile, errors);
      speakerProfiles.add(recording.speakerProfile.toLowerCase());
    }
    if (nonEmptyString(recording?.microphone)) {
      rejectPlaceholder(`recordings[${index}].microphone`, recording.microphone, errors);
    }
    if (nonEmptyString(recording?.noiseProfile)) {
      rejectPlaceholder(`recordings[${index}].noiseProfile`, recording.noiseProfile, errors);
    }
    if (!usefulString(recording?.notes)) {
      errors.push(`recordings[${index}].notes must describe what was tested.`);
    } else {
      rejectPlaceholder(`recordings[${index}].notes`, recording.notes, errors);
      if (!RECORDING_NOTES_PATTERN.test(recording.notes)) {
        errors.push(
          `recordings[${index}].notes must describe observed, confirmed, verified, recorded, inspected, tested, opened, or reviewed local/offline recording behavior.`,
        );
      }
    }
  }
  if (speakerProfiles.size < 2) {
    errors.push("recordings must cover at least two speaker profiles.");
  }
  if (![...containers].some((container) => /mp4/.test(container))) {
    errors.push("recordings must include at least one MP4 recording.");
  }
  if (![...containers].some((container) => /webm/.test(container))) {
    errors.push("recordings must include at least one WebM recording.");
  }
  if (![...sources].some((source) => /tab|browser|region/.test(source))) {
    errors.push("recordings must include at least one tab/browser/region recording.");
  }
  if (![...sources].some((source) => /desktop|screen|window/.test(source))) {
    errors.push("recordings must include at least one desktop/screen/window recording.");
  }
  if (!hasLongRecording) {
    errors.push("recordings must include at least one recording of 180 seconds or longer.");
  }

  const recordingIds = new Set(recordings.map((recording) => recording?.id).filter(nonEmptyString));
  const exportFiles = Array.isArray(evidence?.exports?.files) ? evidence.exports.files : [];
  if (exportFiles.length < REQUIRED_EXPORT_FORMATS.length) {
    errors.push("exports.files must include each required release export format.");
  }
  const exportFormats = new Set();
  const exportFileNames = new Set();
  for (const [index, exportedFile] of exportFiles.entries()) {
    const format = typeof exportedFile?.format === "string" ? exportedFile.format.toLowerCase() : "";
    if (!format) {
      errors.push(`exports.files[${index}].format is required.`);
    } else {
      rejectPlaceholder(`exports.files[${index}].format`, exportedFile.format, errors);
      exportFormats.add(format);
    }
    if (!nonEmptyString(exportedFile?.fileName)) {
      errors.push(`exports.files[${index}].fileName is required.`);
    } else {
      rejectPlaceholder(`exports.files[${index}].fileName`, exportedFile.fileName, errors);
      const normalizedFileName = exportedFile.fileName.trim().toLowerCase();
      if (exportFileNames.has(normalizedFileName)) {
        errors.push(`exports.files[${index}].fileName must be unique within exports.files.`);
      } else {
        exportFileNames.add(normalizedFileName);
      }
      const fileNamePattern = EXPORT_FILE_NAME_PATTERNS[format];
      if (fileNamePattern && !fileNamePattern.test(exportedFile.fileName)) {
        errors.push(`exports.files[${index}].fileName must match the ${format} export format.`);
      }
    }
    if (!nonEmptyString(exportedFile?.sourceRecordingId)) {
      errors.push(`exports.files[${index}].sourceRecordingId is required.`);
    } else {
      rejectPlaceholder(`exports.files[${index}].sourceRecordingId`, exportedFile.sourceRecordingId, errors);
      if (!recordingIds.has(exportedFile.sourceRecordingId)) {
        errors.push(`exports.files[${index}].sourceRecordingId must reference an id from recordings.`);
      }
    }
    if (!usefulString(exportedFile?.notes)) {
      errors.push(`exports.files[${index}].notes must describe how the export was inspected.`);
    } else {
      rejectPlaceholder(`exports.files[${index}].notes`, exportedFile.notes, errors);
      if (!EXPORT_INSPECTION_NOTE_PATTERN.test(exportedFile.notes)) {
        errors.push(
          `exports.files[${index}].notes must describe opening, playing, importing, decoding, previewing, viewing, loading, listening to, or inspecting the export.`,
        );
      }
    }
  }
  for (const format of REQUIRED_EXPORT_FORMATS) {
    if (!exportFormats.has(format)) {
      errors.push(`exports.files must include ${format}.`);
    }
  }

  const exportWorkflow = evidence?.exports?.workflow || {};
  for (const key of [
    "captionBurnInVerified",
    "cancelRetryCompleted",
    "revealActionVerified",
    "saveDialogCancellationVerified",
  ]) {
    if (exportWorkflow[key] !== true) {
      errors.push(`exports.workflow.${key} must be true.`);
    }
  }
  if (!nonEmptyString(exportWorkflow.cancelRetryRecordingId)) {
    errors.push("exports.workflow.cancelRetryRecordingId is required.");
  } else {
    rejectPlaceholder(
      "exports.workflow.cancelRetryRecordingId",
      exportWorkflow.cancelRetryRecordingId,
      errors,
    );
    if (!recordingIds.has(exportWorkflow.cancelRetryRecordingId)) {
      errors.push("exports.workflow.cancelRetryRecordingId must reference an id from recordings.");
    }
  }
  for (const key of ["cancelledExportFormat", "retryCompletedExportFormat"]) {
    const format = String(exportWorkflow[key] || "").toLowerCase();
    if (!["mp4", "webm", "gif"].includes(format)) {
      errors.push(`exports.workflow.${key} must be one of mp4, webm, or gif.`);
    }
  }
  if (!usefulString(exportWorkflow.revealDownloadIdObserved)) {
    errors.push(
      "exports.workflow.revealDownloadIdObserved must describe the completed Chrome download id or reveal UI observation.",
    );
  } else {
    rejectPlaceholder(
      "exports.workflow.revealDownloadIdObserved",
      exportWorkflow.revealDownloadIdObserved,
      errors,
    );
    if (
      !EXPORT_REVEAL_COMPLETION_PATTERN.test(exportWorkflow.revealDownloadIdObserved) ||
      !EXPORT_REVEAL_OBSERVATION_PATTERN.test(exportWorkflow.revealDownloadIdObserved)
    ) {
      errors.push(
        "exports.workflow.revealDownloadIdObserved must mention a completed export/download and the reveal/open observation.",
      );
    }
  }
  const saveToFileStatus = exportWorkflow.saveToFileVerifiedOrUnavailable;
  if (!["verified", "unavailable"].includes(saveToFileStatus)) {
    errors.push('exports.workflow.saveToFileVerifiedOrUnavailable must be "verified" or "unavailable".');
  }
  if (!usefulString(exportWorkflow.notes)) {
    errors.push("exports.workflow.notes must describe export workflow observations.");
  } else {
    rejectPlaceholder("exports.workflow.notes", exportWorkflow.notes, errors);
    if (
      saveToFileStatus === "verified" &&
      !EXPORT_SAVE_TO_FILE_VERIFIED_PATTERN.test(exportWorkflow.notes)
    ) {
      errors.push(
        "exports.workflow.notes must describe the verified Save to file or user-chosen file/folder flow.",
      );
    }
    if (
      saveToFileStatus === "unavailable" &&
      !EXPORT_SAVE_TO_FILE_UNAVAILABLE_PATTERN.test(exportWorkflow.notes)
    ) {
      errors.push("exports.workflow.notes must explain why Save to file was unavailable.");
    }
    if (!EXPORT_SAVE_DIALOG_CANCELLATION_PATTERN.test(exportWorkflow.notes)) {
      errors.push("exports.workflow.notes must describe the save dialog cancellation observation.");
    }
  }

  const validateRecordingRefs = (label, values, minimum = 1) => {
    const refs = Array.isArray(values) ? values : [];
    if (refs.length < minimum) {
      errors.push(`${label} must include at least ${minimum} recording id${minimum === 1 ? "" : "s"}.`);
      return;
    }
    const uniqueRefs = new Set();
    for (const [index, value] of refs.entries()) {
      if (!nonEmptyString(value)) {
        errors.push(`${label}[${index}] is required.`);
      } else {
        rejectPlaceholder(`${label}[${index}]`, value, errors);
        if (!recordingIds.has(value)) {
          errors.push(`${label}[${index}] must reference an id from recordings.`);
        } else if (uniqueRefs.has(value)) {
          errors.push(`${label}[${index}] must be a unique recording id within ${label}.`);
        } else {
          uniqueRefs.add(value);
        }
      }
    }
    if (uniqueRefs.size < minimum) {
      errors.push(
        `${label} must reference at least ${minimum} unique listed recording id${minimum === 1 ? "" : "s"}.`,
      );
    }
  };
  const validateObservedRanges = (label, ranges, minimum) => {
    if (!Array.isArray(ranges)) {
      errors.push(`${label} must include at least ${minimum} observed range${minimum === 1 ? "" : "s"}.`);
      return;
    }
    if (ranges.length < minimum) {
      errors.push(`${label} must include at least ${minimum} observed range${minimum === 1 ? "" : "s"}.`);
    }
    for (const [index, range] of ranges.entries()) {
      const prefix = `${label}[${index}]`;
      if (!nonEmptyString(range?.recordingId)) {
        errors.push(`${prefix}.recordingId is required.`);
      } else {
        rejectPlaceholder(`${prefix}.recordingId`, range.recordingId, errors);
        if (!recordingIds.has(range.recordingId)) {
          errors.push(`${prefix}.recordingId must reference an id from recordings.`);
        }
      }
      if (!Number.isFinite(range?.startSeconds) || range.startSeconds < 0) {
        errors.push(`${prefix}.startSeconds must be a non-negative number.`);
      }
      if (!Number.isFinite(range?.endSeconds) || range.endSeconds <= 0) {
        errors.push(`${prefix}.endSeconds must be a positive number.`);
      }
      if (
        Number.isFinite(range?.startSeconds) &&
        Number.isFinite(range?.endSeconds) &&
        range.endSeconds <= range.startSeconds
      ) {
        errors.push(`${prefix}.endSeconds must be greater than startSeconds.`);
      }
      if (!usefulString(range?.observation)) {
        errors.push(`${prefix}.observation must describe the observed behavior.`);
      } else {
        rejectPlaceholder(`${prefix}.observation`, range.observation, errors);
      }
    }
  };

  const offlineTranscription = evidence?.offlineTranscription || {};
  validateRecordingRefs("offlineTranscription.recordingIds", offlineTranscription.recordingIds, 2);
  if (!usefulString(offlineTranscription.networkDisabledMethod)) {
    errors.push("offlineTranscription.networkDisabledMethod must describe how network access was disabled.");
  } else {
    rejectPlaceholder(
      "offlineTranscription.networkDisabledMethod",
      offlineTranscription.networkDisabledMethod,
      errors,
    );
    if (!OFFLINE_NETWORK_DISABLED_PATTERN.test(offlineTranscription.networkDisabledMethod)) {
      errors.push(
        "offlineTranscription.networkDisabledMethod must describe disabled, blocked, disconnected, offline, airplane, DevTools, or firewall network isolation.",
      );
    }
  }
  const externalNetworkProbe = offlineTranscription.externalNetworkProbe || {};
  if (!isExternalHttpUrl(externalNetworkProbe.url)) {
    errors.push(
      "offlineTranscription.externalNetworkProbe.url must be an external http(s) URL, not localhost or an extension URL.",
    );
  } else {
    rejectPlaceholder(
      "offlineTranscription.externalNetworkProbe.url",
      externalNetworkProbe.url,
      errors,
    );
  }
  if (externalNetworkProbe.result !== "failed") {
    errors.push('offlineTranscription.externalNetworkProbe.result must be "failed".');
  }
  if (!usefulString(externalNetworkProbe.observedError)) {
    errors.push(
      "offlineTranscription.externalNetworkProbe.observedError must describe the browser network failure.",
    );
  } else {
    rejectPlaceholder(
      "offlineTranscription.externalNetworkProbe.observedError",
      externalNetworkProbe.observedError,
      errors,
    );
    if (!OFFLINE_NETWORK_PROBE_FAILURE_PATTERN.test(externalNetworkProbe.observedError)) {
      errors.push(
        "offlineTranscription.externalNetworkProbe.observedError must include the observed browser failure, error, blocked, offline, disconnected, timeout, or unreachable result.",
      );
    }
  }
  if (externalNetworkProbe.sameChromeProfile !== true) {
    errors.push("offlineTranscription.externalNetworkProbe.sameChromeProfile must be true.");
  }
  if (!usefulString(offlineTranscription.networkProbeResult)) {
    errors.push(
      "offlineTranscription.networkProbeResult must describe the failed external network probe observed during offline transcription QA.",
    );
  } else {
    rejectPlaceholder(
      "offlineTranscription.networkProbeResult",
      offlineTranscription.networkProbeResult,
      errors,
    );
    if (!OFFLINE_NETWORK_PROBE_FAILURE_PATTERN.test(offlineTranscription.networkProbeResult)) {
      errors.push("offlineTranscription.networkProbeResult must include the failed external probe result.");
    }
    if (!OFFLINE_MODEL_READY_PATTERN.test(offlineTranscription.networkProbeResult)) {
      errors.push(
        "offlineTranscription.networkProbeResult must mention that the bundled/local Whisper model stayed ready or loaded.",
      );
    }
  }
  if (!usefulString(offlineTranscription.transcriptQualityNotes)) {
    errors.push("offlineTranscription.transcriptQualityNotes must describe transcript quality and timing.");
  } else {
    rejectPlaceholder(
      "offlineTranscription.transcriptQualityNotes",
      offlineTranscription.transcriptQualityNotes,
      errors,
    );
    if (!TRANSCRIPT_QUALITY_PATTERN.test(offlineTranscription.transcriptQualityNotes)) {
      errors.push(
        "offlineTranscription.transcriptQualityNotes must mention real-speaker, voice, narration, microphone, or recording quality with word timing, timestamps, accuracy, or usability.",
      );
    }
  }
  for (const key of [
    "bundledModelReadyObserved",
    "cachedAfterReopen",
    "regenerateVerified",
    "deleteVerified",
  ]) {
    if (offlineTranscription[key] !== true) {
      errors.push(`offlineTranscription.${key} must be true.`);
    }
  }

  const silenceSuggestions = evidence?.silenceSuggestions || {};
  validateRecordingRefs("silenceSuggestions.recordingIds", silenceSuggestions.recordingIds, 2);
  const silenceContainers = new Set(
    Array.isArray(silenceSuggestions.codecsOrContainers)
      ? silenceSuggestions.codecsOrContainers.map((value) => String(value).toLowerCase())
      : [],
  );
  if (![...silenceContainers].some((container) => /webm/.test(container))) {
    errors.push("silenceSuggestions.codecsOrContainers must include WebM.");
  }
  if (![...silenceContainers].some((container) => /mp4|m4a|aac/.test(container))) {
    errors.push("silenceSuggestions.codecsOrContainers must include MP4/M4A/AAC coverage.");
  }
  if (silenceSuggestions.noisyEnvironmentCovered !== true) {
    errors.push("silenceSuggestions.noisyEnvironmentCovered must be true.");
  }
  validateObservedRanges(
    "silenceSuggestions.suggestedQuietRanges",
    silenceSuggestions.suggestedQuietRanges,
    2,
  );
  validateObservedRanges(
    "silenceSuggestions.ignoredNoiseRanges",
    silenceSuggestions.ignoredNoiseRanges,
    1,
  );
  if (!usefulString(silenceSuggestions.notes)) {
    errors.push("silenceSuggestions.notes must describe real-codec/noise behavior.");
  } else {
    rejectPlaceholder("silenceSuggestions.notes", silenceSuggestions.notes, errors);
  }

  const zoom = evidence?.zoom || {};
  validateRecordingRefs("zoom.recordingId", [zoom.recordingId], 1);
  for (const key of [
    "sourceHadClickMetadata",
    "previewVerified",
    "mp4ExportVerified",
    "keepRemoveVerified",
    "persistedAfterReopen",
  ]) {
    if (zoom[key] !== true) {
      errors.push(`zoom.${key} must be true.`);
    }
  }
  if (!usefulString(zoom.exportInspection)) {
    errors.push("zoom.exportInspection must describe how the MP4 export was inspected for zoom framing.");
  } else {
    rejectPlaceholder("zoom.exportInspection", zoom.exportInspection, errors);
  }
  if (!usefulString(zoom.notes)) {
    errors.push("zoom.notes must describe zoom suggestion, preview, and export behavior.");
  } else {
    rejectPlaceholder("zoom.notes", zoom.notes, errors);
  }

  const localLibraryRecovery = evidence?.localLibraryRecovery || {};
  for (const key of [
    "duplicateReopenVerified",
    "sidecarImportVerified",
    "bulkExportDeleteVerified",
    "orphanCleanupVerified",
    "missingMediaRepairVerified",
  ]) {
    if (localLibraryRecovery[key] !== true) {
      errors.push(`localLibraryRecovery.${key} must be true.`);
    }
  }
  const recoveryOperations = Array.isArray(localLibraryRecovery.operations)
    ? localLibraryRecovery.operations
    : [];
  if (recoveryOperations.length < REQUIRED_LOCAL_LIBRARY_RECOVERY_OPERATIONS.length) {
    errors.push(
      "localLibraryRecovery.operations must include duplicate-reopen, sidecar-import, bulk-export-delete, orphan-cleanup, and missing-media-repair.",
    );
  }
  const recoveryOperationTypes = new Set();
  for (const [index, operation] of recoveryOperations.entries()) {
    const type = typeof operation?.type === "string" ? operation.type.toLowerCase() : "";
    if (!type) {
      errors.push(`localLibraryRecovery.operations[${index}].type is required.`);
    } else {
      rejectPlaceholder(`localLibraryRecovery.operations[${index}].type`, operation.type, errors);
      recoveryOperationTypes.add(type);
      if (!REQUIRED_LOCAL_LIBRARY_RECOVERY_OPERATIONS.includes(type)) {
        errors.push(
          `localLibraryRecovery.operations[${index}].type must be one of ${REQUIRED_LOCAL_LIBRARY_RECOVERY_OPERATIONS.join(", ")}.`,
        );
      }
    }
    const minimumRefs = type === "orphan-cleanup" ? 0 : type === "bulk-export-delete" ? 2 : 1;
    const operationRecordingIds = Array.isArray(operation?.recordingIds) ? operation.recordingIds : [];
    if (operationRecordingIds.length < minimumRefs) {
      errors.push(
        `localLibraryRecovery.operations[${index}].recordingIds must include at least ${minimumRefs} recording id${minimumRefs === 1 ? "" : "s"}.`,
      );
    }
    const uniqueOperationRecordingIds = new Set();
    for (const [refIndex, recordingId] of operationRecordingIds.entries()) {
      if (!nonEmptyString(recordingId)) {
        errors.push(`localLibraryRecovery.operations[${index}].recordingIds[${refIndex}] is required.`);
      } else {
        rejectPlaceholder(
          `localLibraryRecovery.operations[${index}].recordingIds[${refIndex}]`,
          recordingId,
          errors,
        );
        if (!recordingIds.has(recordingId)) {
          errors.push(
            `localLibraryRecovery.operations[${index}].recordingIds[${refIndex}] must reference an id from recordings.`,
          );
        } else if (uniqueOperationRecordingIds.has(recordingId)) {
          errors.push(
            `localLibraryRecovery.operations[${index}].recordingIds[${refIndex}] must be unique within this operation.`,
          );
        } else {
          uniqueOperationRecordingIds.add(recordingId);
        }
      }
    }
    if (uniqueOperationRecordingIds.size < minimumRefs) {
      errors.push(
        `localLibraryRecovery.operations[${index}].recordingIds must reference at least ${minimumRefs} unique listed recording id${minimumRefs === 1 ? "" : "s"}.`,
      );
    }
    if (!usefulString(operation?.observation)) {
      errors.push(`localLibraryRecovery.operations[${index}].observation must describe the observed recovery behavior.`);
    } else {
      rejectPlaceholder(
        `localLibraryRecovery.operations[${index}].observation`,
        operation.observation,
        errors,
      );
    }
  }
  for (const type of REQUIRED_LOCAL_LIBRARY_RECOVERY_OPERATIONS) {
    if (!recoveryOperationTypes.has(type)) {
      errors.push(`localLibraryRecovery.operations must include ${type}.`);
    }
  }
  if (!usefulString(localLibraryRecovery.notes)) {
    errors.push("localLibraryRecovery.notes must describe local recovery behavior.");
  } else {
    rejectPlaceholder("localLibraryRecovery.notes", localLibraryRecovery.notes, errors);
  }

  const publicationSurface = evidence?.publicationSurface || {};
  const reviewedArtifacts = Array.isArray(publicationSurface.reviewedArtifacts)
    ? publicationSurface.reviewedArtifacts
    : [];
  const reviewedTypes = new Set();
  if (reviewedArtifacts.length < REQUIRED_PUBLICATION_ARTIFACT_TYPES.length) {
    errors.push("publicationSurface.reviewedArtifacts must include release notes, screenshots, and store text.");
  }
  for (const [index, artifact] of reviewedArtifacts.entries()) {
    const type = typeof artifact?.type === "string" ? artifact.type.toLowerCase() : "";
    if (!type) {
      errors.push(`publicationSurface.reviewedArtifacts[${index}].type is required.`);
    } else {
      reviewedTypes.add(type);
      if (!REQUIRED_PUBLICATION_ARTIFACT_TYPES.includes(type)) {
        errors.push(`publicationSurface.reviewedArtifacts[${index}].type is not recognized.`);
      }
    }
    if (!nonEmptyString(artifact?.name)) {
      errors.push(`publicationSurface.reviewedArtifacts[${index}].name is required.`);
    } else {
      rejectPlaceholder(`publicationSurface.reviewedArtifacts[${index}].name`, artifact.name, errors);
      if (!publicationArtifactNameMatchesType(type, artifact.name)) {
        errors.push(
          `publicationSurface.reviewedArtifacts[${index}].name must identify the ${type || "publication"} artifact reviewed.`,
        );
      }
      if (type === "store-text" && !artifact.name.includes(REQUIRED_STORE_LISTING_DRAFT_PATH)) {
        errors.push(
          `publicationSurface.reviewedArtifacts[${index}].name must include ${REQUIRED_STORE_LISTING_DRAFT_PATH}.`,
        );
      }
    }
    if (!usefulString(artifact?.notes)) {
      errors.push(`publicationSurface.reviewedArtifacts[${index}].notes must describe what was reviewed.`);
    } else {
      rejectPlaceholder(`publicationSurface.reviewedArtifacts[${index}].notes`, artifact.notes, errors);
      if (!PUBLICATION_REVIEW_NOTE_PATTERN.test(artifact.notes)) {
        errors.push(
          `publicationSurface.reviewedArtifacts[${index}].notes must describe reviewing, checking, searching, scanning, or inspecting paid/account/cloud/remote/local-only claims.`,
        );
      }
    }
    const searchedTerms = Array.isArray(artifact?.searchedTerms) ? artifact.searchedTerms : [];
    const searchedPaidTerms = searchedTerms.some((term) => /paid|paywall|subscription|billing|pricing/i.test(term));
    const searchedGateTerms = searchedTerms.some(
      (term) => /premium|trial|entitlement|licen[cs]e|required|upgrade|feature.?gate|account.?level/i.test(term),
    );
    const searchedPlanTerms = searchedTerms.some(
      (term) =>
        /starter.?plan|team.?plan|business.?plan|enterprise.?plan|free.?plan|limited.?plan|plan.?limit|usage.?limit|member.?only|membership|locked.?feature|feature.?locked/i.test(
          term,
        ),
    );
    const searchedExplicitLockTerms = searchedTerms.some(
      (term) =>
        /locked behind|pay(?:ing)? (?:to|for) (?:unlock|use|export|record|capture|transcribe)|upgrade.?required|(?:subscription|premium|pro|enterprise|licen[cs]e).?only/i.test(
          term,
        ),
    );
    const searchedAccessGateTerms = searchedTerms.some(
      (term) =>
        /account.?tier|paid.?account|paid.?membership|enterprise.?only|contact.?sales|sales.?gated|licen[cs]e.?key|activation|(?:plan|tier|subscription|membership).?required|locked by (?:plan|tier|account|membership)/i.test(
          term,
        ),
    );
    const searchedAccountTerms = searchedTerms.some((term) => /account|sign.?in/i.test(term));
    const searchedCloudTerms = searchedTerms.some((term) => /cloud|dashboard|drive|remote/i.test(term));
    if (
      searchedTerms.length < 5 ||
      !searchedPaidTerms ||
      !searchedGateTerms ||
      !searchedPlanTerms ||
      !searchedExplicitLockTerms ||
      !searchedAccessGateTerms ||
      !searchedAccountTerms ||
      !searchedCloudTerms
    ) {
      errors.push(
        `publicationSurface.reviewedArtifacts[${index}].searchedTerms must include paid/subscription, premium/trial/entitlement/license/upgrade, plan/membership/locked-feature, locked-behind/pay-to-unlock/upgrade-required gates, account-tier/license-key/activation/contact-sales gates, account/sign-in, and cloud/remote terms.`,
      );
    }
    for (const [termIndex, term] of searchedTerms.entries()) {
      if (!nonEmptyString(term)) {
        errors.push(`publicationSurface.reviewedArtifacts[${index}].searchedTerms[${termIndex}] is required.`);
      } else {
        rejectPlaceholder(
          `publicationSurface.reviewedArtifacts[${index}].searchedTerms[${termIndex}]`,
          term,
          errors,
        );
      }
    }
    if (!usefulString(artifact?.residualRisk)) {
      errors.push(`publicationSurface.reviewedArtifacts[${index}].residualRisk must state residual risk or none.`);
    } else {
      rejectPlaceholder(
        `publicationSurface.reviewedArtifacts[${index}].residualRisk`,
        artifact.residualRisk,
        errors,
      );
      if (!PUBLICATION_RESIDUAL_RISK_PATTERN.test(artifact.residualRisk)) {
        errors.push(
          `publicationSurface.reviewedArtifacts[${index}].residualRisk must explicitly state no residual risk, no remaining risk, or describe the residual risk.`,
        );
      }
    }
  }
  for (const type of REQUIRED_PUBLICATION_ARTIFACT_TYPES) {
    if (!reviewedTypes.has(type)) {
      errors.push(`publicationSurface.reviewedArtifacts must include ${type}.`);
    }
  }
  for (const key of [
    "noPaidOrAccountGateClaims",
    "noHostedDashboardOrCloudUploadClaims",
    "noGoogleDriveClaims",
    "noDefaultRemoteTranscriptionClaims",
    "noUnverifiedMultiSceneAutoZoomClaims",
  ]) {
    if (publicationSurface[key] !== true) {
      errors.push(`publicationSurface.${key} must be true.`);
    }
  }
  if (!usefulString(publicationSurface.notes)) {
    errors.push("publicationSurface.notes must describe final publication surface observations.");
  } else {
    rejectPlaceholder("publicationSurface.notes", publicationSurface.notes, errors);
  }

  const checks = evidence?.checks && typeof evidence.checks === "object" ? evidence.checks : {};
  for (const id of REQUIRED_CHECKS) {
    const check = checks[id];
    if (!check) {
      errors.push(`checks.${id} is required.`);
      continue;
    }
    if (check.status !== "pass") {
      errors.push(`checks.${id}.status must be "pass".`);
    }
    if (!usefulString(check.notes)) {
      errors.push(`checks.${id}.notes must describe the manual result.`);
    } else {
      rejectPlaceholder(`checks.${id}.notes`, check.notes, errors);
      if (!CHECKLIST_EVIDENCE_PATTERN.test(check.notes)) {
        errors.push(
          `checks.${id}.notes must describe observed, confirmed, verified, recorded, inspected, tested, opened, or reviewed local/offline release behavior.`,
        );
      }
    }
    const checkEvidence = Array.isArray(check.evidence) ? check.evidence : [];
    if (checkEvidence.length < 1) {
      errors.push(`checks.${id}.evidence must include at least one structured evidence item.`);
    }
    let referencedRecordingCount = 0;
    for (const [index, item] of checkEvidence.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`checks.${id}.evidence[${index}] must be an object with artifact and observation.`);
        continue;
      }
      if (!usefulString(item.artifact)) {
        errors.push(`checks.${id}.evidence[${index}].artifact must identify the evidence artifact.`);
      } else {
        rejectPlaceholder(`checks.${id}.evidence[${index}].artifact`, item.artifact, errors);
        if (!CHECKLIST_ARTIFACT_PATTERN.test(item.artifact)) {
          errors.push(
            `checks.${id}.evidence[${index}].artifact must identify a screenshot, report, log, recording, export, transcript, video, image, JSON, VTT, MP4, WebM, GIF, WAV, M4A, or notes artifact.`,
          );
        }
      }
      if (!usefulString(item.observation)) {
        errors.push(`checks.${id}.evidence[${index}].observation must describe the observed result.`);
      } else {
        rejectPlaceholder(`checks.${id}.evidence[${index}].observation`, item.observation, errors);
        if (!CHECKLIST_EVIDENCE_PATTERN.test(item.observation)) {
          errors.push(
            `checks.${id}.evidence[${index}].observation must describe observed, confirmed, verified, recorded, inspected, tested, opened, or reviewed local/offline release behavior.`,
          );
        }
      }
      const itemRecordingIds = Array.isArray(item.recordingIds) ? item.recordingIds : [];
      for (const [refIndex, recordingId] of itemRecordingIds.entries()) {
        if (!nonEmptyString(recordingId)) {
          errors.push(`checks.${id}.evidence[${index}].recordingIds[${refIndex}] is required.`);
        } else {
          rejectPlaceholder(
            `checks.${id}.evidence[${index}].recordingIds[${refIndex}]`,
            recordingId,
            errors,
          );
          if (!recordingIds.has(recordingId)) {
            errors.push(
              `checks.${id}.evidence[${index}].recordingIds[${refIndex}] must reference an id from recordings.`,
            );
          } else {
            referencedRecordingCount += 1;
          }
        }
      }
    }
    const requiredRecordingRefs = CHECK_RECORDING_REF_MINIMUMS[id] || 0;
    const uniqueReferencedRecordingIds = new Set();
    for (const item of checkEvidence) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const itemRecordingIds = Array.isArray(item.recordingIds) ? item.recordingIds : [];
      for (const recordingId of itemRecordingIds) {
        if (recordingIds.has(recordingId)) uniqueReferencedRecordingIds.add(recordingId);
      }
    }
    if (referencedRecordingCount < requiredRecordingRefs) {
      errors.push(
        `checks.${id}.evidence must reference at least ${requiredRecordingRefs} listed recording id${requiredRecordingRefs === 1 ? "" : "s"}.`,
      );
    }
    if (uniqueReferencedRecordingIds.size < requiredRecordingRefs) {
      errors.push(
        `checks.${id}.evidence must reference at least ${requiredRecordingRefs} unique listed recording id${requiredRecordingRefs === 1 ? "" : "s"}.`,
      );
    }
  }

  return errors;
};

const args = process.argv.slice(2);
if (args.includes("--print-template")) {
  printTemplate();
  process.exit(0);
}
if (args.includes("--write-template")) {
  writeTemplate({ force: args.includes("--force") });
  process.exit(0);
}

const evidencePath =
  args.find((arg) => !arg.startsWith("--")) || DEFAULT_EVIDENCE_PATH;
const absoluteEvidencePath = resolveRootPath(evidencePath);

if (!existsSync(absoluteEvidencePath)) {
  fail([
    `manual QA evidence file is missing: ${relative(ROOT, absoluteEvidencePath)}`,
    "Create it with: npm run qa:release:manual:template",
  ]);
}

let evidence;
try {
  evidence = JSON.parse(readFileSync(absoluteEvidencePath, "utf8"));
} catch (error) {
  fail([`manual QA evidence is not valid JSON: ${error.message}`]);
}

const errors = validate(evidence);
if (errors.length) fail(errors);

console.log(`Manual QA evidence passed: ${relative(ROOT, absoluteEvidencePath)}`);
console.log(`Required checks: ${REQUIRED_CHECKS.length}`);
