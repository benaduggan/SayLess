/**
 * End-to-end harness for the real transcription engine with local assets only.
 *
 * This is developer regression coverage for the same provider path the extension
 * uses: src/transcription + bundled Whisper model assets + local ORT files. It
 * intentionally avoids remote model and fixture downloads.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const webpack = require("webpack");

const ROOT = path.resolve(__dirname, "..", "..");
const ASSET_ROOT = path.join(ROOT, "src");
const ORT_SRC = path.join(ROOT, "node_modules/@huggingface/transformers/dist");
const HOST = "127.0.0.1";
const MAX_TRANSCRIPTION_MS = 120000;
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
};

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "transcription.entry.mjs"),
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

const createServer = (work) =>
  http.createServer((req, res) => {
    const rawPath = decodeURIComponent(req.url.split("?")[0]);
    if (rawPath === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const relativePath = rawPath === "/" ? "harness.html" : rawPath.slice(1);
    const root = relativePath.startsWith("assets/") ? ASSET_ROOT : work;
    const file = path.resolve(root, relativePath);
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
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

const copyOrtFiles = (work) => {
  const ortDir = path.join(work, "ort");
  fs.mkdirSync(ortDir);
  for (const fileName of fs.readdirSync(ORT_SRC).filter((name) => /^ort-wasm-/.test(name))) {
    fs.copyFileSync(path.join(ORT_SRC, fileName), path.join(ortDir, fileName));
  }
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-asr-local-"));
  await bundleHarness(work);
  copyOrtFiles(work);
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Local ASR harness</title><pre id=o>loading</pre><script type=module src=./bundle.js></script>",
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
  page.on("console", (message) => console.log("  [page]", message.type(), message.text()));
  page.on("pageerror", (error) => console.log("  [pageerror]", error.message));

  let result;
  try {
    await page.goto(`${origin}/harness.html`);
    await page.waitForFunction("window.ST_READY === true", { timeout: 30000 });
    result = await page.evaluate(async (baseUrl) => {
      const makeToneWav = (seconds = 1.4, sampleRate = 16000) => {
        const sampleCount = Math.round(seconds * sampleRate);
        const dataBytes = sampleCount * 2;
        const buffer = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(buffer);
        const writeAscii = (offset, text) => {
          for (let i = 0; i < text.length; i += 1) {
            view.setUint8(offset + i, text.charCodeAt(i));
          }
        };
        writeAscii(0, "RIFF");
        view.setUint32(4, 36 + dataBytes, true);
        writeAscii(8, "WAVE");
        writeAscii(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeAscii(36, "data");
        view.setUint32(40, dataBytes, true);
        for (let i = 0; i < sampleCount; i += 1) {
          const t = i / sampleRate;
          const envelope = Math.sin(Math.PI * Math.min(1, t / seconds));
          const sample = Math.sin(2 * Math.PI * 440 * t) * envelope * 0.18;
          view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
        }
        return new Blob([buffer], { type: "audio/wav" });
      };

      const progress = [];
      const startedAt = performance.now();
      const transcript = await window.ST.transcribe(
        {
          blob: makeToneWav(),
          language: "en",
          onProgress: (value) => progress.push(Number(value) || 0),
        },
        {
          providerId: "local-whisper",
          privacyMode: true,
          defaultLanguage: "en",
          providerOptions: {
            "local-whisper": {
              allowRemoteModels: false,
              localModelPath: `${baseUrl}/assets/whisper/models/`,
              model: "onnx-community/whisper-base_timestamped",
              wasmPaths: `${baseUrl}/ort/`,
              device: "wasm",
            },
          },
        },
      );
      const words = Array.isArray(transcript.words) ? transcript.words : [];
      return {
        durationMs: Math.round(performance.now() - startedAt),
        providerId: transcript.providerId,
        language: transcript.language,
        textLength: String(transcript.text || "").length,
        wordCount: words.length,
        timestampsMonotonic: words.every(
          (word, index) => index === 0 || word.start >= words[index - 1].start - 0.001,
        ),
        maxProgress: progress.length ? Math.max(...progress) : 0,
      };
    }, origin);
  } finally {
    await browser.close();
    server.close();
  }

  console.log("=== LOCAL TRANSCRIPTION HARNESS ===");
  console.log(JSON.stringify(result, null, 2));

  const ok =
    result.providerId === "local-whisper" &&
    result.timestampsMonotonic === true &&
    result.maxProgress >= 1 &&
    result.durationMs <= MAX_TRANSCRIPTION_MS;
  console.log(ok ? "LOCAL ASR HARNESS PASS" : "LOCAL ASR HARNESS FAIL");
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error("RUNNER ERROR", error);
  process.exit(2);
});
