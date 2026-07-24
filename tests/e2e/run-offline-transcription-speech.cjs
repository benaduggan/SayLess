/**
 * Slow real-speech offline Whisper harness.
 *
 * Generates temporary spoken WAV fixtures locally with macOS `say` +
 * `afconvert`, serves them with the bundled Whisper model and local ORT files,
 * and verifies the transcription engine recognizes expected words without
 * remote model downloads. The noisy fixture mixes deterministic low background
 * noise into the same speech so the release gate covers more than ideal audio.
 */
const { chromium } = require("@playwright/test");
const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const webpack = require("webpack");

const ROOT = path.resolve(__dirname, "..", "..");
const ASSET_ROOT = path.join(ROOT, "src");
const ORT_SRC = path.join(ROOT, "node_modules/@huggingface/transformers/dist");
const HOST = "127.0.0.1";
const SPEECH_TEXT = "hello offline recording";
const EXPECTED_WORDS = ["hello", "offline", "recording"];
const LONG_SPEECH_TEXT =
  "local editing keeps recordings offline [[slnc 700]] export transcript timeline";
const LONG_EXPECTED_WORDS = [
  "local",
  "editing",
  "recordings",
  "offline",
  "export",
  "transcript",
  "timeline",
];
const MAX_DURATION_MS = 180000;
const NOISY_SPEECH_FILE = "speech-noisy.wav";
const LONG_SPEECH_FILE = "speech-long.wav";
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
};

const commandExists = (command) => {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const generateSpeechFixture = (work) => {
  if (process.platform !== "darwin" || !commandExists("say") || !commandExists("afconvert")) {
    throw new Error("offline speech transcription harness requires macOS `say` and `afconvert`.");
  }
  const aiffPath = path.join(work, "speech.aiff");
  const wavPath = path.join(work, "speech.wav");
  execFileSync("say", ["-v", "Alex", "-o", aiffPath, SPEECH_TEXT]);
  execFileSync("afconvert", [
    aiffPath,
    "-o",
    wavPath,
    "-f",
    "WAVE",
    "-d",
    "LEI16@16000",
    "-c",
    "1",
  ]);
  const stat = fs.statSync(wavPath);
  if (stat.size < 1000) {
    throw new Error(`generated speech fixture is unexpectedly small: ${stat.size} bytes`);
  }
  generateNoisySpeechFixture(wavPath, path.join(work, NOISY_SPEECH_FILE));
  generateLongSpeechFixture(work);
  return wavPath;
};

const generateLongSpeechFixture = (work) => {
  const aiffPath = path.join(work, "speech-long.aiff");
  const wavPath = path.join(work, LONG_SPEECH_FILE);
  execFileSync("say", ["-v", "Alex", "-o", aiffPath, LONG_SPEECH_TEXT]);
  execFileSync("afconvert", [
    aiffPath,
    "-o",
    wavPath,
    "-f",
    "WAVE",
    "-d",
    "LEI16@16000",
    "-c",
    "1",
  ]);
  const stat = fs.statSync(wavPath);
  if (stat.size < 1000) {
    throw new Error(`generated long speech fixture is unexpectedly small: ${stat.size} bytes`);
  }
};

const readPcm16Wav = (wavPath) => {
  const buffer = fs.readFileSync(wavPath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`unsupported WAV header: ${wavPath}`);
  }

  let offset = 12;
  let fmt = null;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (id === "data") {
      dataStart = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }

  if (!fmt || fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`expected mono PCM16 WAV fixture: ${wavPath}`);
  }
  if (dataStart < 0 || dataSize <= 0) {
    throw new Error(`missing WAV data chunk: ${wavPath}`);
  }

  return {
    sampleRate: fmt.sampleRate,
    samples: new Int16Array(buffer.buffer, buffer.byteOffset + dataStart, Math.floor(dataSize / 2)),
  };
};

const writePcm16Wav = (wavPath, { sampleRate, samples }) => {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  fs.writeFileSync(wavPath, buffer);
};

const generateNoisySpeechFixture = (sourcePath, targetPath) => {
  const { sampleRate, samples } = readPcm16Wav(sourcePath);
  const noisy = new Int16Array(samples.length);
  let seed = 0x5eed1234;
  const randomCentered = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };

  for (let i = 0; i < samples.length; i += 1) {
    const time = i / sampleRate;
    const roomTone =
      Math.sin(time * Math.PI * 2 * 180) * 900 + Math.sin(time * Math.PI * 2 * 330) * 450;
    const broadband = randomCentered() * 650;
    const mixed = Math.round(samples[i] * 0.92 + roomTone + broadband);
    noisy[i] = Math.max(-32768, Math.min(32767, mixed));
  }

  writePcm16Wav(targetPath, { sampleRate, samples: noisy });
};

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "offline-transcription-smoke.entry.mjs"),
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

