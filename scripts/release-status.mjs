#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeManualTemplateSync } from "./manual-qa-template-sync.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_RELEASE_STATUS_ROOT
  ? resolve(process.env.SAYLESS_RELEASE_STATUS_ROOT)
  : DEFAULT_ROOT;
const AUTOMATED_EVIDENCE_PATH = join(
  ROOT,
  "release-artifacts",
  "release-qa-automated.json"
);
const MANUAL_EVIDENCE_PATH = join(
  ROOT,
  "release-artifacts",
  "manual-qa-evidence.json"
);
const MANUAL_SESSION_PATH = join(
  ROOT,
  "release-artifacts",
  "manual-qa-session.json"
);
const PACKAGE_EVIDENCE_PATH = join(
  ROOT,
  "release-artifacts",
  "package-release.json"
);
const CWS_EVIDENCE_PATH = join(ROOT, "release-artifacts", "cws-package.json");
const BUILD_DIR = join(ROOT, "build");
const WHISPER_BUILD_DIR = join(BUILD_DIR, "assets", "whisper");
const PACKAGE_PATH = join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = join(ROOT, "package-lock.json");
const SOURCE_MANIFEST_PATH = join(ROOT, "src", "manifest.json");
const BUILD_MANIFEST_PATH = join(BUILD_DIR, "manifest.json");
const MANUAL_QA_VERIFIER_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "verify-manual-qa-evidence.mjs"
);
const MANUAL_QA_PROFILE_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "manual-qa-profile.mjs"
);
const RELEASE_PACKAGE_VERIFIER_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "verify-release-package.mjs"
);
const CWS_PACKAGE_VERIFIER_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "verify-cws-package.mjs"
);
const READY_NEXT_ACTIONS = [
  "npm run verify:release-package",
  "npm run verify:cws-package",
  "npm run release:cws",
  "npm run release:cws:publish",
  "attach release-artifacts/release-qa-automated.json",
  "attach release-artifacts/manual-qa-evidence.json",
  "attach release-artifacts/manual-qa-media-probe.json",
  "attach release-artifacts/manual-qa-sidecar-probe.json",
  "attach release-artifacts/package-release.json",
  "attach release-artifacts/cws-package.json",
  "attach docs/STORE_LISTING.md",
  "attach extension.zip",
  "attach build-cws.zip",
];
const COMPLETE_MANUAL_QA_ACTION =
  "complete docs/RELEASE_QA.md, fill release-artifacts/manual-qa-evidence.json, then run npm run qa:release:manual";
const OPEN_MANUAL_QA_PROFILE_ACTION =
  "npm run qa:release:manual:profile -- --launch";
const SYNC_MANUAL_QA_PROFILE_ACTION =
  "npm run qa:release:manual:profile -- --sync-template --launch";
const REVIEW_MANUAL_QA_PROGRESS_ACTION = "npm run qa:release:manual:progress";
const MANUAL_SESSION_KIND = "sayless.manualQaSession";
const REQUIRED_AUTOMATED_COMMANDS = [
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
const CONDITIONAL_AUTOMATED_COMMANDS = [
  "test:e2e:offline-transcription-speech",
];
const EXPECTED_AUTOMATED_COMMANDS = new Map(
  [...REQUIRED_AUTOMATED_COMMANDS, ...CONDITIONAL_AUTOMATED_COMMANDS].map(
    (label) => [label, `npm run ${label}`]
  )
);
const AUTOMATED_RUN_WINDOW_TOLERANCE_MS = 5_000;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: error.message };
  }
};

