#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { platform, release, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSynchronizedManualTemplate } from "./manual-qa-template-sync.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_MANUAL_QA_PROFILE_ROOT
  ? resolve(process.env.SAYLESS_MANUAL_QA_PROFILE_ROOT)
  : DEFAULT_ROOT;
const BUILD_DIR = join(ROOT, "build");
const BUILD_MANIFEST_PATH = join(BUILD_DIR, "manifest.json");
const AUTOMATED_EVIDENCE_PATH = join(ROOT, "release-artifacts", "release-qa-automated.json");
const MANUAL_EVIDENCE_PATH = join(ROOT, "release-artifacts", "manual-qa-evidence.json");
const ACTIVE_SESSION_PATH = join(ROOT, "release-artifacts", "manual-qa-session.json");
const MANUAL_EVIDENCE_VERIFIER_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "verify-manual-qa-evidence.mjs",
);
const PROFILE_MARKER_FILE = ".sayless-manual-qa-profile.json";
const PROFILE_MARKER_KIND = "sayless.manualQaProfile";
const ACTIVE_SESSION_KIND = "sayless.manualQaSession";
const MANUAL_SESSION_PROVENANCE_KIND = "sayless.manualQaSessionProvenance";

const args = process.argv.slice(2);
const shouldLaunch = args.includes("--launch");
const asJson = args.includes("--json");
const shouldSyncTemplate = args.includes("--sync-template");
const shouldResumeProfile = args.includes("--resume-profile");
const failEarly = (message) => {
  if (asJson) {
    console.error(JSON.stringify({ status: "failed", error: message }, null, 2));
  } else {
    console.error(`Manual QA profile helper failed: ${message}`);
  }
  process.exit(1);
};
const unknownArgs = args.filter(
  (arg) =>
    arg !== "--launch" &&
    arg !== "--json" &&
    arg !== "--sync-template" &&
    arg !== "--resume-profile" &&
    !arg.startsWith("--profile-dir="),
);
if (unknownArgs.length > 0) {
  failEarly(`unknown manual QA profile option: ${unknownArgs[0]}`);
}
const profileArgs = args.filter((arg) => arg.startsWith("--profile-dir="));
if (profileArgs.length > 1) {
  failEarly("manual QA profile helper accepts at most one --profile-dir option.");
}
const profileArg = profileArgs[0];
const requestedProfileDir = profileArg ? profileArg.slice("--profile-dir=".length) : null;
if (profileArg && requestedProfileDir.length === 0) {
  failEarly("manual QA profile --profile-dir value must not be empty.");
}
if (shouldResumeProfile && !requestedProfileDir) {
  failEarly("--resume-profile requires --profile-dir=<existing-session-dir>.");
}
if (shouldResumeProfile && shouldSyncTemplate) {
  failEarly(
    "--resume-profile cannot be combined with --sync-template; synchronize before starting a new clean-profile session.",
  );
}

const readBuildManifest = () => {
  if (!existsSync(BUILD_MANIFEST_PATH)) {
    throw new Error("build/manifest.json is missing. Run npm run qa:release:auto first.");
  }
  try {
    return JSON.parse(readFileSync(BUILD_MANIFEST_PATH, "utf8"));
  } catch (error) {
    throw new Error(`build/manifest.json is not valid JSON: ${error.message}`);
  }
};

