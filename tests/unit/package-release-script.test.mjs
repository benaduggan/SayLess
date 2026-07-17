import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const packageReleaseScript = readFileSync(join(ROOT, "scripts", "package-release.mjs"), "utf8");
const packageCwsScript = readFileSync(join(ROOT, "scripts", "package-cws.mjs"), "utf8");
const verifyCwsPackageScript = readFileSync(join(ROOT, "scripts", "verify-cws-package.mjs"), "utf8");
const verifyReleasePackageScript = readFileSync(
  join(ROOT, "scripts", "verify-release-package.mjs"),
  "utf8",
);
const verifyManualQaScript = readFileSync(
  join(ROOT, "scripts", "verify-manual-qa-evidence.mjs"),
  "utf8",
);
const releaseAuditScript = readFileSync(join(ROOT, "scripts", "release-audit.mjs"), "utf8");
const releaseQaAutomatedScript = readFileSync(
  join(ROOT, "scripts", "release-qa-automated.mjs"),
  "utf8",
);
const verifyLocalWhisperAssetsScript = readFileSync(
  join(ROOT, "scripts", "verify-local-whisper-assets.mjs"),
  "utf8",
);
const verifyNoSecretsScript = readFileSync(join(ROOT, "scripts", "verify-no-secrets.mjs"), "utf8");
const manualQaProfileScript = readFileSync(join(ROOT, "scripts", "manual-qa-profile.mjs"), "utf8");
const builtExtensionSurfaceScript = readFileSync(
  join(ROOT, "tests", "e2e", "run-built-extension-surface.cjs"),
  "utf8",
);
const manualQaDoc = readFileSync(join(ROOT, "docs", "MANUAL_QA_EVIDENCE.md"), "utf8");
const releaseQaDoc = readFileSync(join(ROOT, "docs", "RELEASE_QA.md"), "utf8");
const capabilitiesDoc = readFileSync(join(ROOT, "docs", "CAPABILITIES.md"), "utf8");
const forkPlanDoc = readFileSync(join(ROOT, "docs", "FORK_PLAN.md"), "utf8");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const releaseScript = readFileSync(join(ROOT, "scripts", "release.mjs"), "utf8");
const releaseStatusScript = readFileSync(join(ROOT, "scripts", "release-status.mjs"), "utf8");
const buildScript = readFileSync(join(ROOT, "utils", "build.js"), "utf8");
const transcriptionConfigScript = readFileSync(
  join(ROOT, "src", "transcription", "config.js"),
  "utf8",
);