const arrayFrom = (value) => (Array.isArray(value) ? value : []);
const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));
const timestampMs = (value) => (isIsoDate(value) ? Date.parse(value) : null);
const nonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;
const quoteShellArg = (value) => {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const discoverActiveManualQaSession = () => {
  const relativePath = "release-artifacts/manual-qa-session.json";
  if (!existsSync(MANUAL_SESSION_PATH)) {
    return {
      path: relativePath,
      exists: false,
      usable: false,
      reason: "no launched manual QA session has been recorded",
    };
  }
  const session = readJson(MANUAL_SESSION_PATH);
  if (session.error) {
    return {
      path: relativePath,
      exists: true,
      usable: false,
      reason: `active session JSON is invalid: ${session.error}`,
    };
  }
  if (
    session.kind !== MANUAL_SESSION_KIND ||
    session.status !== "active" ||
    !isIsoDate(session.updatedAt) ||
    !nonEmptyString(session.profileDir)
  ) {
    return {
      path: relativePath,
      exists: true,
      usable: false,
      reason: "active session metadata is malformed",
    };
  }
  const validation = spawnSync(
    process.execPath,
    [
      MANUAL_QA_PROFILE_PATH,
      "--json",
      "--resume-profile",
      `--profile-dir=${session.profileDir}`,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SAYLESS_MANUAL_QA_PROFILE_ROOT: ROOT,
      },
      encoding: "utf8",
    }
  );
  if (validation.status !== 0) {
    let reason = validation.stderr.trim() || validation.stdout.trim();
    try {
      reason = JSON.parse(reason).error || reason;
    } catch {}
    return {
      path: relativePath,
      exists: true,
      usable: false,
      profileDir: session.profileDir,
      reason: `recorded session cannot be resumed: ${reason}`,
    };
  }
  let profile;
  try {
    profile = JSON.parse(validation.stdout);
  } catch (error) {
    return {
      path: relativePath,
      exists: true,
      usable: false,
      profileDir: session.profileDir,
      reason: `resume validation returned invalid JSON: ${error.message}`,
    };
  }
  const fieldsMatch =
    profile.profileMode === "resumed" &&
    profile.profileDir === session.profileDir &&
    profile.profileMarkerPath === session.profileMarkerPath &&
    profile.profileCreatedAt === session.profileCreatedAt &&
    profile.buildManifestVersion === session.releaseVersion &&
    profile.automatedEvidenceGeneratedAt ===
      session.automatedEvidenceGeneratedAt &&
    profile.buildSha256 === session.buildSha256 &&
    profile.browserObservedExtensionId === session.unpackedExtensionId &&
    profile.detectedEnvironment?.os === session.operatingSystem &&
    profile.browserCommand === session.browserCommand &&
    profile.detectedEnvironment?.chromeVersion === session.browserVersion;
  if (!fieldsMatch || !Array.isArray(profile.resumeCommand)) {
    return {
      path: relativePath,
      exists: true,
      usable: false,
      profileDir: session.profileDir,
      reason:
        "active session metadata does not match its strictly validated profile marker",
    };
  }
  return {
    path: relativePath,
    exists: true,
    usable: true,
    updatedAt: session.updatedAt,
    profileDir: session.profileDir,
    profileCreatedAt: session.profileCreatedAt,
    resumeAction: profile.resumeCommand.map(quoteShellArg).join(" "),
  };
};
const commandMatchesExpected = (actual, expected) =>
  actual === expected || actual === expected.replace(/^npm\b/, "npm.cmd");

const sortedStrings = (value) =>
  arrayFrom(value)
    .filter((item) => typeof item === "string")
    .slice()
    .sort();

const arraysEqual = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  return { fileCount: files.length, sha256: hash.digest("hex") };
};

const dirSize = (dir) =>
  walkFiles(dir).reduce((total, file) => total + file.size, 0);

