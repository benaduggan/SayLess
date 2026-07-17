import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const RELEASE_AUDIT = join(ROOT, "scripts", "release-audit.mjs");

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeScript = (path, body = "process.exit(0);") => {
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
};

const makeFixture = ({
  buildManifestOverrides = {},
  manifestOverrides = {},
  packageJsonOverrides = {},
  packageLockOverrides = {},
  sourceText = "export const label = 'Local recording';\n",
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-release-audit-"));
  const defaultScripts = {
    package: "npm run package:release",
    "package:release": "node scripts/package-release.mjs",
    "package:ci-extension": "node scripts/package-ci-extension.mjs",
    "build:cws": "node scripts/package-cws.mjs",
    "preflight:cws": "npm run qa:release:status -- --require-ready",
    "release:cws":
      "npm run build:cws && npm run verify:cws-package && npm run preflight:cws",
    "release:cws:force": "npm run release:cws",
    "release:cws:publish": "npm run preflight:cws && npm run verify:cws-package",
    "release:cws:publish:10": "npm run preflight:cws && npm run verify:cws-package",
    "release:cws:publish:50": "npm run preflight:cws && npm run verify:cws-package",
    "verify:release-package": "node scripts/verify-release-package.mjs",
    "verify:cws-package": "node scripts/verify-cws-package.mjs",
    "qa:release:status": "node scripts/release-status.mjs",
    "qa:release:manual:profile": "node scripts/manual-qa-profile.mjs",
    "qa:release:manual:template": "node scripts/verify-manual-qa-evidence.mjs --write-template",
    "qa:release:manual:template:force": "node scripts/verify-manual-qa-evidence.mjs --write-template --force",
  };
  mkdirSync(join(dir, "build"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  mkdirSync(join(dir, "build", "_locales", "en"), { recursive: true });
  mkdirSync(join(dir, "build", "assets", "whisper", "models"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "tests", "e2e"), { recursive: true });
  mkdirSync(join(dir, "utils"), { recursive: true });
  mkdirSync(join(dir, "src", "assets", "editor"), { recursive: true });
  mkdirSync(join(dir, "src", "_locales", "en"), { recursive: true });
  mkdirSync(join(dir, "src", "pages", "Content"), { recursive: true });
  mkdirSync(join(dir, "src", "transcription"), { recursive: true });

  writeJson(join(dir, "package.json"), {
    version: "9.9.9",
    description:
      "Free to use, offline, local-first screen recorder with on-device transcription and word-based editing. No signup required.",
    scripts: {
      ...defaultScripts,
      ...(packageJsonOverrides.scripts || {}),
    },
    ...Object.fromEntries(Object.entries(packageJsonOverrides).filter(([key]) => key !== "scripts")),
  });
  writeJson(join(dir, "package-lock.json"), {
    version: "9.9.9",
    packages: {
      "": {
        version: "9.9.9",
      },
    },
    ...packageLockOverrides,
  });
  writeFileSync(
    join(dir, ".gitignore"),
    "build/\nrelease-artifacts/\ndist/\n*.zip\n!docs/STORE_LISTING.md\n",
  );
  writeFileSync(
    join(dir, "docs", "STORE_LISTING.md"),
    `# SayLess Store Listing

## Chrome Web Store Summary

Offline, local-first screen recording and transcript-based editing for developers.

## Chrome Web Store Description

SayLess keeps recording and editing on your device with local capture, local storage, and the bundled Whisper model.

Free to use. No signup required. All extension features are included, with no hidden access levels or separate capability modes.

## Privacy

Release defaults use the bundled Whisper model and run transcription locally without sending recordings to external services.
`,
  );
  writeFileSync(
    join(dir, "webpack.config.js"),
    `const ASSET_PATH = process.env.ASSET_PATH || "";\n{ loader: "css-loader", options: { url: false } }\n"process.env.SAYLESS_DEV_MODE": JSON.stringify(isDev && process.env.SAYLESS_DEV_MODE === "true" ? "true" : "")\n`,
  );
  writeFileSync(
    join(dir, "utils", "build.js"),
    'process.env.ASSET_PATH = "";\nconst ALLOWED_WEBPACK_WARNINGS = [{ name: "transformers import.meta standalone warning", moduleName: /@huggingface[\\\\/]transformers/, message: /import\\.meta\\\' cannot be used as a standalone expression/ }];\nconst unexpectedWarnings = [];\nif (unexpectedWarnings.length) { console.error("Webpack compilation had unexpected warnings"); process.exit(1); }\n',
  );
  writeFileSync(
    join(dir, "src", "transcription", "config.js"),
    'const isRemoteModelPath = () => false;\nconst isBundledExtensionModelPath = () => /^chrome-extension:\\/\\/[^/]+\\/assets\\/whisper\\/models\\/?$/.test("");\nnext.localModelPath = current.localModelPath;\n',
  );
  writeFileSync(
    join(dir, "scripts", "package-release.mjs"),
    "verify-manual-qa-evidence.mjs\nMANUAL_QA_VERIFIER_PATH\nSAYLESS_MANUAL_QA_ROOT\nverify-no-secrets.mjs\nNO_SECRETS_VERIFIER_PATH\nverify-release-package.mjs\nverifyWrittenPackage()\nSAYLESS_RELEASE_PACKAGE_VERIFY_ROOT\nwriteNonPassingPackageEvidence\nsayless.releasePackageIncomplete\nsayless.releasePackageFailed\nremainingReleaseWork\nfailedStep\n",
  );
  writeFileSync(
    join(dir, "scripts", "verify-manual-qa-evidence.mjs"),
    "SAYLESS_MANUAL_QA_ROOT\n--write-template\nwriteFileAtomic\nstatus: \"template\"\ncleanChromeProfile: false\nnetworkDisabledForOfflineTranscription: false\ncaptionBurnInVerified: false\nmanual QA evidence file already exists\nqa:release:manual:template:force\nDEFAULT_AUTOMATED_EVIDENCE_PATH\nautomatedEvidenceCanPrefillTemplate\nEXPECTED_AUTOMATED_COMMANDS\nisCanonicalRelativePath\ngitWorktreeFingerprint\nautomatedEvidencePath must point to\nmanual QA evidence status must be \"passed\"\nautomated QA evidence status must be \"passed\"\nautomated QA evidence startedAt must be\nautomated QA evidence durationMs must be a positive number\nautomated QA evidence durationMs must match the startedAt/generatedAt run window\nautomated QA evidence build.formattedBytes must match build.bytes\nautomated QA evidence build.path must be the canonical relative build path\nautomated QA evidence bundledWhisper.formattedBytes must match bundledWhisper.bytes\nautomated QA evidence bundledWhisper.path must be the canonical relative build/assets/whisper path\nautomated QA evidence releaseSurface is required\nautomated QA evidence releaseSurface.hasOauth2 must be false\nautomated QA evidence releaseSurface.hasExternallyConnectable must be false\nautomated QA evidence releaseSurface.hasIdentityPermission must be false\nautomated QA evidence releaseSurface.hasGoogleDrivePermission must be false\nautomated QA evidence releaseSurface.hasRemoteConnectSrc must be false\ncurrent build byte size ${currentBuildBytes} does not match\nautomated QA evidence contains duplicate command\nautomated QA evidence contains unexpected command\nautomated QA evidence command durations must not exceed total durationMs\nautomated QA evidence git.commit\nautomated QA evidence git.workingTree.sha256 must match the current git worktree\nautomated QA evidence command ${label} must be\nrecordings[${index}].id must be unique\nmust be a unique recording id within\nmust reference at least ${minimum} unique listed recording id\nmust be unique within this operation\nmust reference at least ${requiredRecordingRefs} unique listed recording id\nexternalNetworkProbe\nsameChromeProfile\nexternal http(s) URL\nobservedError must describe the browser network failure\npremium/trial/entitlement/license/upgrade\nplan/membership/locked-feature\nlocked-behind/pay-to-unlock/upgrade-required gates\naccount-tier/license-key/activation/contact-sales gates\nmanual QA evidence\n",
  );
  writeFileSync(
    join(dir, "scripts", "package-cws.mjs"),
    "package-release.mjs\nRELEASE_PACKAGER_PATH\nSAYLESS_PACKAGE_RELEASE_ROOT\npackage-release.json\ncws-package.json\nbuild-cws.zip\ngit: packageEvidence.git\nverify-cws-package.mjs\nverifyWrittenCwsPackage()\nSAYLESS_CWS_VERIFY_ROOT\nwriteNonPassingCwsEvidence\nsayless.cwsPackageIncomplete\nsayless.cwsPackageFailed\nremainingReleaseWork\nfailedStep\n",
  );
  writeFileSync(
    join(dir, "scripts", "package-ci-extension.mjs"),
    "JSZip\nbuild/manifest.json\npackage.json version\nsayless-extension-v${manifest.version}\nsayless.ciExtensionPackage\ncreateHash(\"sha256\").update(zipBuffer)\nplatform: \"UNIX\"\ndist\n",
  );
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    "pull_request:\npush:\nworkflow_dispatch:\nnpm ci\nnpx playwright install chrome chromium\nset -o pipefail\nxvfb-run -a npm run qa:release:auto\ntee release-artifacts/release-qa-automated.log\nnpm run qa:release:status\nrelease-artifacts/release-qa-automated.json\nrelease-artifacts/release-qa-automated.log\nneeds: release-checks\nnpm run build:release\nnpm run verify:release\nnpm run package:ci-extension\nactions/upload-artifact@v4\nsayless-extension-v*.zip\nsayless-extension-v*.sha256\nsayless-extension-v*.json\nsoftprops/action-gh-release@v2\nrefs/tags/v\ninputs.release_tag\ndraft: false\n",
  );
  writeFileSync(
    join(dir, "scripts", "release-qa-automated.mjs"),
    "writeNonPassingEvidence\nstatus: \"passed\"\nsayless.releaseQaAutomatedIncomplete\nsayless.releaseQaAutomatedFailed\nfailedCommand\nreleaseSurface\nhasOauth2\nhasExternallyConnectable\nhasIdentityPermission\nhasGoogleDrivePermission\nhasRemoteConnectSrc\nAutomated release QA has not passed\n",
  );
  writeFileSync(
    join(dir, "scripts", "release-status.mjs"),
    "SAYLESS_RELEASE_STATUS_ROOT\nverify-manual-qa-evidence.mjs\nverify-release-package.mjs\nverify-cws-package.mjs\ngateStatus\nevidenceGateStatus\nvalidateAutomatedEvidence\ndirFingerprint\nreleaseSurface\nEXPECTED_AUTOMATED_COMMANDS\ncommand durations must not exceed total durationMs\ngit.commit must be a 40-character SHA-1 commit\ngit.workingTree.sha256 must match the current git worktree\nverifierErrorCount\nverifierSummary\nmanualQaTodo\nManual QA todo\nRecord at least two real recordings\npublication-surface evidence for release notes, screenshots, and docs/STORE_LISTING.md store text\naccount-tier/license-key/activation/contact-sales\nnpm run qa:release:auto\nnpm run qa:release:manual:template\nnpm run qa:release:manual:profile\ncomplete docs/RELEASE_QA.md\nfix release-artifacts/manual-qa-evidence.json\nnpm run package:release\nnpm run build:cws\nnpm run verify:release-package\nnpm run verify:cws-package\nnpm run release:cws\nnpm run release:cws:publish\nrelease-artifacts/manual-qa-evidence.json\nattach docs/STORE_LISTING.md\nattach extension.zip\nattach build-cws.zip\n--require-ready\nRelease status must be ready before this action can continue\nNext steps\nRelease handoff\n",
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-profile.mjs"),
    "SAYLESS_MANUAL_QA_PROFILE_ROOT\nSAYLESS_CHROME\nbuild/manifest.json is missing\nrelease-artifacts/release-qa-automated.json is missing\nautomated QA evidence status must be \"passed\"\nautomated QA evidence generatedAt must be an ISO UTC timestamp\ncurrent build fingerprint does not match automated QA evidence\ncurrent build byte size does not match automated QA evidence\nautomated QA evidence build.formattedBytes must match current build byte size\ngitWorktreeFingerprint\nautomated QA evidence git.workingTree is required\nautomated QA evidence git.workingTree.sha256 must match the current git worktree\nautomated QA evidence git.workingTree.fileCount must match the current git worktree\nautomated QA evidence git.workingTree.statusSha256 must match the current git status\nmanual QA profile directory must be a new or empty directory\nmanual QA profile directory must be empty so manual QA uses a clean Chrome profile\nunknown manual QA profile option\nmanual QA profile helper accepts at most one --profile-dir option\nmanual QA profile --profile-dir value must not be empty\n--user-data-dir=\n--disable-extensions-except=\n--load-extension=\nchrome://extensions/\ncleanChromeProfile: true\nextensionSource: \"build\"\nautomatedEvidenceGeneratedAt\nbuildSha256\nbuildBytes\nbuildFormattedBytes\nevidencePrefill\nautomated evidence timestamp\n--launch\n--json\n",
  );
  writeFileSync(
    join(dir, "scripts", "release.mjs"),
    "Run: npm run qa:release:auto\nRun: npm run qa:release:status\nRun: npm run qa:release:manual:template\nRun: npm run qa:release:manual:profile\nComplete docs/RELEASE_QA.md manual sections\nrelease-artifacts/manual-qa-evidence.json\nRun: npm run qa:release:manual\nRun: npm run package:release\nRun: npm run verify:release-package\nRun: npm run build:cws\nRun: npm run verify:cws-package\nRun: npm run qa:release:status\nAttach release-artifacts/release-qa-automated.json, release-artifacts/manual-qa-evidence.json, release-artifacts/package-release.json, release-artifacts/cws-package.json, docs/STORE_LISTING.md, extension.zip, and build-cws.zip\n",
  );
  writeFileSync(
    join(dir, "tests", "e2e", "run-built-extension-surface.cjs"),
    "recordPageErrors\npattern: \"pageerror\"\nscanExtensionPage\nisTargetClosedError\nrecordPageErrors(hits, pageName, surface.pageErrors)\nrecordPageErrors(hits, \"content-script-popup\", contentErrors)\nrecordConsoleErrors\npattern: \"console-error\"\nmessage.type() === \"error\"\nrecordConsoleErrors(hits, pageName, surface.consoleErrors)\nrecordConsoleErrors(hits, \"content-script-popup\", contentConsoleErrors)\n",
  );
  writeFileSync(
    join(dir, "scripts", "verify-cws-package.mjs"),
    "verify-release-package.mjs\ncws-package.json\npackage-release.json\nbuild-cws.zip\nextension.zip\nisCanonicalRelativePath\nautomated QA evidence status must be \"passed\"\npackage release evidence automated QA status must be \"passed\"\nautomated QA evidence status must match package release evidence\nmanual QA evidence status must be \"passed\"\npackage release evidence manual QA status must be \"passed\"\nmanual QA evidence status must match package release evidence\npackage release evidence automated QA releaseVersion must match automated QA evidence\npackage release evidence manual QA releaseVersion must match manual QA evidence\nCWS package evidence status must be \"passed\"\nappendNonPassingEvidenceDetails\nremainingReleaseWork\nfailedStep\nvalidateGitProvenance\nCWS package evidence releaseVersion must match package release evidence\nCWS package evidence packageEvidence.releaseVersion must match package release evidence\nCWS package evidence packageEvidence.generatedAt must match package release evidence\nCWS package evidence packageEvidence.path is required\nCWS package evidence packageEvidence.path must point to release-artifacts/package-release.json\nCWS package evidence git provenance must match package release evidence\nCWS package sourceZip.path is required\nCWS package sourceZip.path must point to extension.zip\nCWS package sourceZip size must match current extension.zip size\nCWS package sourceZip formatted size must match current extension.zip size\nCWS package sourceZip SHA-256 must match package release zip evidence\nCWS package sourceZip size must match package release zip evidence\nCWS package sourceZip formatted size must match package release zip evidence\npackage release evidence build byte size\npackage release evidence formatted build size must match current build size\nCWS package evidence cwsZip.path is required\nCWS package evidence cwsZip.path must point to build-cws.zip\nCWS package evidence formatted zip size must match current build-cws.zip size\nCWS package evidence generatedAt must be at or after package release evidence generatedAt\n",
  );
  writeFileSync(
    join(dir, "scripts", "verify-release-package.mjs"),
    "package-release.json\nextension.zip\nisCanonicalRelativePath\nverify-manual-qa-evidence.mjs\nSAYLESS_MANUAL_QA_ROOT\nmanual QA evidence\nautomated QA evidence\nappendNonPassingEvidenceDetails\nremainingReleaseWork\nfailedStep\npackage release evidence status must be \"passed\"\nautomated QA evidence status must be \"passed\"\npackage release evidence automated QA status must be \"passed\"\nautomated QA evidence status must match package release evidence\nmanual QA evidence status must be \"passed\"\npackage release evidence manual QA status must be \"passed\"\nmanual QA evidence status must match package release evidence\nvalidateGitProvenance\npackage release evidence releaseVersion must match automated QA evidence\npackage release evidence automated QA releaseVersion must match automated QA evidence\npackage release evidence releaseVersion must match manual QA evidence\npackage release evidence manual QA releaseVersion must match manual QA evidence\npackage release evidence generatedAt must be at or after automated QA evidence generatedAt\npackage release evidence generatedAt must be at or after manual QA evidence testedAt\npackage release evidence git provenance must match automated QA evidence\npackage release evidence build byte size\npackage release evidence formatted build size must match current build size\npackage release evidence formatted zip size must match current extension.zip size\npackage release evidence zip.path is required\npackage release evidence zip.path must point to extension.zip\n",
  );
  writeScript(
    join(dir, "scripts", "verify-local-whisper-assets.mjs"),
    "console.error('fixture whisper verifier must not run'); process.exit(1);",
  );
  writeScript(
    join(dir, "scripts", "verify-no-secrets.mjs"),
    "const SKIP_EXTENSIONS = new Set([\n  \".png\",\n  \".jpg\",\n  \".jpeg\",\n  \".gif\",\n  \".woff\",\n  \".woff2\",\n  \".ttf\",\n  \".otf\",\n  \".ico\",\n  \".mp3\",\n  \".mp4\",\n  \".webm\",\n  \".wasm\",\n  \".bin\",\n]);\nconsole.error('fixture no-secrets verifier must not run'); process.exit(1);",
  );
  const manifest = {
    manifest_version: 3,
    version: "9.9.9",
    name: "SayLess fixture",
    permissions: [],
    host_permissions: ["<all_urls>"],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self';",
    },
    ...manifestOverrides,
  };
  writeJson(join(dir, "src", "manifest.json"), manifest);
  writeJson(join(dir, "build", "manifest.json"), {
    ...manifest,
    ...buildManifestOverrides,
  });
  const messages = {
    extName: {
      message: "SayLess fixture",
    },
    extDesc: {
      message:
        "Free to use, offline, local-first screen recorder with on-device transcription and word-based editing. No signup required.",
    },
  };
  writeJson(join(dir, "src", "_locales", "en", "messages.json"), messages);
  writeJson(join(dir, "build", "_locales", "en", "messages.json"), messages);
  writeJson(join(dir, "build", "assets", "whisper", "model-manifest.json"), {
    assetRoot: "assets/whisper/models/",
    requiredFiles: ["fixture-model.bin"],
    fileIntegrity: {
      "fixture-model.bin": {
        bytes: 0,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    },
  });
  writeFileSync(join(dir, "build", "assets", "whisper", "models", "fixture-model.bin"), "");
  writeFileSync(join(dir, "build", "background.js"), "console.log('local only');\n");
  writeFileSync(
    join(dir, "src", "assets", "editor", "index.html"),
    '<!DOCTYPE html><html><head><title>SayLess Editor</title></head><body><div id="root"></div></body></html>\n',
  );
  writeFileSync(join(dir, "src", "pages", "Content", "Gate.jsx"), sourceText);

  return dir;
};

const runAudit = (root) =>
  spawnSync(process.execPath, [RELEASE_AUDIT], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_RELEASE_AUDIT_ROOT: root },
    encoding: "utf8",
  });