const readAutomatedEvidence = () => {
  if (!existsSync(AUTOMATED_EVIDENCE_PATH)) {
    throw new Error(
      "release-artifacts/release-qa-automated.json is missing. Run npm run qa:release:auto first.",
    );
  }
  try {
    return JSON.parse(readFileSync(AUTOMATED_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `release-artifacts/release-qa-automated.json is not valid JSON: ${error.message}`,
    );
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

const dirSize = (dir) => walkFiles(dir).reduce((total, file) => total + file.size, 0);

const gitOutput = (gitArgs) => {
  const result = spawnSync("git", gitArgs, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitLines = (gitArgs) => {
  const output = gitOutput(gitArgs);
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

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const validateAutomatedEvidence = (automatedEvidence, manifest) => {
  if (automatedEvidence.status !== "passed") {
    throw new Error(
      'automated QA evidence status must be "passed". Run npm run qa:release:auto first.',
    );
  }
  if (!isIsoDate(automatedEvidence.generatedAt)) {
    throw new Error(
      "automated QA evidence generatedAt must be an ISO UTC timestamp. Run npm run qa:release:auto first.",
    );
  }
  if (automatedEvidence.build?.path !== "build") {
    throw new Error("automated QA evidence build.path must be the canonical relative build path.");
  }
  if (automatedEvidence.releaseVersion !== manifest.version) {
    throw new Error(
      `automated QA evidence releaseVersion ${
        automatedEvidence.releaseVersion || "missing"
      } does not match build manifest version ${manifest.version || "missing"}.`,
    );
  }
  const currentBuild = dirFingerprint(BUILD_DIR);
  const currentBuildBytes = dirSize(BUILD_DIR);
  if (
    automatedEvidence.build?.sha256 !== currentBuild.sha256 ||
    automatedEvidence.build?.fileCount !== currentBuild.fileCount
  ) {
    throw new Error(
      "current build fingerprint does not match automated QA evidence. Run npm run qa:release:auto first.",
    );
  }
  if (automatedEvidence.build?.bytes !== currentBuildBytes) {
    throw new Error(
      "current build byte size does not match automated QA evidence. Run npm run qa:release:auto first.",
    );
  }
  if (automatedEvidence.build?.formattedBytes !== formatBytes(currentBuildBytes)) {
    throw new Error(
      "automated QA evidence build.formattedBytes must match current build byte size. Run npm run qa:release:auto first.",
    );
  }
  const currentWorkingTree = gitWorktreeFingerprint();
  const recordedWorkingTree = automatedEvidence.git?.workingTree;
  if (!recordedWorkingTree || typeof recordedWorkingTree !== "object") {
    throw new Error(
      "automated QA evidence git.workingTree is required. Run npm run qa:release:auto first.",
    );
  }
  if (recordedWorkingTree.sha256 !== currentWorkingTree.sha256) {
    throw new Error(
      "automated QA evidence git.workingTree.sha256 must match the current git worktree. Run npm run qa:release:auto first.",
    );
  }
  if (recordedWorkingTree.fileCount !== currentWorkingTree.fileCount) {
    throw new Error(
      "automated QA evidence git.workingTree.fileCount must match the current git worktree. Run npm run qa:release:auto first.",
    );
  }
  if (recordedWorkingTree.statusSha256 !== currentWorkingTree.statusSha256) {
    throw new Error(
      "automated QA evidence git.workingTree.statusSha256 must match the current git status. Run npm run qa:release:auto first.",
    );
  }
  if (
    !/^[a-p]{32}$/.test(automatedEvidence.builtExtension?.id || "") ||
    automatedEvidence.builtExtension?.buildPath !== "build" ||
    automatedEvidence.builtExtension?.cleanChromeProfile !== true ||
    !isIsoDate(automatedEvidence.builtExtension?.observedAt) ||
    Date.parse(automatedEvidence.builtExtension.observedAt) <
      Date.parse(automatedEvidence.startedAt) ||
    Date.parse(automatedEvidence.builtExtension.observedAt) >
      Date.parse(automatedEvidence.generatedAt) ||
    !Number.isInteger(automatedEvidence.builtExtension?.summaryCount) ||
    automatedEvidence.builtExtension.summaryCount <= 0
  ) {
    throw new Error(
      "automated QA evidence must include passing clean-profile built-extension identity evidence. Run npm run qa:release:auto first.",
    );
  }
};

const quoteShellArg = (value) => {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const findChrome = () => {
  if (process.env.SAYLESS_CHROME) {
    return {
      command: process.env.SAYLESS_CHROME,
      found: existsSync(process.env.SAYLESS_CHROME),
    };
  }
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [
            join(
              process.env.PROGRAMFILES || "C:\\Program Files",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
            join(
              process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return { command: found, found: true };
  return {
    command: process.platform === "win32" ? "chrome.exe" : "google-chrome",
    found: false,
  };
};

const detectOperatingSystem = () => {
  if (platform() === "darwin") {
    const result = spawnSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
    });
    const version = result.status === 0 ? result.stdout.trim() : "";
    return version ? `macOS ${version}` : `macOS ${release()}`;
  }
  if (platform() === "win32") return `Windows ${release()}`;
  if (platform() === "linux") return `Linux ${release()}`;
  return `${platform()} ${release()}`;
};

const detectChromeVersion = (chrome) => {
  if (!chrome.found) return null;
  const result = spawnSync(chrome.command, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0 || result.error) return null;
  const version = `${result.stdout || ""}\n${result.stderr || ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return version || null;
};

const validateNewProfileDir = (profileDir) => {
  if (!existsSync(profileDir)) return;
  const stat = statSync(profileDir);
  if (!stat.isDirectory()) {
    throw new Error("manual QA profile directory must be a new or empty directory.");
  }
  if (readdirSync(profileDir).length > 0) {
    throw new Error(
      "manual QA profile directory must be empty so manual QA uses a clean Chrome profile.",
    );
  }
};

const profileMarkerRecord = ({
  createdAt,
  manifest,
  automatedEvidence,
  detectedEnvironment,
  browserCommand,
}) => ({
  kind: PROFILE_MARKER_KIND,
  createdAt,
  releaseVersion: manifest.version,
  automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  buildSha256: automatedEvidence.build.sha256,
  buildFileCount: automatedEvidence.build.fileCount,
  buildBytes: automatedEvidence.build.bytes,
  unpackedExtensionId: automatedEvidence.builtExtension.id,
  operatingSystem: detectedEnvironment.os,
  browserCommand,
  browserVersion: detectedEnvironment.chromeVersion,
});

const validateProfileMarker = (
  marker,
  { manifest, automatedEvidence, detectedEnvironment, browserCommand },
) => {
  const expected = profileMarkerRecord({
    createdAt: marker?.createdAt,
    manifest,
    automatedEvidence,
    detectedEnvironment,
    browserCommand,
  });
  if (marker?.kind !== PROFILE_MARKER_KIND) {
    throw new Error(`manual QA profile marker kind must be ${PROFILE_MARKER_KIND}.`);
  }
  if (!isIsoDate(marker.createdAt)) {
    throw new Error("manual QA profile marker createdAt must be an ISO UTC timestamp.");
  }
  for (const field of [
    "releaseVersion",
    "automatedEvidenceGeneratedAt",
    "buildSha256",
    "buildFileCount",
    "buildBytes",
    "unpackedExtensionId",
    "operatingSystem",
    "browserCommand",
    "browserVersion",
  ]) {
    if (marker[field] !== expected[field]) {
      throw new Error(
        `manual QA profile marker ${field} does not match the current release evidence or test environment; start a new clean-profile session.`,
      );
    }
  }
};

const prepareProfileDir = (
  profileDir,
  { resume, createdAt, manifest, automatedEvidence, detectedEnvironment, browserCommand },
) => {
  const markerPath = join(profileDir, PROFILE_MARKER_FILE);
  if (resume) {
    if (!existsSync(profileDir) || !statSync(profileDir).isDirectory()) {
      throw new Error("resumed manual QA profile directory must be an existing directory.");
    }
    if (!existsSync(markerPath) || !statSync(markerPath).isFile()) {
      throw new Error(
        `resumed manual QA profile is missing ${PROFILE_MARKER_FILE}; arbitrary existing Chrome profiles cannot be used.`,
      );
    }
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch (error) {
      throw new Error(`manual QA profile marker is not valid JSON: ${error.message}`);
    }
    validateProfileMarker(marker, {
      manifest,
      automatedEvidence,
      detectedEnvironment,
      browserCommand,
    });
    return { marker, markerPath, mode: "resumed" };
  }

  validateNewProfileDir(profileDir);
  mkdirSync(profileDir, { recursive: true });
  const marker = profileMarkerRecord({
    createdAt,
    manifest,
    automatedEvidence,
    detectedEnvironment,
    browserCommand,
  });
  const temporaryMarkerPath = `${markerPath}.tmp-${process.pid}`;
  writeFileSync(temporaryMarkerPath, `${JSON.stringify(marker, null, 2)}\n`);
  renameSync(temporaryMarkerPath, markerPath);
  return { marker, markerPath, mode: "new" };
};

const readCanonicalManualEvidenceTemplate = () => {
  const result = spawnSync(process.execPath, [MANUAL_EVIDENCE_VERIFIER_PATH, "--print-template"], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: ROOT },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `could not read the canonical manual QA template: ${(
        result.stderr ||
        result.stdout ||
        "unknown verifier error"
      ).trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`canonical manual QA template is not valid JSON: ${error.message}`);
  }
};

const syncManualEvidenceTemplate = (manifest, automatedEvidence, environmentPrefill) => {
  if (!existsSync(MANUAL_EVIDENCE_PATH)) {
    throw new Error(
      "release-artifacts/manual-qa-evidence.json is missing. Run npm run qa:release:manual:template first.",
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(MANUAL_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `release-artifacts/manual-qa-evidence.json is not valid JSON: ${error.message}`,
    );
  }
  if (evidence.kind !== "sayless.manualQaEvidence") {
    throw new Error(
      "manual QA evidence kind must be sayless.manualQaEvidence before template synchronization.",
    );
  }
  if (evidence.status !== "template") {
    throw new Error(
      'manual QA evidence status must be "template" for --sync-template; existing observations were not changed.',
    );
  }
  const synchronized = buildSynchronizedManualTemplate({
    canonicalTemplate: readCanonicalManualEvidenceTemplate(),
    evidence,
    releaseVersion: manifest.version,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    environmentPrefill,
  });
  const temporaryPath = `${MANUAL_EVIDENCE_PATH}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(synchronized, null, 2)}\n`);
  renameSync(temporaryPath, MANUAL_EVIDENCE_PATH);
  return "release-artifacts/manual-qa-evidence.json";
};

const writeActiveSession = ({
  updatedAt,
  profileDir,
  profileMarkerPath,
  profileCreatedAt,
  manifest,
  automatedEvidence,
  detectedEnvironment,
  browserCommand,
}) => {
  const record = {
    kind: ACTIVE_SESSION_KIND,
    status: "active",
    updatedAt,
    profileDir,
    profileMarkerPath,
    profileCreatedAt,
    releaseVersion: manifest.version,
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
    buildSha256: automatedEvidence.build.sha256,
    unpackedExtensionId: automatedEvidence.builtExtension.id,
    operatingSystem: detectedEnvironment.os,
    browserCommand,
    browserVersion: detectedEnvironment.chromeVersion,
  };
  mkdirSync(dirname(ACTIVE_SESSION_PATH), { recursive: true });
  const temporaryPath = `${ACTIVE_SESSION_PATH}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporaryPath, ACTIVE_SESSION_PATH);
  return {
    path: "release-artifacts/manual-qa-session.json",
    record,
  };
};

const manualSessionProvenanceRecord = ({
  profileCreatedAt,
  manifest,
  automatedEvidence,
  detectedEnvironment,
}) => ({
  kind: MANUAL_SESSION_PROVENANCE_KIND,
  profileCreatedAt,
  releaseVersion: manifest.version,
  automatedEvidenceGeneratedAt: automatedEvidence.generatedAt,
  buildSha256: automatedEvidence.build.sha256,
  buildFileCount: automatedEvidence.build.fileCount,
  buildBytes: automatedEvidence.build.bytes,
  unpackedExtensionId: automatedEvidence.builtExtension.id,
  operatingSystem: detectedEnvironment.os,
  browserVersion: detectedEnvironment.chromeVersion,
});

const writeManualSessionProvenance = ({
  profileCreatedAt,
  manifest,
  automatedEvidence,
  detectedEnvironment,
}) => {
  if (!existsSync(MANUAL_EVIDENCE_PATH)) {
    throw new Error(
      "release-artifacts/manual-qa-evidence.json is missing. Synchronize its template before launching manual QA.",
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(MANUAL_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `release-artifacts/manual-qa-evidence.json is not valid JSON: ${error.message}`,
    );
  }
  if (evidence.kind !== "sayless.manualQaEvidence") {
    throw new Error(
      "manual QA evidence kind must be sayless.manualQaEvidence before recording launch provenance.",
    );
  }
  if (
    evidence.releaseVersion !== manifest.version ||
    evidence.automatedEvidenceGeneratedAt !== automatedEvidence.generatedAt
  ) {
    throw new Error(
      "manual QA evidence is not synchronized to the current automated evidence; synchronize a template before launching.",
    );
  }
  const record = manualSessionProvenanceRecord({
    profileCreatedAt,
    manifest,
    automatedEvidence,
    detectedEnvironment,
  });
  if (evidence.status === "passed") {
    if (JSON.stringify(evidence.manualSession) !== JSON.stringify(record)) {
      throw new Error(
        "passed manual QA evidence has different session provenance and was not changed.",
      );
    }
    return { path: "release-artifacts/manual-qa-evidence.json", recorded: false };
  }
  if (evidence.status !== "template") {
    throw new Error(
      'manual QA evidence status must be "template" or a matching "passed" record before recording launch provenance.',
    );
  }
  const temporaryPath = `${MANUAL_EVIDENCE_PATH}.tmp-${process.pid}`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ ...evidence, manualSession: record }, null, 2)}\n`,
  );
  renameSync(temporaryPath, MANUAL_EVIDENCE_PATH);
  return { path: "release-artifacts/manual-qa-evidence.json", recorded: true };
};

const launchChrome = (command, commandArgs) =>
  new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
    });
    let launchSettled = false;
    child.once("spawn", () => {
      launchSettled = true;
      child.unref();
      resolveLaunch();
    });
    child.once("error", (error) => {
      if (launchSettled) return;
      launchSettled = true;
      rejectLaunch(new Error(`could not launch the selected Chrome executable: ${error.message}`));
    });
  });

const fail = (message) => {
  if (asJson) {
    console.error(JSON.stringify({ status: "failed", error: message }, null, 2));
  } else {
    console.error(`Manual QA profile helper failed: ${message}`);
  }
  process.exit(1);
};

try {
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const manifest = readBuildManifest();
  const automatedEvidence = readAutomatedEvidence();
  validateAutomatedEvidence(automatedEvidence, manifest);
  const chrome = findChrome();
  const detectedEnvironment = {
    os: detectOperatingSystem(),
    chromeVersion: detectChromeVersion(chrome),
    unpackedExtensionId: automatedEvidence.builtExtension.id,
  };
  const synchronizedTemplatePath = shouldSyncTemplate
    ? syncManualEvidenceTemplate(manifest, automatedEvidence, detectedEnvironment)
    : null;
  const profileDir = resolve(
    requestedProfileDir ||
      join(tmpdir(), `sayless-release-manual-qa-${manifest.version || "unknown"}-${timestamp}`),
  );
  const preparedProfile = prepareProfileDir(profileDir, {
    resume: shouldResumeProfile,
    createdAt,
    manifest,
    automatedEvidence,
    detectedEnvironment,
    browserCommand: chrome.command,
  });
  const commandArgs = [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--disable-extensions-except=${BUILD_DIR}`,
    `--load-extension=${BUILD_DIR}`,
    "chrome://extensions/",
  ];
  const command = [chrome.command, ...commandArgs];
  const resumeCommand = [
    "npm",
    "run",
    "qa:release:manual:profile",
    "--",
    `--profile-dir=${profileDir}`,
    "--resume-profile",
    "--launch",
  ];
  let activeSession = null;
  let manualSessionProvenance = null;
  if (shouldLaunch) {
    if (!chrome.found && !process.env.SAYLESS_CHROME) {
      fail("Cannot launch Chrome automatically. Set SAYLESS_CHROME to the Chrome executable path.");
    }
    await launchChrome(chrome.command, commandArgs);
    manualSessionProvenance = writeManualSessionProvenance({
      profileCreatedAt: preparedProfile.marker.createdAt,
      manifest,
      automatedEvidence,
      detectedEnvironment,
    });
    activeSession = writeActiveSession({
      updatedAt: new Date().toISOString(),
      profileDir,
      profileMarkerPath: preparedProfile.markerPath,
      profileCreatedAt: preparedProfile.marker.createdAt,
      manifest,
      automatedEvidence,
      detectedEnvironment,
      browserCommand: chrome.command,
    });
  }
  const summary = {
    buildPath: "build",
    buildManifestVersion: manifest.version || null,
    automatedEvidencePath: "release-artifacts/release-qa-automated.json",
    automatedEvidenceGeneratedAt: automatedEvidence.generatedAt || null,
    buildSha256: automatedEvidence.build?.sha256 || null,
    buildBytes: automatedEvidence.build?.bytes || null,
    buildFormattedBytes: automatedEvidence.build?.formattedBytes || null,
    browserCommand: chrome.command,
    browserFound: chrome.found,
    browserObservedExtensionId: automatedEvidence.builtExtension.id,
    detectedEnvironment,
    profileDir,
    profileMode: preparedProfile.mode,
    profileMarkerPath: preparedProfile.markerPath,
    profileCreatedAt: preparedProfile.marker.createdAt,
    resumeCommand,
    activeSessionPath: activeSession?.path || null,
    activeSessionRecorded: Boolean(activeSession),
    manualSessionProvenancePath: manualSessionProvenance?.path || null,
    manualSessionProvenanceRecorded: manualSessionProvenance?.recorded || false,
    templateSynchronized: Boolean(synchronizedTemplatePath),
    synchronizedTemplatePath,
    command,
    evidenceReminder: {
      cleanChromeProfile: true,
      extensionSource: "build",
      recordUnpackedExtensionIdFrom: "chrome://extensions/",
      expectedUnpackedExtensionId: automatedEvidence.builtExtension.id,
    },
    evidencePrefill: {
      automatedEvidencePath: "release-artifacts/release-qa-automated.json",
      automatedEvidenceGeneratedAt: automatedEvidence.generatedAt || null,
      environment: {
        ...(detectedEnvironment.os ? { os: detectedEnvironment.os } : {}),
        ...(detectedEnvironment.chromeVersion
          ? { chromeVersion: detectedEnvironment.chromeVersion }
          : {}),
        unpackedExtensionId: detectedEnvironment.unpackedExtensionId,
        extensionSource: "build",
        cleanChromeProfile: true,
      },
    },
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Manual QA clean-profile Chrome command:");
    console.log(command.map(quoteShellArg).join(" "));
    console.log("");
    console.log(`Build: build (${manifest.version || "unknown version"})`);
    console.log(
      `Automated evidence: release-artifacts/release-qa-automated.json (${automatedEvidence.generatedAt})`,
    );
    console.log(`Build fingerprint: ${automatedEvidence.build?.sha256 || "missing"}`);
    console.log(`Profile directory: ${profileDir}`);
    console.log(`Profile mode: ${preparedProfile.mode}`);
    console.log(`Detected OS: ${detectedEnvironment.os}`);
    console.log(
      `Detected browser version: ${
        detectedEnvironment.chromeVersion || "unavailable; record it from Chrome"
      }`,
    );
    console.log(
      `Browser found: ${
        chrome.found ? "yes" : "no; set SAYLESS_CHROME to the Chrome executable path"
      }`,
    );
    if (synchronizedTemplatePath) {
      console.log(`Synchronized template provenance: ${synchronizedTemplatePath}`);
    }
    console.log("");
    console.log(
      "Use chrome://extensions/ to copy the unpacked extension id into release-artifacts/manual-qa-evidence.json.",
    );
    console.log(
      "The synchronized template prefills detected OS/browser versions when their placeholders are untouched; verify them in Chrome before relying on them.",
    );
    console.log(
      "Use the printed automated evidence timestamp and keep environment.cleanChromeProfile true and environment.extensionSource set to build.",
    );
    console.log(
      `Resume this exact session after closing Chrome: ${resumeCommand
        .map(quoteShellArg)
        .join(" ")}`,
    );
  }

  if (shouldLaunch) {
    if (!asJson) {
      console.log(`Launched ${preparedProfile.mode} clean-profile Chrome session for manual QA.`);
      console.log(
        "Recorded the active session at release-artifacts/manual-qa-session.json so release status can validate and recommend its resume command.",
      );
      console.log(
        "Recorded portable launch provenance in release-artifacts/manual-qa-evidence.json without machine-local profile or browser paths.",
      );
    }
  }
} catch (error) {
  fail(error.message);
}