const gitOutput = (args) => {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitLines = (args) => {
  const output = gitOutput(args);
  return output
    ? output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
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

const compareEvidenceRecord = ({ label, actual, expected, fields, errors }) => {
  for (const field of fields) {
    if (actual?.[field] !== expected?.[field]) {
      errors.push(
        `automated QA evidence ${label}.${field} must match current ${label}.`
      );
    }
  }
};

const validateAutomatedEvidence = (state) => {
  const errors = [];
  if (!state.exists) {
    errors.push("automated QA evidence file is missing.");
  } else if (state.status === "invalid-json") {
    errors.push(`automated QA evidence is not valid JSON: ${state.error}`);
  }
  if (errors.length) {
    return {
      passed: false,
      exitCode: 1,
      output: errors
        .map((error) => `AUTOMATED QA EVIDENCE FAIL: ${error}`)
        .join("\n"),
    };
  }

  const evidence = readJson(AUTOMATED_EVIDENCE_PATH);
  const packageJson = readJson(PACKAGE_PATH);
  const packageLock = readJson(PACKAGE_LOCK_PATH);
  const sourceManifest = readJson(SOURCE_MANIFEST_PATH);
  const buildManifest = readJson(BUILD_MANIFEST_PATH);

  if (packageJson.error)
    errors.push(`package.json is not valid JSON: ${packageJson.error}`);
  if (packageLock.error)
    errors.push(`package-lock.json is not valid JSON: ${packageLock.error}`);
  if (sourceManifest.error)
    errors.push(`src manifest is not valid JSON: ${sourceManifest.error}`);
  if (buildManifest.error)
    errors.push(`build manifest is not valid JSON: ${buildManifest.error}`);
  if (errors.length) {
    return {
      passed: false,
      exitCode: 1,
      output: errors
        .map((error) => `AUTOMATED QA EVIDENCE FAIL: ${error}`)
        .join("\n"),
    };
  }

  if (evidence.kind !== "sayless.releaseQaAutomated") {
    errors.push(
      'automated QA evidence kind must be "sayless.releaseQaAutomated".'
    );
  }
  if (evidence.status !== "passed") {
    errors.push('automated QA evidence status must be "passed".');
  }
  if (!isIsoDate(evidence.startedAt)) {
    errors.push(
      "automated QA evidence startedAt must be an ISO UTC timestamp."
    );
  }
  if (!isIsoDate(evidence.generatedAt)) {
    errors.push(
      "automated QA evidence generatedAt must be an ISO UTC timestamp."
    );
  }
  const automatedStartedAtMs = timestampMs(evidence.startedAt);
  const automatedGeneratedAtMs = timestampMs(evidence.generatedAt);
  if (
    automatedStartedAtMs !== null &&
    automatedGeneratedAtMs !== null &&
    automatedGeneratedAtMs < automatedStartedAtMs
  ) {
    errors.push(
      "automated QA evidence generatedAt must be at or after startedAt."
    );
  }
  if (!Number.isFinite(evidence.durationMs) || evidence.durationMs <= 0) {
    errors.push("automated QA evidence durationMs must be a positive number.");
  }
  if (
    automatedStartedAtMs !== null &&
    automatedGeneratedAtMs !== null &&
    Number.isFinite(evidence.durationMs) &&
    evidence.durationMs > 0
  ) {
    const runWindowMs = automatedGeneratedAtMs - automatedStartedAtMs;
    if (
      Math.abs(runWindowMs - evidence.durationMs) >
      AUTOMATED_RUN_WINDOW_TOLERANCE_MS
    ) {
      errors.push(
        "automated QA evidence durationMs must match the startedAt/generatedAt run window."
      );
    }
  }
  if (!nonEmptyString(evidence?.git?.branch)) {
    errors.push("automated QA evidence git.branch is required.");
  }
  if (!nonEmptyString(evidence?.git?.commit)) {
    errors.push("automated QA evidence git.commit is required.");
  } else if (!/^[0-9a-f]{40}$/i.test(evidence.git.commit)) {
    errors.push(
      "automated QA evidence git.commit must be a 40-character SHA-1 commit."
    );
  }
  if (typeof evidence?.git?.dirty !== "boolean") {
    errors.push("automated QA evidence git.dirty must be a boolean.");
  }
  if (
    !evidence?.git?.workingTree ||
    typeof evidence.git.workingTree !== "object"
  ) {
    errors.push("automated QA evidence git.workingTree is required.");
  } else {
    const workingTree = evidence.git.workingTree;
    if (!nonEmptyString(workingTree.sha256)) {
      errors.push("automated QA evidence git.workingTree.sha256 is required.");
    }
    if (!Number.isFinite(workingTree.fileCount) || workingTree.fileCount < 0) {
      errors.push(
        "automated QA evidence git.workingTree.fileCount must be a non-negative number."
      );
    }
    if (!nonEmptyString(workingTree.statusSha256)) {
      errors.push(
        "automated QA evidence git.workingTree.statusSha256 is required."
      );
    }
    const currentWorkingTree = gitWorktreeFingerprint();
    if (
      nonEmptyString(workingTree.sha256) &&
      workingTree.sha256 !== currentWorkingTree.sha256
    ) {
      errors.push(
        "automated QA evidence git.workingTree.sha256 must match the current git worktree."
      );
    }
    if (
      Number.isFinite(workingTree.fileCount) &&
      workingTree.fileCount !== currentWorkingTree.fileCount
    ) {
      errors.push(
        "automated QA evidence git.workingTree.fileCount must match the current git worktree."
      );
    }
    if (
      nonEmptyString(workingTree.statusSha256) &&
      workingTree.statusSha256 !== currentWorkingTree.statusSha256
    ) {
      errors.push(
        "automated QA evidence git.workingTree.statusSha256 must match the current git status."
      );
    }
  }
  if (evidence.releaseVersion !== packageJson.version) {
    errors.push(
      "automated QA evidence releaseVersion must match package.json."
    );
  }
  if (evidence.packageLockVersion !== packageLock.version) {
    errors.push(
      "automated QA evidence packageLockVersion must match package-lock.json."
    );
  }
  if (evidence.packageLockRootVersion !== packageLock.packages?.[""]?.version) {
    errors.push(
      "automated QA evidence packageLockRootVersion must match package-lock root package."
    );
  }
  if (evidence.manifestVersion !== sourceManifest.version) {
    errors.push(
      "automated QA evidence manifestVersion must match src/manifest.json."
    );
  }
  if (evidence.buildManifestVersion !== buildManifest.version) {
    errors.push(
      "automated QA evidence buildManifestVersion must match build/manifest.json."
    );
  }
  if (!/^[a-p]{32}$/.test(evidence?.builtExtension?.id || "")) {
    errors.push(
      "automated QA evidence builtExtension.id must be a browser-observed 32-character Chrome extension id."
    );
  }
  if (evidence?.builtExtension?.buildPath !== "build") {
    errors.push(
      "automated QA evidence builtExtension.buildPath must match build."
    );
  }
  if (evidence?.builtExtension?.cleanChromeProfile !== true) {
    errors.push(
      "automated QA evidence builtExtension.cleanChromeProfile must be true."
    );
  }
  const builtExtensionObservedAtMs = timestampMs(
    evidence?.builtExtension?.observedAt
  );
  if (builtExtensionObservedAtMs === null) {
    errors.push(
      "automated QA evidence builtExtension.observedAt must be an ISO UTC timestamp."
    );
  } else if (
    (automatedStartedAtMs !== null &&
      builtExtensionObservedAtMs < automatedStartedAtMs) ||
    (automatedGeneratedAtMs !== null &&
      builtExtensionObservedAtMs > automatedGeneratedAtMs)
  ) {
    errors.push(
      "automated QA evidence builtExtension.observedAt must fall within the automated QA run window."
    );
  }
  if (
    !Number.isInteger(evidence?.builtExtension?.summaryCount) ||
    evidence.builtExtension.summaryCount <= 0
  ) {
    errors.push(
      "automated QA evidence builtExtension.summaryCount must be a positive integer."
    );
  }

  const commandLabels = new Set();
  let commandDurationTotal = 0;
  for (const command of arrayFrom(evidence.commands)) {
    const label = command?.label;
    if (!EXPECTED_AUTOMATED_COMMANDS.has(label)) {
      errors.push(
        `automated QA evidence contains unexpected command ${
          label || "<missing>"
        }.`
      );
      continue;
    }
    if (commandLabels.has(label)) {
      errors.push(`automated QA evidence contains duplicate command ${label}.`);
    }
    commandLabels.add(label);
    if (command.status !== "passed") {
      errors.push(
        `automated QA evidence command ${label} must have status "passed".`
      );
    }
    if (
      !commandMatchesExpected(
        command.command,
        EXPECTED_AUTOMATED_COMMANDS.get(label)
      )
    ) {
      errors.push(
        `automated QA evidence command ${label} must be "${EXPECTED_AUTOMATED_COMMANDS.get(
          label
        )}".`
      );
    }
    if (!Number.isFinite(command.durationMs) || command.durationMs < 0) {
      errors.push(
        `automated QA evidence command ${label} must include a non-negative durationMs.`
      );
    } else {
      commandDurationTotal += command.durationMs;
    }
  }
  for (const label of REQUIRED_AUTOMATED_COMMANDS) {
    if (!commandLabels.has(label)) {
      errors.push(`automated QA evidence command ${label} is required.`);
    }
  }
  for (const skipped of arrayFrom(evidence.skippedCommands)) {
    if (!CONDITIONAL_AUTOMATED_COMMANDS.includes(skipped?.label)) {
      errors.push(
        `automated QA evidence skipped command ${
          skipped?.label || "<missing>"
        } is not expected.`
      );
    }
    if (!nonEmptyString(skipped?.reason)) {
      errors.push(
        `automated QA evidence skipped command ${
          skipped?.label || "<missing>"
        } must include a useful reason.`
      );
    }
  }
  for (const label of CONDITIONAL_AUTOMATED_COMMANDS) {
    const hasCommand = commandLabels.has(label);
    const hasSkip = arrayFrom(evidence.skippedCommands).some(
      (skipped) => skipped?.label === label
    );
    if (hasCommand && hasSkip) {
      errors.push(
        `automated QA evidence command ${label} cannot be both completed and skipped.`
      );
    } else if (!hasCommand && !hasSkip) {
      errors.push(
        `automated QA evidence command ${label} must be completed or skipped with a reason.`
      );
    }
  }
  if (
    Number.isFinite(evidence.durationMs) &&
    commandDurationTotal > evidence.durationMs
  ) {
    errors.push(
      "automated QA evidence command durations must not exceed total durationMs."
    );
  }

  const buildFingerprint = dirFingerprint(BUILD_DIR);
  const buildBytes = dirSize(BUILD_DIR);
  compareEvidenceRecord({
    label: "build",
    actual: evidence.build,
    expected: {
      path: "build",
      bytes: buildBytes,
      formattedBytes: formatBytes(buildBytes),
      fileCount: buildFingerprint.fileCount,
      sha256: buildFingerprint.sha256,
    },
    fields: ["path", "bytes", "formattedBytes", "fileCount", "sha256"],
    errors,
  });

  const whisperFingerprint = dirFingerprint(WHISPER_BUILD_DIR);
  const whisperBytes = dirSize(WHISPER_BUILD_DIR);
  compareEvidenceRecord({
    label: "bundledWhisper",
    actual: evidence.bundledWhisper,
    expected: {
      path: "build/assets/whisper",
      bytes: whisperBytes,
      formattedBytes: formatBytes(whisperBytes),
      fileCount: whisperFingerprint.fileCount,
      sha256: whisperFingerprint.sha256,
    },
    fields: ["path", "bytes", "formattedBytes", "fileCount", "sha256"],
    errors,
  });

  const currentSurface = releaseManifestSurface(buildManifest);
  for (const [field, expected] of Object.entries(currentSurface)) {
    const actual = evidence.releaseSurface?.[field];
    if (Array.isArray(expected)) {
      if (!arraysEqual(sortedStrings(actual), expected)) {
        errors.push(
          `automated QA evidence releaseSurface.${field} must match build/manifest.json.`
        );
      }
    } else if (actual !== expected) {
      errors.push(
        `automated QA evidence releaseSurface.${field} must match build/manifest.json.`
      );
    }
  }
  for (const field of [
    "hasOauth2",
    "hasExternallyConnectable",
    "hasIdentityPermission",
    "hasGoogleDrivePermission",
    "hasRemoteConnectSrc",
  ]) {
    if (evidence.releaseSurface?.[field] !== false) {
      errors.push(
        `automated QA evidence releaseSurface.${field} must be false.`
      );
    }
  }

  return {
    passed: errors.length === 0,
    exitCode: errors.length === 0 ? 0 : 1,
    output: errors
      .map((error) => `AUTOMATED QA EVIDENCE FAIL: ${error}`)
      .join("\n"),
  };
};

const runVerifier = (scriptPath, env = {}) => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    passed: result.status === 0,
    exitCode: result.status ?? 1,
    output: `${result.stderr || ""}${result.stdout || ""}`.trim(),
  };
};

