#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_RELEASE_QA_ROOT
  ? resolve(process.env.SAYLESS_RELEASE_QA_ROOT)
  : DEFAULT_ROOT;
const BUILD_DIR = join(ROOT, "build");
const WHISPER_BUILD_DIR = join(BUILD_DIR, "assets", "whisper");
const EVIDENCE_DIR = join(ROOT, "release-artifacts");
const EVIDENCE_PATH = join(EVIDENCE_DIR, "release-qa-automated.json");
const PACKAGE_PATH = join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = join(ROOT, "package-lock.json");
const SOURCE_MANIFEST_PATH = join(ROOT, "src", "manifest.json");
const BUILD_MANIFEST_PATH = join(BUILD_DIR, "manifest.json");
const BUILT_EXTENSION_EVIDENCE_PATH = join(EVIDENCE_DIR, "built-extension-surface.json");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  { label: "lint", command: npm, args: ["run", "lint"] },
  { label: "format:check", command: npm, args: ["run", "format:check"] },
  { label: "typecheck", command: npm, args: ["run", "typecheck"] },
  { label: "test:unit", command: npm, args: ["run", "test:unit"] },
  {
    label: "test:e2e:offline-whisper-assets",
    command: npm,
    args: ["run", "test:e2e:offline-whisper-assets"],
  },
  {
    label: "test:e2e:offline-transcription-smoke",
    command: npm,
    args: ["run", "test:e2e:offline-transcription-smoke"],
  },
  {
    label: "test:e2e:offline-transcription-speech",
    command: npm,
    args: ["run", "test:e2e:offline-transcription-speech"],
    when: process.platform === "darwin",
    skipReason: "requires macOS say/afconvert speech synthesis tools",
  },
  {
    label: "test:e2e:local-recordings",
    command: npm,
    args: ["run", "test:e2e:local-recordings"],
  },
  {
    label: "test:e2e:editor-layout",
    command: npm,
    args: ["run", "test:e2e:editor-layout"],
  },
  { label: "build:release", command: npm, args: ["run", "build:release"] },
  {
    label: "test:e2e:editor-editing-proof",
    command: npm,
    args: ["run", "test:e2e:editor-editing-proof"],
  },
  {
    label: "test:e2e:built-extension-surface",
    command: npm,
    args: ["run", "test:e2e:built-extension-surface"],
  },
  { label: "verify:release", command: npm, args: ["run", "verify:release"] },
];

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const dirSize = (dir) => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    total += stat.isDirectory() ? dirSize(path) : stat.size;
  }
  return total;
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

const run = (label, command, args) => {
  const startedAt = Date.now();
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env },
    stdio: "inherit",
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    const error = new Error(`${label} failed with exit code ${result.status}`);
    error.commandLabel = label;
    error.command = [command, ...args].join(" ");
    error.exitCode = result.status;
    error.durationMs = durationMs;
    throw error;
  }
  return {
    label,
    status: "passed",
    command: [command, ...args].join(" "),
    durationMs,
  };
};

