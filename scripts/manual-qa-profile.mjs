#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_MANUAL_QA_PROFILE_ROOT
  ? resolve(process.env.SAYLESS_MANUAL_QA_PROFILE_ROOT)
  : DEFAULT_ROOT;
const BUILD_DIR = join(ROOT, "build");
const BUILD_MANIFEST_PATH = join(BUILD_DIR, "manifest.json");
const AUTOMATED_EVIDENCE_PATH = join(ROOT, "release-artifacts", "release-qa-automated.json");

const args = process.argv.slice(2);
const shouldLaunch = args.includes("--launch");
const asJson = args.includes("--json");
const failEarly = (message) => {
  if (asJson) {
    console.error(JSON.stringify({ status: "failed", error: message }, null, 2));
  } else {
    console.error(`Manual QA profile helper failed: ${message}`);
  }
  process.exit(1);
};
const unknownArgs = args.filter(
  (arg) => arg !== "--launch" && arg !== "--json" && !arg.startsWith("--profile-dir="),
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
    throw new Error("release-artifacts/release-qa-automated.json is missing. Run npm run qa:release:auto first.");
  }
  try {
    return JSON.parse(readFileSync(AUTOMATED_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`release-artifacts/release-qa-automated.json is not valid JSON: ${error.message}`);
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

const dirSize = (dir) =>
  walkFiles(dir).reduce((total, file) => total + file.size, 0);

const gitOutput = (gitArgs) => {
  const result = spawnSync("git", gitArgs, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitLines = (gitArgs) => {
  const output = gitOutput(gitArgs);
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
    throw new Error('automated QA evidence status must be "passed". Run npm run qa:release:auto first.');
  }
  if (!isIsoDate(automatedEvidence.generatedAt)) {
    throw new Error("automated QA evidence generatedAt must be an ISO UTC timestamp. Run npm run qa:release:auto first.");
  }
  if (automatedEvidence.build?.path !== "build") {
    throw new Error("automated QA evidence build.path must be the canonical relative build path.");
  }
  if (automatedEvidence.releaseVersion !== manifest.version) {
    throw new Error(
      `automated QA evidence releaseVersion ${automatedEvidence.releaseVersion || "missing"} does not match build manifest version ${manifest.version || "missing"}.`,
    );
  }
  const currentBuild = dirFingerprint(BUILD_DIR);
  const currentBuildBytes = dirSize(BUILD_DIR);
  if (
    automatedEvidence.build?.sha256 !== currentBuild.sha256 ||
    automatedEvidence.build?.fileCount !== currentBuild.fileCount
  ) {
    throw new Error("current build fingerprint does not match automated QA evidence. Run npm run qa:release:auto first.");
  }
  if (automatedEvidence.build?.bytes !== currentBuildBytes) {
    throw new Error("current build byte size does not match automated QA evidence. Run npm run qa:release:auto first.");
  }
  if (automatedEvidence.build?.formattedBytes !== formatBytes(currentBuildBytes)) {
    throw new Error("automated QA evidence build.formattedBytes must match current build byte size. Run npm run qa:release:auto first.");
  }
  const currentWorkingTree = gitWorktreeFingerprint();
  const recordedWorkingTree = automatedEvidence.git?.workingTree;
  if (!recordedWorkingTree || typeof recordedWorkingTree !== "object") {
    throw new Error("automated QA evidence git.workingTree is required. Run npm run qa:release:auto first.");
  }
  if (recordedWorkingTree.sha256 !== currentWorkingTree.sha256) {
    throw new Error("automated QA evidence git.workingTree.sha256 must match the current git worktree. Run npm run qa:release:auto first.");
  }
  if (recordedWorkingTree.fileCount !== currentWorkingTree.fileCount) {
    throw new Error("automated QA evidence git.workingTree.fileCount must match the current git worktree. Run npm run qa:release:auto first.");
  }
  if (recordedWorkingTree.statusSha256 !== currentWorkingTree.statusSha256) {
    throw new Error("automated QA evidence git.workingTree.statusSha256 must match the current git status. Run npm run qa:release:auto first.");
  }
};

const quoteShellArg = (value) => {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const findChrome = () => {
  if (process.env.SAYLESS_CHROME) {
    return { command: process.env.SAYLESS_CHROME, found: existsSync(process.env.SAYLESS_CHROME) };
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
            join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
            join(
              process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return { command: found, found: true };
  return { command: process.platform === "win32" ? "chrome.exe" : "google-chrome", found: false };
};

const validateProfileDir = (profileDir) => {
  if (!existsSync(profileDir)) return;
  const stat = statSync(profileDir);
  if (!stat.isDirectory()) {
    throw new Error("manual QA profile directory must be a new or empty directory.");
  }
  if (readdirSync(profileDir).length > 0) {
    throw new Error("manual QA profile directory must be empty so manual QA uses a clean Chrome profile.");
  }
};

const fail = (message) => {
  if (asJson) {
    console.error(JSON.stringify({ status: "failed", error: message }, null, 2));
  } else {
    console.error(`Manual QA profile helper failed: ${message}`);
  }
  process.exit(1);
};

try {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifest = readBuildManifest();
  const automatedEvidence = readAutomatedEvidence();
  validateAutomatedEvidence(automatedEvidence, manifest);
  const chrome = findChrome();
  const profileDir = resolve(
    requestedProfileDir || join(tmpdir(), `sayless-release-manual-qa-${manifest.version || "unknown"}-${timestamp}`),
  );
  validateProfileDir(profileDir);
  const commandArgs = [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--disable-extensions-except=${BUILD_DIR}`,
    `--load-extension=${BUILD_DIR}`,
    "chrome://extensions/",
  ];
  const command = [chrome.command, ...commandArgs];
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
    profileDir,
    command,
    evidenceReminder: {
      cleanChromeProfile: true,
      extensionSource: "build",
      recordUnpackedExtensionIdFrom: "chrome://extensions/",
    },
    evidencePrefill: {
      automatedEvidencePath: "release-artifacts/release-qa-automated.json",
      automatedEvidenceGeneratedAt: automatedEvidence.generatedAt || null,
      environment: {
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
    console.log(`Automated evidence: release-artifacts/release-qa-automated.json (${automatedEvidence.generatedAt})`);
    console.log(`Build fingerprint: ${automatedEvidence.build?.sha256 || "missing"}`);
    console.log(`Profile directory: ${profileDir}`);
    console.log(`Browser found: ${chrome.found ? "yes" : "no; set SAYLESS_CHROME to the Chrome executable path"}`);
    console.log("");
    console.log("Use chrome://extensions/ to copy the unpacked extension id into release-artifacts/manual-qa-evidence.json.");
    console.log("Use the printed automated evidence timestamp and keep environment.cleanChromeProfile true and environment.extensionSource set to build.");
  }

  if (shouldLaunch) {
    if (!chrome.found && !process.env.SAYLESS_CHROME) {
      fail("Cannot launch Chrome automatically. Set SAYLESS_CHROME to the Chrome executable path.");
    }
    const child = spawn(chrome.command, commandArgs, {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    if (!asJson) console.log("Launched clean-profile Chrome for manual QA.");
  }
} catch (error) {
  fail(error.message);
}
