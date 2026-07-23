import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    typecheck: "node scripts/typecheck.mjs",
    lint: "npm run typecheck",
    package: "npm run package:release",
    "package:release": "node scripts/package-release.mjs",
    "package:ci-extension": "node scripts/package-ci-extension.mjs",
    "build:cws": "node scripts/package-cws.mjs",
    "preflight:cws": "npm run qa:release:status -- --require-ready",
    "release:cws":
      "npm run build:cws && npm run verify:cws-package && npm run preflight:cws",
    "release:cws:force": "npm run release:cws",
    "release:cws:publish":
      "npm run preflight:cws && npm run verify:cws-package",
    "release:cws:publish:10":
      "npm run preflight:cws && npm run verify:cws-package",
    "release:cws:publish:50":
      "npm run preflight:cws && npm run verify:cws-package",
    "verify:release-package": "node scripts/verify-release-package.mjs",
    "verify:cws-package": "node scripts/verify-cws-package.mjs",
    "qa:release:status": "node scripts/release-status.mjs",
    "qa:release:manual:profile": "node scripts/manual-qa-profile.mjs",
    "qa:release:manual:progress":
      "node scripts/verify-manual-qa-evidence.mjs --progress",
    "qa:release:manual:media": "node scripts/manual-qa-media-probe.mjs",
    "qa:release:manual:sidecars": "node scripts/manual-qa-sidecar-probe.mjs",
    "qa:release:manual:measurements":
      "node scripts/apply-manual-qa-measurements.mjs",
    "qa:release:manual:template":
      "node scripts/verify-manual-qa-evidence.mjs --write-template",
    "qa:release:manual:template:force":
      "node scripts/verify-manual-qa-evidence.mjs --write-template --force",
  };
  mkdirSync(join(dir, "build"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  mkdirSync(join(dir, "build", "_locales", "en"), { recursive: true });
  mkdirSync(join(dir, "build", "assets", "whisper", "models"), {
    recursive: true,
  });
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
    ...Object.fromEntries(
      Object.entries(packageJsonOverrides).filter(([key]) => key !== "scripts")
    ),
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
    "build/\nrelease-artifacts/\ndist/\n*.zip\n!docs/STORE_LISTING.md\n"
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
`
  );
  writeFileSync(
    join(dir, "webpack.config.cts"),
    `const ASSET_PATH = process.env.ASSET_PATH || "";\n{ loader: "css-loader", options: { url: false } }\n"process.env.SAYLESS_DEV_MODE": JSON.stringify(isDev && process.env.SAYLESS_DEV_MODE === "true" ? "true" : "")\n`
  );
  writeFileSync(
    join(dir, "utils", "build.cts"),
    'process.env.ASSET_PATH = "";\nconst ALLOWED_WEBPACK_WARNINGS = [{ name: "transformers import.meta standalone warning", moduleName: /@huggingface[\\\\/]transformers/, message: /import\\.meta\\\' cannot be used as a standalone expression/ }];\nconst unexpectedWarnings = [];\nif (unexpectedWarnings.length) { console.error("Webpack compilation had unexpected warnings"); process.exit(1); }\n'
  );
  writeFileSync(
    join(dir, "src", "transcription", "config.ts"),
    'const isRemoteModelPath = () => false;\nconst isBundledExtensionModelPath = () => /^chrome-extension:\\/\\/[^/]+\\/assets\\/whisper\\/models\\/?$/.test("");\nnext.localModelPath = current.localModelPath;\n'
  );
  writeFileSync(
    join(dir, "scripts", "package-release.mjs"),
    "verify-manual-qa-evidence.mjs\nMANUAL_QA_VERIFIER_PATH\nSAYLESS_MANUAL_QA_ROOT\nverify-no-secrets.mjs\nNO_SECRETS_VERIFIER_PATH\nverify-release-package.mjs\nverifyWrittenPackage()\nSAYLESS_RELEASE_PACKAGE_VERIFY_ROOT\nwriteNonPassingPackageEvidence\nsayless.releasePackageIncomplete\nsayless.releasePackageFailed\nremainingReleaseWork\nfailedStep\n"
  );
  writeFileSync(
    join(dir, "scripts", "verify-manual-qa-evidence.mjs"),
    'const REQUIRED_AUTOMATED_COMMANDS = ["typecheck"];\n' +
      '["finalization", "Final verification", ["status", "testedAt"]]\n' +
      'environment.networkDisabledForOfflineTranscription\nreturn "offlineTranscription"\n' +
      'SAYLESS_MANUAL_QA_ROOT\n--write-template\n--progress\n--section=\nsayless.manualQaProgress\nMANUAL_QA_PROGRESS_SECTIONS\n["mediaProbe", "Media probe report"]\n["sidecarProbe", "Sidecar probe report"]\n["measurementImport", "Probe measurements"]\nMEASUREMENT_IMPORT_ERROR_PATTERN\nerrorSamples\nworkTargets\nWork targets:\nprobeReports.media\nprobeReports.sidecars\nsayless.manualQaSessionProvenance\nmanualSession.profileCreatedAt\nmanualSessionMatches\n"buildSha256"\n"operatingSystem"\nselectedSection\nnextSection\nNext command:\nnpm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json\nnpm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json\nnpm run qa:release:manual:measurements -- --json --write\nwriteFileAtomic\nstatus: "template"\ncleanChromeProfile: false\nnetworkDisabledForOfflineTranscription: false\ncaptionBurnInVerified: false\nmanual QA evidence file already exists\nqa:release:manual:template:force\nDEFAULT_AUTOMATED_EVIDENCE_PATH\nMEDIA_PROBE_REPORT_RELATIVE_PATH\nSIDECAR_PROBE_REPORT_RELATIVE_PATH\nautomatedEvidenceCanPrefillTemplate\nEXPECTED_AUTOMATED_COMMANDS\nisCanonicalRelativePath\ngitWorktreeFingerprint\nautomatedEvidencePath must point to\nmanual QA evidence status must be "passed"\nautomated QA evidence status must be "passed"\nautomated QA evidence startedAt must be\nautomated QA evidence durationMs must be a positive number\nautomated QA evidence durationMs must match the startedAt/generatedAt run window\nautomated QA evidence build.formattedBytes must match build.bytes\nautomated QA evidence build.path must be the canonical relative build path\nautomated QA evidence bundledWhisper.formattedBytes must match bundledWhisper.bytes\nautomated QA evidence bundledWhisper.path must be the canonical relative build/assets/whisper path\nautomated QA evidence builtExtension.id must be a browser-observed\nenvironment.unpackedExtensionId must match the browser-observed automated extension id\nautomated QA evidence releaseSurface is required\nautomated QA evidence releaseSurface.hasOauth2 must be false\nautomated QA evidence releaseSurface.hasExternallyConnectable must be false\nautomated QA evidence releaseSurface.hasIdentityPermission must be false\nautomated QA evidence releaseSurface.hasGoogleDrivePermission must be false\nautomated QA evidence releaseSurface.hasRemoteConnectSrc must be false\ncurrent build byte size ${currentBuildBytes} does not match\nautomated QA evidence contains duplicate command\nautomated QA evidence contains unexpected command\nautomated QA evidence command durations must not exceed total durationMs\nautomated QA evidence git.commit\nautomated QA evidence git.workingTree.sha256 must match the current git worktree\nautomated QA evidence command ${label} must be\nprobeReports.${field} must point to\nmanual QA media probe report releaseCoverage.status must be "measurable-set-complete"\nmanual QA sidecar probe report coverage.status must be "structurally-complete"\nmust match probeReports.media\nmust match probeReports.${reportField}\n64-character source-file SHA-256\n64-character export-file SHA-256\n64-character project-audio file SHA-256\nrecordings[${index}].id must be unique\nmust be a unique recording id within\nmust reference at least ${minimum} unique listed recording id\nmust be unique within this operation\nmust reference at least ${requiredRecordingRefs} unique listed recording id\nexternalNetworkProbe\nsameChromeProfile\nexternal http(s) URL\nobservedError must describe the browser network failure\npremium/trial/entitlement/license/upgrade\nplan/membership/locked-feature\nlocked-behind/pay-to-unlock/upgrade-required gates\naccount-tier/license-key/activation/contact-sales gates\nmanual QA evidence\n'
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-media-probe.mjs"),
    "openAsBlob\nBlobSource\ncomputeDuration\ngetDisplayWidth\ngetDisplayHeight\ngetNumberOfChannels\ngetSampleRate\nsha256File\nrecordingFields = { fileName, sha256 }\nprojectAudioInputFields = { fileName, sha256 }\nreleaseThresholds\nreleaseCoverage\nrequireComplete\n--require-complete\n--output=\nmanual-qa-report-output.mjs\nwriteReportAtomically\nreportPath\nmeasurable-set-complete\nprocess.exitCode = 1\nmanual-qa-media-coverage.mjs\n"
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-media-coverage.mjs"),
    "const MIN_LONG_RECORDING_DURATION_SECONDS = 180\nconst MIN_LARGE_RECORDING_BYTE_SIZE = 25 * 1024 * 1024\noriginal source recordings rather than exports\nobservations manually\n"
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-sidecar-probe.mjs"),
    "sayless.localRecordingProject\nsayless.localRecordingTranscript\nconst PROJECT_SCHEMA_VERSION = 4\nWEBVTT\ntimelineAwareWords\nproject.timeline.clips\nproject timeline/source durations must match\nsayless-project-json\ntranscript-json\nexportFields: { format, fileName, byteSize, sha256 }\nsidecarSetName\ncompleteSetCount\nrecording-id-mismatch\nrequireComplete\n--require-complete\n--output=\nmanual-qa-report-output.mjs\nwriteReportAtomically\nreportPath\nprocess.exitCode = 1\nStructural checks are read-only\nimport the project sidecar\n"
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-measurement-import.mjs"),
    'buildManualQaMeasurementImport\nmanual QA evidence status must be "template"\nmeasurable-set-complete\nstructurally-complete\nfileName must exactly match\nrecordingFields\nprojectAudioInputFields\n["byteSize", "sha256"]\n'
  );
  writeFileSync(
    join(dir, "scripts", "apply-manual-qa-measurements.mjs"),
    "buildManualQaMeasurementImport\nSAYLESS_MANUAL_QA_MEASUREMENTS_ROOT\n--write\nsayless.manualQaMeasurementImport\nrenameSync\n"
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-report-output.mjs"),
    '--output may be provided only once\n--output requires a file path\nmust not overwrite an inspected input file\nwriteFileSync\nflag: "wx"\nrenameSync\nunlinkSync\nrandomUUID\n'
  );
  writeFileSync(
    join(dir, "tests", "e2e", "run-local-recordings.cjs"),
    "manual-qa-sidecar-probe.mjs\n--require-complete\n_sidecarProbeExports\nproductSidecarProbe\ncoverage.completeSetCount\n"
  );
  writeFileSync(
    join(dir, "scripts", "package-cws.mjs"),
    "package-release.mjs\nRELEASE_PACKAGER_PATH\nSAYLESS_PACKAGE_RELEASE_ROOT\npackage-release.json\ncws-package.json\nbuild-cws.zip\ngit: packageEvidence.git\nverify-cws-package.mjs\nverifyWrittenCwsPackage()\nSAYLESS_CWS_VERIFY_ROOT\nwriteNonPassingCwsEvidence\nsayless.cwsPackageIncomplete\nsayless.cwsPackageFailed\nremainingReleaseWork\nfailedStep\n"
  );
  writeFileSync(
    join(dir, "scripts", "package-ci-extension.mjs"),
    'JSZip\nbuild/manifest.json\npackage.json version\nsayless-extension-v${manifest.version}\nsayless.ciExtensionPackage\ncreateHash("sha256").update(zipBuffer)\nplatform: "UNIX"\ndist\n'
  );
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    "pull_request:\npush:\nworkflow_dispatch:\nactions/checkout@v7.0.1\nactions/checkout@v7.0.1\nactions/setup-node@v7.0.0\nactions/setup-node@v7.0.0\nnode-version: 24\nnode-version: 24\nnpm ci\nDeterminateSystems/determinate-nix-action@v3.21.8\nTypecheck with TypeScript 7\nnpm run typecheck\nactions/cache@v5.0.5\n~/.cache/ms-playwright\nplaywright-core/package.json\nnpx playwright install chrome chromium\nset -o pipefail\nxvfb-run -a npm run qa:release:auto\ntee release-artifacts/release-qa-automated.log\nnpm run qa:release:status\nrelease-artifacts/release-qa-automated.json\nrelease-artifacts/release-qa-automated.log\nneeds: release-checks\nnpm run build:release\nnpm run verify:release\nnpm run package:ci-extension\nactions/upload-artifact@v7.0.1\nsayless-extension-v*.zip\nsayless-extension-v*.sha256\nsayless-extension-v*.json\nsoftprops/action-gh-release@v3.0.0\nrefs/tags/v\ninputs.release_tag\ndraft: false\n"
  );
  writeFileSync(
    join(dir, "scripts", "release-qa-automated.mjs"),
    'writeNonPassingEvidence\nstatus: "passed"\nlabel: "typecheck"\nargs: ["run", "typecheck"]\nnpm run typecheck\ntest:e2e:editor-editing-proof\nsayless.releaseQaAutomatedIncomplete\nsayless.releaseQaAutomatedFailed\nfailedCommand\nreadBuiltExtensionEvidence\nbuiltExtensionSurfaceEvidence\nbuiltExtension:\nreleaseSurface\nhasOauth2\nhasExternallyConnectable\nhasIdentityPermission\nhasGoogleDrivePermission\nhasRemoteConnectSrc\nAutomated release QA has not passed\nqa:release:manual:profile -- --sync-template --launch\n'
  );
  writeFileSync(
    join(dir, "scripts", "typecheck.mjs"),
    'spawnSync("tsgo");\nspawnSync("nix-shell");\n'
  );
  writeFileSync(
    join(dir, "scripts", "release-status.mjs"),
    'const REQUIRED_AUTOMATED_COMMANDS = ["typecheck"];\n' +
      "SAYLESS_RELEASE_STATUS_ROOT\nverify-manual-qa-evidence.mjs\nverify-release-package.mjs\nverify-cws-package.mjs\ngateStatus\nevidenceGateStatus\nvalidateAutomatedEvidence\ndirFingerprint\nreleaseSurface\nEXPECTED_AUTOMATED_COMMANDS\ncommand durations must not exceed total durationMs\ngit.commit must be a 40-character SHA-1 commit\ngit.workingTree.sha256 must match the current git worktree\nbuiltExtension.id must be a browser-observed\nverifierErrorCount\nverifierSummary\nmanualQaTodo\ndiscoverActiveManualQaSession\nrelease-artifacts/manual-qa-session.json\nrecorded session cannot be resumed\nresumeAction\nmanualTemplateSyncState\nmanual-qa-template-sync.mjs\nanalyzeManualTemplateSync\ntemplateSyncRequired\nautomated QA must pass before template freshness can be established\nManual QA todo\nfor (const todo of item.todo)\nRecord at least two real recordings\nat least 25 MiB\nper-recording crop evidence\nreal WAV, M4A, and MP3 inputs\npublication-surface evidence for release notes, screenshots, and docs/STORE_LISTING.md store text\naccount-tier/license-key/activation/contact-sales\nnpm run qa:release:auto\nnpm run qa:release:manual:template\nnpm run qa:release:manual:profile -- --launch\nnpm run qa:release:manual:profile -- --sync-template --launch\nnpm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json\nnpm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json\nfilename-matched three-format set\nnpm run qa:release:manual:progress\ncomplete docs/RELEASE_QA.md\nfix release-artifacts/manual-qa-evidence.json\nnpm run package:release\nnpm run build:cws\nnpm run verify:release-package\nnpm run verify:cws-package\nnpm run release:cws\nnpm run release:cws:publish\nrelease-artifacts/manual-qa-evidence.json\nattach release-artifacts/manual-qa-media-probe.json\nattach release-artifacts/manual-qa-sidecar-probe.json\nattach docs/STORE_LISTING.md\nattach extension.zip\nattach build-cws.zip\n--require-ready\nRelease status must be ready before this action can continue\nNext steps\nRelease handoff\n"
  );
  writeFileSync(
    join(dir, "scripts", "release-status.mjs"),
    `${readFileSync(
      join(dir, "scripts", "release-status.mjs"),
      "utf8"
    )}npm run qa:release:manual:measurements -- --json --write\n`
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-profile.mjs"),
    'SAYLESS_MANUAL_QA_PROFILE_ROOT\nSAYLESS_CHROME\nbuild/manifest.json is missing\nrelease-artifacts/release-qa-automated.json is missing\nautomated QA evidence status must be "passed"\nautomated QA evidence generatedAt must be an ISO UTC timestamp\ncurrent build fingerprint does not match automated QA evidence\ncurrent build byte size does not match automated QA evidence\nautomated QA evidence build.formattedBytes must match current build byte size\ngitWorktreeFingerprint\nautomated QA evidence git.workingTree is required\nautomated QA evidence git.workingTree.sha256 must match the current git worktree\nautomated QA evidence git.workingTree.fileCount must match the current git worktree\nautomated QA evidence git.workingTree.statusSha256 must match the current git status\npassing clean-profile built-extension identity evidence\nmanual QA profile directory must be a new or empty directory\nmanual QA profile directory must be empty so manual QA uses a clean Chrome profile\nunknown manual QA profile option\nmanual QA profile helper accepts at most one --profile-dir option\nmanual QA profile --profile-dir value must not be empty\n--resume-profile\nPROFILE_MARKER_FILE\nsayless.manualQaProfile\nsayless.manualQaSession\nrelease-artifacts/manual-qa-session.json\nwriteActiveSession\nactiveSessionRecorded\nmanualSessionProvenanceRecord\nwriteManualSessionProvenance\nsayless.manualQaSessionProvenance\nmanualSessionProvenanceRecorded\nlaunchChrome\ncould not launch the selected Chrome executable\nprofileMarkerRecord\nvalidateProfileMarker\noperatingSystem\nbrowserCommand\nbrowserVersion\narbitrary existing Chrome profiles cannot be used\ndoes not match the current release evidence or test environment\nresumeCommand\n--user-data-dir=\n--disable-extensions-except=\n--load-extension=\nchrome://extensions/\ncleanChromeProfile: true\nextensionSource: "build"\nautomatedEvidenceGeneratedAt\nbuildSha256\nbuildBytes\nbuildFormattedBytes\nevidencePrefill\ndetectedEnvironment\nbrowserObservedExtensionId\ndetectOperatingSystem\ndetectChromeVersion\nautomated evidence timestamp\n--launch\n--json\n--sync-template\ntemplateSynchronized\nmanual-qa-template-sync.mjs\nbuildSynchronizedManualTemplate\n--print-template\nmanual QA evidence status must be "template" for --sync-template\n'
  );
  writeFileSync(
    join(dir, "scripts", "manual-qa-template-sync.mjs"),
    'mergeTemplateDefaults\nmigrateRetiredTemplatePlaceholders\nbuildSynchronizedManualTemplate\nanalyzeManualTemplateSync\ncanonical template fields are missing\nretired template placeholders are still present\n...(mergedTemplate.environment || {})\nenvironmentPrefill\nRETIRED_EXTENSION_ID_PLACEHOLDERS\nRETIRED_TESTER_EMAIL_PLACEHOLDER\n["os", "chromeVersion", "unpackedExtensionId"]\n'
  );
  writeFileSync(
    join(dir, "scripts", "release.mjs"),
    "Run: npm run qa:release:auto\nRun: npm run qa:release:status\nRun: npm run qa:release:manual:template\nRun: npm run qa:release:manual:profile -- --sync-template --launch\nComplete docs/RELEASE_QA.md in that clean profile\nRun throughout the session: npm run qa:release:manual:progress\nnpm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json\nnpm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json\nOnly after both strict reports pass\nRun: npm run qa:release:manual\nRun: npm run package:release\nRun: npm run verify:release-package\nRun: npm run build:cws\nRun: npm run verify:cws-package\nRun: npm run qa:release:status\nAttach release-artifacts/release-qa-automated.json, release-artifacts/manual-qa-evidence.json, release-artifacts/manual-qa-media-probe.json, release-artifacts/manual-qa-sidecar-probe.json, release-artifacts/package-release.json, release-artifacts/cws-package.json, docs/STORE_LISTING.md, extension.zip, and build-cws.zip\n"
  );
  writeFileSync(
    join(dir, "scripts", "release.mjs"),
    readFileSync(join(dir, "scripts", "release.mjs"), "utf8").replace(
      "Only after both strict reports pass",
      "npm run qa:release:manual:measurements -- --json --write\nOnly after both strict reports pass"
    )
  );
  writeFileSync(
    join(dir, "tests", "e2e", "run-built-extension-surface.cjs"),
    'recordPageErrors\npattern: "pageerror"\nscanExtensionPage\nisTargetClosedError\nrecordPageErrors(hits, pageName, surface.pageErrors)\nrecordPageErrors(hits, "content-script-popup", contentErrors)\nrecordConsoleErrors\npattern: "console-error"\nmessage.type() === "error"\nrecordConsoleErrors(hits, pageName, surface.consoleErrors)\nrecordConsoleErrors(hits, "content-script-popup", contentConsoleErrors)\nSAYLESS_BUILT_EXTENSION_EVIDENCE\nsayless.builtExtensionSurfaceEvidence\nextensionId\nwriteEvidence({ status: "running" })\nstatus: "passed"\nstatus: "failed"\n'
  );
  writeFileSync(
    join(dir, "scripts", "verify-cws-package.mjs"),
    'verify-release-package.mjs\ncws-package.json\npackage-release.json\nbuild-cws.zip\nextension.zip\nisCanonicalRelativePath\nautomated QA evidence status must be "passed"\npackage release evidence automated QA status must be "passed"\nautomated QA evidence status must match package release evidence\nmanual QA evidence status must be "passed"\npackage release evidence manual QA status must be "passed"\nmanual QA evidence status must match package release evidence\npackage release evidence automated QA releaseVersion must match automated QA evidence\npackage release evidence manual QA releaseVersion must match manual QA evidence\nCWS package evidence status must be "passed"\nappendNonPassingEvidenceDetails\nremainingReleaseWork\nfailedStep\nvalidateGitProvenance\nCWS package evidence releaseVersion must match package release evidence\nCWS package evidence packageEvidence.releaseVersion must match package release evidence\nCWS package evidence packageEvidence.generatedAt must match package release evidence\nCWS package evidence packageEvidence.path is required\nCWS package evidence packageEvidence.path must point to release-artifacts/package-release.json\nCWS package evidence git provenance must match package release evidence\nCWS package sourceZip.path is required\nCWS package sourceZip.path must point to extension.zip\nCWS package sourceZip size must match current extension.zip size\nCWS package sourceZip formatted size must match current extension.zip size\nCWS package sourceZip SHA-256 must match package release zip evidence\nCWS package sourceZip size must match package release zip evidence\nCWS package sourceZip formatted size must match package release zip evidence\npackage release evidence build byte size\npackage release evidence formatted build size must match current build size\nCWS package evidence cwsZip.path is required\nCWS package evidence cwsZip.path must point to build-cws.zip\nCWS package evidence formatted zip size must match current build-cws.zip size\nCWS package evidence generatedAt must be at or after package release evidence generatedAt\n'
  );
  writeFileSync(
    join(dir, "scripts", "verify-release-package.mjs"),
    'package-release.json\nextension.zip\nisCanonicalRelativePath\nverify-manual-qa-evidence.mjs\nSAYLESS_MANUAL_QA_ROOT\nmanual QA evidence\nautomated QA evidence\nappendNonPassingEvidenceDetails\nremainingReleaseWork\nfailedStep\npackage release evidence status must be "passed"\nautomated QA evidence status must be "passed"\npackage release evidence automated QA status must be "passed"\nautomated QA evidence status must match package release evidence\nmanual QA evidence status must be "passed"\npackage release evidence manual QA status must be "passed"\nmanual QA evidence status must match package release evidence\nvalidateGitProvenance\npackage release evidence releaseVersion must match automated QA evidence\npackage release evidence automated QA releaseVersion must match automated QA evidence\npackage release evidence releaseVersion must match manual QA evidence\npackage release evidence manual QA releaseVersion must match manual QA evidence\npackage release evidence generatedAt must be at or after automated QA evidence generatedAt\npackage release evidence generatedAt must be at or after manual QA evidence testedAt\npackage release evidence git provenance must match automated QA evidence\npackage release evidence build byte size\npackage release evidence formatted build size must match current build size\npackage release evidence formatted zip size must match current extension.zip size\npackage release evidence zip.path is required\npackage release evidence zip.path must point to extension.zip\n'
  );
  writeScript(
    join(dir, "scripts", "verify-local-whisper-assets.mjs"),
    "console.error('fixture whisper verifier must not run'); process.exit(1);"
  );
  writeScript(
    join(dir, "scripts", "verify-no-secrets.mjs"),
    'const SKIP_EXTENSIONS = new Set([\n  ".png",\n  ".jpg",\n  ".jpeg",\n  ".gif",\n  ".woff",\n  ".woff2",\n  ".ttf",\n  ".otf",\n  ".ico",\n  ".mp3",\n  ".mp4",\n  ".webm",\n  ".wasm",\n  ".bin",\n]);\nconsole.error(\'fixture no-secrets verifier must not run\'); process.exit(1);'
  );
  const manifest = {
    manifest_version: 3,
    version: "9.9.9",
    name: "SayLess fixture",
    permissions: [],
    host_permissions: ["<all_urls>"],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self';",
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
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    },
  });
  writeFileSync(
    join(dir, "build", "assets", "whisper", "models", "fixture-model.bin"),
    ""
  );
  writeFileSync(
    join(dir, "build", "background.js"),
    "console.log('local only');\n"
  );
  writeFileSync(
    join(dir, "src", "assets", "editor", "index.html"),
    '<!DOCTYPE html><html><head><title>SayLess Editor</title></head><body><div id="root"></div></body></html>\n'
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
    writeFileSync(
      join(fixture, ".gitignore"),
      "build/\nrelease-artifacts/\ndist/\n*.zip\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /\.gitignore must allow docs\/STORE_LISTING\.md/
    );
    assert.match(
      result.stderr,
      /machine-scanned store listing draft can be tracked/
    );
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
`
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: account tier/);
    assert.match(result.stderr, /docs\/STORE_LISTING\.md: premium/);
    assert.match(
      result.stderr,
      /docs\/STORE_LISTING\.md: remote transcription/
    );
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
      /package\.json description is missing required free\/offline\/local-first\/no-signup metadata phrase/
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
    assert.match(
      result.stderr,
      /forbidden publication-surface string\(s\) found in release metadata/
    );
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
    assert.match(
      result.stderr,
      /package:ci-extension must run scripts\/package-ci-extension\.mjs/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires GitHub Actions release checks and downloadable bundle publishing", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, ".github", "workflows", "ci.yml"),
      "pull_request:\n"
    );

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
      /build\/_locales\/en\/messages\.json extDesc\.message is missing required free\/offline\/local-first\/no-signup metadata phrase/
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
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: Account tiers/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: enterprise-only/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: Contact sales/
    );
    assert.match(result.stderr, /src\/pages\/Content\/Gate\.jsx: license key/);
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: activation required/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: locked behind a subscription/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: Pay to unlock/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: requires an account/
    );
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: sign-in required/
    );
    assert.match(result.stderr, /paid\/account-gating source reference/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects network endpoint literals in active source", () => {
  const fixture = makeFixture({
    sourceText:
      "export const uploadEndpoint = 'https://api.example.com/upload';\n",
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/Content\/Gate\.jsx: https:\/\/api\.example\.com\/upload/
    );
    assert.match(
      result.stderr,
      /network endpoint literal\(s\) found in active extension source/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit scans SVG source assets for paid and account-gated text", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "src", "assets", "editor", "badge.svg"),
      "<svg><title>Premium cloud upload</title></svg>\n"
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
      '<svg><a href="https://api.example.com/upload"/></svg>\n'
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/assets\/editor\/endpoint\.svg: https:\/\/api\.example\.com\/upload/
    );
    assert.match(
      result.stderr,
      /network endpoint literal\(s\) found in active extension source/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects legacy Screenity debug and keepalive names", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "Recorder"), { recursive: true });
    writeFileSync(
      join(fixture, "src", "pages", "Recorder", "Recorder.tsx"),
      "export const debugRecorder = window.SCREENITY_DEBUG_RECORDER;\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/Recorder\/Recorder\.tsx: SCREENITY_DEBUG_RECORDER/
    );
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
      join(fixture, "src", "pages", "EditorApp", "EditorApp.tsx"),
      "export const className = 'screenity-scrollbar';\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/EditorApp\/EditorApp\.tsx: screenity-scrollbar/
    );
    assert.match(result.stderr, /stale active Screenity UI\/debug name/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects retired destructive editor utility paths", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "Editor", "utils"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture, "src", "pages", "Editor", "utils", "cropVideo.ts"),
      "export default async function cropVideo() {}\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/Editor\/utils\/cropVideo\.ts: file exists/
    );
    assert.match(
      result.stderr,
      /obsolete destructive editor compatibility path\(s\) found/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects implicit edited-media checkpoints for project edits", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "src", "pages", "EditorApp", "context"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture, "src", "pages", "EditorApp", "context", "ContentState.tsx"),
      "if (!contentState.hasBeenEdited) return;\ncheckpointEditedLocalRecording(id, blob);\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/EditorApp\/context\/ContentState\.tsx: if \(!contentState\.hasBeenEdited\) return/
    );
    assert.match(
      result.stderr,
      /obsolete destructive editor compatibility path\(s\) found/
    );
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
      join(fixture, "src", "pages", "EditorApp", "context", "ContentState.tsx"),
      "export const requestDownload = async (url) => fetch(url);\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/EditorApp\/context\/ContentState\.tsx: editor export download path must validate blob URLs/
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
      join(fixture, "src", "pages", "utils", "localFileExport.ts"),
      "export const downloadBlobWithChrome = (blob) => chrome.downloads.download({ url: URL.createObjectURL(blob) });\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/pages\/utils\/localFileExport\.ts: shared local file export helper must validate blob URLs/
    );
    assert.match(result.stderr, /dynamic local URL guard\(s\) missing/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires packaged editor save cancellation and retry proof", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "tests", "e2e"), { recursive: true });
    writeFileSync(
      join(fixture, "tests", "e2e", "run-editor-editing-proof.cjs"),
      'globalThis.__saylessSavePickerMode = "save";\n'
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /packaged editor proof must cover File System Access cancellation and retry/
    );
    assert.match(
      result.stderr,
      /export delivery contract\/proof invariant\(s\) missing/
    );
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
      "const JFK_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';\nconst opts = { allowRemoteModels: true };\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tests\/e2e\/run-transcription\.cjs: JFK_URL/);
    assert.match(
      result.stderr,
      /remote transcription harness reference\(s\) found/
    );
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
      /remote telemetry\/analytics source reference\(s\) found in active extension source/
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
`
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /src\/assets\/editor\/index\.html: Web site created using create-react-app/
    );
    assert.match(
      result.stderr,
      /src\/assets\/editor\/index\.html: <title>React App<\/title>/
    );
    assert.match(
      result.stderr,
      /stale template\/analytics HTML reference\(s\) found/
    );
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
    assert.match(
      result.stderr,
      /src\/_locales\/en\/messages\.json: solo maker/
    );
    assert.match(
      result.stderr,
      /src\/_locales\/en\/messages\.json: private feedback form/
    );
    assert.match(
      result.stderr,
      /src\/_locales\/en\/messages\.json: support form/
    );
    assert.match(
      result.stderr,
      /src\/_locales\/en\/messages\.json: solo indie maker/
    );
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
      /manifest exposes broad or internal asset resource\(s\) as web-accessible/
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
    writeFileSync(
      join(fixture, "src", "assets", "temp", "substack.webp"),
      "stale"
    );
    writeFileSync(join(fixture, "src", "assets", "twitter-logo.svg"), "stale");

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /source contains removed hosted\/cloud surface path\(s\)/
    );
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
    assert.match(
      result.stderr,
      /source contains removed hosted\/cloud surface path\(s\)/
    );
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
    writeFileSync(
      join(fixture, "utils", "server.cts"),
      'require("ssestream");\n'
    );
    writeFileSync(
      join(fixture, "utils", "autoReloadClients", "backgroundClient.ts"),
      'const querystring = require("querystring");\n'
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dev server must use native SSE/);
    assert.match(
      result.stderr,
      /auto-reload client must parse resource queries/
    );
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
      join(fixture, "src", "pages", "utils", "buildSupportContext.ts"),
      "export const buildSupportContext = () => { const ctx = {}; ctx.cloud = '0'; ctx.supportCode = 'SCR-1234'; return ctx; };\n"
    );
    writeFileSync(
      join(fixture, "src", "pages", "utils", "errorCodes.ts"),
      "export const makeSupportCode = () => 'SCR-0000';\n"
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /support diagnostics must use SayLess local-first markers/
    );
    assert.match(
      result.stderr,
      /support diagnostic codes must use a SayLess prefix/
    );
    assert.match(result.stderr, /forbidden source configuration/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects inherited promo and social build assets", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(join(fixture, "build", "assets", "temp"), { recursive: true });
    writeFileSync(
      join(fixture, "build", "assets", "temp", "twitter.webp"),
      "stale"
    );
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
      /manifest host_permissions must stay pinned to the single recorder UI injection permission <all_urls>/
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
      /source and build manifest release-critical field\(s\) differ: permissions/
    );
    assert.match(
      result.stderr,
      /Run npm run build:release before release verification/
    );
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
    assert.match(
      result.stderr,
      /package\.json version \(9\.9\.8\) must match src\/manifest\.json version \(9\.9\.9\)/
    );
    assert.match(result.stderr, /Run npm run release -- <patch\|minor\|major>/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects direct CWS store upload scripts without release gates", () => {
  const fixture = makeFixture({
    packageJsonOverrides: {
      scripts: {
        "release:cws:unsafe-upload":
          "chrome-webstore-upload upload --source build-cws.zip",
      },
    },
  });
  try {
    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /release:cws:unsafe-upload invokes chrome-webstore-upload and must run preflight:cws plus verify:cws-package before the store action/
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
      'const SKIP_EXTENSIONS = new Set([".png", ".svg", ".mp4"]);\nconsole.error(\'fixture no-secrets verifier must not run\'); process.exit(1);'
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/verify-no-secrets\.mjs must scan text SVG assets for secret leaks/
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
    assert.match(
      result.stderr,
      /package-lock\.json version \(9\.9\.7\) must match src\/manifest\.json version \(9\.9\.9\)/
    );
    assert.match(result.stderr, /Run npm run release -- <patch\|minor\|major>/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects probe-report routing in manual QA progress", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    const verifierText = readFileSync(verifierPath, "utf8")
      .replace('["mediaProbe", "Media probe report"]\n', "")
      .replace(
        "npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json\n",
        ""
      );
    writeFileSync(verifierPath, verifierText);

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects measurement-import routing in manual QA progress", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    writeFileSync(
      verifierPath,
      readFileSync(verifierPath, "utf8").replace(
        "MEASUREMENT_IMPORT_ERROR_PATTERN\n",
        ""
      )
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects the guarded manual QA measurement import", () => {
  const fixture = makeFixture();
  try {
    const importerPath = join(
      fixture,
      "scripts",
      "manual-qa-measurement-import.mjs"
    );
    writeFileSync(
      importerPath,
      readFileSync(importerPath, "utf8").replace(
        "measurable-set-complete\n",
        ""
      )
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /manual QA measurement import must remain preview-first/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects manual QA section work targets", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    writeFileSync(
      verifierPath,
      readFileSync(verifierPath, "utf8").replace("workTargets\n", "")
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit keeps strict probes after the clean-profile session", () => {
  const fixture = makeFixture();
  try {
    const releasePath = join(fixture, "scripts", "release.mjs");
    const releaseText = readFileSync(releasePath, "utf8");
    const mediaCommand =
      "npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json";
    writeFileSync(
      releasePath,
      releaseText.replace(
        `Complete docs/RELEASE_QA.md in that clean profile\nRun throughout the session: npm run qa:release:manual:progress\n${mediaCommand}`,
        `${mediaCommand}\nComplete docs/RELEASE_QA.md in that clean profile\nRun throughout the session: npm run qa:release:manual:progress`
      )
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must print the full release QA, manual evidence, package, and CWS verification sequence in order/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires status actions to launch the clean profile", () => {
  const fixture = makeFixture();
  try {
    const statusPath = join(fixture, "scripts", "release-status.mjs");
    writeFileSync(
      statusPath,
      readFileSync(statusPath, "utf8").replaceAll(" --launch", "")
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must inspect release evidence and report the next manual\/package\/CWS release/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects validated active manual session discovery", () => {
  const fixture = makeFixture();
  try {
    const statusPath = join(fixture, "scripts", "release-status.mjs");
    writeFileSync(
      statusPath,
      readFileSync(statusPath, "utf8").replace(
        "discoverActiveManualQaSession\n",
        ""
      )
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must inspect release evidence and report the next manual\/package\/CWS release/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects provenance-marked manual profile resume", () => {
  const fixture = makeFixture();
  try {
    const profilePath = join(fixture, "scripts", "manual-qa-profile.mjs");
    writeFileSync(
      profilePath,
      readFileSync(profilePath, "utf8").replace("PROFILE_MARKER_FILE\n", "")
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /permit only provenance-marked session resumption/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit requires launch acknowledgement before session recording", () => {
  const fixture = makeFixture();
  try {
    const profilePath = join(fixture, "scripts", "manual-qa-profile.mjs");
    writeFileSync(
      profilePath,
      readFileSync(profilePath, "utf8").replace("launchChrome\n", "")
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /permit only provenance-marked session resumption/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects portable manual session provenance stamping", () => {
  const fixture = makeFixture();
  try {
    const profilePath = join(fixture, "scripts", "manual-qa-profile.mjs");
    writeFileSync(
      profilePath,
      readFileSync(profilePath, "utf8").replace(
        "writeManualSessionProvenance\n",
        ""
      )
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /permit only provenance-marked session resumption/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects manual session provenance verification", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    writeFileSync(
      verifierPath,
      readFileSync(verifierPath, "utf8").replace("manualSessionMatches\n", "")
    );

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects terminal manual QA finalization ordering", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    const verifierText = readFileSync(verifierPath, "utf8").replace(
      '["finalization", "Final verification", ["status", "testedAt"]]\n',
      ""
    );
    writeFileSync(verifierPath, verifierText);

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects offline network-isolation progress routing", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    const verifierText = readFileSync(verifierPath, "utf8").replace(
      'environment.networkDisabledForOfflineTranscription\nreturn "offlineTranscription"\n',
      ""
    );
    writeFileSync(verifierPath, verifierText);

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must enforce canonical automated and manual-probe provenance/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit rejects a required tester email placeholder", () => {
  const fixture = makeFixture();
  try {
    const verifierPath = join(
      fixture,
      "scripts",
      "verify-manual-qa-evidence.mjs"
    );
    const verifierText = `${readFileSync(
      verifierPath,
      "utf8"
    )}\nconst tester = { email: "tester@example.com" };\n`;
    writeFileSync(verifierPath, verifierText);

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /named tester attribution without requiring contact data/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release audit protects retired tester email placeholder migration", () => {
  const fixture = makeFixture();
  try {
    const syncPath = join(fixture, "scripts", "manual-qa-template-sync.mjs");
    const syncText = readFileSync(syncPath, "utf8").replace(
      "RETIRED_TESTER_EMAIL_PLACEHOLDER\n",
      ""
    );
    writeFileSync(syncPath, syncText);

    const result = runAudit(fixture);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /manual QA template merge, migration, synchronization, and status analysis/
    );
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
