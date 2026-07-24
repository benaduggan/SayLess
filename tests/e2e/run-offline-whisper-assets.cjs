/**
 * E2E harness for offline Whisper release asset readiness.
 *
 * Serves the checked-in bundled Whisper manifest/model files locally and drives
 * the same browser model-status code used by the extension UI. This does not
 * download a model or speech fixture; it verifies clean offline startup
 * readiness for the release asset path.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const webpack = require("webpack");

const ROOT = path.resolve(__dirname, "..", "..");
const ASSET_ROOT = path.join(ROOT, "src");
const MIN_EXPECTED_MODEL_BYTES = 70 * 1024 * 1024;
const MAX_READY_MS = 5000;
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".onnx": "application/octet-stream",
};

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "offline-whisper-assets.entry.mjs"),
        output: {
          path: work,
          filename: "bundle.js",
        },
        target: "web",
        devtool: false,
        optimization: {
          minimize: false,
        },
        resolve: {
          extensions: [".js", ".mjs", ".ts", ".tsx", ".json"],
          extensionAlias: {
            ".js": [".js", ".ts"],
            ".jsx": [".jsx", ".tsx"],
          },
        },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              use: {
                loader: "ts-loader",
                options: {
                  transpileOnly: true,
                },
              },
            },
          ],
        },
      },
      (err, stats) => {
        if (err) {
          reject(err);
          return;
        }
        const info = stats.toJson({ all: false, errors: true, warnings: true });
        if (stats.hasWarnings()) {
          for (const warning of info.warnings) {
            console.warn("  [bundle warning]", warning.message || warning);
          }
        }
        if (stats.hasErrors()) {
          reject(new Error(info.errors.map((error) => error.message || String(error)).join("\n")));
          return;
        }
        resolve();
      },
    );
  });

const createServer = (work) =>
  http.createServer((req, res) => {
    const rawPath = decodeURIComponent(req.url.split("?")[0]);
    const relativePath = rawPath === "/" ? "harness.html" : rawPath.slice(1);
    const root = relativePath.startsWith("assets/") ? ASSET_ROOT : work;
    const file = path.resolve(root, relativePath);
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      "content-length": String(stat.size),
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-offline-whisper-"));
  const HOST = "127.0.0.1";

  await bundleHarness(work);
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Offline Whisper assets</title><script type=module src=./bundle.js></script>",
  );

  const server = createServer(work);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address();
  const origin = `http://${HOST}:${port}`;

  const browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.SAYLESS_E2E_HEADLESS !== "0",
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  let result;
  try {
    await page.goto(`${origin}/harness.html`);
    await page.waitForFunction("window.OFFLINE_WHISPER_ASSETS_READY === true", {
      timeout: 30000,
    });
    result = await page.evaluate(async () => {
      const startedAt = performance.now();
      const status = await window.OFFLINE_WHISPER_ASSETS.checkLocalWhisperModelStatus({
        runtime: {
          runtime: {
            getURL: (assetPath) => `/${assetPath}`,
          },
        },
        fetchImpl: window.fetch.bind(window),
      });
      return {
        ...status,
        durationMs: Math.round(performance.now() - startedAt),
      };
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log("=== OFFLINE WHISPER ASSETS HARNESS ===");
  console.log(JSON.stringify(result, null, 2));

  const ok =
    result.ready === true &&
    result.state === "ready" &&
    result.requiredCount === 7 &&
    result.presentCount === 7 &&
    result.missingFiles.length === 0 &&
    result.totalBytes >= MIN_EXPECTED_MODEL_BYTES &&
    result.durationMs <= MAX_READY_MS;

  console.log(ok ? "OFFLINE WHISPER ASSETS PASS" : "OFFLINE WHISPER ASSETS FAIL");
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error("RUNNER ERROR", err);
  process.exit(2);
});