const copyOrtFiles = (work) => {
  const ortDir = path.join(work, "ort");
  fs.mkdirSync(ortDir);
  for (const fileName of fs.readdirSync(ORT_SRC).filter((name) => name.startsWith("ort-wasm-"))) {
    fs.copyFileSync(path.join(ORT_SRC, fileName), path.join(ortDir, fileName));
  }
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-offline-asr-speech-"));
  await bundleHarness(work);
  copyOrtFiles(work);
  generateSpeechFixture(work);
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Offline speech transcription</title><script type=module src=./bundle.js></script>",
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
    await page.waitForFunction("window.OFFLINE_TRANSCRIPTION_SMOKE_READY === true", {
      timeout: 30000,
    });
    result = await page.evaluate(async (baseUrl) => {
      const options = {
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
      };
      const transcribeFixture = async (fileName) => {
        const response = await fetch(`${baseUrl}/${fileName}`);
        if (!response.ok) {
          throw new Error(`${fileName} fixture fetch failed: ${response.status}`);
        }
        const blob = await response.blob();
        const progress = [];
        const startedAt = performance.now();
        const transcript = await window.OFFLINE_TRANSCRIPTION_SMOKE.transcribe(
          {
            blob,
            language: "en",
            onProgress: (value) => progress.push(Number(value) || 0),
          },
          options,
        );
        const words = Array.isArray(transcript.words) ? transcript.words : [];
        return {
          fileName,
          durationMs: Math.round(performance.now() - startedAt),
          text: words.map((word) => word.text).join(" "),
          wordCount: words.length,
          words: words.map((word) => ({
            text: word.text,
            start: Number(word.start),
            end: Number(word.end),
          })),
          providerId: transcript.providerId,
          language: transcript.language,
          maxProgress: progress.length ? Math.max(...progress) : 0,
        };
      };

      return {
        clean: await transcribeFixture("speech.wav"),
        noisy: await transcribeFixture("speech-noisy.wav"),
        longClean: await transcribeFixture("speech-long.wav"),
      };
    }, origin);
  } finally {
    await browser.close();
    server.close();
  }

  const summarize = (
    fixture,
    {
      expectedText = SPEECH_TEXT,
      expectedWords = EXPECTED_WORDS,
      minMatchedWords = 2,
      maxWordEndLimit = 12,
      minWordEnd = 0,
    } = {},
  ) => {
    const normalizedText = String(fixture.text || "").toLowerCase();
    const matchedWords = expectedWords.filter((word) => normalizedText.includes(word));
    const words = Array.isArray(fixture.words) ? fixture.words : [];
    const timedWords = words.filter(
      (word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.start >= 0 &&
        word.end > word.start,
    );
    const monotonicTiming = timedWords.every(
      (word, index) => index === 0 || word.start >= timedWords[index - 1].start,
    );
    const maxWordEnd = timedWords.length ? Math.max(...timedWords.map((word) => word.end)) : 0;
    return {
      ...fixture,
      expectedText,
      matchedWords,
      timedWordCount: timedWords.length,
      monotonicTiming,
      maxWordEnd,
      timingOk:
        timedWords.length >= matchedWords.length &&
        monotonicTiming &&
        maxWordEnd > minWordEnd &&
        maxWordEnd < maxWordEndLimit,
      ok:
        fixture.providerId === "local-whisper" &&
        fixture.wordCount > 0 &&
        timedWords.length >= matchedWords.length &&
        monotonicTiming &&
        maxWordEnd > minWordEnd &&
        maxWordEnd < maxWordEndLimit &&
        fixture.maxProgress >= 1 &&
        fixture.durationMs <= MAX_DURATION_MS &&
        matchedWords.length >= minMatchedWords,
    };
  };
  const summary = {
    clean: summarize(result.clean),
    noisy: summarize(result.noisy),
    longClean: summarize(result.longClean, {
      expectedText: LONG_SPEECH_TEXT.replace(/\s*\[\[slnc\s+\d+\]\]\s*/i, " "),
      expectedWords: LONG_EXPECTED_WORDS,
      minMatchedWords: 5,
      minWordEnd: 3,
      maxWordEndLimit: 20,
    }),
  };
  const ok = summary.clean.ok && summary.noisy.ok && summary.longClean.ok;

  console.log("=== OFFLINE TRANSCRIPTION SPEECH ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(ok ? "OFFLINE TRANSCRIPTION SPEECH PASS" : "OFFLINE TRANSCRIPTION SPEECH FAIL");
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error("RUNNER ERROR", error);
  process.exit(2);
});
