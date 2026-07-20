/**
 * WebCodecs microphone quality regression harness.
 *
 * Records a deterministic synthetic mic tone through the real WebCodecsRecorder
 * in Chrome, demuxes/decodes the output with Mediabunny, and checks for audio
 * duration drift, pitch drift, missing audio, and audio backpressure drops.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const webpack = require("webpack");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = { ".js": "text/javascript", ".html": "text/html" };

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "webcodecs-mic-quality.entry.mjs"),
        output: {
          path: work,
          filename: "bundle.js",
          chunkFilename: "[name].js",
        },
        target: "web",
        devtool: false,
        optimization: {
          minimize: false,
        },
        resolve: {
          extensions: [".js", ".mjs", ".ts", ".tsx", ".json"],
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
        experiments: {
          topLevelAwait: true,
        },
        plugins: [
          new webpack.DefinePlugin({
            "process.env.SAYLESS_DEV_MODE": JSON.stringify("false"),
            "process.env.NODE_ENV": JSON.stringify("development"),
          }),
        ],
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
          reject(
            new Error(
              info.errors
                .map((error) => error.message || String(error))
                .join("\n"),
            ),
          );
          return;
        }
        resolve();
      },
    );
  });

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-webcodecs-mic-"));
  const HOST = "127.0.0.1";
  let server = null;
  let browser = null;

  try {
    await bundleHarness(work);
    fs.writeFileSync(
      path.join(work, "harness.html"),
      "<!doctype html><meta charset=utf-8><title>WebCodecs mic quality harness</title><script type=module src=./bundle.js></script>",
    );

    server = http.createServer((req, res) => {
      if (req.url === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      const f = path.join(
        work,
        req.url === "/" ? "/harness.html" : req.url.split("?")[0],
      );
      if (!fs.existsSync(f)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(f)] || "application/octet-stream",
      });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, HOST, resolve);
    });

    const { port } = server.address();
    const harnessUrl = `http://${HOST}:${port}/harness.html`;
    const headless = process.env.SAYLESS_E2E_HEADLESS !== "0";
    browser = await chromium.launch({
      channel: process.env.SAYLESS_E2E_CHROME_CHANNEL || "chrome",
      headless,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      console.log("  [pageerror]", error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        console.log("  [console:error]", message.text());
      }
    });

    await page.goto(harnessUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      "window.WEBCODECS_MIC_QUALITY_READY === true",
      { timeout: 30000 },
    );
    const summary = await page.evaluate(() => window.WEBCODECS_MIC_QUALITY.run());
    console.log("=== WEBCODECS MIC QUALITY SMOKE ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log("WEBCODECS MIC QUALITY PASS");
  } catch (error) {
    console.error("WEBCODECS MIC QUALITY FAIL");
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      await new Promise((resolve) => server.close(resolve)).catch(() => {});
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
})();