test("release audit requires a machine-scanned store listing draft", () => {
  const fixture = makeFixture();
  try {
    rmSync(join(fixture, "docs", "STORE_LISTING.md"), { force: true });

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md is missing/);
    assert.match(result.stderr, /machine-scanned store listing draft/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires the store listing draft to be trackable", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(join(fixture, ".gitignore"), "build/\nrelease-artifacts/\ndist/\n*.zip\n");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.gitignore must allow docs\/STORE_LISTING\.md/);
    assert.match(result.stderr, /machine-scanned store listing draft can be tracked/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects gated or cloud publication surface text", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "docs", "STORE_LISTING.md"),
      `# SayLess Store Listing

## Chrome Web Store Summary

Offline, local-first screen recording and transcript-based editing for developers.

## Chrome Web Store Description

Free to use. No signup required. All extension features are included.
Upgrade your account tier for premium remote transcription and cloud upload.

## Privacy

Release defaults use the bundled Whisper model and run transcription locally without sending recordings to external services.
`,
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: account tier/);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: premium/);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: remote transcription/);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: cloud upload/);
    assert.match(result.stderr, /forbidden publication-surface string/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires offline local-first no-signup release metadata", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      description: "Privacy-friendly screen recording.",
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package\.json description is missing required free\/offline\/local-first\/no-signup metadata phrase/,
    );
    assert.match(result.stderr, /\\bFree to use\\b/);
    assert.match(result.stderr, /\\boffline\\b/);
    assert.match(result.stderr, /\\blocal-first\\b/);
    assert.match(result.stderr, /\\bNo signup required\\b/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects gated release metadata", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      description:
        "Free to use, offline, local-first screen recorder with on-device transcription and word-based editing. No signup required. Upgrade your account tier for premium cloud upload.",
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json: account tier/);
    assert.match(result.stderr, /package\.json: premium/);
    assert.match(result.stderr, /package\.json: cloud upload/);
    assert.match(result.stderr, /forbidden publication-surface string\(s\) found in release metadata/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires CI extension package wiring", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      scripts: {
        "package:ci-extension": "node scripts/package-release.mjs",
      },
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package:ci-extension must run scripts\/package-ci-extension\.mjs/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires GitHub Actions release checks and downloadable bundle publishing", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(join(fixture, ".github", "workflows", "ci.yml"), "pull_request:\n");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GitHub Actions CI must run release checks/);
    assert.match(result.stderr, /downloadable extension bundle/);
    assert.match(result.stderr, /direct-download release assets/);
    assert.match(result.stderr, /explicit manual tags/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires built extension description metadata to match the offline product", () => {
  const fixture = makeFixture();
  try {
    writeJson(join(fixture, "build", "_locales", "en", "messages.json"), {
      extName: {
        message: "SayLess fixture",
      },
      extDesc: {
        message: "Privacy-friendly screen recording.",
      },
    });

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /build\/_locales\/en\/messages\.json extDesc\.message is missing required free\/offline\/local-first\/no-signup metadata phrase/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects paid and account-gated active source references", () => {
  const fixture = makeFixture({
    sourceText:
      "export const cta = 'Premium feature gates are back';\nexport const hiddenGate = 'Free trial entitlement required';\nexport const accountGate = 'Member-only export for the team plan';\nexport const tierGate = 'Account tiers and enterprise-only exports are back';\nexport const salesGate = 'Contact sales for a license key because activation required';\nexport const lockCopy = 'Exports are locked behind a subscription and upgrade-required';\nexport const payCopy = 'Pay to unlock local transcription';\nexport const requiredAccount = 'Offline export requires an account and sign-in required';\n",
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Premium/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Free trial/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: team plan/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Member-only/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Account tiers/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: enterprise-only/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Contact sales/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: license key/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: activation required/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: locked behind a subscription/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Pay to unlock/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: requires an account/);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: sign-in required/);
    assert.match(result.stderr, /paid\/account-gating source reference/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects network endpoint literals in active source", () => {
  const fixture = makeFixture({
    sourceText: "export const uploadEndpoint = 'https://api.example.com/upload';\n",
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: https:\/\/api\.example\.com\/upload/);
    assert.match(result.stderr, /network endpoint literal\(s\) found in active extension source/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit scans SVG source assets for paid and account-gated text", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "src", "assets", "editor", "badge.svg"),
      "<svg><title>Premium cloud upload</title></svg>\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/assets\/editor\/badge\.svg: Premium/);
    assert.match(result.stderr, /paid\/account-gating source reference/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit scans SVG source assets for network endpoint literals", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "src", "assets", "editor", "endpoint.svg"),
      '<svg><a href="https://api.example.com/upload"/></svg>\n',
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/assets\/editor\/endpoint\.svg: https:\/\/api\.example\.com\/upload/);
    assert.match(result.stderr, /network endpoint literal\(s\) found in active extension source/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects legacy Screenity debug and keepalive names", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "Recorder"), { recursive: true });
    writeFileSync(
      join(fixture, "src", "pages", "Recorder", "Recorder.jsx"),
      "export const debugRecorder = window.SCREENITY_DEBUG_RECORDER;\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/Recorder\/Recorder\.jsx: SCREENITY_DEBUG_RECORDER/);
    assert.match(result.stderr, /legacy Screenity build\/test env reference/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects stale active Screenity UI and debug names", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "EditorApp"), { recursive: true });
    writeFileSync(
      join(fixture, "src", "pages", "EditorApp", "EditorApp.jsx"),
      "export const className = 'screenity-scrollbar';\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/EditorApp\/EditorApp\.jsx: screenity-scrollbar/);
    assert.match(result.stderr, /stale active Screenity UI\/debug name/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited Screenity product references in active source", () => {
  const fixture = makeFixture({
    sourceText: "export const legacyBrand = 'Screenity hosted recorder';\n",
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: Screenity/);
    assert.match(result.stderr, /inherited Screenity product reference/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects missing local-only dynamic URL guards", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "EditorApp", "context"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture, "src", "pages", "EditorApp", "context", "ContentState.jsx"),
      "export const requestDownload = async (url) => fetch(url);\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/EditorApp\/context\/ContentState\.jsx: editor export download path must validate blob URLs/,
    );
    assert.match(result.stderr, /dynamic local URL guard\(s\) missing/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects missing shared blob download URL guard", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "utils"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture, "src", "pages", "utils", "localFileExport.js"),
      "export const downloadBlobWithChrome = (blob) => chrome.downloads.download({ url: URL.createObjectURL(blob) });\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/utils\/localFileExport\.js: shared local file export helper must validate blob URLs/,
    );
    assert.match(result.stderr, /dynamic local URL guard\(s\) missing/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects remote transcription harness references", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "tests", "e2e"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture, "tests", "e2e", "run-transcription.cjs"),
      "const JFK_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';\nconst opts = { allowRemoteModels: true };\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tests\/e2e\/run-transcription\.cjs: JFK_URL/);
    assert.match(result.stderr, /remote transcription harness reference\(s\) found/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects remote telemetry and analytics source references", () => {
  const fixture = makeFixture({
    sourceText:
      "export const eventSink = 'remote analytics telemetry must stay out';\n",
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: telemetry/);
    assert.match(
      result.stderr,
      /remote telemetry\/analytics source reference\(s\) found in active extension source/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects stale template analytics HTML references", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "src", "assets", "editor", "index.html"),
      `<!DOCTYPE html>
<html>
  <head>
    <meta name="description" content="Web site created using create-react-app" />
    <title>React App</title>
  </head>
  <body>
    <!-- This HTML file is a template. -->
    <div id="root"></div>
  </body>
</html>
`,
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/assets\/editor\/index\.html: Web site created using create-react-app/,
    );
    assert.match(
      result.stderr,
      /src\/assets\/editor\/index\.html: <title>React App<\/title>/,
    );
    assert.match(result.stderr, /stale template\/analytics HTML reference\(s\) found/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited founder review copy in locale text", () => {
  const fixture = makeFixture();
  try {
    writeJson(join(fixture, "src", "_locales", "en", "messages.json"), {
      extName: {
        message: "SayLess fixture",
      },
      extDesc: {
        message:
          "Free to use, offline, local-first screen recorder with on-device transcription and word-based editing. No signup required.",
      },
      reviewThanksDescription: {
        message:
          "I'm Alyssa, the solo maker behind SayLess. I built the first version back in 2020.",
      },
      reviewSorryButton: {
        message: "Open the private feedback form",
      },
      getHelpButton: {
        message: "Open a prefilled support form",
      },
      welcomePopupSupport: {
        message: "Support development by a solo indie maker",
      },
    });

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/_locales\/en\/messages\.json: Alyssa/);
    assert.match(result.stderr, /src\/_locales\/en\/messages\.json: solo maker/);
    assert.match(result.stderr, /src\/_locales\/en\/messages\.json: private feedback form/);
    assert.match(result.stderr, /src\/_locales\/en\/messages\.json: support form/);
    assert.match(result.stderr, /src\/_locales\/en\/messages\.json: solo indie maker/);
    assert.match(result.stderr, /forbidden locale string/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects broad and internal web-accessible assets", () => {
  const fixture = makeFixture({
    manifestOverrides: {
      web_accessible_resources: [
        {
          resources: [
            "assets/*",
            "assets/whisper/model.onnx",
            "assets/mediapipeVision/vision_bundle.wasm",
            "assets/vendor/bundle.js",
            "assets/videos/pro.mp4",
          ],
          matches: ["<all_urls>"],
        },
      ],
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /manifest exposes broad or internal asset resource\(s\) as web-accessible/,
    );
    assert.match(result.stderr, /assets\/\*/);
    assert.match(result.stderr, /assets\/whisper\/model\.onnx/);
    assert.match(result.stderr, /assets\/mediapipeVision\/vision_bundle\.wasm/);
    assert.match(result.stderr, /assets\/vendor\/bundle\.js/);
    assert.match(result.stderr, /assets\/videos\/pro\.mp4/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited promo and social source assets", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "assets", "temp"), { recursive: true });
    writeFileSync(join(fixture, "src", "assets", "temp", "substack.webp"), "stale");
    writeFileSync(join(fixture, "src", "assets", "twitter-logo.svg"), "stale");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /source contains removed hosted\/cloud surface path\(s\)/);
    assert.match(result.stderr, /src\/assets\/temp\/substack\.webp/);
    assert.match(result.stderr, /src\/assets\/twitter-logo\.svg/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects obsolete removed-package patches", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "patches"), { recursive: true });
    writeFileSync(join(fixture, "patches", "fabric+5.3.0.patch"), "stale");
    writeFileSync(join(fixture, "patches", "plyr+3.7.8.patch"), "stale");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /source contains removed hosted\/cloud surface path\(s\)/);
    assert.match(result.stderr, /patches\/fabric\+5\.3\.0\.patch/);
    assert.match(result.stderr, /patches\/plyr\+3\.7\.8\.patch/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects stale dev auto-reload dependencies", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "utils", "autoReloadClients"), { recursive: true });
    writeFileSync(join(fixture, "utils", "server.js"), 'require("ssestream");\n');
    writeFileSync(
      join(fixture, "utils", "autoReloadClients", "backgroundClient.js"),
      'const querystring = require("querystring");\n',
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dev server must use native SSE/);
    assert.match(result.stderr, /auto-reload client must parse resource queries/);
    assert.match(result.stderr, /forbidden source configuration/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited support diagnostic cloud and Screenity markers", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "utils"), { recursive: true });
    writeFileSync(
      join(fixture, "src", "pages", "utils", "buildSupportContext.js"),
      "export const buildSupportContext = () => { const ctx = {}; ctx.cloud = '0'; ctx.supportCode = 'SCR-1234'; return ctx; };\n",
    );
    writeFileSync(
      join(fixture, "src", "pages", "utils", "errorCodes.js"),
      "export const makeSupportCode = () => 'SCR-0000';\n",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /support diagnostics must use SayLess local-first markers/);
    assert.match(result.stderr, /support diagnostic codes must use a SayLess prefix/);
    assert.match(result.stderr, /forbidden source configuration/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited promo and social build assets", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "build", "assets", "temp"), { recursive: true });
    writeFileSync(join(fixture, "build", "assets", "temp", "twitter.webp"), "stale");
    writeFileSync(join(fixture, "build", "assets", "solo-dev.png"), "stale");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /build contains stale forbidden asset\(s\)/);
    assert.match(result.stderr, /assets\/temp\/twitter\.webp/);
    assert.match(result.stderr, /assets\/solo-dev\.png/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects missing pinned host permission", () => {
  const fixture = makeFixture({
    manifestOverrides: {
      host_permissions: [],
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /manifest host_permissions must stay pinned to the single recorder UI injection permission <all_urls>/,
    );
    assert.match(result.stderr, /found none/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects source/build manifest release-field drift", () => {
  const fixture = makeFixture({
    buildManifestOverrides: {
      permissions: ["downloads"],
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /source and build manifest release-critical field\(s\) differ: permissions/,
    );
    assert.match(result.stderr, /Run npm run build:release before release verification/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects package version drift", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      version: "9.9.8",
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json version \(9\.9\.8\) must match src\/manifest\.json version \(9\.9\.9\)/);
    assert.match(result.stderr, /Run npm run release -- <patch\|minor\|major>/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects direct CWS store upload scripts without release gates", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      scripts: {
        "release:cws:unsafe-upload": "chrome-webstore-upload upload --source build-cws.zip",
      },
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /release:cws:unsafe-upload invokes chrome-webstore-upload and must run preflight:cws plus verify:cws-package before the store action/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects no-secrets scanners that skip SVG assets", () => {
  const fixture = makeFixture();
  try {
    writeScript(
      join(fixture, "scripts", "verify-no-secrets.mjs"),
      "const SKIP_EXTENSIONS = new Set([\".png\", \".svg\", \".mp4\"]);\nconsole.error('fixture no-secrets verifier must not run'); process.exit(1);",
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/verify-no-secrets\.mjs must scan text SVG assets for secret leaks/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects package lockfile version drift", () => {
  const fixture = makeFixture({
    packageLockOverrides: {
      version: "9.9.7",
      packages: {
        "": {
          version: "9.9.6",
        },
      },
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package-lock\.json version \(9\.9\.7\) must match src\/manifest\.json version \(9\.9\.9\)/);
    assert.match(result.stderr, /Run npm run release -- <patch\|minor\|major>/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit accepts a minimal local-only fixture", () => {
  const fixture = makeFixture();
  try {
    const result = runAudit(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release audit passed/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