const walkFiles = (dir, root = dir) => {
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

const emptyGitWorkingTree = {
  sha256: createHash("sha256").digest("hex"),
  fileCount: 0,
  statusSha256: createHash("sha256").update("").digest("hex"),
};

test("package release script is the only package:release entrypoint", () => {
  assert.equal(packageJson.scripts["package:release"], "node scripts/package-release.mjs");
  assert.equal(packageJson.scripts.package, "npm run package:release");
  assert.equal(packageJson.scripts["verify:release-package"], "node scripts/verify-release-package.mjs");
  assert.equal(packageJson.scripts["qa:release:status"], "node scripts/release-status.mjs");
});

test("package release script fails through release gates before writing extension zip", () => {
  const manualGateIndex = packageReleaseScript.indexOf("verify-manual-qa-evidence.mjs");
  const secretScanIndex = packageReleaseScript.indexOf("verify-no-secrets.mjs");
  const zipWriteIndex = packageReleaseScript.indexOf("writeFileAtomic(EXTENSION_ZIP_PATH");
  const packageEvidenceIndex = packageReleaseScript.indexOf("package-release.json");
  const verifierIndex = packageReleaseScript.indexOf("verifyWrittenPackage()");
  const successIndex = packageReleaseScript.indexOf("Release package created.");

  assert.notEqual(manualGateIndex, -1);
  assert.notEqual(secretScanIndex, -1);
  assert.notEqual(zipWriteIndex, -1);
  assert.notEqual(packageEvidenceIndex, -1);
  assert.notEqual(verifierIndex, -1);
  assert.notEqual(successIndex, -1);
  assert.ok(manualGateIndex < zipWriteIndex);
  assert.ok(secretScanIndex < zipWriteIndex);
  assert.ok(packageEvidenceIndex < verifierIndex);
  assert.ok(verifierIndex < successIndex);
  assert.match(packageReleaseScript, /kind:\s*"sayless\.releasePackage"/);
  assert.match(packageReleaseScript, /status:\s*"passed"/);
  assert.match(packageReleaseScript, /writeNonPassingPackageEvidence/);
  assert.match(packageReleaseScript, /sayless\.releasePackageIncomplete/);
  assert.match(packageReleaseScript, /sayless\.releasePackageFailed/);
  assert.match(packageReleaseScript, /remainingReleaseWork/);
  assert.match(packageReleaseScript, /failedStep/);
  assert.match(packageReleaseScript, /releaseVersion:\s*automatedEvidence\.json\.releaseVersion/);
  assert.match(packageReleaseScript, /sha256:\s*createHash\("sha256"\)\.update\(zipBuffer\)/);
  assert.match(packageReleaseScript, /formattedBytes:\s*formatBytes\(zipBuffer\.length\)/);
  assert.match(packageReleaseScript, /bytes:\s*buildBytes/);
  assert.match(packageReleaseScript, /formattedBytes:\s*formatBytes\(buildBytes\)/);
  assert.match(packageReleaseScript, /automatedEvidence:\s*\{/);
  assert.match(packageReleaseScript, /manualEvidence:\s*\{/);
  assert.match(packageReleaseScript, /releaseVersion:\s*automatedEvidence\.json\.releaseVersion/);
  assert.match(packageReleaseScript, /releaseVersion:\s*manualEvidence\.json\.releaseVersion/);
  assert.match(packageReleaseScript, /status:\s*automatedEvidence\.json\.status/);
  assert.match(packageReleaseScript, /status:\s*manualEvidence\.json\.status/);
  assert.match(packageReleaseScript, /sha256:\s*automatedEvidence\.sha256/);
  assert.match(packageReleaseScript, /sha256:\s*manualEvidence\.sha256/);
  assert.match(packageReleaseScript, /writeFileAtomic\(EXTENSION_ZIP_PATH, zipBuffer\)/);
  assert.match(packageReleaseScript, /writeFileAtomic\(PACKAGE_EVIDENCE_PATH/);
  assert.doesNotMatch(packageReleaseScript, /unlinkSync\(EXTENSION_ZIP_PATH\)/);
  assert.match(packageReleaseScript, /SAYLESS_PACKAGE_RELEASE_ROOT/);
  assert.match(packageReleaseScript, /MANUAL_QA_VERIFIER_PATH/);
  assert.match(packageReleaseScript, /SAYLESS_MANUAL_QA_ROOT/);
  assert.match(packageReleaseScript, /NO_SECRETS_VERIFIER_PATH/);
  assert.match(packageReleaseScript, /SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT/);
  assert.match(packageReleaseScript, /verify-release-package\.mjs/);
  assert.match(packageReleaseScript, /const gitValue = \(args\) =>/);
  assert.match(packageReleaseScript, /automatedEvidence\.json\.git\?\.branch/);
  assert.match(packageReleaseScript, /automatedEvidence\.json\.git\?\.commit/);
  assert.match(packageReleaseScript, /automatedEvidence\.json\.git\?\.dirty/);
  assert.match(verifyReleasePackageScript, /package-release\.json/);
  assert.match(verifyReleasePackageScript, /extension\.zip/);
  assert.match(verifyReleasePackageScript, /isCanonicalRelativePath/);
  assert.match(verifyReleasePackageScript, /release-qa-automated\.json/);
  assert.match(verifyReleasePackageScript, /manual-qa-evidence\.json/);
  assert.match(verifyReleasePackageScript, /verify-manual-qa-evidence\.mjs/);
  assert.match(verifyReleasePackageScript, /SAYLESS_MANUAL_QA_ROOT/);
  assert.match(verifyReleasePackageScript, /manual QA evidence/);
  assert.match(verifyReleasePackageScript, /automated QA evidence/);
  assert.match(verifyReleasePackageScript, /appendNonPassingEvidenceDetails/);
  assert.match(verifyReleasePackageScript, /remainingReleaseWork/);
  assert.match(verifyReleasePackageScript, /failedStep/);
  assert.match(verifyReleasePackageScript, /package release evidence status must be "passed"/);
  assert.match(verifyReleasePackageScript, /manual QA evidence status must be "passed"/);
  assert.match(verifyReleasePackageScript, /package release evidence manual QA status must be "passed"/);
  assert.match(verifyReleasePackageScript, /manual QA evidence status must match package release evidence/);
  assert.match(verifyReleasePackageScript, /validateGitProvenance/);
  assert.match(
    verifyReleasePackageScript,
    /package release evidence generatedAt must be at or after automated QA evidence generatedAt/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence generatedAt must be at or after manual QA evidence testedAt/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence git provenance must match automated QA evidence/,
  );
  assert.match(verifyReleasePackageScript, /automated QA evidence status must be "passed"/);
  assert.match(verifyReleasePackageScript, /package release evidence automated QA status must be "passed"/);
  assert.match(verifyReleasePackageScript, /automated QA evidence status must match package release evidence/);
  assert.match(
    verifyReleasePackageScript,
    /package release evidence formatted zip size must match current extension\.zip size/,
  );
  assert.match(verifyReleasePackageScript, /package release evidence zip\.path is required/);
  assert.match(
    verifyReleasePackageScript,
    /package release evidence zip\.path must point to extension\.zip/,
  );
  assert.match(verifyReleasePackageScript, /package release evidence build byte size/);
  assert.match(
    verifyReleasePackageScript,
    /package release evidence formatted build size must match current build size/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence releaseVersion must match automated QA evidence/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence automated QA releaseVersion must match automated QA evidence/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence releaseVersion must match manual QA evidence/,
  );
  assert.match(
    verifyReleasePackageScript,
    /package release evidence manual QA releaseVersion must match manual QA evidence/,
  );
  assert.match(verifyManualQaScript, /SAYLESS_MANUAL_QA_ROOT/);
  assert.match(verifyManualQaScript, /DEFAULT_AUTOMATED_EVIDENCE_PATH/);
  assert.match(verifyManualQaScript, /EXPECTED_AUTOMATED_COMMANDS/);
  assert.match(verifyManualQaScript, /isCanonicalRelativePath/);
  assert.match(verifyManualQaScript, /automatedEvidencePath must point to/);
  assert.match(verifyManualQaScript, /automated QA evidence status must be "passed"/);
  assert.match(verifyManualQaScript, /automated QA evidence startedAt must be/);
  assert.match(verifyManualQaScript, /automated QA evidence durationMs must be a positive number/);
  assert.match(verifyManualQaScript, /automated QA evidence build\.formattedBytes must match build\.bytes/);
  assert.match(
    verifyManualQaScript,
    /automated QA evidence build\.path must be the canonical relative build path/,
  );
  assert.match(
    verifyManualQaScript,
    /automated QA evidence bundledWhisper\.formattedBytes must match bundledWhisper\.bytes/,
  );
  assert.match(
    verifyManualQaScript,
    /automated QA evidence bundledWhisper\.path must be the canonical relative build\/assets\/whisper path/,
  );
  assert.match(verifyManualQaScript, /automated QA evidence releaseSurface is required/);
  assert.match(verifyManualQaScript, /"hasOauth2"/);
  assert.match(verifyManualQaScript, /"hasExternallyConnectable"/);
  assert.match(verifyManualQaScript, /"hasIdentityPermission"/);
  assert.match(verifyManualQaScript, /"hasGoogleDrivePermission"/);
  assert.match(verifyManualQaScript, /"hasRemoteConnectSrc"/);
  assert.match(verifyManualQaScript, /releaseSurface\.\$\{field\} must be false/);
  assert.match(verifyManualQaScript, /current build byte size .+ does not match/);
  assert.match(
    verifyManualQaScript,
    /automated QA evidence durationMs must match the startedAt\/generatedAt run window/,
  );
  assert.match(verifyManualQaScript, /automated QA evidence contains duplicate command/);
  assert.match(verifyManualQaScript, /automated QA evidence contains unexpected command/);
  assert.match(
    verifyManualQaScript,
    /automated QA evidence command durations must not exceed total durationMs/,
  );
  assert.match(verifyManualQaScript, /automated QA evidence git\.commit/);
  assert.match(
    verifyManualQaScript,
    /automated QA evidence git\.workingTree\.sha256 must match the current git worktree/,
  );
  assert.match(verifyManualQaScript, /automated QA evidence command .+ must be/);
  assert.match(verifyManualQaScript, /recordings\[\$\{index\}\]\.id must be unique/);
  assert.match(verifyManualQaScript, /must be a unique recording id within/);
  assert.match(verifyManualQaScript, /must reference at least \$\{minimum\} unique listed recording id/);
  assert.match(verifyManualQaScript, /must be unique within this operation/);
  assert.match(
    verifyManualQaScript,
    /must reference at least \$\{requiredRecordingRefs\} unique listed recording id/,
  );
  assert.match(verifyManualQaScript, /externalNetworkProbe/);
  assert.match(verifyManualQaScript, /sameChromeProfile/);
  assert.match(verifyManualQaScript, /external http\(s\) URL/);
  assert.match(verifyManualQaScript, /observedError must describe the browser network failure/);
  assert.match(verifyManualQaScript, /premium\/trial\/entitlement\/license\/upgrade/);
  assert.match(verifyManualQaScript, /account-tier\/license-key\/activation\/contact-sales gates/);
});

test("release audit guards package release script gates", () => {
  assert.ok(releaseAuditScript.includes("scripts/package-release"));
  assert.ok(releaseAuditScript.includes("scripts/package-cws"));
  assert.ok(releaseAuditScript.includes("GITIGNORE_PATH"));
  assert.ok(releaseAuditScript.includes("release-artifacts/"));
  assert.ok(releaseAuditScript.includes("*.zip"));
  assert.ok(releaseAuditScript.includes("verify-manual-qa-evidence"));
  assert.ok(releaseAuditScript.includes("manual-qa-profile"));
  assert.ok(releaseAuditScript.includes("SAYLESS_MANUAL_QA_PROFILE_ROOT"));
  assert.ok(releaseAuditScript.includes("--user-data-dir="));
  assert.ok(releaseAuditScript.includes("--load-extension="));
  assert.ok(releaseAuditScript.includes("SAYLESS_MANUAL_QA_ROOT"));
  assert.ok(releaseAuditScript.includes("MANUAL_QA_VERIFIER_PATH"));
  assert.ok(releaseAuditScript.includes("verify-no-secrets"));
  assert.ok(releaseAuditScript.includes("WHISPER_ASSET_VERIFIER_PATH"));
  assert.ok(releaseAuditScript.includes("SAYLESS_WHISPER_ASSETS_ROOT"));
  assert.ok(releaseAuditScript.includes("NO_SECRETS_VERIFIER_PATH"));
  assert.ok(releaseAuditScript.includes("FORBIDDEN_HTML_TEMPLATE_PATTERNS"));
  assert.ok(releaseAuditScript.includes("Web site created using create-react-app"));
  assert.ok(releaseAuditScript.includes("You can add webfonts, meta tags, or analytics to this file"));
  assert.ok(releaseAuditScript.includes("stale template/analytics HTML reference"));
  assert.ok(releaseAuditScript.includes("FORBIDDEN_SOURCE_REMOTE_TELEMETRY_PATTERNS"));
  assert.ok(releaseAuditScript.includes("remote telemetry/analytics source reference"));
  assert.match(releaseAuditScript, /SOURCE_TEXT_EXTENSIONS[\s\S]*"\.svg"/);
  assert.ok(releaseAuditScript.includes("REQUIRED_DYNAMIC_LOCAL_URL_GUARDS"));
  assert.ok(releaseAuditScript.includes("dynamic local URL guard(s) missing"));
  assert.ok(releaseAuditScript.includes("src/pages/utils/localFileExport.js"));
  assert.ok(releaseAuditScript.includes("shared local file export helper must validate blob URLs"));
  assert.ok(releaseAuditScript.includes("src/pages/Download/Download.jsx"));
  assert.ok(releaseAuditScript.includes("download recovery page must validate blob URLs"));
  assert.ok(releaseAuditScript.includes("src/pages/EditorApp/layout/player/RightPanel.js"));
  assert.ok(releaseAuditScript.includes("editor panel direct download paths must validate blob URLs"));
  assert.ok(releaseAuditScript.includes("assertLocalBlobUrl"));
  assert.ok(releaseAuditScript.includes("assertLocalExportObjectUrl"));
  assert.ok(releaseAuditScript.includes("assertLocalExtensionUrl"));
  assert.ok(releaseAuditScript.includes("FORBIDDEN_TRANSCRIPTION_HARNESS_PATTERNS"));
  assert.ok(releaseAuditScript.includes("tests/e2e/run-transcription.cjs"));
  assert.ok(releaseAuditScript.includes("SAYLESS_ALLOW_NETWORK_TRANSCRIPTION_E2E"));
  assert.ok(releaseAuditScript.includes("remote transcription harness reference"));
  assert.ok(releaseAuditScript.includes("SCREENITY_(?:SKIP_ENV|USE_LOCAL_ENV"));
  assert.ok(releaseAuditScript.includes("DEBUG_RECORDER"));
  assert.ok(releaseAuditScript.includes("__SCREENITY_KEEPALIVE"));
  assert.ok(releaseAuditScript.includes("screenity-(?:recorder-)?keepalive"));
  assert.ok(releaseAuditScript.includes("FORBIDDEN_ACTIVE_SCREENITY_UI_NAMES"));
  assert.ok(releaseAuditScript.includes("screenity-wave-bg"));
  assert.ok(releaseAuditScript.includes("screenity-scrollbar"));
  assert.ok(releaseAuditScript.includes("src/pages/Content/context/ContentState.jsx"));
  assert.ok(releaseAuditScript.includes("src/pages/Content/styles/app.scss"));
  assert.ok(releaseAuditScript.includes("src/pages/Content/styles/app.css"));
  assert.ok(releaseAuditScript.includes("__screenity(?:ExportRecordingDebug|PingRecdbg)"));
  assert.ok(releaseAuditScript.includes("screenity-(?:player-loading|spin)"));
  assert.ok(releaseAuditScript.includes("screenitySandboxToast(?:In|Out)"));
  assert.ok(releaseAuditScript.includes("stale active Screenity UI/debug name"));
  assert.match(
    releaseAuditScript,
    /execFileSync\(process\.execPath, \[WHISPER_ASSET_VERIFIER_PATH, "--build"\]/,
  );
  assert.match(
    releaseAuditScript,
    /execFileSync\(process\.execPath, \[NO_SECRETS_VERIFIER_PATH, BUILD_DIR\]/,
  );
  assert.ok(releaseAuditScript.includes("NO_SECRETS_VERIFIER_PATH"));
  assert.ok(releaseAuditScript.includes("noSecretsVerifierScriptText"));
  assert.ok(releaseAuditScript.includes("must scan text SVG assets for secret leaks"));
  assert.doesNotMatch(
    verifyNoSecretsScript.match(/const\s+SKIP_EXTENSIONS\s*=\s*new Set\(\[([\s\S]*?)\]\);/)?.[1] || "",
    /(["'])\.svg\1/,
  );
  assert.ok(releaseAuditScript.includes("verifyWrittenPackage"));
  assert.ok(releaseAuditScript.includes("SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT"));
  assert.ok(releaseAuditScript.includes("package must delegate to package:release"));
  assert.ok(releaseAuditScript.includes("preflight:cws must require ready qa:release:status"));
  assert.ok(releaseAuditScript.includes("verifyWrittenCwsPackage"));
  assert.ok(releaseAuditScript.includes("SAYLESS_CWS_VERIFY_ROOT"));
  assert.match(verifyCwsPackageScript, /CWS package evidence packageEvidence\.path is required/);
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence packageEvidence\.path must point to release-artifacts\/package-release\.json/,
  );
  assert.match(verifyCwsPackageScript, /CWS package sourceZip\.path is required/);
  assert.match(verifyCwsPackageScript, /CWS package sourceZip\.path must point to extension\.zip/);
  assert.match(verifyCwsPackageScript, /CWS package evidence cwsZip\.path is required/);
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence cwsZip\.path must point to build-cws\.zip/,
  );
  assert.ok(releaseAuditScript.includes("release:cws:force"));
  assert.ok(releaseAuditScript.includes("release:cws:force must delegate to release:cws"));
  assert.match(releaseAuditScript, /chrome-webstore-upload/);
  assert.match(releaseAuditScript, /must run preflight:cws plus verify:cws-package before the store action/);
  assert.ok(!Object.hasOwn(packageJson.scripts, "preflight:cws:bless"));
  assert.ok(releaseAuditScript.includes("must not use bless aliases"));
  assert.ok(releaseAuditScript.includes("release-qa-automated.mjs"));
  assert.ok(releaseAuditScript.includes("BUILT_EXTENSION_SURFACE_TEST_PATH"));
  assert.ok(releaseAuditScript.includes("writeNonPassingEvidence"));
  assert.ok(releaseAuditScript.includes("writeNonPassingPackageEvidence"));
  assert.ok(releaseAuditScript.includes("writeNonPassingCwsEvidence"));
  assert.ok(releaseAuditScript.includes("recordPageErrors\\(hits, pageName, pageErrors\\)"));
  assert.ok(
    releaseAuditScript.includes(
      'recordPageErrors\\(hits, "content-script-popup", contentErrors\\)',
    ),
  );
  assert.ok(releaseAuditScript.includes("recordConsoleErrors"));
  assert.ok(releaseAuditScript.includes('pattern:\\s*"console-error"'));
  assert.ok(releaseAuditScript.includes('message\\.type\\(\\) === "error"'));
  assert.ok(
    releaseAuditScript.includes("recordConsoleErrors\\(hits, pageName, consoleErrors\\)"),
  );
  assert.ok(
    releaseAuditScript.includes(
      'recordConsoleErrors\\(hits, "content-script-popup", contentConsoleErrors\\)',
    ),
  );
  assert.ok(releaseAuditScript.includes("cws-package"));
  assert.ok(releaseAuditScript.includes("verify-cws-package"));
  assert.match(verifyCwsPackageScript, /isCanonicalRelativePath/);
  assert.ok(verifyLocalWhisperAssetsScript.includes("SAYLESS_WHISPER_ASSETS_ROOT"));
});

test("built extension surface smoke fails on page JavaScript and console errors", () => {
  assert.match(builtExtensionSurfaceScript, /const recordPageErrors = \(hits, pageName, pageErrors\) =>/);
  assert.match(builtExtensionSurfaceScript, /pattern:\s*"pageerror"/);
  assert.match(builtExtensionSurfaceScript, /recordPageErrors\(hits, pageName, pageErrors\)/);
  assert.match(
    builtExtensionSurfaceScript,
    /recordPageErrors\(hits, "content-script-popup", contentErrors\)/,
  );
  assert.match(
    builtExtensionSurfaceScript,
    /const recordConsoleErrors = \(hits, pageName, consoleErrors\) =>/,
  );
  assert.match(builtExtensionSurfaceScript, /pattern:\s*"console-error"/);
  assert.match(builtExtensionSurfaceScript, /message\.type\(\) === "error"/);
  assert.match(builtExtensionSurfaceScript, /recordConsoleErrors\(hits, pageName, consoleErrors\)/);
  assert.match(
    builtExtensionSurfaceScript,
    /recordConsoleErrors\(hits, "content-script-popup", contentConsoleErrors\)/,
  );
  for (const forbiddenTerm of [
    "account[- ]tiers?",
    "paid[- ]accounts?",
    "(?:starter|team|business|enterprise|free|limited)[- ]tiers?",
    "enterprise[- ]only",
    "paid[- ]memberships?",
    "locked by (?:plan|tier|account|membership)",
    "(?:plan|tier|subscription|membership)[- ]required",
    "contact sales",
    "sales[- ]gated",
    "licen[cs]e[- ]keys?",
    "activation[- ](?:required|keys?|codes?)",
  ]) {
    assert.ok(
      builtExtensionSurfaceScript.includes(forbiddenTerm),
      `missing built-extension surface guard for ${forbiddenTerm}`,
    );
  }
});

test("automated release QA overwrites stale evidence with non-passing status", () => {
  assert.match(releaseQaAutomatedScript, /writeNonPassingEvidence/);
  assert.match(releaseQaAutomatedScript, /status:\s*"passed"/);
  assert.match(releaseQaAutomatedScript, /sayless\.releaseQaAutomatedIncomplete/);
  assert.match(releaseQaAutomatedScript, /sayless\.releaseQaAutomatedFailed/);
  assert.match(releaseQaAutomatedScript, /failedCommand/);
  assert.match(releaseQaAutomatedScript, /releaseSurface/);
  assert.match(releaseQaAutomatedScript, /hasOauth2/);
  assert.match(releaseQaAutomatedScript, /hasExternallyConnectable/);
  assert.match(releaseQaAutomatedScript, /hasIdentityPermission/);
  assert.match(releaseQaAutomatedScript, /hasGoogleDrivePermission/);
  assert.match(releaseQaAutomatedScript, /hasRemoteConnectSrc/);
  assert.match(releaseQaAutomatedScript, /Automated release QA has not passed/);
  assert.match(releaseQaAutomatedScript, /remainingManualQa/);
  assert.match(releaseQaAutomatedScript, /npm run qa:release:manual:profile/);
});

test("release status command reports evidence gates without creating artifacts", () => {
  assert.match(releaseStatusScript, /SAYLESS_RELEASE_STATUS_ROOT/);
  assert.match(releaseStatusScript, /release-qa-automated\.json/);
  assert.match(releaseStatusScript, /manual-qa-evidence\.json/);
  assert.match(releaseStatusScript, /package-release\.json/);
  assert.match(releaseStatusScript, /cws-package\.json/);
  assert.match(releaseStatusScript, /verify-manual-qa-evidence\.mjs/);
  assert.match(releaseStatusScript, /verify-release-package\.mjs/);
  assert.match(releaseStatusScript, /verify-cws-package\.mjs/);
  assert.match(releaseStatusScript, /gateStatus/);
  assert.match(releaseStatusScript, /evidenceGateStatus/);
  assert.match(releaseStatusScript, /validateAutomatedEvidence/);
  assert.match(releaseStatusScript, /dirFingerprint/);
  assert.match(releaseStatusScript, /releaseSurface/);
  assert.match(releaseStatusScript, /EXPECTED_AUTOMATED_COMMANDS/);
  assert.match(releaseStatusScript, /command durations must not exceed total durationMs/);
  assert.match(releaseStatusScript, /git\.commit must be a 40-character SHA-1 commit/);
  assert.match(releaseStatusScript, /git\.workingTree\.sha256 must match the current git worktree/);
  assert.match(releaseStatusScript, /verifierErrorCount/);
  assert.match(releaseStatusScript, /verifierSummary/);
  assert.match(releaseStatusScript, /manualQaTodo/);
  assert.match(releaseStatusScript, /Manual QA todo/);
  assert.match(releaseStatusScript, /Record at least two real recordings/);
  assert.match(releaseStatusScript, /publication-surface evidence for release notes, screenshots, and docs\/STORE_LISTING\.md store text/);
  assert.match(releaseStatusScript, /account-tier\/license-key\/activation\/contact-sales/);
  assert.match(releaseStatusScript, /npm run qa:release:auto/);
  assert.match(releaseStatusScript, /npm run qa:release:manual:template/);
  assert.match(releaseStatusScript, /npm run qa:release:manual:profile/);
  assert.match(releaseStatusScript, /complete docs\/RELEASE_QA\.md/);
  assert.match(releaseStatusScript, /fix release-artifacts\/manual-qa-evidence\.json/);
  assert.match(releaseStatusScript, /npm run package:release/);
  assert.match(releaseStatusScript, /npm run build:cws/);
  assert.match(releaseStatusScript, /npm run verify:release-package/);
  assert.match(releaseStatusScript, /npm run verify:cws-package/);
  assert.match(releaseStatusScript, /npm run release:cws/);
  assert.match(releaseStatusScript, /npm run release:cws:publish/);
  assert.match(releaseStatusScript, /release-artifacts\/manual-qa-evidence\.json/);
  assert.match(releaseStatusScript, /attach docs\/STORE_LISTING\.md/);
  assert.match(releaseStatusScript, /attach extension\.zip/);
  assert.match(releaseStatusScript, /attach build-cws\.zip/);
  assert.match(releaseStatusScript, /--require-ready/);
  assert.match(releaseStatusScript, /Release status must be ready before this action can continue/);
  assert.match(releaseStatusScript, /Next steps/);
  assert.match(releaseStatusScript, /Release handoff/);
  assert.match(releaseStatusScript, /--json/);
});

test("release prep script prints the gated release evidence sequence", () => {
  const orderedSteps = [
    /Run: npm run qa:release:auto/,
    /Run: npm run qa:release:status/,
    /Run: npm run qa:release:manual:template/,
    /Run: npm run qa:release:manual:profile/,
    /Complete docs\/RELEASE_QA\.md manual sections/,
    /release-artifacts\/manual-qa-evidence\.json/,
    /Run: npm run qa:release:manual(?!:)/,
    /Run: npm run package:release/,
    /Run: npm run verify:release-package/,
    /Run: npm run build:cws/,
    /Run: npm run verify:cws-package/,
    /Run: npm run qa:release:status/,
    /Attach release-artifacts\/release-qa-automated\.json, release-artifacts\/manual-qa-evidence\.json, release-artifacts\/package-release\.json, release-artifacts\/cws-package\.json, docs\/STORE_LISTING\.md, extension\.zip, and build-cws\.zip/,
  ];

  let previousIndex = -1;
  for (const step of orderedSteps) {
    const searchStart = previousIndex + 1;
    const match = step.exec(releaseScript.slice(searchStart));
    const index = match ? searchStart + match.index : -1;
    assert.notEqual(index, -1, `release script must mention ${step}`);
    assert.ok(index > previousIndex, `${step} must appear after the previous release step`);
    previousIndex = index;
  }
});

test("release dry run previews the gated release evidence sequence", () => {
  const releaseFiles = [
    join(ROOT, "package.json"),
    join(ROOT, "package-lock.json"),
    join(ROOT, "src", "manifest.json"),
  ];
  const before = new Map(releaseFiles.map((path) => [path, readFileSync(path, "utf8")]));
  const result = spawnSync(process.execPath, ["scripts/release.mjs", "--dry-run", "patch"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--dry-run: no files written, no build run\./);
  assert.match(result.stdout, /Release v\d+\.\d+\.\d+ preview/);
  assert.match(result.stdout, /Run: npm run qa:release:manual:template/);
  assert.match(result.stdout, /Run: npm run qa:release:manual:profile/);
  assert.match(result.stdout, /Run: npm run qa:release:manual/);
  assert.match(result.stdout, /Run: npm run build:cws/);
  assert.match(result.stdout, /Run: npm run verify:cws-package/);
  for (const path of releaseFiles) {
    assert.equal(readFileSync(path, "utf8"), before.get(path), `${path} changed during dry-run`);
  }
});

test("manual QA template commands use the safe template writer", () => {
  assert.equal(
    packageJson.scripts["qa:release:manual:profile"],
    "node scripts/manual-qa-profile.mjs",
  );
  assert.equal(
    packageJson.scripts["qa:release:manual:template"],
    "node scripts/verify-manual-qa-evidence.mjs --write-template",
  );
  assert.equal(
    packageJson.scripts["qa:release:manual:template:force"],
    "node scripts/verify-manual-qa-evidence.mjs --write-template --force",
  );
  assert.match(verifyManualQaScript, /--write-template/);
  assert.match(verifyManualQaScript, /writeFileAtomic/);
  assert.match(verifyManualQaScript, /automatedEvidenceCanPrefillTemplate/);
  assert.match(verifyManualQaScript, /gitWorktreeFingerprint/);
  assert.match(verifyManualQaScript, /status:\s*"template"/);
  assert.match(verifyManualQaScript, /cleanChromeProfile:\s*false/);
  assert.match(verifyManualQaScript, /networkDisabledForOfflineTranscription:\s*false/);
  assert.match(verifyManualQaScript, /captionBurnInVerified:\s*false/);
  assert.match(verifyManualQaScript, /manual QA evidence file already exists/);
  assert.match(verifyManualQaScript, /qa:release:manual:template:force/);
  const manualTemplateCommand = "npm run qa:release:manual:template";
  const manualProfileCommand = "npm run qa:release:manual:profile";
  for (const [label, text] of [
    ["docs/MANUAL_QA_EVIDENCE.md", manualQaDoc],
    ["docs/RELEASE_QA.md", releaseQaDoc],
    ["README.md", readme],
    ["scripts/release.mjs", releaseScript],
  ]) {
    assert.ok(text.includes(manualTemplateCommand), `${label} must use the safe writer`);
    assert.ok(text.includes(manualProfileCommand), `${label} must include the clean-profile helper`);
    assert.ok(
      !text.includes("npm run qa:release:manual -- --print-template"),
      `${label} must not recommend redirected npm template output`,
    );
  }
  assert.match(manualQaDoc, /release-artifacts\/release-qa-automated\.json[^.]+status: "passed"/);
  assert.match(releaseQaDoc, /release-artifacts\/release-qa-automated\.json[^.]+status: "passed"/);
});

test("manual QA profile helper prints a clean Chrome command for the canonical build", () => {
  assert.match(manualQaProfileScript, /SAYLESS_MANUAL_QA_PROFILE_ROOT/);
  assert.match(manualQaProfileScript, /SAYLESS_CHROME/);
  assert.match(manualQaProfileScript, /build\/manifest\.json is missing/);
  assert.match(manualQaProfileScript, /release-artifacts\/release-qa-automated\.json is missing/);
  assert.match(manualQaProfileScript, /automated QA evidence status must be "passed"/);
  assert.match(manualQaProfileScript, /automated QA evidence generatedAt must be an ISO UTC timestamp/);
  assert.match(manualQaProfileScript, /current build fingerprint does not match automated QA evidence/);
  assert.match(manualQaProfileScript, /current build byte size does not match automated QA evidence/);
  assert.match(manualQaProfileScript, /automated QA evidence build\.formattedBytes must match current build byte size/);
  assert.match(manualQaProfileScript, /automated QA evidence git\.workingTree is required/);
  assert.match(manualQaProfileScript, /automated QA evidence git\.workingTree\.sha256 must match the current git worktree/);
  assert.match(manualQaProfileScript, /automated QA evidence git\.workingTree\.fileCount must match the current git worktree/);
  assert.match(manualQaProfileScript, /automated QA evidence git\.workingTree\.statusSha256 must match the current git status/);
  assert.match(manualQaProfileScript, /--user-data-dir=/);
  assert.match(manualQaProfileScript, /--disable-extensions-except=/);
  assert.match(manualQaProfileScript, /--load-extension=/);
  assert.match(manualQaProfileScript, /chrome:\/\/extensions\//);
  assert.match(manualQaProfileScript, /cleanChromeProfile:\s*true/);
  assert.match(manualQaProfileScript, /extensionSource:\s*"build"/);
  assert.match(manualQaProfileScript, /automatedEvidenceGeneratedAt/);
  assert.match(manualQaProfileScript, /buildSha256/);
  assert.match(manualQaProfileScript, /buildBytes/);
  assert.match(manualQaProfileScript, /buildFormattedBytes/);
  assert.match(manualQaProfileScript, /evidencePrefill/);
  assert.match(manualQaProfileScript, /automated evidence timestamp/);
  assert.match(manualQaProfileScript, /manual QA profile directory must be a new or empty directory/);
  assert.match(manualQaProfileScript, /manual QA profile directory must be empty so manual QA uses a clean Chrome profile/);
  assert.match(manualQaProfileScript, /unknown manual QA profile option/);
  assert.match(manualQaProfileScript, /manual QA profile helper accepts at most one --profile-dir option/);
  assert.match(manualQaProfileScript, /manual QA profile --profile-dir value must not be empty/);
  assert.match(manualQaProfileScript, /--launch/);
  assert.match(manualQaProfileScript, /--json/);

  const fixture = mkdtempSync(join(tmpdir(), "sayless-manual-profile-pass-"));
  try {
    mkdirSync(join(fixture, "build"), { recursive: true });
    mkdirSync(join(fixture, "release-artifacts"), { recursive: true });
    writeFileSync(join(fixture, "build", "manifest.json"), JSON.stringify({ version: "1.2.3" }));
    const build = dirFingerprint(join(fixture, "build"));
    const buildBytes = statSync(join(fixture, "build", "manifest.json")).size;
    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({
        status: "passed",
        releaseVersion: "1.2.3",
        generatedAt: "2026-07-17T00:00:00.000Z",
        git: {
          workingTree: emptyGitWorkingTree,
        },
        build: {
          path: "build",
          sha256: build.sha256,
          fileCount: build.fileCount,
          bytes: buildBytes,
          formattedBytes: `${buildBytes} B`,
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      ["scripts/manual-qa-profile.mjs", "--json", "--profile-dir=/tmp/sayless-profile-test"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_CHROME: "/tmp/Chrome Test",
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const profile = JSON.parse(result.stdout);
    assert.equal(profile.buildPath, "build");
    assert.equal(profile.automatedEvidencePath, "release-artifacts/release-qa-automated.json");
    assert.equal(profile.automatedEvidenceGeneratedAt, "2026-07-17T00:00:00.000Z");
    assert.equal(profile.buildSha256, build.sha256);
    assert.equal(profile.buildBytes, buildBytes);
    assert.equal(profile.buildFormattedBytes, `${buildBytes} B`);
    assert.equal(profile.evidenceReminder.cleanChromeProfile, true);
    assert.equal(profile.evidenceReminder.extensionSource, "build");
    assert.equal(profile.evidencePrefill.automatedEvidencePath, "release-artifacts/release-qa-automated.json");
    assert.equal(profile.evidencePrefill.automatedEvidenceGeneratedAt, "2026-07-17T00:00:00.000Z");
    assert.equal(profile.evidencePrefill.environment.extensionSource, "build");
    assert.equal(profile.evidencePrefill.environment.cleanChromeProfile, true);
    assert.equal(profile.profileDir, "/tmp/sayless-profile-test");
    assert.ok(profile.command.includes("--load-extension=" + join(fixture, "build")));
    assert.ok(profile.command.includes("chrome://extensions/"));

    const dirtyProfileDir = join(fixture, "dirty-profile");
    mkdirSync(dirtyProfileDir);
    writeFileSync(join(dirtyProfileDir, "Preferences"), "{}");
    const dirtyProfileResult = spawnSync(
      process.execPath,
      ["scripts/manual-qa-profile.mjs", "--json", `--profile-dir=${dirtyProfileDir}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.notEqual(dirtyProfileResult.status, 0);
    const dirtyProfileError = JSON.parse(dirtyProfileResult.stderr);
    assert.equal(dirtyProfileError.status, "failed");
    assert.match(dirtyProfileError.error, /manual QA profile directory must be empty/);

    const fileProfileDir = join(fixture, "not-a-directory");
    writeFileSync(fileProfileDir, "");
    const fileProfileResult = spawnSync(
      process.execPath,
      ["scripts/manual-qa-profile.mjs", "--json", `--profile-dir=${fileProfileDir}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.notEqual(fileProfileResult.status, 0);
    const fileProfileError = JSON.parse(fileProfileResult.stderr);
    assert.equal(fileProfileError.status, "failed");
    assert.match(fileProfileError.error, /manual QA profile directory must be a new or empty directory/);

    const unknownOptionResult = spawnSync(
      process.execPath,
      ["scripts/manual-qa-profile.mjs", "--json", "--lauch"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.notEqual(unknownOptionResult.status, 0);
    const unknownOptionError = JSON.parse(unknownOptionResult.stderr);
    assert.equal(unknownOptionError.status, "failed");
    assert.match(unknownOptionError.error, /unknown manual QA profile option: --lauch/);

    const duplicateProfileResult = spawnSync(
      process.execPath,
      [
        "scripts/manual-qa-profile.mjs",
        "--json",
        "--profile-dir=/tmp/sayless-a",
        "--profile-dir=/tmp/sayless-b",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.notEqual(duplicateProfileResult.status, 0);
    const duplicateProfileError = JSON.parse(duplicateProfileResult.stderr);
    assert.equal(duplicateProfileError.status, "failed");
    assert.match(duplicateProfileError.error, /at most one --profile-dir option/);

    const emptyProfileResult = spawnSync(
      process.execPath,
      ["scripts/manual-qa-profile.mjs", "--json", "--profile-dir="],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture,
        },
      },
    );
    assert.notEqual(emptyProfileResult.status, 0);
    const emptyProfileError = JSON.parse(emptyProfileResult.stderr);
    assert.equal(emptyProfileError.status, "failed");
    assert.match(emptyProfileError.error, /--profile-dir value must not be empty/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("manual QA profile helper fails closed without a valid release build manifest", () => {
  const fixture = mkdtempSync(join(tmpdir(), "sayless-manual-profile-"));
  try {
    const missingResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(missingResult.status, 0);
    assert.match(missingResult.stderr, /build\/manifest\.json is missing/);
    assert.doesNotMatch(missingResult.stderr, /\n\s*at\s+/);
    const missingError = JSON.parse(missingResult.stderr);
    assert.equal(missingError.status, "failed");
    assert.match(missingError.error, /build\/manifest\.json is missing/);

    mkdirSync(join(fixture, "build"), { recursive: true });
    writeFileSync(join(fixture, "build", "manifest.json"), "{not-json");
    const invalidResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(invalidResult.status, 0);
    assert.match(invalidResult.stderr, /build\/manifest\.json is not valid JSON/);
    assert.doesNotMatch(invalidResult.stderr, /\n\s*at\s+/);
    const invalidError = JSON.parse(invalidResult.stderr);
    assert.equal(invalidError.status, "failed");
    assert.match(invalidError.error, /build\/manifest\.json is not valid JSON/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("manual QA profile helper requires current passing automated release evidence", () => {
  const fixture = mkdtempSync(join(tmpdir(), "sayless-manual-profile-evidence-"));
  try {
    mkdirSync(join(fixture, "build"), { recursive: true });
    writeFileSync(join(fixture, "build", "manifest.json"), JSON.stringify({ version: "1.2.3" }));

    const missingEvidenceResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(missingEvidenceResult.status, 0);
    assert.match(missingEvidenceResult.stderr, /release-artifacts\/release-qa-automated\.json is missing/);
    assert.doesNotMatch(missingEvidenceResult.stderr, /\n\s*at\s+/);

    mkdirSync(join(fixture, "release-artifacts"), { recursive: true });
    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({ status: "running", releaseVersion: "1.2.3", build: { path: "build" } }),
    );
    const runningEvidenceResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(runningEvidenceResult.status, 0);
    assert.doesNotMatch(runningEvidenceResult.stderr, /\n\s*at\s+/);
    const runningEvidenceError = JSON.parse(runningEvidenceResult.stderr);
    assert.equal(runningEvidenceError.status, "failed");
    assert.match(runningEvidenceError.error, /automated QA evidence status must be "passed"/);

    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({
        status: "passed",
        releaseVersion: "1.2.3",
        generatedAt: "2026-07-17T00:00:00.000Z",
        git: {
          workingTree: emptyGitWorkingTree,
        },
        build: { path: "build", sha256: "0".repeat(64), fileCount: 999, bytes: 999, formattedBytes: "999 B" },
      }),
    );
    const staleEvidenceResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(staleEvidenceResult.status, 0);
    assert.doesNotMatch(staleEvidenceResult.stderr, /\n\s*at\s+/);
    const staleEvidenceError = JSON.parse(staleEvidenceResult.stderr);
    assert.equal(staleEvidenceError.status, "failed");
    assert.match(staleEvidenceError.error, /current build fingerprint does not match automated QA evidence/);

    const currentBuild = dirFingerprint(join(fixture, "build"));
    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({
        status: "passed",
        releaseVersion: "1.2.3",
        generatedAt: "not-a-date",
        git: {
          workingTree: emptyGitWorkingTree,
        },
        build: {
          path: "build",
          sha256: currentBuild.sha256,
          fileCount: currentBuild.fileCount,
          bytes: statSync(join(fixture, "build", "manifest.json")).size,
          formattedBytes: `${statSync(join(fixture, "build", "manifest.json")).size} B`,
        },
      }),
    );
    const badTimestampResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(badTimestampResult.status, 0);
    const badTimestampError = JSON.parse(badTimestampResult.stderr);
    assert.equal(badTimestampError.status, "failed");
    assert.match(badTimestampError.error, /automated QA evidence generatedAt must be an ISO UTC timestamp/);

    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({
        status: "passed",
        releaseVersion: "1.2.3",
        generatedAt: "2026-07-17T00:00:00.000Z",
        git: {
          workingTree: emptyGitWorkingTree,
        },
        build: {
          path: "build",
          sha256: currentBuild.sha256,
          fileCount: currentBuild.fileCount,
          bytes: 1,
          formattedBytes: "1 B",
        },
      }),
    );
    const staleBytesResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(staleBytesResult.status, 0);
    const staleBytesError = JSON.parse(staleBytesResult.stderr);
    assert.equal(staleBytesError.status, "failed");
    assert.match(staleBytesError.error, /current build byte size does not match automated QA evidence/);

    writeFileSync(
      join(fixture, "release-artifacts", "release-qa-automated.json"),
      JSON.stringify({
        status: "passed",
        releaseVersion: "1.2.3",
        generatedAt: "2026-07-17T00:00:00.000Z",
        git: {
          workingTree: {
            ...emptyGitWorkingTree,
            sha256: "f".repeat(64),
          },
        },
        build: {
          path: "build",
          sha256: currentBuild.sha256,
          fileCount: currentBuild.fileCount,
          bytes: statSync(join(fixture, "build", "manifest.json")).size,
          formattedBytes: `${statSync(join(fixture, "build", "manifest.json")).size} B`,
        },
      }),
    );
    const staleWorktreeResult = spawnSync(process.execPath, ["scripts/manual-qa-profile.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SAYLESS_MANUAL_QA_PROFILE_ROOT: fixture },
    });
    assert.notEqual(staleWorktreeResult.status, 0);
    const staleWorktreeError = JSON.parse(staleWorktreeResult.stderr);
    assert.equal(staleWorktreeError.status, "failed");
    assert.match(staleWorktreeError.error, /git\.workingTree\.sha256 must match the current git worktree/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("README release handoff matches gated artifact evidence", () => {
  assert.match(readme, /npm run qa:release:status/);
  assert.match(readme, /release handoff/i);
  assert.match(readme, /release-artifacts\/release-qa-automated\.json/);
  assert.match(readme, /release-artifacts\/manual-qa-evidence\.json/);
  assert.match(readme, /release-artifacts\/package-release\.json/);
  assert.match(readme, /release-artifacts\/cws-package\.json/);
  assert.match(readme, /extension\.zip/);
  assert.match(readme, /build-cws\.zip/);
  assert.match(readme, /manual QA evidence is required before packaging or publishing/);
});

test("release QA doc describes source and SVG endpoint audit coverage", () => {
  assert.match(releaseQaDoc, /no forbidden network service endpoint literals in active source/);
  assert.match(releaseQaDoc, /SVG source assets/);
  assert.match(releaseQaDoc, /built JS bundles/);
});

test("capabilities inventory describes source and SVG endpoint audit coverage", () => {
  assert.match(capabilitiesDoc, /active source, SVG source assets, and built JavaScript bundles/);
  assert.match(capabilitiesDoc, /forbidden network service endpoint literals/);
  assert.match(capabilitiesDoc, /SVG\/XML namespace metadata/);
});

test("fork plan describes source and SVG endpoint audit coverage", () => {
  assert.match(forkPlanDoc, /active source, SVG source assets, or built JS bundles/);
  assert.match(forkPlanDoc, /forbidden network endpoint literals/);
  assert.match(forkPlanDoc, /stale cloud\/account protocol strings/);
});

test("release audit rejects stale build manifests for release-critical fields", () => {
  assert.ok(releaseAuditScript.includes("SOURCE_MANIFEST_PATH"));
  assert.ok(releaseAuditScript.includes("PACKAGE_LOCK_PATH"));
  assert.ok(releaseAuditScript.includes("ASSET_PATH"));
  assert.match(releaseAuditScript, /default ASSET_PATH to a relative path/);
  assert.match(releaseAuditScript, /preserve CSS asset URLs for packaged extension pages/);
  assert.match(releaseAuditScript, /utils\/build\.js must build packaged extension pages with a relative ASSET_PATH/);
  assert.ok(releaseAuditScript.includes("rootRelativeHtmlHits"));
  assert.match(releaseAuditScript, /chrome-extension:\\\/\\\/__MSG_@@extension_id__\\\//);
  assert.match(releaseAuditScript, /root-relative extension HTML asset reference/);
  assert.ok(releaseAuditScript.includes("packageLock.packages?.[\"\"]?.version"));
  assert.ok(releaseAuditScript.includes("must match src/manifest.json version"));
  assert.ok(releaseAuditScript.includes("assertManifestPolicy(sourceManifest, \"source\")"));
  assert.ok(releaseAuditScript.includes("assertManifestPolicy(manifest, \"build\")"));
  assert.ok(releaseAuditScript.includes("assertManifestReleaseFieldsMatch"));
  for (const field of [
    "version",
    "host_permissions",
    "permissions",
    "optional_permissions",
    "web_accessible_resources",
    "content_security_policy",
  ]) {
    assert.ok(releaseAuditScript.includes(`"${field}"`), `missing manifest drift guard for ${field}`);
  }
  assert.match(
    releaseAuditScript,
    /source and build manifest release-critical field\(s\) differ/,
  );
});

test("release build fails on unexpected webpack warnings", () => {
  assert.match(buildScript, /ALLOWED_WEBPACK_WARNINGS/);
  assert.match(buildScript, /transformers import\.meta standalone warning/);
  assert.match(buildScript, /@huggingface/);
  assert.match(buildScript, /import\\\.meta' cannot be used as a standalone expression/);
  assert.match(buildScript, /unexpectedWarnings/);
  assert.match(buildScript, /Webpack compilation had unexpected warnings/);
  assert.match(buildScript, /process\.exit\(1\)/);
  assert.match(releaseAuditScript, /utils\/build\.js must fail release builds on unexpected webpack warnings/);
});

test("release transcription config preserves bundled model path against remote overrides", () => {
  assert.match(transcriptionConfigScript, /isRemoteModelPath/);
  assert.match(transcriptionConfigScript, /isBundledExtensionModelPath/);
  assert.match(transcriptionConfigScript, /chrome-extension:/);
  assert.match(transcriptionConfigScript, /assets\\\/whisper\\\/models/);
  assert.match(transcriptionConfigScript, /next\.localModelPath = current\.localModelPath/);
  assert.match(
    releaseAuditScript,
    /must keep release transcription on the bundled extension model path/,
  );
});

test("release audit blocks paid and account-gated source from returning", () => {
  assert.ok(releaseAuditScript.includes("FORBIDDEN_SOURCE_MONETIZATION_PATTERNS"));
  assert.ok(releaseAuditScript.includes("src/assets/whisper/"));
  for (const forbiddenTerm of [
    "paid[- ]tiers?",
    "paid[- ]plans?",
    "paywalls?",
    "premium",
    "free[- ]trials?",
    "trial[- ]only",
    "licen[cs]e[- ]required",
    "entitlements?",
    "subscription",
    "billing",
    "stripe",
    "isSubscribed",
    "account[- ]level",
    "account[- ]plans?",
    "account[- ]tiers?",
    "paid[- ]accounts?",
    "(?:starter|team|business|enterprise|free|limited)[- ]plans?",
    "(?:starter|team|business|enterprise|free|limited)[- ]tiers?",
    "enterprise[- ]only",
    "plan[- ]limits?",
    "tier[- ]limits?",
    "usage[- ]limits?",
    "memberships?",
    "paid[- ]memberships?",
    "member[- ]only",
    "feature[- ]gates?",
    "locked[- ]features?",
    "features?[- ]locked",
    "locked by (?:plan|tier|account|membership)",
    "(?:plan|tier|subscription|membership)[- ]required",
    "upgrade (?:to|for|your plan|your account)",
    "contact sales",
    "sales[- ]gated",
    "requires? (?:a )?(?:paid|premium|subscription|membership|account[- ]level)",
    "pro[- ]plans?",
    "licen[cs]e[- ]keys?",
    "activation[- ](?:required|keys?|codes?)",
  ]) {
    assert.ok(
      releaseAuditScript.includes(forbiddenTerm),
      `missing source monetization guard for ${forbiddenTerm}`,
    );
  }
  assert.match(
    releaseAuditScript,
    /paid\/account-gating source reference\(s\) found in active extension source/,
  );
});

test("release audit blocks inherited Screenity product names in active source", () => {
  assert.ok(releaseAuditScript.includes("FORBIDDEN_ACTIVE_SOURCE_SCREENITY_PATTERNS"));
  assert.ok(releaseAuditScript.includes("sourceScreenityProductHits"));
  assert.match(
    releaseAuditScript,
    /Screenity\\s\+\(\?:Pro\|account\|auth\|dashboard\|cloud\|hosted\|subscription\|pricing\)/,
  );
  assert.ok(releaseAuditScript.includes("screenity(?:Token|User)"));
  assert.ok(releaseAuditScript.includes("app\\.screenity\\.io"));
  assert.match(
    releaseAuditScript,
    /inherited Screenity product reference\(s\) found in active extension source/,
  );
});

test("release audit blocks network endpoints in active source", () => {
  assert.ok(releaseAuditScript.includes("ALLOWED_SOURCE_URL_HOSTS"));
  assert.ok(releaseAuditScript.includes("sourceNetworkEndpointHits"));
  assert.ok(releaseAuditScript.includes("isXmlNamespaceUrl"));
  assert.ok(releaseAuditScript.includes("rel.startsWith(\"src/assets/\") && !rel.endsWith(\".svg\")"));
  assert.match(
    releaseAuditScript,
    /network endpoint literal\(s\) found in active extension source/,
  );
});

test("release audit blocks broad or internal web-accessible asset exposure", () => {
  assert.ok(releaseAuditScript.includes("FORBIDDEN_WEB_ACCESSIBLE_RESOURCES"));
  assert.ok(releaseAuditScript.includes("FORBIDDEN_WEB_ACCESSIBLE_RESOURCE_PREFIXES"));
  for (const forbiddenResource of [
    "assets/*",
    "assets/**",
    "assets/**/*",
    "assets/mediapipeVision/",
    "assets/vendor/",
    "assets/videos/",
    "assets/whisper/",
  ]) {
    assert.ok(
      releaseAuditScript.includes(forbiddenResource),
      `missing web-accessible resource guard for ${forbiddenResource}`,
    );
  }
  assert.match(
    releaseAuditScript,
    /manifest exposes broad or internal asset resource\(s\) as web-accessible/,
  );
});

test("release audit blocks stale hosted and account-era asset files", () => {
  for (const staleAsset of [
    "patches/fabric+5.3.0.patch",
    "patches/fabric+5.5.2.patch",
    "patches/plyr+3.7.8.patch",
    "assets/editor/icons/drive.svg",
    "assets/editor/icons/unlock.svg",
    "assets/editor/icons/youtube.svg",
    "assets/temp/twitter.webp",
    "assets/temp/substack.webp",
    "assets/pfp.png",
    "assets/solo-dev.png",
    "assets/twitter-logo.svg",
    "src/assets/editor/icons/drive.svg",
    "src/assets/editor/icons/unlock.svg",
    "src/assets/editor/icons/youtube.svg",
    "src/assets/temp/twitter.webp",
    "src/assets/temp/substack.webp",
    "src/assets/pfp.png",
    "src/assets/solo-dev.png",
    "src/assets/twitter-logo.svg",
  ]) {
    assert.ok(releaseAuditScript.includes(staleAsset), `missing stale asset guard for ${staleAsset}`);
  }
});

test("release audit blocks stale dev auto-reload dependency imports", () => {
  assert.ok(releaseAuditScript.includes('"selenium-webdriver"'));
  assert.match(releaseAuditScript, /utils\/server\.js/);
  assert.match(releaseAuditScript, /ssestream/);
  assert.match(releaseAuditScript, /native SSE/);
  assert.match(releaseAuditScript, /utils\/autoReloadClients\/backgroundClient\.js/);
  assert.match(releaseAuditScript, /querystring/);
  assert.match(releaseAuditScript, /URLSearchParams|resource queries/);
});

test("release audit blocks inherited cloud and Screenity markers in support diagnostics", () => {
  assert.match(releaseAuditScript, /src\/pages\/utils\/buildSupportContext\.js/);
  assert.match(releaseAuditScript, /ctx\\\.cloud/);
  assert.match(releaseAuditScript, /SCR-/);
  assert.match(releaseAuditScript, /support diagnostics must use SayLess local-first markers/);
  assert.match(releaseAuditScript, /support diagnostic codes must use a SayLess prefix/);
});

test("CWS packaging is routed through traceable release package evidence", () => {
  assert.equal(packageJson.scripts["build:cws"], "node scripts/package-cws.mjs");
  const cwsEvidenceWriteIndex = packageCwsScript.indexOf("writeFileAtomic(CWS_EVIDENCE_PATH");
  const cwsVerifierIndex = packageCwsScript.indexOf("verifyWrittenCwsPackage()");
  const cwsSuccessIndex = packageCwsScript.indexOf("Chrome Web Store package created.");

  assert.notEqual(cwsEvidenceWriteIndex, -1);
  assert.notEqual(cwsVerifierIndex, -1);
  assert.notEqual(cwsSuccessIndex, -1);
  assert.ok(cwsEvidenceWriteIndex < cwsVerifierIndex);
  assert.ok(cwsVerifierIndex < cwsSuccessIndex);
  assert.match(packageCwsScript, /package-release\.mjs/);
  assert.match(packageCwsScript, /RELEASE_PACKAGER_PATH/);
  assert.match(packageCwsScript, /SAYLESS_PACKAGE_RELEASE_ROOT/);
  assert.match(packageCwsScript, /package-release\.json/);
  assert.match(packageCwsScript, /cws-package\.json/);
  assert.match(packageCwsScript, /build-cws\.zip/);
  assert.match(packageCwsScript, /verify-cws-package\.mjs/);
  assert.match(packageCwsScript, /SAYLESS_CWS_VERIFY_ROOT/);
  assert.match(packageCwsScript, /releaseVersion:\s*packageEvidence\.releaseVersion/);
  assert.match(packageCwsScript, /automatedEvidence:\s*packageEvidence\.automatedEvidence/);
  assert.match(packageCwsScript, /manualEvidence:\s*packageEvidence\.manualEvidence/);
  assert.match(packageCwsScript, /writeNonPassingCwsEvidence/);
  assert.match(packageCwsScript, /sayless\.cwsPackageIncomplete/);
  assert.match(packageCwsScript, /sayless\.cwsPackageFailed/);
  assert.match(packageCwsScript, /remainingReleaseWork/);
  assert.match(packageCwsScript, /failedStep/);
  assert.match(packageCwsScript, /git:\s*packageEvidence\.git/);
  assert.match(packageCwsScript, /formattedBytes:\s*formatBytes\(cwsBytes\)/);
  assert.match(packageCwsScript, /spawnSync\(process\.execPath/);
  assert.match(packageCwsScript, /writeFileAtomic\(CWS_ZIP_PATH/);
  assert.match(packageCwsScript, /writeFileAtomic\(CWS_EVIDENCE_PATH/);
  assert.match(packageCwsScript, /SAYLESS_PACKAGE_CWS_ROOT/);
  assert.doesNotMatch(packageCwsScript, /copyFileSync/);
  assert.match(packageCwsScript, /extension\.zip does not match package-release evidence/);
  assert.match(packageCwsScript, /build-cws\.zip differs from extension\.zip/);
});

test("CWS upload and publish verify package evidence before store actions", () => {
  assert.equal(packageJson.scripts["verify:cws-package"], "node scripts/verify-cws-package.mjs");
  assert.equal(packageJson.scripts["preflight:cws"], "npm run qa:release:status -- --require-ready");
  assert.equal(packageJson.scripts["release:cws:force"], "npm run release:cws");
  for (const scriptName of [
    "release:cws",
    "release:cws:force",
    "release:cws:publish",
    "release:cws:publish:10",
    "release:cws:publish:50",
  ]) {
    assert.match(packageJson.scripts[scriptName], /npm run (?:verify:cws-package|release:cws)/);
  }
  assert.match(verifyCwsPackageScript, /cws-package\.json/);
  assert.match(verifyCwsPackageScript, /verify-release-package\.mjs/);
  assert.match(verifyCwsPackageScript, /package-release\.json/);
  assert.match(verifyCwsPackageScript, /build-cws\.zip/);
  assert.match(verifyCwsPackageScript, /extension\.zip/);
  assert.match(verifyCwsPackageScript, /validateGitProvenance/);
  assert.match(verifyCwsPackageScript, /CWS package evidence status must be "passed"/);
  assert.match(verifyCwsPackageScript, /appendNonPassingEvidenceDetails/);
  assert.match(verifyCwsPackageScript, /remainingReleaseWork/);
  assert.match(verifyCwsPackageScript, /failedStep/);
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence generatedAt must be at or after package release evidence generatedAt/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence releaseVersion must match package release evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence packageEvidence\.releaseVersion must match package release evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence packageEvidence\.generatedAt must match package release evidence/,
  );
  assert.match(verifyCwsPackageScript, /field:\s*"automatedEvidence"/);
  assert.match(verifyCwsPackageScript, /field:\s*"manualEvidence"/);
  assert.match(verifyCwsPackageScript, /CWS package evidence \$\{field\} is required/);
  assert.match(verifyCwsPackageScript, /label:\s*"automated QA evidence"/);
  assert.match(verifyCwsPackageScript, /label:\s*"manual QA evidence"/);
  assert.match(verifyCwsPackageScript, /requiredFields:\s*\["path", "releaseVersion", "generatedAt", "status", "sha256"\]/);
  assert.match(verifyCwsPackageScript, /"testedAt"/);
  assert.match(verifyCwsPackageScript, /"automatedEvidenceGeneratedAt"/);
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence git provenance must match package release evidence/,
  );
  assert.match(verifyCwsPackageScript, /automated QA evidence status must be "passed"/);
  assert.match(verifyCwsPackageScript, /package release evidence automated QA status must be "passed"/);
  assert.match(verifyCwsPackageScript, /automated QA evidence status must match package release evidence/);
  assert.match(verifyCwsPackageScript, /manual QA evidence status must be "passed"/);
  assert.match(verifyCwsPackageScript, /package release evidence manual QA status must be "passed"/);
  assert.match(verifyCwsPackageScript, /manual QA evidence status must match package release evidence/);
  assert.match(
    verifyCwsPackageScript,
    /package release evidence automated QA releaseVersion must match automated QA evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /package release evidence manual QA releaseVersion must match manual QA evidence/,
  );
  assert.match(verifyCwsPackageScript, /CWS package sourceZip size must match current extension\.zip size/);
  assert.match(
    verifyCwsPackageScript,
    /CWS package sourceZip formatted size must match current extension\.zip size/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package sourceZip SHA-256 must match package release zip evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package sourceZip size must match package release zip evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package sourceZip formatted size must match package release zip evidence/,
  );
  assert.match(
    verifyCwsPackageScript,
    /CWS package evidence formatted zip size must match current build-cws\.zip size/,
  );
  assert.match(verifyCwsPackageScript, /package release evidence build byte size/);
  assert.match(
    verifyCwsPackageScript,
    /package release evidence formatted build size must match current build size/,
  );
  assert.match(verifyCwsPackageScript, /build-cws\.zip must match extension\.zip SHA-256/);
  assert.match(verifyCwsPackageScript, /manual QA evidence/);
  assert.match(verifyCwsPackageScript, /automated QA evidence/);
});
