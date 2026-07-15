/**
 * E2E harness for local recording persistence.
 *
 * Verifies:
 * - multiple recordings register into a local-only index
 * - list sorting returns all local recordings
 * - edited blobs are checkpointed separately from originals
 * - checkpointed edits survive closing and reopening the editor tab
 */
const { chromium } = require("@playwright/test");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = { ".js": "text/javascript", ".html": "text/html" };

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-local-recordings-"));
  const PORT = 8751;

  execFileSync(
    "npx",
    [
      "--yes",
      "esbuild",
      path.join(__dirname, "local-recordings.entry.mjs"),
      "--bundle",
      "--format=esm",
      "--platform=browser",
      '--define:process={"env":{}}',
      `--outfile=${path.join(work, "bundle.js")}`,
      "--log-level=warning",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Local recordings harness</title><script type=module src=./bundle.js></script>",
  );

  const server = http.createServer((req, res) => {
    const f = path.join(
      work,
      req.url === "/" ? "/harness.html" : req.url.split("?")[0],
    );
    if (!fs.existsSync(f)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(f)] || "application/octet-stream",
    });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((resolve) => server.listen(PORT, resolve));

  const headless = process.env.SCREENITY_E2E_HEADLESS !== "0";
  const browser = await chromium.launch({ channel: "chrome", headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`http://localhost:${PORT}/harness.html`);
  await page.waitForFunction("window.LOCAL_RECORDINGS_READY === true", {
    timeout: 30000,
  });

  const result = await page.evaluate(async () => {
    localStorage.clear();
    indexedDB.deleteDatabase("local-recordings");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const lib = window.LOCAL_RECORDINGS;
    const blobText = async (blob) => await blob.text();

    const firstOriginal = new Blob(["first-original"], {
      type: "video/webm",
    });
    const secondOriginal = new Blob(["second-original"], {
      type: "video/mp4",
    });

    await lib.registerLocalRecording({
      id: "rec-a",
      title: "Alpha demo",
      blob: firstOriginal,
      durationMs: 1000,
      createdAt: 1000,
    });
    await lib.registerLocalRecording({
      id: "rec-b",
      title: "Beta demo",
      blob: secondOriginal,
      durationMs: 2000,
      createdAt: 2000,
    });
    await lib.checkpointEditedLocalRecording(
      "rec-a",
      new Blob(["first-edited"], { type: "video/mp4" }),
    );

    const newest = await lib.listLocalRecordings({ sortBy: "newest" });
    const alpha = await lib.listLocalRecordings({ sortBy: "alphabetical" });
    const firstEntry = newest.find((item) => item.id === "rec-a");
    const editedBeforeClose = await blobText(
      await lib.readLocalRecordingBlob(firstEntry),
    );

    return {
      newestIds: newest.map((item) => item.id),
      alphaIds: alpha.map((item) => item.id),
      editedBeforeClose,
    };
  });

  await page.close();
  const reopened = await context.newPage();
  reopened.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await reopened.goto(`http://localhost:${PORT}/harness.html`);
  await reopened.waitForFunction("window.LOCAL_RECORDINGS_READY === true", {
    timeout: 30000,
  });

  const afterReopen = await reopened.evaluate(async () => {
    const lib = window.LOCAL_RECORDINGS;
    const newest = await lib.listLocalRecordings({ sortBy: "newest" });
    const firstEntry = newest.find((item) => item.id === "rec-a");
    const editedAfterReopen = await (
      await lib.readLocalRecordingBlob(firstEntry)
    ).text();
    return {
      count: newest.length,
      ids: newest.map((item) => item.id),
      editedAfterReopen,
      hasEditedAt: Boolean(firstEntry.editedAt),
    };
  });

  await browser.close();
  server.close();

  console.log("=== LOCAL RECORDINGS HARNESS ===");
  console.log(JSON.stringify({ result, afterReopen }, null, 2));

  const ok =
    result.newestIds.join(",") === "rec-b,rec-a" &&
    result.alphaIds.join(",") === "rec-a,rec-b" &&
    result.editedBeforeClose === "first-edited" &&
    afterReopen.count === 2 &&
    afterReopen.ids.includes("rec-a") &&
    afterReopen.ids.includes("rec-b") &&
    afterReopen.editedAfterReopen === "first-edited" &&
    afterReopen.hasEditedAt;

  console.log(ok ? "LOCAL RECORDINGS HARNESS PASS" : "LOCAL RECORDINGS HARNESS FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("RUNNER ERROR", e);
  process.exit(2);
});
