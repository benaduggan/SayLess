/**
 * Browser geometry smoke for the editor viewport.
 *
 * Verifies that the rebuilt editor grid keeps the media, timeline, and
 * transcript pane usable at desktop and compact viewports. This intentionally
 * tests the production SCSS class contract instead of only unit-testing style
 * strings.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const webpack = require("webpack");

const MIME = { ".js": "text/javascript", ".html": "text/html" };

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "editor-layout.entry.mjs"),
        output: {
          path: work,
          filename: "bundle.js",
          chunkFilename: "[name].js",
        },
        target: "web",
        devtool: false,
        optimization: { minimize: false },
        resolve: { extensions: [".js", ".mjs", ".json"] },
        module: {
          rules: [
            {
              test: /\.module\.scss$/,
              use: [
                "style-loader",
                {
                  loader: "css-loader",
                  options: {
                    url: false,
                    modules: {
                      localIdentName: "[hash:base64]",
                    },
                  },
                },
                "sass-loader",
              ],
            },
            {
              test: /\.scss$/,
              exclude: /\.module\.scss$/,
              use: ["style-loader", { loader: "css-loader", options: { url: false } }, "sass-loader"],
            },
            {
              test: /\.(ttf|woff2?|svg|png|jpe?g|gif)$/i,
              type: "asset/resource",
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

const assert = (condition, message, details = null) => {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
};

const nearViewport = (rect, viewport, tolerance = 1) =>
  rect.top >= -tolerance &&
  rect.left >= -tolerance &&
  rect.right <= viewport.width + tolerance &&
  rect.bottom <= viewport.height + tolerance;

const assertLayout = (name, data) => {
  const { viewport } = data;
  assert(data.editor.height >= viewport.height - 1, `${name}: editor does not fill viewport`, data.editor);
  assert(data.media.top >= 79 && data.media.top <= 81, `${name}: media content is not below fixed nav`, data.media);
  assert(data.workspace.height > 0, `${name}: workspace collapsed`, data.workspace);
  assert(data.media.height >= 600 || viewport.width > 1100, `${name}: media column collapsed in compact layout`, data.media);
  assert(data.player.height > 240, `${name}: player area is too short`, data.player);
  assert(data.plyr.width > 250 && data.plyr.height > 140, `${name}: video player is not usable`, data.plyr);
  assert(data.timeline.height >= 150, `${name}: timeline is too short to operate`, data.timeline);
  assert(data.timelineTrack.height >= 68, `${name}: timeline track collapsed`, data.timelineTrack);
  assert(data.timeline.bottom <= viewport.height + 1, `${name}: timeline is below the first viewport`, data.timeline);
  assert(data.timeline.top >= data.player.top, `${name}: timeline overlaps above player area`, data.timeline);
  assert(data.player.bottom <= data.timeline.top + 1, `${name}: player overlaps timeline`, {
    player: data.player,
    timeline: data.timeline,
  });
  assert(data.transcriptPanel.width > 0, `${name}: transcript panel collapsed`, data.transcriptPanel);
  assert(data.transcriptBody.overflowY === "auto", `${name}: transcript body is not independently scrollable`, data.transcriptBody);
  assert(
    data.transcriptBody.scrollHeight > data.transcriptBody.clientHeight,
    `${name}: transcript body did not retain overflow content`,
    data.transcriptBody,
  );
  if (viewport.width > 1100) {
    const playerTopGap = data.plyr.top - data.media.top;
    assert(data.bodyScrollHeight <= viewport.height + 1, `${name}: desktop document creates vertical overflow`, {
      bodyScrollHeight: data.bodyScrollHeight,
      viewport,
    });
    assert(data.transcriptPanel.top >= 79 && data.transcriptPanel.top <= 81, `${name}: desktop transcript panel is not below fixed nav`, data.transcriptPanel);
    assert(playerTopGap >= 0 && playerTopGap <= 72, `${name}: desktop video player is stranded too low in the media column`, {
      playerTopGap,
      media: data.media,
      player: data.plyr,
    });
    assert(data.transcriptPanel.bottom <= viewport.height + 1, `${name}: desktop transcript panel extends below viewport`, data.transcriptPanel);
    assert(nearViewport(data.transcriptPanel, viewport), `${name}: desktop transcript panel is outside viewport`, data.transcriptPanel);
    assert(data.transcriptPanel.width >= 360, `${name}: desktop transcript panel too narrow`, data.transcriptPanel);
    assert(data.transcriptPanel.left >= data.media.right - 1, `${name}: transcript overlaps media column`, {
      media: data.media,
      transcriptPanel: data.transcriptPanel,
    });
    assert(data.media.bottom <= viewport.height + 1, `${name}: desktop media column extends below viewport`, data.media);
    assert(data.media.right <= data.transcriptPanel.left + 1, `${name}: desktop media/transcript columns overflow or overlap`, {
      media: data.media,
      transcriptPanel: data.transcriptPanel,
      viewport,
    });
  } else {
    assert(data.transcriptPanel.top >= data.timeline.bottom - 1, `${name}: compact transcript should stack below media`, data.transcriptPanel);
    assert(data.transcriptPanel.width >= viewport.width - 1, `${name}: compact transcript should span viewport`, data.transcriptPanel);
  }
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-editor-layout-"));
  const HOST = "127.0.0.1";

  await bundleHarness(work);
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Editor layout harness</title><script type=module src=./bundle.js></script>",
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
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  const { port } = server.address();
  const harnessUrl = `http://${HOST}:${port}/harness.html`;
  const headless = process.env.SAYLESS_E2E_HEADLESS !== "0";
  const browser = await chromium.launch({ channel: "chrome", headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  const viewports = [
    { name: "threshold-desktop", width: 1101, height: 720 },
    { name: "reported-screenshot", width: 1103, height: 994 },
    { name: "screenshot-desktop", width: 1103, height: 995 },
    { name: "laptop", width: 1366, height: 768 },
    { name: "desktop", width: 1440, height: 900 },
    { name: "ultrawide", width: 1920, height: 1080 },
    { name: "short-desktop", width: 1280, height: 720 },
    { name: "tablet", width: 900, height: 780 },
    { name: "phone", width: 390, height: 844 },
  ];
  const measurements = [];

  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(harnessUrl);
      await page.waitForFunction("window.EDITOR_LAYOUT_READY === true", {
        timeout: 30000,
      });
      const data = await page.evaluate(() => window.EDITOR_LAYOUT_SMOKE.measure());
      assertLayout(viewport.name, data);
      measurements.push({
        name: viewport.name,
        viewport: data.viewport,
        player: {
          top: Math.round(data.plyr.top),
          topGap: Math.round(data.plyr.top - data.media.top),
          width: Math.round(data.plyr.width),
          height: Math.round(data.plyr.height),
        },
        document: {
          scrollHeight: Math.round(data.bodyScrollHeight),
        },
        timeline: {
          top: Math.round(data.timeline.top),
          bottom: Math.round(data.timeline.bottom),
          height: Math.round(data.timeline.height),
        },
        transcript: {
          top: Math.round(data.transcriptPanel.top),
          width: Math.round(data.transcriptPanel.width),
          scrollable: data.transcriptBody.scrollHeight > data.transcriptBody.clientHeight,
        },
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("=== EDITOR LAYOUT SMOKE ===");
  console.log(JSON.stringify({ measurements }, null, 2));
  console.log("EDITOR LAYOUT PASS");
})().catch((err) => {
  console.error("RUNNER ERROR", err);
  process.exit(2);
});
