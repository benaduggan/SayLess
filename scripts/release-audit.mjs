#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_RELEASE_AUDIT_ROOT
  ? resolve(process.env.SAYLESS_RELEASE_AUDIT_ROOT)
  : DEFAULT_ROOT;
const BUILD_DIR = join(ROOT, "build");
const MANIFEST_PATH = join(BUILD_DIR, "manifest.json");
const SOURCE_MANIFEST_PATH = join(ROOT, "src", "manifest.json");
const PACKAGE_PATH = join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = join(ROOT, "package-lock.json");
const GITIGNORE_PATH = join(ROOT, ".gitignore");
const BUILD_SCRIPT_PATH = join(ROOT, "utils", "build.js");
const CI_WORKFLOW_PATH = join(ROOT, ".github", "workflows", "ci.yml");
const STORE_LISTING_PATH = join(ROOT, "docs", "STORE_LISTING.md");
const BUILT_EXTENSION_SURFACE_TEST_PATH = join(
  ROOT,
  "tests",
  "e2e",
  "run-built-extension-surface.cjs",
);
const WHISPER_ASSET_VERIFIER_PATH = join(
  DEFAULT_ROOT,
  "scripts",
  "verify-local-whisper-assets.mjs",
);
const NO_SECRETS_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-no-secrets.mjs");
const MAX_BUILD_BYTES = 180 * 1024 * 1024;
const WARN_BUILD_BYTES = 150 * 1024 * 1024;
const LARGE_DUPLICATE_BYTES = 1024 * 1024;

const FORBIDDEN_MANIFEST_KEYS = [
  "oauth2",
  "externally_connectable",
  "key",
];
const FORBIDDEN_PERMISSIONS = new Set([
  "identity",
  "clipboardWrite",
  "https://app.screenity.io/*",
  "https://*.screenity.io/*",
  "https://www.googleapis.com/*",
  "https://www.googleapis.com/auth/drive.file",
]);
const FORBIDDEN_WEB_ACCESSIBLE_RESOURCES = new Set([
  "*",
  "/*",
  "assets/*",
  "assets/**",
  "assets/**/*",
]);
const FORBIDDEN_WEB_ACCESSIBLE_RESOURCE_PREFIXES = [
  "assets/mediapipeVision/",
  "assets/vendor/",
  "assets/videos/",
  "assets/whisper/",
];
const FORBIDDEN_PACKAGE_DEPENDENCIES = new Set([
  "@sentry/browser",
  "axios",
  "browserstack-local",
  "driver.js",
  "plyr",
  "plyr-react",
  "querystring",
  "react-hotkeys-hook",
  "selenium-webdriver",
  "ssestream",
]);
const FORBIDDEN_BUILD_FILES = new Set([
  "assets/videos/pro.mp4",
  "assets/editor/icons/drive.svg",
  "assets/editor/icons/unlock.svg",
  "assets/editor/icons/youtube.svg",
  "assets/temp/figma.webp",
  "assets/temp/twitter.webp",
  "assets/temp/designsystem.webp",
  "assets/temp/marketing.webp",
  "assets/temp/substack.webp",
  "assets/pfp.png",
  "assets/solo-dev.png",
  "assets/twitter-logo.svg",
]);
const FORBIDDEN_SOURCE_PATHS = [
  "patches/fabric+5.3.0.patch",
  "patches/fabric+5.5.2.patch",
  "patches/plyr+3.7.8.patch",
  "src/pages/CloudRecorder",
  "src/assets/editor/icons/drive.svg",
  "src/assets/editor/icons/unlock.svg",
  "src/assets/editor/icons/youtube.svg",
  "src/assets/temp/figma.webp",
  "src/assets/temp/twitter.webp",
  "src/assets/temp/designsystem.webp",
  "src/assets/temp/marketing.webp",
  "src/assets/temp/substack.webp",
  "src/assets/pfp.png",
  "src/assets/solo-dev.png",
  "src/assets/twitter-logo.svg",
];
const SOURCE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".scss",
  ".svg",
  ".ts",
  ".tsx",
]);
const FORBIDDEN_SOURCE_MONETIZATION_PATTERNS = [
  /\bpaid\b/i,
  /\bpaid[- ]tiers?\b/i,
  /\bpaid[- ]plans?\b/i,
  /\bpaywalls?\b/i,
  /\bpremium\b/i,
  /\bpremium[- ]only\b/i,
  /\bfree[- ]trials?\b/i,
  /\btrial[- ]only\b/i,
  /\btrial expired\b/i,
  /\blicen[cs]e[- ]required\b/i,
  /\bentitlements?\b/i,
  /\bpricing\b/i,
  /\bsubscription\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\bstripe\b/i,
  /\bisSubscribed\b/,
  /\baccount[- ]level\b/i,
  /\baccount[- ]plans?\b/i,
  /\baccount[- ]tiers?\b/i,
  /\brequires? (?:an? )?account\b/i,
  /\b(?:sign[- ]?in|log[- ]?in|login)[- ]required\b/i,
  /\brequires? (?:sign[- ]?in|log[- ]?in|login)\b/i,
  /\bpaid[- ]accounts?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]plans?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]tiers?\b/i,
  /\benterprise[- ]only\b/i,
  /\bplan[- ]limits?\b/i,
  /\btier[- ]limits?\b/i,
  /\busage[- ]limits?\b/i,
  /\bmemberships?\b/i,
  /\bpaid[- ]memberships?\b/i,
  /\bmember[- ]only\b/i,
  /\bfeature[- ]gates?\b/i,
  /\bgated feature\b/i,
  /\blocked[- ]features?\b/i,
  /\bfeatures?[- ]locked\b/i,
  /\blocked by (?:plan|tier|account|membership)\b/i,
  /\blocked behind (?:a )?(?:paid|premium|pro|plan|tier|subscription|membership|account|licen[cs]e|upgrade)\b/i,
  /\b(?:plan|tier|subscription|membership)[- ]required\b/i,
  /\bunlock(?: this)? (?:feature|export|recording|capture|transcription)\b/i,
  /\b(?:pay|paying) (?:to|for) (?:unlock|use|export|record|capture|transcribe)\b/i,
  /\bupgrade[- ]required\b/i,
  /\bupgrade (?:to|for|your plan|your account)\b/i,
  /\bcontact sales\b/i,
  /\bsales[- ]gated\b/i,
  /\brequires? (?:a )?(?:paid|premium|subscription|membership|account[- ]level)\b/i,
  /\bpro[- ]only\b/i,
  /\b(?:subscription|premium|enterprise|licen[cs]e)[- ]only\b/i,
  /\bpro[- ]plans?\b/i,
  /\bPro\b/,
  /\blicen[cs]e[- ]keys?\b/i,
  /\bactivation[- ](?:required|keys?|codes?)\b/i,
];
const FORBIDDEN_ACTIVE_SOURCE_SCREENITY_PATTERNS = [
  /\bScreenity\s+(?:Pro|account|auth|dashboard|cloud|hosted|subscription|pricing)\b/i,
  /\bscreenity(?:Token|User)\b/,
  /app\.screenity\.io/i,
];
const FORBIDDEN_HTML_TEMPLATE_PATTERNS = [
  /Web site created using create-react-app/i,
  /<title>\s*React App\s*<\/title>/i,
  /This HTML file is a template/i,
  /You can add webfonts, meta tags, or analytics to this file/i,
];
const FORBIDDEN_SOURCE_REMOTE_TELEMETRY_PATTERNS = [
  /\btelemetry\b/i,
  /\banalytics\b/i,
  /\bsentry\b/i,
  /\bposthog\b/i,
  /@amplitude\/|amplitude\.com|amplitude\.(?:init|track|identify)/i,
  /\bmixpanel\b/i,
];
const FORBIDDEN_LEGACY_ENV_FILES = [
  "package.json",
  "webpack.config.js",
  "scripts/verify-no-secrets.mjs",
  "tests/e2e/run-offline-whisper-assets.cjs",
  "tests/e2e/run-offline-transcription-smoke.cjs",
  "tests/e2e/run-offline-transcription-speech.cjs",
  "tests/e2e/run-built-extension-surface.cjs",
  "tests/e2e/run-local-recordings.cjs",
  "src/media/fastRecorderGate.ts",
  "src/pages/Editor/mediabunny/lib/videoCutter.ts",
  "src/pages/Background/listeners/onStartupListener.js",
  "src/pages/Background/messaging/handlers.js",
  "src/pages/RemuxOffscreen/index.js",
  "src/pages/RemuxOffscreen/worker.js",
  "src/pages/Region/Recorder.jsx",
  "src/pages/Camera/components/Background.js",
  "src/pages/Recorder/recorderKeepalive.js",
  "src/pages/utils/perfMarks.js",
  "src/pages/utils/recorderDebug.js",
  "src/pages/utils/recordingDebug.js",
  "src/pages/utils/startFlowTrace.js",
  "src/pages/utils/tabKeepalive.js",
  "src/pages/Recorder/Recorder.jsx",
  "src/pages/Recorder/recorderStorage/opfs/writerWorker.js",
  "src/pages/Content/countdown/Countdown.jsx",
  "src/pages/Content/context/ContentState.jsx",
  "src/pages/Content/popup/layout/SettingsMenu.jsx",
  "src/pages/EditorApp/context/ContentState.jsx",
];
const FORBIDDEN_LEGACY_ENV_PATTERN =
  /\bSCREENITY_(?:SKIP_ENV|USE_LOCAL_ENV|BS_BUILD|E2E_HEADLESS|E2E_CHROME_CHANNEL|DEV_MODE|DEBUG_RECORDER|VERBOSE_LOGS|FAST_REC_DEBUG|FORCE_MEDIARECORDER)\b|__SCREENITY_KEEPALIVE|\bscreenity-(?:recorder-)?keepalive\b|\bSAYLESS_BS_BUILD\b|\bbrowserstack\b/i;
const WEBPACK_CONFIG_PATH = join(ROOT, "webpack.config.js");
const RELEASE_DEV_MODE_DEFINE_PATTERN =
  /"process\.env\.SAYLESS_DEV_MODE"\s*:\s*JSON\.stringify\(\s*isDev\s*&&\s*process\.env\.SAYLESS_DEV_MODE\s*===\s*["']true["']\s*\?\s*["']true["']\s*:\s*["']["']\s*\)/;