const manualTemplateSyncState = (state, automatedPassed) => {
  if (!state.exists || state.status !== "template") {
    return { required: false, reasons: [] };
  }
  if (!automatedPassed) {
    return {
      required: true,
      reasons: [
        "current automated QA must pass before template freshness can be established",
      ],
    };
  }
  const evidence = readJson(MANUAL_EVIDENCE_PATH);
  if (evidence.error) {
    return { required: true, reasons: ["template is not valid JSON"] };
  }
  const templateResult = spawnSync(
    process.execPath,
    [MANUAL_QA_VERIFIER_PATH, "--print-template"],
    {
      cwd: ROOT,
      env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: ROOT },
      encoding: "utf8",
    }
  );
  if (templateResult.status !== 0) {
    return {
      required: true,
      reasons: ["canonical template could not be generated"],
    };
  }
  let canonicalTemplate;
  try {
    canonicalTemplate = JSON.parse(templateResult.stdout);
  } catch {
    return {
      required: true,
      reasons: ["canonical template output is not valid JSON"],
    };
  }
  return analyzeManualTemplateSync({
    canonicalTemplate,
    evidence,
    automatedEvidence: readJson(AUTOMATED_EVIDENCE_PATH),
  });
};

const evidenceState = (path, expectedKind) => {
  const rel = relative(ROOT, path);
  if (!existsSync(path)) {
    return { path: rel, exists: false, status: "missing" };
  }
  const evidence = readJson(path);
  if (evidence.error) {
    return {
      path: rel,
      exists: true,
      status: "invalid-json",
      error: evidence.error,
    };
  }
  return {
    path: rel,
    exists: true,
    kind: evidence.kind,
    expectedKind,
    status: evidence.status || "unknown",
    generatedAt: evidence.generatedAt,
    releaseVersion: evidence.releaseVersion,
    failedStep: evidence.failedStep,
    remainingReleaseWork:
      evidence.remainingReleaseWork || evidence.remainingManualQa,
  };
};

