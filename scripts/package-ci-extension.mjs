#!/usr/bin/env node

import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build");
const DIST_DIR = join(ROOT, "dist");
const PACKAGE_PATH = join(ROOT, "package.json");
const MANIFEST_PATH = join(BUILD_DIR, "manifest.json");

const fail = (message) => {
  console.error(`CI extension package failed: ${message}`);
  process.exit(1);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

if (!existsSync(BUILD_DIR)) {
  fail("build/ is missing. Run npm run build:release first.");
}
if (!existsSync(MANIFEST_PATH)) {
  fail("build/manifest.json is missing. Run npm run build:release first.");
}

const packageJson = readJson(PACKAGE_PATH);
const manifest = readJson(MANIFEST_PATH);
if (packageJson.version !== manifest.version) {
  fail(
    `package.json version ${packageJson.version} does not match build manifest version ${manifest.version}.`,
  );
}

const files = walkFiles(BUILD_DIR);
const zip = new JSZip();
for (const file of files) {
  zip.file(file.relativePath, readFileSync(file.path), {
    date: new Date("1980-01-01T00:00:00.000Z"),
  });
}

const zipBuffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});

mkdirSync(DIST_DIR, { recursive: true });
const baseName = `sayless-extension-v${manifest.version}`;
const zipPath = join(DIST_DIR, `${baseName}.zip`);
const shaPath = join(DIST_DIR, `${baseName}.sha256`);
const metadataPath = join(DIST_DIR, `${baseName}.json`);
const sha256 = createHash("sha256").update(zipBuffer).digest("hex");
const buildBytes = files.reduce((total, file) => total + file.size, 0);

writeFileSync(zipPath, zipBuffer);
writeFileSync(shaPath, `${sha256}  ${relative(ROOT, zipPath)}\n`);
writeFileSync(
  metadataPath,
  `${JSON.stringify(
    {
      kind: "sayless.ciExtensionPackage",
      status: "passed",
      version: manifest.version,
      generatedAt: new Date().toISOString(),
      zip: {
        path: relative(ROOT, zipPath),
        bytes: zipBuffer.length,
        formattedBytes: formatBytes(zipBuffer.length),
        sha256,
      },
      build: {
        path: relative(ROOT, BUILD_DIR),
        bytes: buildBytes,
        formattedBytes: formatBytes(buildBytes),
        fileCount: files.length,
      },
    },
    null,
    2,
  )}\n`,
);

console.log("CI extension package created.");
console.log(`Zip: ${relative(ROOT, zipPath)}`);
console.log(`Size: ${formatBytes(zipBuffer.length)}`);
console.log(`SHA-256: ${sha256}`);
