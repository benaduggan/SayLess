import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_WHISPER_ASSETS_ROOT
  ? path.resolve(process.env.SAYLESS_WHISPER_ASSETS_ROOT)
  : DEFAULT_ROOT;
const target = process.argv.includes("--build") ? "build" : "src";
const whisperRoot =
  target === "build"
    ? path.join(ROOT, "build", "assets", "whisper")
    : path.join(ROOT, "src", "assets", "whisper");
const manifestPath = path.join(whisperRoot, "model-manifest.json");

const relative = (file) => path.relative(ROOT, file);

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing local Whisper model manifest: ${relative(manifestPath)}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const assetRoot = String(manifest.assetRoot || "assets/whisper/models/").replace(
  /^assets\/whisper\//,
  "",
);
const modelRoot = path.join(whisperRoot, assetRoot);
const requiredFiles = Array.isArray(manifest.requiredFiles)
  ? manifest.requiredFiles
  : [];
const fileIntegrity =
  manifest.fileIntegrity && typeof manifest.fileIntegrity === "object"
    ? manifest.fileIntegrity
    : {};

if (!requiredFiles.length) {
  console.error(`No requiredFiles listed in ${relative(manifestPath)}`);
  process.exit(1);
}

const missing = requiredFiles
  .map((file) => path.join(modelRoot, file))
  .filter((file) => !fs.existsSync(file));

if (missing.length) {
  console.error(
    [
      `Local Whisper assets are incomplete for ${target}.`,
      "Missing files:",
      ...missing.map((file) => `- ${relative(file)}`),
    ].join("\n"),
  );
  process.exit(1);
}

const invalid = [];

for (const file of requiredFiles) {
  const expected = fileIntegrity[file];

  if (!expected) {
    invalid.push(`${file}: missing integrity metadata`);
    continue;
  }

  const absolutePath = path.join(modelRoot, file);
  const stats = fs.statSync(absolutePath);

  if (Number.isFinite(expected.bytes) && stats.size !== expected.bytes) {
    invalid.push(
      `${file}: expected ${expected.bytes} bytes, found ${stats.size} bytes`,
    );
  }

  if (expected.sha256) {
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");

    if (actualHash !== expected.sha256) {
      invalid.push(
        `${file}: expected sha256 ${expected.sha256}, found ${actualHash}`,
      );
    }
  }
}

if (invalid.length) {
  console.error(
    [
      `Local Whisper assets failed integrity checks for ${target}.`,
      ...invalid.map((message) => `- ${message}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Local Whisper assets verified for ${target}: ${requiredFiles.length} files with integrity.`,
);