const evidenceGateStatus = (state, verifier) => {
  if (!state.exists) {
    return "missing";
  }
  if (state.status === "invalid-json") {
    return "invalid-json";
  }
  if (verifier.passed) {
    return "passed";
  }
  if (state.status === "running" || state.status === "failed") {
    return state.status;
  }
  return "invalid";
};

const verifierLines = (output) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const summarizeVerifierOutput = (output) => {
  const lines = verifierLines(output);
  const failureLines = lines.filter((line) => /\b(?:FAIL|ERROR):\s/.test(line));
  const actionableLines = failureLines.length ? failureLines : lines;
  return {
    verifierErrorCount: actionableLines.length,
    verifierSummary: actionableLines
      .map((line) => line.replace(/^.+?\b(?:FAIL|ERROR):\s*/, ""))
      .slice(0, 5),
    verifierOutput: lines.slice(0, 8),
  };
};

const summarizeVerifier = (state, verifier) => ({
  ...state,
  gateStatus: evidenceGateStatus(state, verifier),
  verifierPassed: verifier.passed,
  verifierExitCode: verifier.exitCode,
  ...summarizeVerifierOutput(verifier.output),
});

const manualQaTodo = (
  state,
  verifier,
  templateSyncRequired,
  currentProfileAction
) => {
  if (!state.exists) {
    return [
      "Generate release-artifacts/manual-qa-evidence.json with npm run qa:release:manual:template.",
      `Run ${SYNC_MANUAL_QA_PROFILE_ACTION} to synchronize the worksheet and launch the current build in a clean Chrome profile.`,
      `Fill release-specific manual observations, use ${REVIEW_MANUAL_QA_PROGRESS_ACTION} to review remaining sections, then run npm run qa:release:manual.`,
    ];
  }
  if (state.status === "template") {
    const profileAction = templateSyncRequired
      ? SYNC_MANUAL_QA_PROFILE_ACTION
      : currentProfileAction;
    return [
      `Run ${profileAction} to launch the current build in a clean Chrome profile.`,
      "Replace tester, environment, testedAt, and unpacked extension id template values.",
      "Record at least two real recordings, then run npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json <files...> for exact byte counts, durations, dimensions, containers, codecs, hashes, and a durable ignored report; cover MP4/WebM, tab/browser/region and desktop/screen/window capture, microphone and noise descriptions, two speaker profiles, and one recording that is both 180 seconds or longer and at least 25 MiB.",
      "Fill export evidence for MP4, WebM, GIF, WAV, M4A, WebVTT, transcript JSON, and .sayless-project.json; run npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json <files...> so one filename-matched three-format set with agreeing JSON recording IDs is required and its structural report is retained, then record the required open/import observations, caption burn-in, cancel/retry, reveal, Save to file, and save-dialog cancellation.",
      "After both strict probe reports pass and worksheet filenames identify their tester-confirmed roles, run npm run qa:release:manual:measurements -- --json --write to atomically copy only exact filename-matched hashes, sizes, durations, dimensions, containers, and audio metadata; all perceptual and workflow observations remain manual.",
      "Fill offline transcription evidence with bundled-model-ready UI status, disabled network method, failed external HTTP(S) probe from the same profile, transcript quality, cache, regenerate, and delete observations.",
      "Fill silence evidence on distinct-noise MP4/WebM recordings with observed quiet ranges and an ignored noisy range.",
      "Fill per-recording zoom evidence on two click-capable sources with distinct dimensions/aspect ratios, including keep/remove, preview, reopen, and inspected MP4 framing.",
      "Fill per-recording crop evidence on two varied sources, including edge-touching normalized bounds, native controls, unchanged source media, reopen, and inspected MP4 aspect agreement.",
      "Fill project-audio evidence using real WAV, M4A, and MP3 inputs with decode metadata and audible previews, plus long-recording sync, perceptual mix/replace/loop gain, cancel/retry, reopen, duplicate/delete isolation, missing-asset relink, and Apply-edits cleanup.",
      "Fill local library recovery and checklist evidence with concrete artifacts and observations.",
      "Fill publication-surface evidence for release notes, screenshots, and docs/STORE_LISTING.md store text, including paid/subscription, premium/trial/license/upgrade, plan/membership/locked-feature, locked-behind/pay-to-unlock/upgrade-required, account-tier/license-key/activation/contact-sales, account/sign-in, and cloud/remote search terms.",
      `Use ${REVIEW_MANUAL_QA_PROGRESS_ACTION} during the session to review incomplete sections without treating progress as a passing gate.`,
      "Set manual evidence status to passed only after every required observation is real, then run npm run qa:release:manual.",
    ];
  }
  if (!verifier.passed) {
    return [
      "Fix release-artifacts/manual-qa-evidence.json until npm run qa:release:manual passes.",
      ...summarizeVerifierOutput(verifier.output).verifierSummary.slice(0, 5),
    ];
  }
  return [];
};

