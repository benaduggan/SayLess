#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--noEmit", "--pretty", "false"];

const direct = spawnSync("tsgo", args, {
  cwd: ROOT,
  stdio: "inherit",
});

if (!direct.error) {
  process.exit(direct.status ?? 1);
}

if (direct.error.code !== "ENOENT") {
  throw direct.error;
}

const viaNix = spawnSync(
  "nix-shell",
  ["default.nix", "--run", `tsgo ${args.join(" ")}`],
  {
    cwd: ROOT,
    stdio: "inherit",
  }
);

if (viaNix.error) {
  if (viaNix.error.code === "ENOENT") {
    console.error(
      "TypeScript 7 requires tsgo or nix-shell. Install Nix and retry npm run typecheck."
    );
    process.exit(1);
  }
  throw viaNix.error;
}

process.exit(viaNix.status ?? 1);
