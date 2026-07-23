import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const e2eDirectory = path.join(root, "tests/e2e");

test("webpack e2e harnesses support TypeScript entry dependencies", () => {
  const webpackRunners = fs
    .readdirSync(e2eDirectory)
    .filter((fileName) => /^run-.*\.cjs$/.test(fileName))
    .map((fileName) => ({
      fileName,
      source: fs.readFileSync(path.join(e2eDirectory, fileName), "utf8"),
    }))
    .filter(({ source }) => source.includes('require("webpack")'));

  assert.ok(webpackRunners.length > 0, "expected webpack e2e runners");
  for (const { fileName, source } of webpackRunners) {
    assert.match(
      source,
      /loader:\s*"ts-loader"/,
      `${fileName} needs ts-loader`
    );
    assert.match(
      source,
      /"\.js":\s*\["\.js",\s*"\.ts"\]/,
      `${fileName} needs .js to .ts extension aliasing`
    );
  }
});