const automated = evidenceState(
  AUTOMATED_EVIDENCE_PATH,
  "sayless.releaseQaAutomated"
);
const automatedVerifier = validateAutomatedEvidence(automated);
const manualVerifier = runVerifier(MANUAL_QA_VERIFIER_PATH, {
  SAYLESS_MANUAL_QA_ROOT: ROOT,
});
const releasePackageVerifier = runVerifier(RELEASE_PACKAGE_VERIFIER_PATH, {
  SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT: ROOT,
});
const cwsPackageVerifier = runVerifier(CWS_PACKAGE_VERIFIER_PATH, {
  SAYLESS_CWS_VERIFY_ROOT: ROOT,
});

const status = {
  automatedQa: summarizeVerifier(automated, automatedVerifier),
  manualQa: summarizeVerifier(
    evidenceState(MANUAL_EVIDENCE_PATH, "sayless.manualQaEvidence"),
    manualVerifier
  ),
  releasePackage: summarizeVerifier(
    evidenceState(PACKAGE_EVIDENCE_PATH, "sayless.releasePackage"),
    releasePackageVerifier
  ),
  cwsPackage: summarizeVerifier(
    evidenceState(CWS_EVIDENCE_PATH, "sayless.cwsPackage"),
    cwsPackageVerifier
  ),
};