const FORBIDDEN_LOCALE_PATTERNS = [
  /\bfaster cloud\b/i,
  /\bcloud recording\b/i,
  /\bcloud recorder\b/i,
  /\bcloud upload\b/i,
  /\bupload reliability\b/i,
  /\bupload paused\b/i,
  /\bvideo upload\b/i,
  /\bno connection\b/i,
  /\bunavailable until reconnected\b/i,
  /\bsome features are unavailable\b/i,
  /\bupgrade for faster processing\b/i,
  /\blog in\b/i,
  /\blog out\b/i,
  /\blogged\s*out\b/i,
  /\bsign up\b/i,
  /\bGoogle Drive\b/i,
  /\bfull\s+100\s*GB\s+of\s+storage\b/i,
  /\bpaid tiers?\b/i,
  /\bpaid[- ]plans?\b/i,
  /\baccount[- ]level\b/i,
  /\baccount[- ]plans?\b/i,
  /\baccount[- ]tiers?\b/i,
  /\brequires? (?:an? )?account\b/i,
  /\b(?:sign[- ]?in|log[- ]?in|login)[- ]required\b/i,
  /\brequires? (?:sign[- ]?in|log[- ]?in|login)\b/i,
  /\bpaid[- ]accounts?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]plans?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]tiers?\b/i,
  /\benterprise[- ]only\b/i,
  /\bplan[- ]limits?\b/i,
  /\btier[- ]limits?\b/i,
  /\busage[- ]limits?\b/i,
  /\bmemberships?\b/i,
  /\bpaid[- ]memberships?\b/i,
  /\bmember[- ]only\b/i,
  /\blocked[- ]features?\b/i,
  /\bfeatures?[- ]locked\b/i,
  /\blocked by (?:plan|tier|account|membership)\b/i,
  /\blocked behind (?:a )?(?:paid|premium|pro|plan|tier|subscription|membership|account|licen[cs]e|upgrade)\b/i,
  /\b(?:plan|tier|subscription|membership)[- ]required\b/i,
  /\bunlock(?: this)? (?:feature|export|recording|capture|transcription)\b/i,
  /\b(?:pay|paying) (?:to|for) (?:unlock|use|export|record|capture|transcribe)\b/i,
  /\bupgrade[- ]required\b/i,
  /\bupgrade (?:to|for|your plan|your account)\b/i,
  /\bcontact sales\b/i,
  /\bsales[- ]gated\b/i,
  /\brequires? (?:a )?(?:paid|premium|subscription|membership|account[- ]level)\b/i,
  /\bpremium\b/i,
  /\b(?:subscription|premium|pro|enterprise|licen[cs]e)[- ]only\b/i,
  /\bfree[- ]trials?\b/i,
  /\btrial[- ]only\b/i,
  /\btrial expired\b/i,
  /\blicen[cs]e[- ]required\b/i,
  /\bentitlements?\b/i,
  /\bpricing\b/i,
  /\bsubscription\b/i,
  /\bbilling\b/i,
  /\bAlyssa\b/i,
  /\bsolo maker\b/i,
  /\bsolo indie maker\b/i,
  /\bbuilt the first version back in 2020\b/i,
  /\bmaker of SayLess\b/i,
  /\bprivate feedback form\b/i,
  /\bprefilled support form\b/i,
  /\bsupport form\b/i,
  /\bTally form\b/i,
];
const FORBIDDEN_SURFACE_PATTERNS = [
  /\bpaid\b/i,
  /\bpaid tiers?\b/i,
  /\bpaid[- ]plans?\b/i,
  /\baccount[- ]level\b/i,
  /\baccount[- ]plans?\b/i,
  /\baccount[- ]tiers?\b/i,
  /\brequires? (?:an? )?account\b/i,
  /\b(?:sign[- ]?in|log[- ]?in|login)[- ]required\b/i,
  /\brequires? (?:sign[- ]?in|log[- ]?in|login)\b/i,
  /\bpaid[- ]accounts?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]plans?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]tiers?\b/i,
  /\benterprise[- ]only\b/i,
  /\bplan[- ]limits?\b/i,
  /\btier[- ]limits?\b/i,
  /\busage[- ]limits?\b/i,
  /\bmemberships?\b/i,
  /\bpaid[- ]memberships?\b/i,
  /\bmember[- ]only\b/i,
  /\bfeature gates?\b/i,
  /\bpaywalls?\b/i,
  /\bpremium\b/i,
  /\bfree[- ]trials?\b/i,
  /\btrial[- ]only\b/i,
  /\btrial expired\b/i,
  /\blicen[cs]e[- ]required\b/i,
  /\bentitlements?\b/i,
  /\bpricing\b/i,
  /\bsubscription\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\bstripe\b/i,
  /\blocked[- ]features?\b/i,
  /\bfeatures?[- ]locked\b/i,
  /\blocked by (?:plan|tier|account|membership)\b/i,
  /\blocked behind (?:a )?(?:paid|premium|pro|plan|tier|subscription|membership|account|licen[cs]e|upgrade)\b/i,
  /\b(?:plan|tier|subscription|membership)[- ]required\b/i,
  /\bunlock(?: this)? (?:feature|export|recording|capture|transcription)\b/i,
  /\b(?:pay|paying) (?:to|for) (?:unlock|use|export|record|capture|transcribe)\b/i,
  /\bupgrade[- ]required\b/i,
  /\bupgrade (?:to|for|your plan|your account)\b/i,
  /\bcontact sales\b/i,
  /\bsales[- ]gated\b/i,
  /\brequires? (?:a )?(?:paid|premium|subscription|membership|account[- ]level)\b/i,
  /\blicen[cs]e[- ]keys?\b/i,
  /\bactivation[- ](?:required|keys?|codes?)\b/i,
  /\b(?:subscription|premium|pro|enterprise|licen[cs]e)[- ]only\b/i,
  /\bunlock\b/i,
  /\bsignin\b/i,
  /\bsign in\b/i,
  /\boauth\b/i,
  /\bcloudrecorder\b/i,
  /\bexternally_connectable\b/i,
  /\bidentity\b/i,
  /Google Drive/i,
  /drive\.google/i,
  /app\.screenity\.io/i,
];
const FORBIDDEN_BUNDLE_PATTERNS = [
  /\bpaid tiers?\b/i,
  /\bpaid[- ]plans?\b/i,
  /\baccount[- ]level\b/i,
  /\baccount[- ]plans?\b/i,
  /\baccount[- ]tiers?\b/i,
  /\brequires? (?:an? )?account\b/i,
  /\b(?:sign[- ]?in|log[- ]?in|login)[- ]required\b/i,
  /\brequires? (?:sign[- ]?in|log[- ]?in|login)\b/i,
  /\bpaid[- ]accounts?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]plans?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]tiers?\b/i,
  /\benterprise[- ]only\b/i,
  /\bplan[- ]limits?\b/i,
  /\btier[- ]limits?\b/i,
  /\busage[- ]limits?\b/i,
  /\bmemberships?\b/i,
  /\bpaid[- ]memberships?\b/i,
  /\bmember[- ]only\b/i,
  /\bfeature gates?\b/i,
  /\bpaywalls?\b/i,
  /\bpremium\b/i,
  /\bfree[- ]trials?\b/i,
  /\btrial[- ]only\b/i,
  /\btrial expired\b/i,
  /\blicen[cs]e[- ]required\b/i,
  /\bentitlements?\b/i,
  /\bpricing\b/i,
  /\bsubscription\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\bstripe\b/i,
  /\bisSubscribed\b/,
  /\blocked[- ]features?\b/i,
  /\bfeatures?[- ]locked\b/i,
  /\blocked by (?:plan|tier|account|membership)\b/i,
  /\blocked behind (?:a )?(?:paid|premium|pro|plan|tier|subscription|membership|account|licen[cs]e|upgrade)\b/i,
  /\b(?:plan|tier|subscription|membership)[- ]required\b/i,
  /\bunlock(?: this)? (?:feature|export|recording|capture|transcription)\b/i,
  /\b(?:pay|paying) (?:to|for) (?:unlock|use|export|record|capture|transcribe)\b/i,
  /\bupgrade[- ]required\b/i,
  /\bupgrade (?:to|for|your plan|your account)\b/i,
  /\bcontact sales\b/i,
  /\bsales[- ]gated\b/i,
  /\brequires? (?:a )?(?:paid|premium|subscription|membership|account[- ]level)\b/i,
  /\blicen[cs]e[- ]keys?\b/i,
  /\bactivation[- ](?:required|keys?|codes?)\b/i,
  /\b(?:subscription|premium|pro|enterprise|licen[cs]e)[- ]only\b/i,
  /cloud-local-playback/i,
  /cloud-telemetry/i,
  /screenity-local-playback/i,
  /screenityToken/,
  /logoutPendingTokenClear/,
  /stayLoggedOut/,
  /screenityUser/,
  /cloudUploadTelemetry/i,
  /upload-telemetry/i,
  /useOffscreenCloud/,
  /recover-cloud-indexed-db/i,
  /opfs-cloud/i,
  /cloud-chunks/i,
  /CloudRestore/,
  /screenity-recording/i,
  /cloud=1/i,
  /cloudRecorderDegradedMode/,
  /cloudrecorder/i,
  /Upload couldn't finish/,
  /Retry upload/,
  /Retrying upload/,
];
const NETWORK_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`),>]+/g;
const ALLOWED_BUNDLE_URL_HOSTS = new Set([
  "aomediacodec.github.io",
  "cdn.jsdelivr.net",
  "developer.mozilla.org",
  "fb.me",
  "gist.github.com",
  "github.com",
  "huggingface.co",
  "mozilla.github.io",
  "radix-ui.com",
  "reactjs.org",
  "stuk.github.io",
  "webmproject.org",
  "web.dev",
  "www.w3.org",
  "www.webmproject.org",
]);
const FORBIDDEN_NETWORK_HOST_PATTERNS = [
  /(^|\.)screenity\.io$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)drive\.google\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtube-nocookie\.com$/i,
  /(^|\.)ytimg\.com$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)cdn\.plyr\.io$/i,
  /(^|\.)noembed\.com$/i,
  /(^|\.)aniview\.com$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)amplitude\.com$/i,
  /(^|\.)posthog\.com$/i,
  /(^|\.)segment\.com$/i,
  /(^|\.)bunnycdn\.com$/i,
  /(^|\.)bunny\.net$/i,
];
const ALLOWED_SOURCE_URL_HOSTS = new Set([
  "www.w3.org",
]);
const FORBIDDEN_SOURCE_PATTERNS = [
  {
    file: "src/pages/localRecordings/localRecordingLibrary.js",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "local recording library uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Recorder/Recorder.jsx",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "recorder uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Recorder/recorderStorage/idbChunkWriter.js",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "IDB chunk writer uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/EditorApp/recorderStorage/idbChunkReader.js",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "IDB chunk reader uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Background/recording/chunkHandler.js",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "background chunk handler uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Region/Recorder.jsx",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "region recorder uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/EditorApp/context/ContentState.jsx",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "editor content state uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Download/Download.jsx",
    pattern: /localforage\.config\(\{[\s\S]*?name:\s*["']screenity["']/,
    message: "download recovery page uses inherited screenity localforage namespace",
  },
  {
    file: "src/pages/Download/Download.jsx",
    pattern: /recover-cloud-indexed-db|CloudRestore|screenity-recording/,
    message: "download recovery page contains inherited cloud/Screenity recovery protocol strings",
  },
  {
    file: "src/pages/utils/buildSupportContext.js",
    pattern: /\bctx\.cloud\b|["']cloud["']\s*:|SCR-/,
    message: "support diagnostics must use SayLess local-first markers instead of inherited Screenity/cloud markers",
  },
  {
    file: "src/pages/utils/errorCodes.js",
    pattern: /SCR-/,
    message: "support diagnostic codes must use a SayLess prefix",
  },
  {
    file: "utils/server.js",
    pattern: /require\(["']ssestream["']\)|from ["']ssestream["']/,
    message: "dev server must use native SSE instead of the removed ssestream dependency",
  },
  {
    file: "utils/autoReloadClients/backgroundClient.js",
    pattern: /require\(["']querystring["']\)|from ["']querystring["']/,
    message: "auto-reload client must parse resource queries without bundling querystring",
  },
  {
    file: "src/pages/Background/offscreen/closeOffscreenDocumentWithFlush.js",
    pattern: /cloud=1|isCloudDoc|TUS upload|Cloud docs/i,
    message: "offscreen cleanup still contains cloud-document branching",
  },
  {
    file: "src/pages/Recorder/recorderStorage/opfsKvStore.js",
    pattern: /opfs-cloud|cloud-chunks/,
    message: "recorder OPFS chunk store uses inherited cloud storage naming",
  },
  {
    file: "src/pages/Recorder/recorderStorage/chooseChunksStore.js",
    pattern: /opfs-cloud|CloudRecorder\/recorderStorage/,
    message: "recorder chunk store uses inherited cloud storage naming",
  },
  {
    file: "src/pages/Background/index.js",
    pattern: /CloudRecorder\/recorderStorage/,
    message: "background imports recorder storage through CloudRecorder path",
  },
  {
    file: "src/pages/Background/messaging/handlers.js",
    pattern: /CloudRecorder\/recorderStorage/,
    message: "background messaging imports recorder storage through CloudRecorder path",
  },
  {
    file: "src/pages/utils/diagnosticLog.js",
    pattern: /drive-upload|drive-save|drive-auth|lastSubscriptionLoss|cloudRestartPhase|cloudRestartHistory/i,
    message: "diagnostic log contains inherited account/cloud diagnostic names",
  },
  {
    file: "src/pages/utils/buildDiagnosticZip.js",
    pattern: /lastSubscriptionLoss/i,
    message: "diagnostic ZIP contains inherited subscription diagnostic names",
  },
  {
    file: "src/pages/EditorApp/context/ContentState.jsx",
    pattern: /driveEnabled|\bstorage\.local\.get\(\s*["']token["']\s*\)/,
    message: "editor state contains inherited Drive/account-gate state",
  },
];
const REQUIRED_DYNAMIC_LOCAL_URL_GUARDS = [
  {
    file: "src/pages/utils/localFileExport.js",
    snippets: [
      "export const assertLocalBlobUrl =",
      'url.startsWith("blob:")',
      "const downloadUrl = assertLocalBlobUrl(URL.createObjectURL(blob))",
      "url: assertLocalBlobUrl(downloadUrl)",
      "URL.revokeObjectURL(downloadUrl)",
    ],
    message: "shared local file export helper must validate blob URLs before Chrome downloads",
  },
  {
    file: "src/pages/EditorApp/context/ContentState.jsx",
    snippets: [
      "const assertLocalExportObjectUrl =",
      "fetch(assertLocalExportObjectUrl(exportUrl))",
      "url: assertLocalExportObjectUrl(exportUrl)",
      "URL.revokeObjectURL(exportUrl)",
    ],
    message: "editor export download path must validate blob URLs before fetch/download/revoke",
  },
  {
    file: "src/pages/Content/popup/PopupContainer.jsx",
    snippets: [
      "const assertLocalExtensionUrl =",
      "const openLocalHelpPage = () =>",
      'window.open(assertLocalExtensionUrl(helpURL), "_blank")',
    ],
    message: "popup help link must validate local extension URL before opening",
  },
  {
    file: "src/pages/EditorApp/layout/player/RightPanel.js",
    snippets: [
      "assertLocalBlobUrl,",
      "assertLocalBlobUrl(window.URL.createObjectURL(blob))",
      "url: assertLocalBlobUrl(url)",
      "window.URL.revokeObjectURL(assertLocalBlobUrl(url))",
    ],
    message: "editor panel direct download paths must validate blob URLs",
  },
  {
    file: "src/pages/Content/popup/layout/VideosTab.jsx",
    snippets: [
      "const assertLocalExtensionUrl =",
      'window.open(assertLocalExtensionUrl(url), "_blank")',
    ],
    message: "popup recording link must validate local extension URL before opening",
  },
  {
    file: "src/pages/Download/Download.jsx",
    snippets: [
      "import { assertLocalBlobUrl } from",
      "assertLocalBlobUrl(URL.createObjectURL(blob))",
      "url: assertLocalBlobUrl(url)",
      "URL.revokeObjectURL(assertLocalBlobUrl(url))",
    ],
    message: "download recovery page must validate blob URLs before Chrome downloads",
  },
  {
    file: "src/pages/OffscreenRecorder/chromeShim.js",
    snippets: [
      "const assertLocalExtensionUrl =",
      "assertLocalExtensionUrl(",
      "_locales/${locale}/messages.json",
    ],
    message: "offscreen i18n shim must load catalogs from local extension URLs only",
  },
];
const TRANSCRIPTION_HARNESS_PATH = join(
  ROOT,
  "tests",
  "e2e",
  "run-transcription.cjs",
);
const FORBIDDEN_TRANSCRIPTION_HARNESS_PATTERNS = [
  /SAYLESS_ALLOW_NETWORK_TRANSCRIPTION_E2E/,
  /JFK_URL/,
  /jfk\.wav/i,
  /huggingface\.co\/datasets/i,
  /allowRemoteModels:\s*true/,
  /npx["'][\s\S]*?--yes[\s\S]*?esbuild/,
];
const FORBIDDEN_ACTIVE_SCREENITY_UI_NAMES = [
  {
    file: "src/pages/Components/GradientBackground.jsx",
    pattern: /screenity-wave-bg/i,
  },
  {
    file: "src/pages/EditorApp/EditorApp.jsx",
    pattern: /screenity-scrollbar/i,
  },
  {
    file: "src/pages/Content/context/ContentState.jsx",
    pattern: /screenity-scrollbar/i,
  },
  {
    file: "src/pages/Content/styles/app.scss",
    pattern: /screenity-scrollbar/i,
  },
  {
    file: "src/pages/Content/styles/app.css",
    pattern: /screenity-scrollbar/i,
  },
  {
    file: "src/pages/EditorApp/context/ContentState.jsx",
    pattern: /__screenity(?:ExportRecordingDebug|PingRecdbg)/,
  },
  {
    file: "src/pages/EditorApp/components/player/VideoPlayer.jsx",
    pattern: /screenity-(?:player-loading|spin)/i,
  },
  {
    file: "src/pages/EditorApp/styles/global/_app.scss",
    pattern: /screenitySandboxToast(?:In|Out)/,
  },
];
const REQUIRED_STORE_LISTING_PATTERNS = [
  /^# SayLess Store Listing/m,
  /\bChrome Web Store Summary\b/,
  /\bChrome Web Store Description\b/,
  /\bPrivacy\b/,
  /\bFree to use\b/,
  /\boffline\b/i,
  /\blocal-first\b/i,
  /\bNo signup required\b/,
  /\bAll extension features are included\b/,
  /\bwithout sending recordings to external services\b/i,
  /\bbundled Whisper model\b/i,
];
const FORBIDDEN_PUBLICATION_SURFACE_PATTERNS = [
  ...FORBIDDEN_SURFACE_PATTERNS,
  /\bhosted dashboard\b/i,
  /\bcloud upload\b/i,
  /\bremote transcription\b/i,
  /\bdefault remote\b/i,
  /\bGoogle Drive\b/i,
  /\bupload to (?:the )?cloud\b/i,
];
const REQUIRED_PACKAGE_DESCRIPTION_PATTERNS = [
  /\bFree to use\b/,
  /\boffline\b/i,
  /\blocal-first\b/i,
  /\bon-device transcription\b/i,
  /\bword-based editing\b/i,
  /\bNo signup required\b/,
];
const REQUIRED_EXTENSION_DESCRIPTION_PATTERNS = [
  /\bFree to use\b/,
  /\boffline\b/i,
  /\blocal-first\b/i,
  /\bon-device transcription\b/i,
  /\bword-based editing\b/i,
  /\bNo signup required\b/,
];

const fail = (message) => {
  console.error(`Release audit failed: ${message}`);
  process.exit(1);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const extractUrlHost = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const match = url.match(/^[a-z]+:\/\/([^/:?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
};
const collectForbiddenPatternHits = ({ file, text, patterns }) => {
  const hits = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      hits.push({
        file,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
  return hits;
};
const isXmlNamespaceUrl = (text, matchIndex) =>
  /xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*["']$/.test(
    text.slice(Math.max(0, matchIndex - 80), matchIndex),
  );

const walk = (dir) => {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
};

const stableJson = (value) => {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
};

const assertManifestPolicy = (manifest, label) => {
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (manifest[key] != null) fail(`${label} manifest contains forbidden ${key}.`);
  }
  const permissions = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.optional_permissions)
      ? manifest.optional_permissions
      : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ];
  for (const permission of permissions) {
    if (FORBIDDEN_PERMISSIONS.has(permission)) {
      fail(`${label} manifest contains forbidden permission ${permission}.`);
    }
  }
  const hostPermissions = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions.slice().sort()
    : [];
  if (
    hostPermissions.length !== 1 ||
    hostPermissions[0] !== "<all_urls>"
  ) {
    fail(
      `${label} manifest host_permissions must stay pinned to the single recorder UI injection permission <all_urls>; found ${hostPermissions.join(
        ", ",
      ) || "none"}.`,
    );
  }
  const manifestText = JSON.stringify(manifest);
  if (manifestText.includes("cloudrecorder")) {
    fail(`${label} manifest still references cloudrecorder.`);
  }
  const webAccessibleResourceEntries = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  const broadWebAccessibleResources = [];
  for (const entry of webAccessibleResourceEntries) {
    const resources = Array.isArray(entry?.resources) ? entry.resources : [];
    for (const resource of resources) {
      if (
        FORBIDDEN_WEB_ACCESSIBLE_RESOURCES.has(resource) ||
        FORBIDDEN_WEB_ACCESSIBLE_RESOURCE_PREFIXES.some((prefix) => resource.startsWith(prefix))
      ) {
        broadWebAccessibleResources.push(resource);
      }
    }
  }
  if (broadWebAccessibleResources.length) {
    fail(
      `${label} manifest exposes broad or internal asset resource(s) as web-accessible: ${broadWebAccessibleResources.join(
        ", ",
      )}.`,
    );
  }
  const extensionPageCsp = manifest.content_security_policy?.extension_pages || "";
  if (!/\bconnect-src\b/.test(extensionPageCsp)) {
    fail(`${label} manifest extension_pages CSP must declare connect-src for local-only release policy.`);
  }
  const forbiddenCspSources = [
    { pattern: /(?:^|[;\s])connect-src[^;]*(?:\*|https?:|wss?:)/i, label: "connect-src" },
    { pattern: /(?:^|[;\s])media-src[^;]*(?:\*|https?:|wss?:)/i, label: "media-src" },
    { pattern: /(?:^|[;\s])img-src[^;]*(?:\*|https?:|wss?:)/i, label: "img-src" },
  ];
  for (const { pattern, label: cspLabel } of forbiddenCspSources) {
    if (pattern.test(extensionPageCsp)) {
      fail(`${label} manifest extension_pages CSP ${cspLabel} allows remote network sources.`);
    }
  }
};

const assertManifestReleaseFieldsMatch = (sourceManifest, buildManifest) => {
  const releaseFields = [
    "version",
    "host_permissions",
    "permissions",
    "optional_permissions",
    "web_accessible_resources",
    "content_security_policy",
  ];
  const mismatches = releaseFields.filter(
    (field) =>
      JSON.stringify(stableJson(sourceManifest[field])) !==
      JSON.stringify(stableJson(buildManifest[field])),
  );
  if (mismatches.length) {
    fail(
      `source and build manifest release-critical field(s) differ: ${mismatches.join(
        ", ",
      )}. Run npm run build:release before release verification.`,
    );
  }
};

if (!existsSync(BUILD_DIR)) {
  fail("build/ does not exist. Run npm run build:release first.");
}
if (!existsSync(SOURCE_MANIFEST_PATH)) {
  fail("src/manifest.json is missing.");
}
if (!existsSync(MANIFEST_PATH)) {
  fail("build/manifest.json is missing.");
}
if (!existsSync(GITIGNORE_PATH)) {
  fail(".gitignore is missing.");
}
if (!existsSync(STORE_LISTING_PATH)) {
  fail("docs/STORE_LISTING.md is missing; release needs a machine-scanned store listing draft.");
}

const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
const packageLock = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8"));
const sourceManifestForVersion = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
const gitignoreText = readFileSync(GITIGNORE_PATH, "utf8");
const buildScriptText = readFileSync(BUILD_SCRIPT_PATH, "utf8");
const webpackConfigText = readFileSync(WEBPACK_CONFIG_PATH, "utf8");
const packageReleaseScriptText = readFileSync(join(ROOT, "scripts", "package-release.mjs"), "utf8");
const packageCwsScriptText = readFileSync(join(ROOT, "scripts", "package-cws.mjs"), "utf8");
const packageCiExtensionScriptText = readFileSync(
  join(ROOT, "scripts", "package-ci-extension.mjs"),
  "utf8",
);
const ciWorkflowText = readFileSync(CI_WORKFLOW_PATH, "utf8");
const releaseScriptText = readFileSync(join(ROOT, "scripts", "release.mjs"), "utf8");
const builtExtensionSurfaceTestText = readFileSync(BUILT_EXTENSION_SURFACE_TEST_PATH, "utf8");
const releaseQaAutomatedScriptText = readFileSync(
  join(ROOT, "scripts", "release-qa-automated.mjs"),
  "utf8",
);
const transcriptionConfigText = readFileSync(join(ROOT, "src", "transcription", "config.js"), "utf8");
const releaseStatusScriptText = readFileSync(join(ROOT, "scripts", "release-status.mjs"), "utf8");
const manualQaProfileScriptText = readFileSync(join(ROOT, "scripts", "manual-qa-profile.mjs"), "utf8");
const verifyManualQaScriptText = readFileSync(
  join(ROOT, "scripts", "verify-manual-qa-evidence.mjs"),
  "utf8",
);
const noSecretsVerifierScriptText = readFileSync(join(ROOT, "scripts", "verify-no-secrets.mjs"), "utf8");
const verifyReleasePackageScriptText = readFileSync(
  join(ROOT, "scripts", "verify-release-package.mjs"),
  "utf8",
);
const verifyCwsPackageScriptText = readFileSync(join(ROOT, "scripts", "verify-cws-package.mjs"), "utf8");
const storeListingText = readFileSync(STORE_LISTING_PATH, "utf8");
const assertMetadataDescription = ({ file, label, text, requiredPatterns }) => {
  if (typeof text !== "string" || !text.trim()) {
    fail(`${file} ${label} is missing; release metadata must state free/offline/local-first/no-signup positioning.`);
  }
  const missingRequiredPatterns = requiredPatterns.filter((pattern) => !pattern.test(text));
  if (missingRequiredPatterns.length) {
    fail(
      `${file} ${label} is missing required free/offline/local-first/no-signup metadata phrase(s): ${missingRequiredPatterns
        .map((pattern) => pattern.source)
        .join(", ")}.`,
    );
  }
  const hits = collectForbiddenPatternHits({
    file,
    text,
    patterns: FORBIDDEN_PUBLICATION_SURFACE_PATTERNS,
  });
  if (hits.length) {
    for (const hit of hits.slice(0, 20)) {
      console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
    }
    fail(`${hits.length} forbidden publication-surface string(s) found in release metadata.`);
  }
};
assertMetadataDescription({
  file: "package.json",
  label: "description",
  text: packageJson.description,
  requiredPatterns: REQUIRED_PACKAGE_DESCRIPTION_PATTERNS,
});
const missingStoreListingSections = REQUIRED_STORE_LISTING_PATTERNS.filter(
  (pattern) => !pattern.test(storeListingText),
);
if (missingStoreListingSections.length) {
  fail(
    `docs/STORE_LISTING.md is missing required local/offline/free-included store listing section(s): ${missingStoreListingSections
      .map((pattern) => pattern.source)
      .join(", ")}.`,
  );
}
const storeListingSurfaceHits = [];
for (const pattern of FORBIDDEN_PUBLICATION_SURFACE_PATTERNS) {
  const match = storeListingText.match(pattern);
  if (match) {
    storeListingSurfaceHits.push({
      file: "docs/STORE_LISTING.md",
      pattern: pattern.source,
      match: match[0],
    });
  }
}
if (storeListingSurfaceHits.length) {
  for (const hit of storeListingSurfaceHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(
    `${storeListingSurfaceHits.length} forbidden publication-surface string(s) found in the store listing draft.`,
  );
}
if (!RELEASE_DEV_MODE_DEFINE_PATTERN.test(webpackConfigText)) {
  fail(
    "webpack.config.js must force process.env.SAYLESS_DEV_MODE off outside development builds.",
  );
}
if (
  !/isBundledExtensionModelPath/.test(transcriptionConfigText) ||
  !/chrome-extension:/.test(transcriptionConfigText) ||
  !/assets\\\/whisper\\\/models/.test(transcriptionConfigText) ||
  !/isRemoteModelPath/.test(transcriptionConfigText) ||
  !/next\.localModelPath = current\.localModelPath/.test(transcriptionConfigText)
) {
  fail("src/transcription/config.js must keep release transcription on the bundled extension model path when stored settings try to override it with HTTP.");
}
if (!/const ASSET_PATH = process\.env\.ASSET_PATH \|\| ""/.test(webpackConfigText)) {
  fail("webpack.config.js must default ASSET_PATH to a relative path for packaged extension pages.");
}
if (!/loader:\s*"css-loader"[\s\S]*?options:\s*{\s*url:\s*false\s*}/.test(webpackConfigText)) {
  fail("webpack.config.js must preserve CSS asset URLs for packaged extension pages.");
}
if (!/process\.env\.ASSET_PATH = ""/.test(buildScriptText)) {
  fail("utils/build.js must build packaged extension pages with a relative ASSET_PATH.");
}
if (
  !/ALLOWED_WEBPACK_WARNINGS/.test(buildScriptText) ||
  !/transformers import\.meta standalone warning/.test(buildScriptText) ||
  !/@huggingface/.test(buildScriptText) ||
  !/import\\\.meta/.test(buildScriptText) ||
  !/cannot be used as a standalone expression/.test(buildScriptText) ||
  !/unexpectedWarnings/.test(buildScriptText) ||
  !/Webpack compilation had unexpected warnings/.test(buildScriptText) ||
  !/process\.exit\(1\)/.test(buildScriptText)
) {
  fail("utils/build.js must fail release builds on unexpected webpack warnings and only allow the known transformers import.meta warning.");
}
for (const [label, version] of [
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock root package", packageLock.packages?.[""]?.version],
]) {
  if (version !== sourceManifestForVersion.version) {
    fail(
      `${label} version (${version || "missing"}) must match src/manifest.json version (${sourceManifestForVersion.version}). Run npm run release -- <patch|minor|major> or update release versions together.`,
    );
  }
}
for (const ignoredPattern of ["build/", "release-artifacts/", "dist/", "*.zip"]) {
  if (!new RegExp(`^${ignoredPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(gitignoreText)) {
    fail(`.gitignore must keep generated release artifact path ignored: ${ignoredPattern}`);
  }
}
if (!/^!docs\/STORE_LISTING\.md$/m.test(gitignoreText)) {
  fail(".gitignore must allow docs/STORE_LISTING.md so the machine-scanned store listing draft can be tracked.");
}
for (const scriptName of [
  "package",
  "package:release",
  "build:cws",
  "release:cws",
  "release:cws:force",
  "release:cws:publish",
  "release:cws:publish:10",
  "release:cws:publish:50",
]) {
  const command = packageJson.scripts?.[scriptName] || "";
  const runsManualGate =
    /(?:qa:release:manual|package:release|preflight:cws|release:cws)/.test(command) ||
    (/scripts\/package-release\.mjs/.test(command) &&
      /verify-manual-qa-evidence\.mjs/.test(packageReleaseScriptText)) ||
    (/scripts\/package-cws\.mjs/.test(command) &&
      /package-release\.mjs/.test(packageCwsScriptText) &&
      /verify-manual-qa-evidence\.mjs/.test(packageReleaseScriptText));
  if (!runsManualGate) {
    fail(`${scriptName} must run the manual release evidence gate before artifact or store actions.`);
  }
}
if ((packageJson.scripts?.package || "") !== "npm run package:release") {
  fail("package must delegate to package:release so generic packaging keeps the release evidence gate.");
}
if ((packageJson.scripts?.["package:ci-extension"] || "") !== "node scripts/package-ci-extension.mjs") {
  fail("package:ci-extension must run scripts/package-ci-extension.mjs for the GitHub Actions downloadable extension artifact.");
}
if (
  !/JSZip/.test(packageCiExtensionScriptText) ||
  !/build\/manifest\.json/.test(packageCiExtensionScriptText) ||
  !/package\.json version/.test(packageCiExtensionScriptText) ||
  !/sayless-extension-v\$\{manifest\.version\}/.test(packageCiExtensionScriptText) ||
  !/sayless\.ciExtensionPackage/.test(packageCiExtensionScriptText) ||
  !/createHash\("sha256"\)\.update\(zipBuffer\)/.test(packageCiExtensionScriptText) ||
  !/platform:\s*"UNIX"/.test(packageCiExtensionScriptText) ||
  !/dist/.test(packageCiExtensionScriptText)
) {
  fail("scripts/package-ci-extension.mjs must create a deterministic versioned zip, SHA-256 file, and CI package metadata from build/.");
}
if (!/verify-no-secrets\.mjs/.test(packageReleaseScriptText)) {
  fail("scripts/package-release.mjs must run the no-secrets scan before writing extension.zip.");
}
if (!/NO_SECRETS_VERIFIER_PATH/.test(packageReleaseScriptText)) {
  fail("scripts/package-release.mjs must run the checked-in no-secrets verifier before writing extension.zip.");
}
const noSecretsSkipExtensionsMatch = noSecretsVerifierScriptText.match(
  /const\s+SKIP_EXTENSIONS\s*=\s*new Set\(\[([\s\S]*?)\]\);/,
);
if (!noSecretsSkipExtensionsMatch) {
  fail("scripts/verify-no-secrets.mjs must declare explicit skipped binary extensions.");
} else if (/(["'])\.svg\1/.test(noSecretsSkipExtensionsMatch[1])) {
  fail("scripts/verify-no-secrets.mjs must scan text SVG assets for secret leaks.");
}
if (
  !/verify-manual-qa-evidence\.mjs/.test(packageReleaseScriptText) ||
  !/SAYLESS_MANUAL_QA_ROOT/.test(packageReleaseScriptText) ||
  !/MANUAL_QA_VERIFIER_PATH/.test(packageReleaseScriptText)
) {
  fail("scripts/package-release.mjs must run the checked-in manual QA verifier with SAYLESS_MANUAL_QA_ROOT before writing extension.zip.");
}
if (
  !/verify-release-package\.mjs/.test(packageReleaseScriptText) ||
  !/verifyWrittenPackage\(\)/.test(packageReleaseScriptText) ||
  !/SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT/.test(packageReleaseScriptText)
) {
  fail("scripts/package-release.mjs must self-verify release package artifacts before reporting success.");
}
if (
  !/writeNonPassingPackageEvidence/.test(packageReleaseScriptText) ||
  !/sayless\.releasePackageFailed/.test(packageReleaseScriptText) ||
  !/sayless\.releasePackageIncomplete/.test(packageReleaseScriptText) ||
  !/remainingReleaseWork/.test(packageReleaseScriptText) ||
  !/failedStep/.test(packageReleaseScriptText)
) {
  fail("scripts/package-release.mjs must overwrite stale package evidence with non-passing evidence before and after failed packaging runs.");
}
if ((packageJson.scripts?.["verify:release-package"] || "") !== "node scripts/verify-release-package.mjs") {
  fail("verify:release-package must run scripts/verify-release-package.mjs.");
}
if (
  !/recordPageErrors/.test(builtExtensionSurfaceTestText) ||
  !/pattern:\s*"pageerror"/.test(builtExtensionSurfaceTestText) ||
  !/recordPageErrors\(hits, pageName, surface\.pageErrors\)/.test(
    builtExtensionSurfaceTestText,
  ) ||
  !/recordPageErrors\(hits, "content-script-popup", contentErrors\)/.test(
    builtExtensionSurfaceTestText,
  ) ||
  !/recordConsoleErrors/.test(builtExtensionSurfaceTestText) ||
  !/pattern:\s*"console-error"/.test(builtExtensionSurfaceTestText) ||
  !/message\.type\(\) === "error"/.test(builtExtensionSurfaceTestText) ||
  !/recordConsoleErrors\(hits, pageName, surface\.consoleErrors\)/.test(
    builtExtensionSurfaceTestText,
  ) ||
  !/recordConsoleErrors\(hits, "content-script-popup", contentConsoleErrors\)/.test(
    builtExtensionSurfaceTestText,
  ) ||
  !/isTargetClosedError/.test(builtExtensionSurfaceTestText) ||
  !/scanExtensionPage/.test(builtExtensionSurfaceTestText)
) {
  fail("tests/e2e/run-built-extension-surface.cjs must fail packaged surface smoke on page JavaScript and console errors.");
}
if (
  !/writeNonPassingEvidence/.test(releaseQaAutomatedScriptText) ||
  !/status:\s*"passed"/.test(releaseQaAutomatedScriptText) ||
  !/sayless\.releaseQaAutomatedFailed/.test(releaseQaAutomatedScriptText) ||
  !/sayless\.releaseQaAutomatedIncomplete/.test(releaseQaAutomatedScriptText) ||
  !/failedCommand/.test(releaseQaAutomatedScriptText) ||
  !/Automated release QA has not passed/.test(releaseQaAutomatedScriptText)
) {
  fail("scripts/release-qa-automated.mjs must overwrite stale automated release QA evidence with non-passing evidence before and after failed runs.");
}
if (
  packageJson.scripts?.["qa:release:status"] !== "node scripts/release-status.mjs" ||
  !/SAYLESS_RELEASE_STATUS_ROOT/.test(releaseStatusScriptText) ||
  !/verify-manual-qa-evidence\.mjs/.test(releaseStatusScriptText) ||
  !/verify-release-package\.mjs/.test(releaseStatusScriptText) ||
  !/verify-cws-package\.mjs/.test(releaseStatusScriptText) ||
  !/gateStatus/.test(releaseStatusScriptText) ||
  !/evidenceGateStatus/.test(releaseStatusScriptText) ||
  !/validateAutomatedEvidence/.test(releaseStatusScriptText) ||
  !/dirFingerprint/.test(releaseStatusScriptText) ||
  !/releaseSurface/.test(releaseStatusScriptText) ||
  !/EXPECTED_AUTOMATED_COMMANDS/.test(releaseStatusScriptText) ||
  !/command durations must not exceed total durationMs/.test(releaseStatusScriptText) ||
  !/git\.commit must be a 40-character SHA-1 commit/.test(releaseStatusScriptText) ||
  !/git\.workingTree\.sha256 must match the current git worktree/.test(releaseStatusScriptText) ||
  !/verifierErrorCount/.test(releaseStatusScriptText) ||
  !/verifierSummary/.test(releaseStatusScriptText) ||
  !/manualQaTodo/.test(releaseStatusScriptText) ||
  !/Manual QA todo/.test(releaseStatusScriptText) ||
  !/Record at least two real recordings/.test(releaseStatusScriptText) ||
  !/publication-surface evidence for release notes, screenshots, and docs\/STORE_LISTING\.md store text/.test(releaseStatusScriptText) ||
  !/npm run qa:release:auto/.test(releaseStatusScriptText) ||
  !/npm run qa:release:manual:template/.test(releaseStatusScriptText) ||
  !/npm run qa:release:manual:profile/.test(releaseStatusScriptText) ||
  !/complete docs\/RELEASE_QA\.md/.test(releaseStatusScriptText) ||
  !/fix release-artifacts\/manual-qa-evidence\.json/.test(releaseStatusScriptText) ||
  !/npm run package:release/.test(releaseStatusScriptText) ||
  !/npm run build:cws/.test(releaseStatusScriptText) ||
  !/npm run verify:release-package/.test(releaseStatusScriptText) ||
  !/npm run verify:cws-package/.test(releaseStatusScriptText) ||
  !/npm run release:cws/.test(releaseStatusScriptText) ||
  !/npm run release:cws:publish/.test(releaseStatusScriptText) ||
  !/release-artifacts\/manual-qa-evidence\.json/.test(releaseStatusScriptText) ||
  !/attach docs\/STORE_LISTING\.md/.test(releaseStatusScriptText) ||
  !/attach extension\.zip/.test(releaseStatusScriptText) ||
  !/attach build-cws\.zip/.test(releaseStatusScriptText) ||
  !/--require-ready/.test(releaseStatusScriptText) ||
  !/Release status must be ready before this action can continue/.test(releaseStatusScriptText) ||
  !/Next steps/.test(releaseStatusScriptText) ||
  !/Release handoff/.test(releaseStatusScriptText)
) {
  fail("qa:release:status must inspect release evidence and report the next manual/package/CWS release or publication action without creating artifacts.");
}
const releasePrepSteps = [
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
  /Attach release-artifacts\/release-qa-automated\.json, release-artifacts\/manual-qa-evidence\.json, release-artifacts\/package-release\.json, release-artifacts\/cws-package\.json, docs\/STORE_LISTING\.md, extension\.zip, and build-cws\.zip/,
];
let previousReleasePrepIndex = -1;
for (const step of releasePrepSteps) {
  const index = step.exec(releaseScriptText)?.index ?? -1;
  if (index <= previousReleasePrepIndex) {
    fail("scripts/release.mjs must print the full release QA, manual evidence, package, and CWS verification sequence in order.");
  }
  previousReleasePrepIndex = index;
}
if (
  !/SAYLESS_MANUAL_QA_ROOT/.test(verifyManualQaScriptText) ||
  !/--write-template/.test(verifyManualQaScriptText) ||
  !/writeFileAtomic/.test(verifyManualQaScriptText) ||
  !/status:\s*"template"/.test(verifyManualQaScriptText) ||
  !/manual QA evidence file already exists/.test(verifyManualQaScriptText) ||
  !/qa:release:manual:template:force/.test(verifyManualQaScriptText) ||
  !/DEFAULT_AUTOMATED_EVIDENCE_PATH/.test(verifyManualQaScriptText) ||
  !/automatedEvidenceCanPrefillTemplate/.test(verifyManualQaScriptText) ||
  !/EXPECTED_AUTOMATED_COMMANDS/.test(verifyManualQaScriptText) ||
  !/isCanonicalRelativePath/.test(verifyManualQaScriptText) ||
  !/gitWorktreeFingerprint/.test(verifyManualQaScriptText) ||
  !/automatedEvidencePath must point to/.test(verifyManualQaScriptText) ||
  !/manual QA evidence status must be "passed"/.test(verifyManualQaScriptText) ||
  !/automated QA evidence startedAt must be/.test(verifyManualQaScriptText) ||
  !/automated QA evidence status must be "passed"/.test(verifyManualQaScriptText) ||
  !/automated QA evidence durationMs must be a positive number/.test(verifyManualQaScriptText) ||
  !/automated QA evidence durationMs must match the startedAt\/generatedAt run window/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence build\.formattedBytes must match build\.bytes/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence build\.path must be the canonical relative build path/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence bundledWhisper\.formattedBytes must match bundledWhisper\.bytes/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence bundledWhisper\.path must be the canonical relative build\/assets\/whisper path/.test(
    verifyManualQaScriptText,
  ) ||
  !/current build byte size .+ does not match/.test(verifyManualQaScriptText) ||
  !/automated QA evidence contains duplicate command/.test(verifyManualQaScriptText) ||
  !/automated QA evidence contains unexpected command/.test(verifyManualQaScriptText) ||
  !/automated QA evidence command durations must not exceed total durationMs/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence git\.commit/.test(verifyManualQaScriptText) ||
  !/automated QA evidence git\.workingTree\.sha256 must match the current git worktree/.test(
    verifyManualQaScriptText,
  ) ||
  !/automated QA evidence command .+ must be/.test(verifyManualQaScriptText) ||
  !/recordings\[\$\{index\}\]\.id must be unique/.test(verifyManualQaScriptText) ||
  !/must be a unique recording id within/.test(verifyManualQaScriptText) ||
  !/must reference at least \$\{minimum\} unique listed recording id/.test(
    verifyManualQaScriptText,
  ) ||
  !/must be unique within this operation/.test(verifyManualQaScriptText) ||
  !/must reference at least \$\{requiredRecordingRefs\} unique listed recording id/.test(
    verifyManualQaScriptText,
  ) ||
  !/externalNetworkProbe/.test(verifyManualQaScriptText) ||
  !/sameChromeProfile/.test(verifyManualQaScriptText) ||
  !/external http\(s\) URL/.test(verifyManualQaScriptText) ||
  !/observedError must describe the browser network failure/.test(verifyManualQaScriptText) ||
  !/premium\/trial\/entitlement\/license\/upgrade/.test(verifyManualQaScriptText) ||
  !/locked-behind\/pay-to-unlock\/upgrade-required gates/.test(verifyManualQaScriptText)
) {
  fail("scripts/verify-manual-qa-evidence.mjs must support fixtureable release verification and enforce canonical automated QA evidence provenance, stale-template prefill protection, timing, command inventory, and structured offline network probe evidence.");
}
if (
  packageJson.scripts?.["qa:release:manual:profile"] !== "node scripts/manual-qa-profile.mjs" ||
  packageJson.scripts?.["qa:release:manual:template"] !==
    "node scripts/verify-manual-qa-evidence.mjs --write-template" ||
  packageJson.scripts?.["qa:release:manual:template:force"] !==
    "node scripts/verify-manual-qa-evidence.mjs --write-template --force"
) {
  fail("manual QA npm scripts must provide the clean-profile helper, safe template writer, and explicit force overwrite command.");
}
if (
  !/SAYLESS_MANUAL_QA_PROFILE_ROOT/.test(manualQaProfileScriptText) ||
  !/SAYLESS_CHROME/.test(manualQaProfileScriptText) ||
  !/build\/manifest\.json is missing/.test(manualQaProfileScriptText) ||
  !/release-artifacts\/release-qa-automated\.json is missing/.test(manualQaProfileScriptText) ||
  !/automated QA evidence status must be "passed"/.test(manualQaProfileScriptText) ||
  !/automated QA evidence generatedAt must be an ISO UTC timestamp/.test(manualQaProfileScriptText) ||
  !/current build fingerprint does not match automated QA evidence/.test(manualQaProfileScriptText) ||
  !/current build byte size does not match automated QA evidence/.test(manualQaProfileScriptText) ||
  !/automated QA evidence build\.formattedBytes must match current build byte size/.test(
    manualQaProfileScriptText,
  ) ||
  !/gitWorktreeFingerprint/.test(manualQaProfileScriptText) ||
  !/automated QA evidence git\.workingTree is required/.test(manualQaProfileScriptText) ||
  !/automated QA evidence git\.workingTree\.sha256 must match the current git worktree/.test(
    manualQaProfileScriptText,
  ) ||
  !/automated QA evidence git\.workingTree\.fileCount must match the current git worktree/.test(
    manualQaProfileScriptText,
  ) ||
  !/automated QA evidence git\.workingTree\.statusSha256 must match the current git status/.test(
    manualQaProfileScriptText,
  ) ||
  !/--user-data-dir=/.test(manualQaProfileScriptText) ||
  !/--disable-extensions-except=/.test(manualQaProfileScriptText) ||
  !/--load-extension=/.test(manualQaProfileScriptText) ||
  !/chrome:\/\/extensions\//.test(manualQaProfileScriptText) ||
  !/cleanChromeProfile:\s*true/.test(manualQaProfileScriptText) ||
  !/extensionSource:\s*"build"/.test(manualQaProfileScriptText) ||
  !/automatedEvidenceGeneratedAt/.test(manualQaProfileScriptText) ||
  !/buildSha256/.test(manualQaProfileScriptText) ||
  !/buildBytes/.test(manualQaProfileScriptText) ||
  !/buildFormattedBytes/.test(manualQaProfileScriptText) ||
  !/evidencePrefill/.test(manualQaProfileScriptText) ||
  !/automated evidence timestamp/.test(manualQaProfileScriptText) ||
  !/manual QA profile directory must be a new or empty directory/.test(manualQaProfileScriptText) ||
  !/manual QA profile directory must be empty so manual QA uses a clean Chrome profile/.test(
    manualQaProfileScriptText,
  ) ||
  !/unknown manual QA profile option/.test(manualQaProfileScriptText) ||
  !/manual QA profile helper accepts at most one --profile-dir option/.test(manualQaProfileScriptText) ||
  !/manual QA profile --profile-dir value must not be empty/.test(manualQaProfileScriptText) ||
  !/--launch/.test(manualQaProfileScriptText) ||
  !/--json/.test(manualQaProfileScriptText)
) {
  fail("scripts/manual-qa-profile.mjs must require current passing automated evidence before printing or launching a clean Chrome profile command for the canonical release build.");
}
if (
  !/package-release\.json/.test(verifyReleasePackageScriptText) ||
  !/extension\.zip/.test(verifyReleasePackageScriptText) ||
  !/isCanonicalRelativePath/.test(verifyReleasePackageScriptText) ||
  !/verify-manual-qa-evidence\.mjs/.test(verifyReleasePackageScriptText) ||
  !/SAYLESS_MANUAL_QA_ROOT/.test(verifyReleasePackageScriptText) ||
  !/manual QA evidence/.test(verifyReleasePackageScriptText) ||
  !/automated QA evidence/.test(verifyReleasePackageScriptText) ||
  !/appendNonPassingEvidenceDetails/.test(verifyReleasePackageScriptText) ||
  !/remainingReleaseWork/.test(verifyReleasePackageScriptText) ||
  !/failedStep/.test(verifyReleasePackageScriptText) ||
  !/package release evidence status must be "passed"/.test(verifyReleasePackageScriptText) ||
  !/automated QA evidence status must be "passed"/.test(verifyReleasePackageScriptText) ||
  !/package release evidence automated QA status must be "passed"/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/automated QA evidence status must match package release evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/manual QA evidence status must be "passed"/.test(verifyReleasePackageScriptText) ||
  !/package release evidence manual QA status must be "passed"/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/manual QA evidence status must match package release evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/validateGitProvenance/.test(verifyReleasePackageScriptText) ||
  !/package release evidence releaseVersion must match automated QA evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence automated QA releaseVersion must match automated QA evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence releaseVersion must match manual QA evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence manual QA releaseVersion must match manual QA evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence generatedAt must be at or after automated QA evidence generatedAt/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence generatedAt must be at or after manual QA evidence testedAt/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence git provenance must match automated QA evidence/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence build byte size/.test(verifyReleasePackageScriptText) ||
  !/package release evidence formatted build size must match current build size/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence formatted zip size must match current extension\.zip size/.test(
    verifyReleasePackageScriptText,
  ) ||
  !/package release evidence zip\.path is required/.test(verifyReleasePackageScriptText) ||
  !/package release evidence zip\.path must point to extension\.zip/.test(
    verifyReleasePackageScriptText,
  )
) {
  fail("scripts/verify-release-package.mjs must verify release package evidence, zip, formatted size, manual QA schema, QA evidence hashes, git provenance, and evidence timestamp ordering.");
}
if (!/scripts\/package-cws\.mjs/.test(packageJson.scripts?.["build:cws"] || "")) {
  fail("build:cws must run scripts/package-cws.mjs so the CWS artifact is traceable.");
}
if (
  !/package-release\.mjs/.test(packageCwsScriptText) ||
  !/RELEASE_PACKAGER_PATH/.test(packageCwsScriptText) ||
  !/SAYLESS_PACKAGE_RELEASE_ROOT/.test(packageCwsScriptText) ||
  !/package-release\.json/.test(packageCwsScriptText) ||
  !/cws-package\.json/.test(packageCwsScriptText) ||
  !/build-cws\.zip/.test(packageCwsScriptText) ||
  !/git:\s*packageEvidence\.git/.test(packageCwsScriptText)
) {
  fail("scripts/package-cws.mjs must package through the checked-in package-release gate and write CWS evidence with package git provenance.");
}
if (
  !/verify-cws-package\.mjs/.test(packageCwsScriptText) ||
  !/verifyWrittenCwsPackage\(\)/.test(packageCwsScriptText) ||
  !/SAYLESS_CWS_VERIFY_ROOT/.test(packageCwsScriptText)
) {
  fail("scripts/package-cws.mjs must self-verify CWS package artifacts before reporting success.");
}
if (
  !/writeNonPassingCwsEvidence/.test(packageCwsScriptText) ||
  !/sayless\.cwsPackageFailed/.test(packageCwsScriptText) ||
  !/sayless\.cwsPackageIncomplete/.test(packageCwsScriptText) ||
  !/remainingReleaseWork/.test(packageCwsScriptText) ||
  !/failedStep/.test(packageCwsScriptText)
) {
  fail("scripts/package-cws.mjs must overwrite stale CWS evidence with non-passing evidence before and after failed packaging runs.");
}
if ((packageJson.scripts?.["verify:cws-package"] || "") !== "node scripts/verify-cws-package.mjs") {
  fail("verify:cws-package must run scripts/verify-cws-package.mjs.");
}
if (
  !/pull_request:/.test(ciWorkflowText) ||
  !/push:/.test(ciWorkflowText) ||
  !/workflow_dispatch:/.test(ciWorkflowText) ||
  !/npm ci/.test(ciWorkflowText) ||
  !/npx playwright install chrome chromium/.test(ciWorkflowText) ||
  !/xvfb-run -a npm run qa:release:auto/.test(ciWorkflowText) ||
  !/npm run qa:release:status/.test(ciWorkflowText) ||
  !/release-artifacts\/release-qa-automated\.json/.test(ciWorkflowText) ||
  !/release-artifacts\/release-qa-automated\.log/.test(ciWorkflowText) ||
  !/tee release-artifacts\/release-qa-automated\.log/.test(ciWorkflowText) ||
  !/set -o pipefail/.test(ciWorkflowText) ||
  !/needs:\s*release-checks/.test(ciWorkflowText) ||
  !/npm run build:release/.test(ciWorkflowText) ||
  !/npm run verify:release/.test(ciWorkflowText) ||
  !/npm run package:ci-extension/.test(ciWorkflowText) ||
  !/actions\/upload-artifact@v4/.test(ciWorkflowText) ||
  !/sayless-extension-v\*\.zip/.test(ciWorkflowText) ||
  !/sayless-extension-v\*\.sha256/.test(ciWorkflowText) ||
  !/sayless-extension-v\*\.json/.test(ciWorkflowText) ||
  !/softprops\/action-gh-release@v2/.test(ciWorkflowText) ||
  !/refs\/tags\/v/.test(ciWorkflowText) ||
  !/inputs\.release_tag/.test(ciWorkflowText) ||
  !/draft:\s*false/.test(ciWorkflowText)
) {
  fail("GitHub Actions CI must run release checks, upload evidence, build a verified downloadable extension bundle, and publish direct-download release assets only from tags or explicit manual tags.");
}
if ((packageJson.scripts?.["preflight:cws"] || "") !== "npm run qa:release:status -- --require-ready") {
  fail("preflight:cws must require ready qa:release:status so CWS store actions keep every release evidence gate.");
}
const cwsBlessAliases = Object.keys(packageJson.scripts || {}).filter((name) =>
  /^preflight:cws:.*bless/i.test(name),
);
if (cwsBlessAliases.length) {
  fail(
    `CWS preflight scripts must not use bless aliases that imply bypassing release evidence gates: ${cwsBlessAliases.join(
      ", ",
    )}.`,
  );
}
if ((packageJson.scripts?.["release:cws:force"] || "") !== "npm run release:cws") {
  fail("release:cws:force must delegate to release:cws so force uploads keep the same evidence gates.");
}
for (const scriptName of [
  "release:cws",
  "release:cws:force",
  "release:cws:publish",
  "release:cws:publish:10",
  "release:cws:publish:50",
]) {
  if (!/(?:verify:cws-package|release:cws)/.test(packageJson.scripts?.[scriptName] || "")) {
    fail(`${scriptName} must verify the CWS package evidence before upload or publish.`);
  }
}
const directCwsStoreScripts = Object.entries(packageJson.scripts || {}).filter(([, command]) =>
  /\bchrome-webstore-upload\b/.test(command || ""),
);
for (const [scriptName, command] of directCwsStoreScripts) {
  if (!/npm run preflight:cws/.test(command) || !/npm run verify:cws-package/.test(command)) {
    fail(
      `${scriptName} invokes chrome-webstore-upload and must run preflight:cws plus verify:cws-package before the store action.`,
    );
  }
}
if (
  !/verify-release-package\.mjs/.test(verifyCwsPackageScriptText) ||
  !/cws-package\.json/.test(verifyCwsPackageScriptText) ||
  !/package-release\.json/.test(verifyCwsPackageScriptText) ||
  !/build-cws\.zip/.test(verifyCwsPackageScriptText) ||
  !/extension\.zip/.test(verifyCwsPackageScriptText) ||
  !/isCanonicalRelativePath/.test(verifyCwsPackageScriptText) ||
  !/CWS package evidence status must be "passed"/.test(verifyCwsPackageScriptText) ||
  !/appendNonPassingEvidenceDetails/.test(verifyCwsPackageScriptText) ||
  !/remainingReleaseWork/.test(verifyCwsPackageScriptText) ||
  !/failedStep/.test(verifyCwsPackageScriptText) ||
  !/automated QA evidence status must be "passed"/.test(verifyCwsPackageScriptText) ||
  !/package release evidence automated QA status must be "passed"/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/automated QA evidence status must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/manual QA evidence status must be "passed"/.test(verifyCwsPackageScriptText) ||
  !/package release evidence manual QA status must be "passed"/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/manual QA evidence status must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/package release evidence automated QA releaseVersion must match automated QA evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/package release evidence manual QA releaseVersion must match manual QA evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/validateGitProvenance/.test(verifyCwsPackageScriptText) ||
  !/CWS package evidence releaseVersion must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence packageEvidence\.releaseVersion must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence packageEvidence\.generatedAt must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence packageEvidence\.path is required/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence packageEvidence\.path must point to release-artifacts\/package-release\.json/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence git provenance must match package release evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip\.path is required/.test(verifyCwsPackageScriptText) ||
  !/CWS package sourceZip\.path must point to extension\.zip/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip size must match current extension\.zip size/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip formatted size must match current extension\.zip size/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip SHA-256 must match package release zip evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip size must match package release zip evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package sourceZip formatted size must match package release zip evidence/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/package release evidence build byte size/.test(verifyCwsPackageScriptText) ||
  !/package release evidence formatted build size must match current build size/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence cwsZip\.path is required/.test(verifyCwsPackageScriptText) ||
  !/CWS package evidence cwsZip\.path must point to build-cws\.zip/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence formatted zip size must match current build-cws\.zip size/.test(
    verifyCwsPackageScriptText,
  ) ||
  !/CWS package evidence generatedAt must be at or after package release evidence generatedAt/.test(
    verifyCwsPackageScriptText,
  )
) {
  fail("scripts/verify-cws-package.mjs must verify CWS evidence, package evidence, both zip artifacts, formatted size, git provenance, and evidence timestamp ordering.");
}
const forbiddenReleaseScriptHits = [];
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (
    /^(?:qa:release|verify:release|package|package:release|build:cws|preflight:cws|release:cws)/.test(
      name,
    ) &&
    /(?:run-transcription\.cjs|SAYLESS_ALLOW_NETWORK_TRANSCRIPTION_E2E)/.test(command)
  ) {
    forbiddenReleaseScriptHits.push(name);
  }
}
if (forbiddenReleaseScriptHits.length) {
  fail(
    `release/package script(s) reference the non-release transcription harness: ${forbiddenReleaseScriptHits.join(
      ", ",
    )}.`,
  );
}
if (existsSync(TRANSCRIPTION_HARNESS_PATH)) {
  const transcriptionHarnessText = readFileSync(TRANSCRIPTION_HARNESS_PATH, "utf8");
  const forbiddenTranscriptionHarnessHits = [];
  for (const pattern of FORBIDDEN_TRANSCRIPTION_HARNESS_PATTERNS) {
    const match = transcriptionHarnessText.match(pattern);
    if (match) {
      forbiddenTranscriptionHarnessHits.push(match[0]);
    }
  }
  if (forbiddenTranscriptionHarnessHits.length) {
    for (const hit of forbiddenTranscriptionHarnessHits) {
      console.error(`tests/e2e/run-transcription.cjs: ${hit}`);
    }
    fail(
      `${forbiddenTranscriptionHarnessHits.length} remote transcription harness reference(s) found.`,
    );
  }
}
const dependencyNames = Object.keys({
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
  ...(packageJson.optionalDependencies || {}),
});
const forbiddenDependencyHits = dependencyNames.filter((name) =>
  FORBIDDEN_PACKAGE_DEPENDENCIES.has(name),
);
if (forbiddenDependencyHits.length) {
  fail(
    `package.json contains removed hosted/cloud/unused dependency/dependencies: ${forbiddenDependencyHits.join(
      ", ",
    )}.`,
  );
}

const forbiddenSourcePathHits = FORBIDDEN_SOURCE_PATHS.filter((path) =>
  existsSync(join(ROOT, path)),
);
if (forbiddenSourcePathHits.length) {
  fail(
    `source contains removed hosted/cloud surface path(s): ${forbiddenSourcePathHits.join(
      ", ",
    )}.`,
  );
}

const legacyEnvHits = [];
for (const file of FORBIDDEN_LEGACY_ENV_FILES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const match = readFileSync(path, "utf8").match(FORBIDDEN_LEGACY_ENV_PATTERN);
  if (match) legacyEnvHits.push({ file, match: match[0] });
}
if (legacyEnvHits.length) {
  for (const hit of legacyEnvHits) {
    console.error(`${hit.file}: ${hit.match}`);
  }
  fail(`${legacyEnvHits.length} legacy Screenity build/test env reference(s) found.`);
}

const activeScreenityUiNameHits = [];
for (const { file, pattern } of FORBIDDEN_ACTIVE_SCREENITY_UI_NAMES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const match = readFileSync(path, "utf8").match(pattern);
  if (match) activeScreenityUiNameHits.push({ file, match: match[0] });
}
if (activeScreenityUiNameHits.length) {
  for (const hit of activeScreenityUiNameHits) {
    console.error(`${hit.file}: ${hit.match}`);
  }
  fail(`${activeScreenityUiNameHits.length} stale active Screenity UI/debug name(s) found.`);
}

const sourceHits = [];
for (const { file, pattern, message } of FORBIDDEN_SOURCE_PATTERNS) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const match = readFileSync(path, "utf8").match(pattern);
  if (match) sourceHits.push({ file, message, match: match[0] });
}
if (sourceHits.length) {
  for (const hit of sourceHits) {
    console.error(`${hit.file}: ${hit.message}`);
  }
  fail(`${sourceHits.length} forbidden source configuration(s) found.`);
}

