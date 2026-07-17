import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const VERIFY_NO_SECRETS = join(ROOT, "scripts", "verify-no-secrets.mjs");

const runVerifier = (buildDir) =>
  spawnSync(process.execPath, [VERIFY_NO_SECRETS, buildDir], {
    cwd: ROOT,
    encoding: "utf8",
  });

test("no-secrets scanner catches tokens embedded in SVG assets", () => {
  const buildDir = mkdtempSync(join(tmpdir(), "sayless-no-secrets-"));
  try {
    mkdirSync(join(buildDir, "assets", "icons"), { recursive: true });
    writeFileSync(
      join(buildDir, "assets", "icons", "leaky.svg"),
      '<svg><!-- ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ --></svg>\n',
    );

    const result = runVerifier(buildDir);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Found 1 secret leak/);
    assert.match(result.stdout, /assets\/icons\/leaky\.svg/);
    assert.match(result.stdout, /This zip must NOT be published/);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("no-secrets scanner still skips binary media extensions", () => {
  const buildDir = mkdtempSync(join(tmpdir(), "sayless-no-secrets-"));
  try {
    mkdirSync(join(buildDir, "assets", "videos"), { recursive: true });
    writeFileSync(
      join(buildDir, "assets", "videos", "fixture.mp4"),
      "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ\n",
    );

    const result = runVerifier(buildDir);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /No forbidden secrets found/);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