const automatedPassed = status.automatedQa.verifierPassed;
const templateSync = manualTemplateSyncState(status.manualQa, automatedPassed);
const activeSession = automatedPassed
  ? discoverActiveManualQaSession()
  : {
      path: "release-artifacts/manual-qa-session.json",
      exists: existsSync(MANUAL_SESSION_PATH),
      usable: false,
      reason: "automated QA must pass before a session can be resumed",
    };
const currentManualQaProfileAction =
  !templateSync.required && activeSession.usable
    ? activeSession.resumeAction
    : OPEN_MANUAL_QA_PROFILE_ACTION;
status.manualQa.templateSyncRequired = templateSync.required;
status.manualQa.templateSyncReasons = templateSync.reasons;
status.manualQa.activeSession = activeSession;
status.manualQa.todo = manualQaTodo(
  status.manualQa,
  manualVerifier,
  templateSync.required,
  currentManualQaProfileAction
);
const manualQaNeedsCompletion =
  status.manualQa.exists && status.manualQa.status === "template";

let overall = "blocked";
let nextAction = "npm run qa:release:auto";
let nextActions = ["npm run qa:release:auto", "npm run qa:release:status"];
if (!automatedPassed) {
  nextAction = "npm run qa:release:auto";
} else if (!status.manualQa.exists) {
  nextAction = "npm run qa:release:manual:template";
  nextActions = [
    "npm run qa:release:manual:template",
    SYNC_MANUAL_QA_PROFILE_ACTION,
    REVIEW_MANUAL_QA_PROGRESS_ACTION,
    COMPLETE_MANUAL_QA_ACTION,
  ];
} else if (!status.manualQa.verifierPassed) {
  nextAction = manualQaNeedsCompletion
    ? templateSync.required
      ? SYNC_MANUAL_QA_PROFILE_ACTION
      : currentManualQaProfileAction
    : "npm run qa:release:manual";
  nextActions = manualQaNeedsCompletion
    ? [nextAction, REVIEW_MANUAL_QA_PROGRESS_ACTION, COMPLETE_MANUAL_QA_ACTION]
    : [
        "fix release-artifacts/manual-qa-evidence.json",
        "npm run qa:release:manual",
      ];
} else if (!status.releasePackage.verifierPassed) {
  nextAction = "npm run package:release";
  nextActions = ["npm run package:release", "npm run verify:release-package"];
} else if (!status.cwsPackage.verifierPassed) {
  nextAction = "npm run build:cws";
  nextActions = [
    "npm run build:cws",
    "npm run verify:cws-package",
    "npm run qa:release:status",
  ];
} else {
  overall = "ready";
  nextActions = READY_NEXT_ACTIONS;
  nextAction = READY_NEXT_ACTIONS[0];
}