const dynamicLocalUrlGuardHits = [];
for (const { file, snippets, message } of REQUIRED_DYNAMIC_LOCAL_URL_GUARDS) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  const missing = snippets.filter((snippet) => !text.includes(snippet));
  if (missing.length) {
    dynamicLocalUrlGuardHits.push({ file, message, missing });
  }
}
if (dynamicLocalUrlGuardHits.length) {
  for (const hit of dynamicLocalUrlGuardHits) {
    console.error(`${hit.file}: ${hit.message}; missing ${hit.missing.join(", ")}`);
  }
  fail(`${dynamicLocalUrlGuardHits.length} dynamic local URL guard(s) missing.`);
}

const sourceMonetizationHits = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/assets/whisper/")) continue;
  if (!SOURCE_TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_SOURCE_MONETIZATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      sourceMonetizationHits.push({
        file: rel,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (sourceMonetizationHits.length) {
  for (const hit of sourceMonetizationHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(
    `${sourceMonetizationHits.length} paid/account-gating source reference(s) found in active extension source.`,
  );
}

const sourceScreenityProductHits = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/assets/whisper/")) continue;
  if (!SOURCE_TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_ACTIVE_SOURCE_SCREENITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      sourceScreenityProductHits.push({
        file: rel,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (sourceScreenityProductHits.length) {
  for (const hit of sourceScreenityProductHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(
    `${sourceScreenityProductHits.length} inherited Screenity product reference(s) found in active extension source.`,
  );
}

const sourceNetworkEndpointHits = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/assets/whisper/")) continue;
  if (rel.startsWith("src/assets/") && !rel.endsWith(".svg")) continue;
  if (!SOURCE_TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))) continue;
  const text = readFileSync(file, "utf8");
  const matches = [...text.matchAll(NETWORK_URL_PATTERN)];
  for (const match of matches) {
    if (isXmlNamespaceUrl(text, match.index || 0)) continue;
    const url = match[0];
    const host = extractUrlHost(url);
    if (host && ALLOWED_SOURCE_URL_HOSTS.has(host)) continue;
    sourceNetworkEndpointHits.push({
      file: rel,
      url,
      host: host || "(unparseable)",
    });
  }
}
if (sourceNetworkEndpointHits.length) {
  for (const hit of sourceNetworkEndpointHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.url} (${hit.host})`);
  }
  fail(
    `${sourceNetworkEndpointHits.length} network endpoint literal(s) found in active extension source.`,
  );
}

const sourceRemoteTelemetryHits = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/assets/whisper/")) continue;
  if (!SOURCE_TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_SOURCE_REMOTE_TELEMETRY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      sourceRemoteTelemetryHits.push({
        file: rel,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (sourceRemoteTelemetryHits.length) {
  for (const hit of sourceRemoteTelemetryHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(
    `${sourceRemoteTelemetryHits.length} remote telemetry/analytics source reference(s) found in active extension source.`,
  );
}

const localePaths = [
  join(ROOT, "src/_locales/en/messages.json"),
  join(BUILD_DIR, "_locales/en/messages.json"),
];
const localeHits = [];
for (const path of localePaths) {
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  const localeMessages = JSON.parse(text);
  assertMetadataDescription({
    file: relative(ROOT, path),
    label: "extDesc.message",
    text: localeMessages.extDesc?.message,
    requiredPatterns: REQUIRED_EXTENSION_DESCRIPTION_PATTERNS,
  });
  for (const pattern of FORBIDDEN_LOCALE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      localeHits.push({
        file: relative(ROOT, path),
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (localeHits.length) {
  for (const hit of localeHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(`${localeHits.length} forbidden locale string(s) found.`);
}

const sourceManifest = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
assertManifestPolicy(sourceManifest, "source");
assertManifestPolicy(manifest, "build");
assertManifestReleaseFieldsMatch(sourceManifest, manifest);

const files = walk(BUILD_DIR);
const forbiddenBuildFiles = files
  .map((file) => relative(BUILD_DIR, file))
  .filter((rel) => FORBIDDEN_BUILD_FILES.has(rel));
if (forbiddenBuildFiles.length) {
  fail(`build contains stale forbidden asset(s): ${forbiddenBuildFiles.join(", ")}.`);
}

const largeFileHashes = new Map();
for (const file of files) {
  const size = statSync(file).size;
  if (size < LARGE_DUPLICATE_BYTES) continue;
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  const matches = largeFileHashes.get(hash) || [];
  matches.push({ file: relative(BUILD_DIR, file), size });
  largeFileHashes.set(hash, matches);
}
const duplicateLargeFiles = [...largeFileHashes.values()].filter(
  (matches) => matches.length > 1,
);
if (duplicateLargeFiles.length) {
  for (const matches of duplicateLargeFiles) {
    console.error(
      `Duplicate large build asset (${formatBytes(matches[0].size)}): ${matches
        .map((match) => match.file)
        .join(", ")}`,
    );
  }
  fail(`${duplicateLargeFiles.length} duplicate large build asset group(s) found.`);
}

const rootRelativeHtmlHits = [];
for (const [rootLabel, rootDir] of [
  ["source", join(ROOT, "src")],
  ["build", BUILD_DIR],
]) {
  for (const file of walk(rootDir)) {
    if (!file.endsWith(".html")) continue;
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    for (const pattern of [
      /\b(?:href|src)=["']\/(?!\/)[^"']+/g,
      /url\(\s*\/(?!\/)[^)]+/g,
      /chrome-extension:\/\/__MSG_@@extension_id__\//g,
    ]) {
      for (const match of text.matchAll(pattern)) {
        rootRelativeHtmlHits.push({
          rootLabel,
          file: rel,
          match: match[0],
        });
      }
    }
  }
}
if (rootRelativeHtmlHits.length) {
  for (const hit of rootRelativeHtmlHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match}`);
  }
  fail(
    `${rootRelativeHtmlHits.length} root-relative extension HTML asset reference(s) found.`,
  );
}

const staleTemplateHtmlHits = [];
for (const [rootLabel, rootDir] of [
  ["source", join(ROOT, "src")],
  ["build", BUILD_DIR],
]) {
  for (const file of walk(rootDir)) {
    if (!file.endsWith(".html")) continue;
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_HTML_TEMPLATE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        staleTemplateHtmlHits.push({
          rootLabel,
          file: rel,
          pattern: pattern.source,
          match: match[0],
        });
      }
    }
  }
}
if (staleTemplateHtmlHits.length) {
  for (const hit of staleTemplateHtmlHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(
    `${staleTemplateHtmlHits.length} stale template/analytics HTML reference(s) found.`,
  );
}

const surfaceHits = [];
for (const file of files) {
  const rel = relative(BUILD_DIR, file);
  if (dirname(rel) !== "." && rel !== "manifest.json") continue;
  if (basename(file) !== "manifest.json" && !file.endsWith(".html")) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_SURFACE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      surfaceHits.push({
        file: rel,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (surfaceHits.length) {
  for (const hit of surfaceHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(`${surfaceHits.length} forbidden built-surface string(s) found.`);
}

const bundleHits = [];
for (const file of files) {
  if (!file.endsWith(".js")) continue;
  const rel = relative(BUILD_DIR, file);
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_BUNDLE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      bundleHits.push({
        file: rel,
        pattern: pattern.source,
        match: match[0],
      });
    }
  }
}
if (bundleHits.length) {
  for (const hit of bundleHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.match} (${hit.pattern})`);
  }
  fail(`${bundleHits.length} forbidden bundle protocol string(s) found.`);
}

const networkEndpointHits = [];
for (const file of files) {
  if (!file.endsWith(".js")) continue;
  const rel = relative(BUILD_DIR, file);
  const text = readFileSync(file, "utf8");
  const matches = [...text.matchAll(NETWORK_URL_PATTERN)];
  for (const match of matches) {
    const url = match[0];
    const host = extractUrlHost(url);
    if (
      host &&
      ALLOWED_BUNDLE_URL_HOSTS.has(host) &&
      !FORBIDDEN_NETWORK_HOST_PATTERNS.some((pattern) => pattern.test(host))
    ) {
      continue;
    }
    networkEndpointHits.push({
      file: rel,
      url,
      host: host || "(unparseable)",
    });
  }
}
if (networkEndpointHits.length) {
  for (const hit of networkEndpointHits.slice(0, 20)) {
    console.error(`${hit.file}: ${hit.url} (${hit.host})`);
  }
  fail(
    `${networkEndpointHits.length} forbidden network endpoint literal(s) found in built JS bundles.`,
  );
}

execFileSync(process.execPath, [WHISPER_ASSET_VERIFIER_PATH, "--build"], {
  cwd: DEFAULT_ROOT,
  env: {
    ...process.env,
    SAYLESS_WHISPER_ASSETS_ROOT: ROOT,
  },
  stdio: "inherit",
});
execFileSync(process.execPath, [NO_SECRETS_VERIFIER_PATH, BUILD_DIR], {
  cwd: DEFAULT_ROOT,
  stdio: "inherit",
});

const buildBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const whisperDir = join(BUILD_DIR, "assets", "whisper");
const whisperBytes = existsSync(whisperDir)
  ? walk(whisperDir).reduce((sum, file) => sum + statSync(file).size, 0)
  : 0;

if (buildBytes > MAX_BUILD_BYTES) {
  fail(
    `build size ${formatBytes(buildBytes)} exceeds ${formatBytes(
      MAX_BUILD_BYTES,
    )}.`,
  );
}

console.log("Release audit passed.");
console.log(`Build size: ${formatBytes(buildBytes)}`);
console.log(`Bundled Whisper assets: ${formatBytes(whisperBytes)}`);
if (buildBytes > WARN_BUILD_BYTES) {
  console.warn(
    `Warning: build size exceeds ${formatBytes(
      WARN_BUILD_BYTES,
    )}; confirm the target distribution channel accepts it.`,
  );
}