const gitValue = (args) => {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitLines = (args) => {
  const output = gitValue(args);
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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const readBuiltExtensionEvidence = () => {
  if (!existsSync(BUILT_EXTENSION_EVIDENCE_PATH)) {
    throw new Error("built-extension surface evidence is missing after its browser smoke.");
  }
  const browserEvidence = readJson(BUILT_EXTENSION_EVIDENCE_PATH);
  if (
    browserEvidence.kind !== "sayless.builtExtensionSurfaceEvidence" ||
    browserEvidence.status !== "passed" ||
    !/^[a-p]{32}$/.test(browserEvidence.extensionId || "") ||
    browserEvidence.buildPath !== "build" ||
    browserEvidence.cleanChromeProfile !== true ||
    !Number.isInteger(browserEvidence.summaryCount) ||
    browserEvidence.summaryCount <= 0 ||
    Number.isNaN(Date.parse(browserEvidence.generatedAt)) ||
    Date.parse(browserEvidence.generatedAt) < startedAt.getTime()
  ) {
    throw new Error("built-extension surface evidence is incomplete, stale, or invalid.");
  }
  return browserEvidence;
};

const arrayFrom = (value) => (Array.isArray(value) ? value : []);

const releaseManifestSurface = (manifest) => {
  const permissions = arrayFrom(manifest.permissions).slice().sort();
  const optionalPermissions = arrayFrom(manifest.optional_permissions).slice().sort();
  const hostPermissions = arrayFrom(manifest.host_permissions).slice().sort();
  const allPermissions = new Set([...permissions, ...optionalPermissions]);
  const csp =
    typeof manifest.content_security_policy?.extension_pages === "string"
      ? manifest.content_security_policy.extension_pages
      : "";
  const remoteConnectSrc =
    /\bconnect-src\b[^;]*(?:https?:|wss?:)/i.test(csp) || /\bconnect-src\b[^;]*\*/i.test(csp);
  return {
    permissions,
    optionalPermissions,
    hostPermissions,
    hasOauth2: Boolean(manifest.oauth2),
    hasExternallyConnectable: Boolean(manifest.externally_connectable),
    hasIdentityPermission: allPermissions.has("identity"),
    hasGoogleDrivePermission: allPermissions.has("drive.file"),
    hasRemoteConnectSrc: remoteConnectSrc,
    contentSecurityPolicyExtensionPages: csp,
  };
};

const writeFileAtomic = (path, bytes) => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const startedAt = new Date();
const results = [];
const skipped = [];
let builtExtensionEvidence = null;

const writeNonPassingEvidence = ({ status, error = null }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const kind =
    status === "failed"
      ? "sayless.releaseQaAutomatedFailed"
      : "sayless.releaseQaAutomatedIncomplete";
  const evidence = {
    kind,
    status,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    commands: results,
    skippedCommands: skipped,
    remainingManualQa:
      "Automated release QA has not passed. Rerun npm run qa:release:auto before filling manual QA evidence.",
  };
  if (error) {
    evidence.failedCommand = {
      label: error.commandLabel,
      command: error.command,
      exitCode: error.exitCode,
      durationMs: error.durationMs,
    };
  }
  writeFileAtomic(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
};

try {
  writeNonPassingEvidence({ status: "running" });
  for (const { label, command, args, when = true, skipReason } of commands) {
    if (!when) {
      console.log(`\n==> ${label} skipped: ${skipReason}`);
      skipped.push({ label, reason: skipReason });
      writeNonPassingEvidence({ status: "running" });
      continue;
    }
    results.push(run(label, command, args));
    writeNonPassingEvidence({ status: "running" });
  }
  builtExtensionEvidence = readBuiltExtensionEvidence();
} catch (err) {
  writeNonPassingEvidence({ status: "failed", error: err });
  console.error(`\nAutomated release QA failed: ${err.message}`);
  process.exit(1);
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const buildBytes = dirSize(BUILD_DIR);
const whisperBytes = dirSize(WHISPER_BUILD_DIR);
const buildFingerprint = dirFingerprint(BUILD_DIR);
const whisperFingerprint = dirFingerprint(WHISPER_BUILD_DIR);
const packageJson = readJson(PACKAGE_PATH);
const packageLock = readJson(PACKAGE_LOCK_PATH);
const sourceManifest = readJson(SOURCE_MANIFEST_PATH);
const buildManifest = readJson(BUILD_MANIFEST_PATH);
const evidence = {
  kind: "sayless.releaseQaAutomated",
  status: "passed",
  generatedAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  releaseVersion: packageJson.version,
  packageLockVersion: packageLock.version,
  packageLockRootVersion: packageLock.packages?.[""]?.version,
  manifestVersion: sourceManifest.version,
  buildManifestVersion: buildManifest.version,
  git: {
    branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: gitValue(["rev-parse", "HEAD"]),
    dirty: Boolean(gitValue(["status", "--porcelain"])),
    workingTree: gitWorktreeFingerprint(),
  },
  commands: results,
  skippedCommands: skipped,
  build: {
    path: relative(ROOT, BUILD_DIR),
    bytes: buildBytes,
    formattedBytes: formatBytes(buildBytes),
    fileCount: buildFingerprint.fileCount,
    sha256: buildFingerprint.sha256,
  },
  bundledWhisper: {
    path: relative(ROOT, WHISPER_BUILD_DIR),
    bytes: whisperBytes,
    formattedBytes: formatBytes(whisperBytes),
    fileCount: whisperFingerprint.fileCount,
    sha256: whisperFingerprint.sha256,
  },
  builtExtension: {
    id: builtExtensionEvidence.extensionId,
    buildPath: builtExtensionEvidence.buildPath,
    cleanChromeProfile: builtExtensionEvidence.cleanChromeProfile,
    observedAt: builtExtensionEvidence.generatedAt,
    summaryCount: builtExtensionEvidence.summaryCount,
  },
  releaseSurface: releaseManifestSurface(buildManifest),
  remainingManualQa:
    "Run npm run qa:release:manual:profile -- --sync-template --launch, complete docs/RELEASE_QA.md manual sections in that clean Chrome profile, then verify release-artifacts/manual-qa-evidence.json with npm run qa:release:manual before publishing.",
};

writeFileAtomic(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\nAutomated release QA passed.`);
console.log(`Evidence: ${relative(ROOT, EVIDENCE_PATH)}`);
console.log(`Build size: ${evidence.build.formattedBytes}`);
console.log(`Bundled Whisper assets: ${evidence.bundledWhisper.formattedBytes}`);