const report = { overall, nextAction, nextActions, ...status };
const requireReady = process.argv.includes("--require-ready");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Release status: ${overall}`);
  console.log(`Next action: ${nextAction}`);
  if (nextActions.length) {
    console.log(overall === "ready" ? "Release handoff:" : "Next steps:");
    for (const action of nextActions) {
      console.log(`  - ${action}`);
    }
  }
  console.log("");
  for (const [label, item] of Object.entries(status)) {
    const verifier =
      "verifierPassed" in item
        ? `, verifier=${item.verifierPassed ? "passed" : "failed"}`
        : "";
    const displayStatus = item.gateStatus || item.status;
    console.log(`${label}: ${displayStatus} (${item.path}${verifier})`);
    if (item.remainingReleaseWork) {
      console.log(`  ${item.remainingReleaseWork}`);
    }
    if (!item.verifierPassed && item.verifierErrorCount) {
      const firstSummary = item.verifierSummary?.[0]
        ? `; first: ${item.verifierSummary[0]}`
        : "";
      console.log(
        `  ${item.verifierErrorCount} verifier issue(s)${firstSummary}`
      );
    }
    if (label === "manualQa" && item.todo?.length) {
      if (item.activeSession) {
        console.log(
          `  Active clean-profile session: ${
            item.activeSession.usable
              ? `resumable (${item.activeSession.profileDir})`
              : item.activeSession.reason
          }`
        );
      }
      console.log("  Manual QA todo:");
      for (const todo of item.todo) {
        console.log(`    - ${todo}`);
      }
    }
    if (item.failedStep?.script) {
      const exitCode =
        typeof item.failedStep.exitCode === "number"
          ? ` exit code ${item.failedStep.exitCode}`
          : "";
      console.log(`  failed step: ${item.failedStep.script}${exitCode}`);
    }
  }
}

if (requireReady && overall !== "ready") {
  console.error(
    `Release status must be ready before this action can continue; current status is ${overall}.`
  );
  console.error(`Next action: ${nextAction}`);
  process.exit(1);
}
