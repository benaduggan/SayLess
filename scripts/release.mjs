#!/usr/bin/env node
// release prep: bumps manifest + package version, then prints the
// local-first QA and packaging checklist. Artifact creation stays in
// package:release so manual QA evidence can reference the exact
// automated QA run it validates.
//
// usage: node scripts/release.mjs <patch|minor|major> [--dry-run]

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST_PATH = join(ROOT, "src", "manifest.json");
const PACKAGE_PATH = join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = join(ROOT, "package-lock.json");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const bumpKind = args.find((a) => ["patch", "minor", "major"].includes(a));

if (!bumpKind) {
  console.error(
    "Usage: node scripts/release.mjs [--dry-run] patch|minor|major"
  );
  process.exit(2);
}

const shCapture = (cmd) =>
  execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();

const bumpSemver = (version, kind) => {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Cannot parse version: ${version}`);
  let [, major, minor, patch] = m.map(Number);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
};

const printReleaseChecklist = (
  version,
  commitsBlock,
  { dryRun = false } = {}
) => {
  const bar = "-".repeat(60);
  console.log(bar);
  console.log(`Release v${version} ${dryRun ? "preview" : "prepared"}`);
  console.log("");
  if (commitsBlock) {
    console.log(commitsBlock);
    console.log("");
  }
  console.log("Next steps:");
  console.log("  1. Run: npm run qa:release:auto");
  console.log("  2. Run: npm run qa:release:status");
  console.log("  3. Run: npm run qa:release:manual:template");
  console.log(
    "  4. Run: npm run qa:release:manual:profile -- --sync-template --launch"
  );
  console.log(
    "  5. Complete docs/RELEASE_QA.md in that clean profile, use the printed --resume-profile command if Chrome closes, keep every real source/export/project-audio/sidecar file, and fill release-artifacts/manual-qa-evidence.json section by section"
  );
  console.log("  6. Run throughout the session: npm run qa:release:manual:progress");
  console.log(
    "  7. After collecting the files, measure the complete real-media set: npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json <files...>"
  );
  console.log(
    "  8. After exporting the matched set, inspect it: npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json <files...>"
  );
  console.log(
    "  9. Preview and atomically import exact filename-matched measurements: npm run qa:release:manual:measurements -- --json --write"
  );
  console.log(
    ' 10. Only after both strict reports pass, set status to "passed", set testedAt, and run: npm run qa:release:manual:progress'
  );
  console.log(" 11. Run: npm run qa:release:manual");
  console.log(" 12. Run: npm run package:release");
  console.log(" 13. Run: npm run verify:release-package");
  console.log(" 14. Run: npm run build:cws");
  console.log(" 15. Run: npm run verify:cws-package");
  console.log(" 16. Run: npm run qa:release:status");
  console.log(
    " 17. Attach release-artifacts/release-qa-automated.json, release-artifacts/manual-qa-evidence.json, release-artifacts/manual-qa-media-probe.json, release-artifacts/manual-qa-sidecar-probe.json, release-artifacts/package-release.json, release-artifacts/cws-package.json, docs/STORE_LISTING.md, extension.zip, and build-cws.zip"
  );
  console.log(
    ` 18. Tag after review: git tag v${version} && git push origin v${version}`
  );
  console.log(bar);
};

try {
  const status = shCapture("git status --porcelain");
  if (status) {
    console.warn(
      "Warning: working tree has uncommitted changes. Continuing anyway.\n"
    );
  }
} catch {}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const pkg = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
const packageLock = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8"));
const currentManifestVersion = manifest.version;
const currentPkgVersion = pkg.version;

if (currentManifestVersion !== currentPkgVersion) {
  console.warn(
    `Warning: manifest (${currentManifestVersion}) and package.json (${currentPkgVersion}) versions differ.`
  );
  console.warn(`Bumping from manifest version (${currentManifestVersion}).\n`);
}

const nextVersion = bumpSemver(currentManifestVersion, bumpKind);

console.log(`Version bump: ${currentManifestVersion} -> ${nextVersion}`);

if (DRY_RUN) {
  console.log("\n--dry-run: no files written, no build run.");
  printReleaseChecklist(nextVersion, "", { dryRun: true });
  process.exit(0);
}

manifest.version = nextVersion;
pkg.version = nextVersion;
packageLock.version = nextVersion;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = nextVersion;
}
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(PACKAGE_LOCK_PATH, JSON.stringify(packageLock, null, 2) + "\n");
console.log("Wrote manifest.json, package.json, and package-lock.json.\n");

// Commit list since prior tag (raw input, no formatting).
let commitsBlock = "";
try {
  const lastTag = shCapture("git describe --tags --abbrev=0").trim();
  const log = shCapture(`git log --oneline ${lastTag}..HEAD`);
  commitsBlock = log
    ? `Commits since ${lastTag}:\n${log
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")}`
    : `No commits since ${lastTag}.`;
} catch {
  // No prior tag.
  const log = shCapture("git log --oneline -20");
  commitsBlock = `No prior tag found. Last 20 commits:\n${log
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n")}`;
}

printReleaseChecklist(nextVersion, commitsBlock);
