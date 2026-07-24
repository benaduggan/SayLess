#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--noEmit", "--pretty", "false"];
const typescript7Path = join(ROOT, "node_modules", "@typescript", "native", "bin", "tsc");

if (!existsSync(typescript7Path)) {
  console.error("TypeScript 7.0.2 is missing. Run npm ci and retry npm run typecheck.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [typescript7Path, ...args], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
