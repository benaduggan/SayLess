/**
 * E2E harness for local recording persistence.
 *
 * Verifies:
 * - multiple recordings register into a local-only index
 * - list sorting returns all local recordings
 * - edited blobs are checkpointed separately from originals
 * - checkpointed edits survive closing and reopening the editor tab
 * - local project state preserves transcript/timeline data across reopen
 * - local project sidecars export/import transcript/timeline data
 * - transcript JSON and WebVTT sidecars export from saved projects
 * - local transcript cache can save, reuse, and delete transcript results
 * - recordings can be duplicated and exported from the local library
 * - local video files can be imported and reopened
 * - missing local media is inspectable and repairable
 * - orphaned local media can be detected and cleaned up
 * - recordings can be bulk-exported and bulk-deleted
 * - storage pressure levels are classified for quota warnings
 * - thumbnails persist in local recording metadata
 * - transcript-driven timeline edits survive reopen and render into export output
 * - timeline video/audio renders abort late and can immediately retry
 * - a 180-second repeated-source timeline cancels late and fully retries
 * - a multi-megabyte high-entropy source cancels late and fully retries
 * - post-render WebM/GIF conversions cancel without delivery and retry successfully
 * - timeline-rendered M4A audio exports can be decoded for local silence analysis
 * - zoom-rendered export framing is verified in browser across wide, square, and portrait video
 * - non-destructive crop metadata persists and renders expected output pixels/dimensions
 * - content-addressed project audio survives duplication/reopen and supports sidecar relinking
 * - actual MP3 project audio decodes and renders through the local mixer
 * - non-destructive project audio renders locally, aborts late, and retries
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const webpack = require("webpack");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".mp3": "audio/mpeg",
};

const bundleHarness = (work) =>
  new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        entry: path.join(__dirname, "local-recordings.entry.mjs"),
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
        experiments: {
          topLevelAwait: true,
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
                .join("\n")
            )
          );
          return;
        }
        resolve();
      }
    );
  });

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sl-local-recordings-"));
  const HOST = "127.0.0.1";

  await bundleHarness(work);
  fs.copyFileSync(
    path.join(ROOT, "src", "assets", "sounds", "beep.mp3"),
    path.join(work, "project-audio.mp3")
  );
  const gifWorkerDir = path.join(work, "assets", "vendor", "gif.js");
  fs.mkdirSync(gifWorkerDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "node_modules", "gif.js", "dist", "gif.worker.js"),
    path.join(gifWorkerDir, "gif.worker.js")
  );
  fs.writeFileSync(
    path.join(work, "harness.html"),
    "<!doctype html><meta charset=utf-8><title>Local recordings harness</title><script type=module src=./bundle.js></script>"
  );

  const server = http.createServer((req, res) => {
    const f = path.join(
      work,
      req.url === "/" ? "/harness.html" : req.url.split("?")[0]
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
  const forceTimelineAacUnsupported =
    process.env.SAYLESS_TEST_FORCE_AAC_UNSUPPORTED === "1";
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(harnessUrl);
  await page.waitForFunction("window.LOCAL_RECORDINGS_READY === true", {
    timeout: 30000,
  });

  const result = await page.evaluate(async (forceAacUnsupported) => {
    localStorage.clear();
    indexedDB.deleteDatabase("local-recordings");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const lib = window.LOCAL_RECORDINGS;
    const transcriptCache = window.TRANSCRIPT_CACHE;
    const blobText = async (blob) => await blob.text();
    const genEditableRecording = async (
      sec = 4,
      {
        includeAudio = true,
        fps = 30,
        width = 320,
        height = 180,
        videoBitsPerSecond,
        complexFrames = false,
      } = {}
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const video = canvas.captureStream(fps);
      let ac = null;
      let osc = null;
      let audioDest = null;
      if (includeAudio) {
        ac = new AudioContext();
        osc = ac.createOscillator();
        const t0 = ac.currentTime;
        osc.frequency.setValueAtTime(300, t0);
        osc.frequency.setValueAtTime(900, t0 + 1.2);
        osc.frequency.setValueAtTime(500, t0 + 2.7);
        audioDest = ac.createMediaStreamDestination();
        osc.connect(audioDest);
        osc.start();
      }
      const stream = new MediaStream(
        includeAudio
          ? [...video.getVideoTracks(), ...audioDest.stream.getAudioTracks()]
          : [...video.getVideoTracks()]
      );
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm",
        ...(videoBitsPerSecond ? { videoBitsPerSecond } : {}),
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const start = performance.now();
      let frameNumber = 0;
      const draw = () => {
        const elapsed = (performance.now() - start) / 1000;
        if (complexFrames) {
          let seed = (frameNumber++ + 1) * 2654435761;
          const blockSize = 24;
          for (let y = 0; y < canvas.height; y += blockSize) {
            for (let x = 0; x < canvas.width; x += blockSize) {
              seed = (seed * 1664525 + 1013904223) >>> 0;
              ctx.fillStyle = `rgb(${seed & 255},${(seed >>> 8) & 255},${
                (seed >>> 16) & 255
              })`;
              ctx.fillRect(x, y, blockSize, blockSize);
            }
          }
        } else {
          ctx.fillStyle =
            elapsed < 1.2 ? "#1457ff" : elapsed < 2.7 ? "#e04747" : "#138a45";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#fff";
          ctx.font = "24px sans-serif";
          ctx.fillText(
            elapsed < 1.2 ? "keep" : elapsed < 2.7 ? "remove" : "tail",
            24,
            96
          );
        }
        if (elapsed < sec) requestAnimationFrame(draw);
      };
      recorder.start();
      draw();
      await new Promise((resolve) => setTimeout(resolve, sec * 1000 + 200));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      if (osc) osc.stop();
      if (ac) await ac.close();
      stream.getTracks().forEach((track) => track.stop());
      return new Blob(chunks, { type: "video/webm" });
    };
    const browserCanEncodeTimelineAac = async () => {
      if (forceAacUnsupported) return false;
      if (
        typeof AudioEncoder === "undefined" ||
        typeof AudioEncoder.isConfigSupported !== "function" ||
        typeof AudioData === "undefined"
      ) {
        return false;
      }
      const config = {
        codec: "mp4a.40.2",
        bitrate: 192000,
        numberOfChannels: 2,
        sampleRate: 48000,
      };
      let encoder = null;
      try {
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported !== true) return false;

        let encodedChunks = 0;
        let encodeError = null;
        encoder = new AudioEncoder({
          output: () => {
            encodedChunks += 1;
          },
          error: (error) => {
            encodeError = error;
          },
        });
        encoder.configure(config);
        const sample = new AudioData({
          format: "f32-planar",
          sampleRate: config.sampleRate,
          numberOfFrames: 1024,
          numberOfChannels: config.numberOfChannels,
          timestamp: 0,
          data: new Float32Array(1024 * config.numberOfChannels),
        });
        encoder.encode(sample);
        sample.close();
        await encoder.flush();
        return encodeError === null && encodedChunks > 0;
      } catch {
        return false;
      } finally {
        if (encoder && encoder.state !== "closed") encoder.close();
      }
    };
    const genSilenceAudioRecording = async (sec = 3.2) => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const audioDest = ac.createMediaStreamDestination();
      const t0 = ac.currentTime;
      osc.frequency.setValueAtTime(440, t0);
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.setValueAtTime(0.25, t0 + 0.9);
      gain.gain.setValueAtTime(0, t0 + 1);
      gain.gain.setValueAtTime(0, t0 + 2.15);
      gain.gain.setValueAtTime(0.25, t0 + 2.25);
      osc.connect(gain);
      gain.connect(audioDest);
      const recorder = new MediaRecorder(audioDest.stream, {
        mimeType: "audio/webm",
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start();
      osc.start();
      await new Promise((resolve) => setTimeout(resolve, sec * 1000));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      osc.stop();
      await ac.close();
      audioDest.stream.getTracks().forEach((track) => track.stop());
      return new Blob(chunks, { type: "audio/webm" });
    };
    const makeWavBlob = (samples, sampleRate = 16000) => {
      const bytesPerSample = 2;
      const dataSize = samples.length * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeString = (offset, value) => {
        for (let i = 0; i < value.length; i += 1) {
          view.setUint8(offset + i, value.charCodeAt(i));
        }
      };

      writeString(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * bytesPerSample, true);
      view.setUint16(32, bytesPerSample, true);
      view.setUint16(34, 8 * bytesPerSample, true);
      writeString(36, "data");
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (const sample of samples) {
        const clamped = Math.max(-1, Math.min(1, Number(sample) || 0));
        view.setInt16(offset, Math.round(clamped * 32767), true);
        offset += bytesPerSample;
      }

      return new Blob([buffer], { type: "audio/wav" });
    };
    const isUnsupportedAudioEncoderError = (err) =>
      /encoder configuration/i.test(String(err?.message || err)) &&
      /not supported by this browser/i.test(String(err?.message || err));
    const renderM4aAudioIfSupported = async (...args) => {
      try {
        return {
          blob: await window.RENDER_TIMELINE_AUDIO(...args),
          unsupportedReason: "",
        };
      } catch (err) {
        if (isUnsupportedAudioEncoderError(err)) {
          return {
            blob: null,
            unsupportedReason: String(err?.message || err),
          };
        }
        throw err;
      }
    };
    const genNoisyRoomAudioRecording = () => {
      const sampleRate = 16000;
      const durationSeconds = 4;
      const samples = new Float32Array(sampleRate * durationSeconds);
      let seed = 12345;
      const noise = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xffffffff - 0.5;
      };

      for (let i = 0; i < samples.length; i += 1) {
        const time = i / sampleRate;
        const inQuietRoomPause = time >= 1 && time < 2.35;
        const tone = inQuietRoomPause
          ? 0
          : Math.sin(time * Math.PI * 2 * 260) * 0.12;
        const roomNoise = noise() * (inQuietRoomPause ? 0.0015 : 0.018);
        samples[i] = tone + roomNoise;
      }

      return makeWavBlob(samples, sampleRate);
    };
    const genQuadrantVideoRecording = async (
      sec = 1.2,
      { width = 320, height = 180 } = {}
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks = [];
      const draw = () => {
        const halfW = Math.floor(width / 2);
        const halfH = Math.floor(height / 2);
        ctx.fillStyle = "#f00000";
        ctx.fillRect(0, 0, halfW, halfH);
        ctx.fillStyle = "#0048ff";
        ctx.fillRect(halfW, 0, width - halfW, halfH);
        ctx.fillStyle = "#00a33a";
        ctx.fillRect(0, halfH, halfW, height - halfH);
        ctx.fillStyle = "#ffd400";
        ctx.fillRect(halfW, halfH, width - halfW, height - halfH);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start();
      const start = performance.now();
      const tick = () => {
        draw();
        if ((performance.now() - start) / 1000 < sec) {
          requestAnimationFrame(tick);
        }
      };
      tick();
      await new Promise((resolve) => setTimeout(resolve, sec * 1000 + 200));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      stream.getTracks().forEach((track) => track.stop());
      return new Blob(chunks, { type: "video/webm" });
    };
    const sampleVideoPixel = (
      blob,
      { time = 0.4, xRatio = 0.5, yRatio = 0.5 } = {}
    ) =>
      new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(blob);
        const cleanup = () => {
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
        };
        const fail = (err) => {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        };
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = () => {
          const seekTo = Math.min(
            Math.max(0, time),
            Math.max(0, (Number(video.duration) || time) - 0.05)
          );
          video.currentTime = seekTo;
        };
        video.onseeked = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const x = Math.min(
              canvas.width - 1,
              Math.max(0, Math.round(canvas.width * xRatio))
            );
            const y = Math.min(
              canvas.height - 1,
              Math.max(0, Math.round(canvas.height * yRatio))
            );
            const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
            cleanup();
            resolve({ r, g, b, a, width: canvas.width, height: canvas.height });
          } catch (err) {
            fail(err);
          }
        };
        video.onerror = () => fail(new Error("video-pixel-sample-failed"));
        video.src = url;
      });
    const readVideoMetadata = (blob) =>
      new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(blob);
        const cleanup = () => {
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
        };
        video.onloadedmetadata = () => {
          const metadata = {
            duration: Number(video.duration) || 0,
            width: video.videoWidth,
            height: video.videoHeight,
          };
          cleanup();
          resolve(metadata);
        };
        video.onerror = () => {
          cleanup();
          reject(new Error("video-metadata-read-failed"));
        };
        video.src = url;
      });
    const opfsSupported =
      navigator.storage && typeof navigator.storage.getDirectory === "function";
    if (opfsSupported) {
      const dir = await navigator.storage.getDirectory();
      for await (const [name] of dir.entries()) {
        if (name.startsWith("recording-")) {
          await dir.removeEntry(name).catch(() => {});
        }
      }
    }

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
    await lib.registerLocalRecording({
      id: "rec-missing",
      title: "Missing media",
      durationMs: 3000,
      createdAt: 3000,
    });
    const editSourceBlob = await genEditableRecording(4);
    await lib.registerLocalRecording({
      id: "rec-transcript-flow",
      title: "Transcript workflow",
      blob: editSourceBlob,
      durationMs: 4000,
      createdAt: 2500,
    });
    const editTranscript = {
      version: 1,
      language: "en",
      providerId: "local-whisper",
      words: [
        { text: "keep", start: 0.25, end: 0.9 },
        { text: "remove", start: 1.35, end: 2.35 },
        { text: "tail", start: 3.05, end: 3.65 },
      ],
    };
    const editAudioBefore = await window.TRANSCRIPTION_AUDIO.blobToMono16k(
      editSourceBlob
    );
    let transcriptTimeline = window.LOCAL_TIMELINE.createTimeline(
      editAudioBefore.duration
    );
    const deleteRange = window.TRANSCRIPT_EDIT.wordRange(
      editTranscript.words,
      1,
      1
    );
    transcriptTimeline = window.LOCAL_TIMELINE.deleteSourceRange(
      transcriptTimeline,
      deleteRange.start,
      deleteRange.end
    );
    await lib.saveLocalRecordingProject("rec-transcript-flow", {
      source: {
        duration: editAudioBefore.duration,
        mimeType: editSourceBlob.type,
        byteSize: editSourceBlob.size,
      },
      timeline: transcriptTimeline,
      transcript: editTranscript,
      selectedClipId: transcriptTimeline.clips[0]?.id || null,
      exportSettings: { format: "mp4", includeCaptionSidecar: true },
    });
    const reopenedTranscriptProject = await lib.getLocalRecordingProject(
      "rec-transcript-flow"
    );
    const transcriptFlowCaption = await lib.getLocalRecordingCaptionExport(
      "rec-transcript-flow"
    );
    const transcriptFlowVtt = await transcriptFlowCaption.blob.text();
    const timelineAacSupported = await browserCanEncodeTimelineAac();
    const transcriptRenderSourceBlob = timelineAacSupported
      ? await lib.readLocalRecordingBlob(
          (
            await lib.getLocalRecordingIndex()
          )["rec-transcript-flow"]
        )
      : await genEditableRecording(4, { includeAudio: false });
    const resolvedTranscriptSegments = window.LOCAL_TIMELINE.resolveTimeline(
      reopenedTranscriptProject.timeline
    ).segments;
    const transcriptFlowExpectedDuration = resolvedTranscriptSegments.reduce(
      (duration, segment) =>
        duration + Math.max(0, segment.sourceEnd - segment.sourceStart),
      0
    );
    const transcriptFlowExport = await window.RENDER_TIMELINE(
      transcriptRenderSourceBlob,
      resolvedTranscriptSegments
    );
    const abortVideoController = new AbortController();
    let abortVideoProgressCount = 0;
    let abortVideoMaxProgress = 0;
    let abortVideoErrorName = null;
    try {
      await window.RENDER_TIMELINE(
        transcriptRenderSourceBlob,
        resolvedTranscriptSegments,
        (progress) => {
          abortVideoProgressCount += 1;
          abortVideoMaxProgress = Math.max(abortVideoMaxProgress, progress);
          if (progress >= 0.35) abortVideoController.abort();
        },
        { signal: abortVideoController.signal }
      );
    } catch (err) {
      abortVideoErrorName = err?.name || String(err);
    }
    const longTimelineSource = await genEditableRecording(1.2, {
      includeAudio: false,
      fps: 2,
    });
    const longTimelineSegments = Array.from({ length: 150 }, () => ({
      sourceStart: 0,
      sourceEnd: 1.2,
      muted: false,
    }));
    const longTimelineAbortController = new AbortController();
    let longTimelineAbortMaxProgress = 0;
    let longTimelineAbortErrorName = null;
    const longTimelineAbortStartedAt = performance.now();
    try {
      await window.RENDER_TIMELINE(
        longTimelineSource,
        longTimelineSegments,
        (progress) => {
          longTimelineAbortMaxProgress = Math.max(
            longTimelineAbortMaxProgress,
            progress
          );
          if (progress >= 0.25) longTimelineAbortController.abort();
        },
        { signal: longTimelineAbortController.signal }
      );
    } catch (error) {
      longTimelineAbortErrorName = error?.name || String(error);
    }
    const longTimelineAbortElapsedMs =
      performance.now() - longTimelineAbortStartedAt;
    const longTimelineRetryStartedAt = performance.now();
    const longTimelineRetry = await window.RENDER_TIMELINE(
      longTimelineSource,
      longTimelineSegments
    );
    const longTimelineRetryElapsedMs =
      performance.now() - longTimelineRetryStartedAt;
    const longTimelineRetryMetadata = await readVideoMetadata(
      longTimelineRetry
    );
    const largeSourceBlob = await genEditableRecording(5, {
      includeAudio: false,
      width: 960,
      height: 540,
      videoBitsPerSecond: 12_000_000,
      complexFrames: true,
    });
    const largeSourceMetadata = await readVideoMetadata(largeSourceBlob);
    const largeSourceSegments = [
      {
        sourceStart: 0,
        sourceEnd: Math.min(5, largeSourceMetadata.duration),
        muted: false,
      },
    ];
    const largeSourceAbortController = new AbortController();
    let largeSourceAbortMaxProgress = 0;
    let largeSourceAbortErrorName = null;
    const largeSourceAbortStartedAt = performance.now();
    try {
      await window.RENDER_TIMELINE(
        largeSourceBlob,
        largeSourceSegments,
        (progress) => {
          largeSourceAbortMaxProgress = Math.max(
            largeSourceAbortMaxProgress,
            progress
          );
          if (progress >= 0.35) largeSourceAbortController.abort();
        },
        { signal: largeSourceAbortController.signal }
      );
    } catch (error) {
      largeSourceAbortErrorName = error?.name || String(error);
    }
    const largeSourceAbortElapsedMs =
      performance.now() - largeSourceAbortStartedAt;
    const largeSourceRetryStartedAt = performance.now();
    const largeSourceRetry = await window.RENDER_TIMELINE(
      largeSourceBlob,
      largeSourceSegments
    );
    const largeSourceRetryElapsedMs =
      performance.now() - largeSourceRetryStartedAt;
    const largeSourceRetryMetadata = await readVideoMetadata(largeSourceRetry);
    const retryVideoExport = await window.RENDER_TIMELINE(
      transcriptRenderSourceBlob,
      resolvedTranscriptSegments
    );
    const loadImageSize = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        image.onerror = () => reject(new Error("image-load-failed"));
        image.src = src;
      });
    const sampleImageCenterPixel = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("image-canvas-unavailable"));
            return;
          }
          context.drawImage(image, 0, 0);
          const x = Math.max(0, Math.floor(image.naturalWidth / 2));
          const y = Math.max(0, Math.floor(image.naturalHeight / 2));
          const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
            r,
            g,
            b,
            a,
          });
        };
        image.onerror = () => reject(new Error("image-load-failed"));
        image.src = src;
      });
    const generatedThumbnailEntry = await lib.generateLocalRecordingThumbnail(
      "rec-transcript-flow",
      { timeoutMs: 5000 }
    );
    const generatedThumbnailDataUrl =
      generatedThumbnailEntry?.thumbnailDataUrl || "";
    const generatedThumbnailSize = generatedThumbnailDataUrl
      ? await loadImageSize(generatedThumbnailDataUrl)
      : null;
    const generatedThumbnailCenterPixel = generatedThumbnailDataUrl
      ? await sampleImageCenterPixel(generatedThumbnailDataUrl)
      : null;
    const captionBurnInExport = await window.RENDER_TIMELINE(
      transcriptRenderSourceBlob,
      resolvedTranscriptSegments,
      undefined,
      {
        captions: [{ start: 0.1, end: 0.8, text: "caption smoke" }],
        captionStyle: { preset: "high-contrast" },
        zoomKeyframes: [
          {
            time: 0.1,
            durationSeconds: 0.8,
            scale: 1.5,
            xRatio: 0.25,
            yRatio: 0.75,
          },
        ],
      }
    );
    const transcriptFlowAudioExport = await window.RENDER_TIMELINE_AUDIO(
      await lib.readLocalRecordingBlob(
        (
          await lib.getLocalRecordingIndex()
        )["rec-transcript-flow"]
      ),
      window.LOCAL_TIMELINE.resolveTimeline(reopenedTranscriptProject.timeline)
        .segments,
      undefined,
      { format: "wav" }
    );
    const transcriptFlowM4aResult = await renderM4aAudioIfSupported(
      await lib.readLocalRecordingBlob(
        (
          await lib.getLocalRecordingIndex()
        )["rec-transcript-flow"]
      ),
      window.LOCAL_TIMELINE.resolveTimeline(reopenedTranscriptProject.timeline)
        .segments,
      undefined,
      { format: "m4a" }
    );
    const editAudioAfter = timelineAacSupported
      ? await window.TRANSCRIPTION_AUDIO.blobToMono16k(transcriptFlowExport)
      : { duration: transcriptFlowExpectedDuration };
    const silenceAudioBlob = await genSilenceAudioRecording();
    const decodedSilenceAudio = await window.TRANSCRIPTION_AUDIO.blobToMono16k(
      silenceAudioBlob
    );
    const browserAudioSilenceSuggestions =
      window.EDL_SUGGESTIONS.buildAudioSilenceSuggestions(
        {
          sampleRate: decodedSilenceAudio.sampleRate,
          channels: [decodedSilenceAudio.pcm],
        },
        {
          frameSeconds: 0.05,
          minSilenceSeconds: 0.8,
          paddingSeconds: 0.05,
          silenceThresholdDb: -45,
        }
      );
    const silenceAudioM4aResult = await renderM4aAudioIfSupported(
      silenceAudioBlob,
      [{ sourceStart: 0, sourceEnd: decodedSilenceAudio.duration }],
      undefined,
      { format: "m4a" }
    );
    const decodedSilenceAudioM4a = silenceAudioM4aResult.blob
      ? await window.TRANSCRIPTION_AUDIO.blobToMono16k(
          silenceAudioM4aResult.blob
        )
      : null;
    const m4aAudioSilenceSuggestions = decodedSilenceAudioM4a
      ? window.EDL_SUGGESTIONS.buildAudioSilenceSuggestions(
          {
            sampleRate: decodedSilenceAudioM4a.sampleRate,
            channels: [decodedSilenceAudioM4a.pcm],
          },
          {
            frameSeconds: 0.05,
            minSilenceSeconds: 0.8,
            paddingSeconds: 0.05,
            silenceThresholdDb: -45,
          }
        )
      : [];
    const abortAudioController = new AbortController();
    let abortAudioProgressCount = 0;
    let abortAudioMaxProgress = 0;
    let abortAudioErrorName = null;
    let retryAudioExportBytes = 0;
    if (!silenceAudioM4aResult.unsupportedReason) {
      try {
        await window.RENDER_TIMELINE_AUDIO(
          silenceAudioBlob,
          [{ sourceStart: 0, sourceEnd: decodedSilenceAudio.duration }],
          (progress) => {
            abortAudioProgressCount += 1;
            abortAudioMaxProgress = Math.max(abortAudioMaxProgress, progress);
            if (progress >= 0.35) abortAudioController.abort();
          },
          { format: "m4a", signal: abortAudioController.signal }
        );
      } catch (err) {
        abortAudioErrorName = err?.name || String(err);
      }
      retryAudioExportBytes = (
        await window.RENDER_TIMELINE_AUDIO(
          silenceAudioBlob,
          [{ sourceStart: 0, sourceEnd: decodedSilenceAudio.duration }],
          undefined,
          { format: "m4a" }
        )
      ).size;
    } else {
      abortAudioErrorName = "UnsupportedAudioEncoder";
    }
    const noisyRoomAudioBlob = genNoisyRoomAudioRecording();
    const decodedNoisyRoomAudio =
      await window.TRANSCRIPTION_AUDIO.blobToMono16k(noisyRoomAudioBlob);
    const noisyRoomSilenceSuggestions =
      window.EDL_SUGGESTIONS.buildAudioSilenceSuggestions(
        {
          sampleRate: decodedNoisyRoomAudio.sampleRate,
          channels: [decodedNoisyRoomAudio.pcm],
        },
        {
          frameSeconds: 0.05,
          minSilenceSeconds: 0.8,
          paddingSeconds: 0.05,
          silenceThresholdDb: -42,
        }
      );
    const renderZoomFixture = async ({ width, height }) => {
      const blob = await genQuadrantVideoRecording(1.2, { width, height });
      const rendered = await window.RENDER_TIMELINE(
        blob,
        [{ sourceStart: 0, sourceEnd: 1 }],
        undefined,
        {
          zoomKeyframes: [
            {
              time: 0,
              durationSeconds: 1,
              scale: 2,
              xRatio: 0.85,
              yRatio: 0.85,
            },
          ],
        }
      );
      return {
        bytes: rendered.size,
        centerPixel: await sampleVideoPixel(rendered, {
          time: 0.35,
          xRatio: 0.5,
          yRatio: 0.5,
        }),
      };
    };
    const zoomWide = await renderZoomFixture({ width: 320, height: 180 });
    const zoomSquare = await renderZoomFixture({ width: 240, height: 240 });
    const zoomPortrait = await renderZoomFixture({ width: 180, height: 320 });
    const cropSource = await genQuadrantVideoRecording(1.2, {
      width: 320,
      height: 180,
    });
    const cropRendered = await window.RENDER_TIMELINE(
      cropSource,
      [{ sourceStart: 0, sourceEnd: 1 }],
      undefined,
      {
        crop: {
          xRatio: 0.5,
          yRatio: 0.5,
          widthRatio: 0.5,
          heightRatio: 0.5,
        },
      }
    );
    const cropCenterPixel = await sampleVideoPixel(cropRendered, {
      time: 0.35,
      xRatio: 0.5,
      yRatio: 0.5,
    });
    const cropZoomRendered = await window.RENDER_TIMELINE(
      cropSource,
      [{ sourceStart: 0, sourceEnd: 1 }],
      undefined,
      {
        crop: {
          xRatio: 0.4,
          yRatio: 0.2,
          widthRatio: 0.5,
          heightRatio: 0.6,
        },
        zoomKeyframes: [
          {
            time: 0,
            durationSeconds: 1,
            scale: 4,
            xRatio: 0.45,
            yRatio: 0.35,
          },
        ],
      }
    );
    const cropZoomCenterPixel = await sampleVideoPixel(cropZoomRendered, {
      time: 0.35,
      xRatio: 0.5,
      yRatio: 0.5,
    });
    await lib.checkpointEditedLocalRecording(
      "rec-a",
      new Blob(["first-edited"], { type: "video/mp4" })
    );
    const migratedProjectExport = await lib.getLocalRecordingProjectExport(
      "rec-a"
    );
    const migratedProjectSidecar = JSON.parse(
      await migratedProjectExport.blob.text()
    );
    const migratedProject = await lib.getLocalRecordingProject("rec-a");

    const newest = await lib.listLocalRecordings({ sortBy: "newest" });
    const alpha = await lib.listLocalRecordings({ sortBy: "alphabetical" });
    const firstEntry = newest.find((item) => item.id === "rec-a");
    const editedBeforeClose = await blobText(
      await lib.readLocalRecordingBlob(firstEntry)
    );
    await lib.renameLocalRecording("rec-b", "Beta renamed");
    const projectAudioSamples = new Float32Array(16000);
    for (let index = 0; index < projectAudioSamples.length; index += 1) {
      projectAudioSamples[index] =
        Math.sin((index / 16000) * Math.PI * 2 * 440) * 0.35;
    }
    const projectAudioBlob = makeWavBlob(projectAudioSamples);
    const projectAudioTrack = await lib.saveLocalRecordingAudioAsset(
      "rec-b",
      projectAudioBlob,
      {
        fileName: "Project tone.wav",
        volume: 0.8,
        sourceVolume: 0.7,
        mode: "replace",
      }
    );
    class PreviewVideoFake extends EventTarget {
      currentTime = 6.5;
      volume = 0.8;
      playbackRate = 1;
      paused = false;
    }
    class PreviewAudioFake extends EventTarget {
      currentTime = 0;
      duration = 1.5;
      volume = 1;
      playbackRate = 1;
      loop = false;
      paused = true;
      preload = "";
      playCalls = 0;
      pauseCalls = 0;
      async play() {
        this.playCalls += 1;
        this.paused = false;
      }
      pause() {
        this.pauseCalls += 1;
        this.paused = true;
      }
    }
    const previewVideo = new PreviewVideoFake();
    const previewAudio = new PreviewAudioFake();
    const revokedPreviewUrls = [];
    const previewController = window.ATTACH_PROJECT_AUDIO_PREVIEW({
      video: previewVideo,
      audioAsset: projectAudioBlob,
      audioTrack: {
        ...projectAudioTrack,
        mode: "mix",
        sourceVolume: 0.4,
        loop: true,
      },
      timeline: {
        version: 2,
        source: { duration: 8 },
        clips: [
          { id: "late", sourceStart: 6, sourceEnd: 8, muted: false },
          { id: "early", sourceStart: 0, sourceEnd: 2, muted: false },
        ],
      },
      createObjectURL: () => "blob:project-audio-preview-proof",
      revokeObjectURL: (url) => revokedPreviewUrls.push(url),
      createAudio: () => previewAudio,
    });
    const previewSourceVolume = previewVideo.volume;
    previewVideo.dispatchEvent(new Event("play"));
    const previewAfterPlay = {
      currentTime: previewAudio.currentTime,
      playCalls: previewAudio.playCalls,
    };
    previewVideo.currentTime = 3;
    previewVideo.dispatchEvent(new Event("seeking"));
    const previewInDeletedGap = previewAudio.currentTime;
    previewVideo.currentTime = 0.5;
    previewVideo.dispatchEvent(new Event("seeking"));
    const previewAfterReorderedSeek = previewAudio.currentTime;
    previewVideo.playbackRate = 1.5;
    previewVideo.dispatchEvent(new Event("ratechange"));
    const previewPlaybackRate = previewAudio.playbackRate;
    previewVideo.paused = true;
    previewVideo.dispatchEvent(new Event("pause"));
    const previewPauseCallsBeforeDispose = previewAudio.pauseCalls;
    previewController.dispose();
    const previewRestoredVolume = previewVideo.volume;
    const previewPauseCallsAfterDispose = previewAudio.pauseCalls;
    const previewPlayCallsBeforeDetachedEvent = previewAudio.playCalls;
    previewVideo.paused = false;
    previewVideo.dispatchEvent(new Event("play"));
    const projectAudioPreviewController = {
      previewSourceVolume,
      previewAfterPlay,
      previewInDeletedGap,
      previewAfterReorderedSeek,
      previewPlaybackRate,
      previewPauseCallsBeforeDispose,
      previewPauseCallsAfterDispose,
      previewRestoredVolume,
      revokedPreviewUrls,
      detachedPlayListener:
        previewAudio.playCalls === previewPlayCallsBeforeDetachedEvent,
    };
    await lib.saveLocalRecordingProject("rec-b", {
      source: {
        duration: 2,
        mimeType: "video/mp4",
        byteSize: secondOriginal.size,
      },
      timeline: {
        version: 2,
        source: { duration: 2 },
        clips: [
          { id: "clip-a", sourceStart: 0, sourceEnd: 0.8, muted: false },
          { id: "clip-b", sourceStart: 1.1, sourceEnd: 2, muted: true },
        ],
      },
      transcript: {
        version: 1,
        language: "en",
        providerId: "local-whisper",
        words: [
          { text: "hello", start: 0.1, end: 0.4 },
          { text: "offline", start: 1.2, end: 1.7 },
        ],
      },
      chapterMarkers: [
        { id: "chapter-start", time: 0, label: "Hello", source: "start" },
        {
          id: "chapter-audio",
          time: 1.1,
          label: "Offline",
          source: "audio-silence",
        },
      ],
      zoomKeyframes: [
        {
          id: "zoom-click",
          time: 0.75,
          durationSeconds: 2,
          scale: 1.6,
          xRatio: 0.25,
          yRatio: 0.75,
          label: "Click zoom",
          source: "click",
        },
      ],
      crop: {
        xRatio: 0.1,
        yRatio: 0.2,
        widthRatio: 0.75,
        heightRatio: 0.65,
      },
      audioTrack: projectAudioTrack,
      selectedClipId: "clip-b",
      exportSettings: {
        format: "gif",
        qualityPreset: "compressed",
        includeProjectSidecar: true,
        includeTranscriptSidecar: true,
        includeCaptionSidecar: true,
        captionStyle: { preset: "high-contrast", burnIn: true },
        gif: { startSeconds: 0.25, durationSeconds: 20, fps: 60, width: 2400 },
      },
    });
    const projectSidecarExport = await lib.getLocalRecordingProjectExport(
      "rec-b"
    );
    const projectSidecar = JSON.parse(await projectSidecarExport.blob.text());
    const projectAudioBeforeClear = await lib.readLocalRecordingAudioAsset(
      "rec-b",
      projectAudioTrack
    );
    await lib.clearLocalRecordingProject("rec-b");
    const projectAfterClear = await lib.getLocalRecordingProject("rec-b");
    let projectAudioAfterClearError = null;
    try {
      await lib.readLocalRecordingAudioAsset("rec-b", projectAudioTrack);
    } catch (error) {
      projectAudioAfterClearError = String(error?.message || error);
    }
    await lib.importLocalRecordingProjectSidecar(
      new File(
        [JSON.stringify(projectSidecar)],
        projectSidecarExport.fileName,
        { type: "application/json" }
      )
    );
    const restoredProject = await lib.getLocalRecordingProject("rec-b");
    let importedAudioMissingError = null;
    try {
      await lib.readLocalRecordingAudioAsset(
        "rec-b",
        restoredProject.audioTrack
      );
    } catch (error) {
      importedAudioMissingError = String(error?.message || error);
    }
    const relinkedAudioTrack = await lib.saveLocalRecordingAudioAsset(
      "rec-b",
      projectAudioBlob,
      {
        fileName: "Project tone.wav",
        volume: restoredProject.audioTrack.volume,
        sourceVolume: restoredProject.audioTrack.sourceVolume,
        mode: restoredProject.audioTrack.mode,
      }
    );
    await lib.saveLocalRecordingProject("rec-b", {
      ...restoredProject,
      audioTrack: relinkedAudioTrack,
    });
    const projectAudioTimelineVideo = await window.RENDER_TIMELINE(
      transcriptRenderSourceBlob,
      resolvedTranscriptSegments
    );
    const runEditorExportOp = async (message, cancelAt = null) => {
      let maxProgress = 0;
      let lastProgress = 0;
      let progressMonotonic = true;
      let cancelled = false;
      let deliveryType = null;
      let deliveryDataUrl = "";
      await window.EDITOR_OPS.runEditorOp(message, (reply) => {
        if (reply.type === "ffmpeg-progress") {
          const progress = Math.max(
            0,
            Math.min(1, Number(reply.progress) / 100)
          );
          if (progress + 0.0001 < lastProgress) progressMonotonic = false;
          lastProgress = progress;
          maxProgress = Math.max(maxProgress, progress);
          if (!cancelled && cancelAt != null && progress >= cancelAt) {
            cancelled = true;
            window.EDITOR_OPS.cancelEditorExports();
          }
        }
        if (reply.type === "download-webm" || reply.type === "download-gif") {
          deliveryType = reply.type;
          deliveryDataUrl = String(reply.base64 || "");
        }
      });
      return {
        maxProgress,
        progressMonotonic,
        cancelled,
        deliveryType,
        deliveryDataUrlPrefix: deliveryDataUrl.slice(0, 32),
        deliveryDataUrlBytes: deliveryDataUrl.length,
      };
    };
    const cancelledPostRenderWebm = await runEditorExportOp(
      { type: "to-webm", blob: largeSourceRetry },
      0.25
    );
    const retriedPostRenderWebm = await runEditorExportOp({
      type: "to-webm",
      blob: largeSourceRetry,
    });
    const gifExportOptions = {
      startSeconds: 0,
      durationSeconds: 1,
      fps: 8,
      width: 320,
    };
    const cancelledPostRenderGif = await runEditorExportOp(
      {
        type: "to-gif",
        blob: largeSourceRetry,
        options: gifExportOptions,
      },
      0.25
    );
    const retriedPostRenderGif = await runEditorExportOp({
      type: "to-gif",
      blob: largeSourceRetry,
      options: gifExportOptions,
    });
    const mp3ProjectAudioResponse = await fetch("/project-audio.mp3");
    if (!mp3ProjectAudioResponse.ok) {
      throw new Error(
        `project-audio-mp3-fetch-${mp3ProjectAudioResponse.status}`
      );
    }
    const mp3ProjectAudioBlob = await mp3ProjectAudioResponse.blob();
    const mp3ProjectAudioProbe = await window.VALIDATE_PROJECT_AUDIO(
      mp3ProjectAudioBlob
    );
    let mp3ProjectAudioRenderedBytes = 0;
    let mp3ProjectAudioRms = null;
    let m4aProjectAudioProbe = null;
    let m4aProjectAudioRenderedBytes = 0;
    let m4aProjectAudioRms = null;
    if (silenceAudioM4aResult.blob) {
      m4aProjectAudioProbe = await window.VALIDATE_PROJECT_AUDIO(
        silenceAudioM4aResult.blob
      );
    }
    let corruptProjectAudioError = null;
    try {
      await window.VALIDATE_PROJECT_AUDIO(
        new Blob(["not encoded audio"], { type: "audio/mpeg" })
      );
    } catch (error) {
      corruptProjectAudioError = String(error?.message || error);
    }
    const rmsWindow = (decoded, startSeconds, endSeconds) => {
      const start = Math.max(0, Math.floor(startSeconds * decoded.sampleRate));
      const end = Math.min(
        decoded.pcm.length,
        Math.ceil(endSeconds * decoded.sampleRate)
      );
      if (end <= start) return 0;
      let sum = 0;
      for (let index = start; index < end; index += 1) {
        sum += decoded.pcm[index] * decoded.pcm[index];
      }
      return Math.sqrt(sum / (end - start));
    };
    let projectAudioRenderedBytes = 0;
    let projectAudioRenderedType = "";
    let projectAudioDuration = null;
    let projectAudioRms = null;
    let projectAudioNonLoopLateRms = null;
    let projectAudioLoopLateRms = null;
    let projectAudioMixRms = null;
    let projectAudioReplaceRms = null;
    let abortProjectAudioErrorName = null;
    let abortProjectAudioMaxProgress = 0;
    let retryProjectAudioExportBytes = 0;
    if (timelineAacSupported) {
      const mp3ProjectAudioRendered = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        mp3ProjectAudioBlob,
        { ...projectAudioTrack, mode: "replace", volume: 1, loop: true }
      );
      const decodedMp3ProjectAudio =
        await window.TRANSCRIPTION_AUDIO.blobToMono16k(mp3ProjectAudioRendered);
      mp3ProjectAudioRenderedBytes = mp3ProjectAudioRendered.size;
      mp3ProjectAudioRms = Math.sqrt(
        decodedMp3ProjectAudio.pcm.reduce(
          (sum, sample) => sum + sample * sample,
          0
        ) / Math.max(1, decodedMp3ProjectAudio.pcm.length)
      );
      if (silenceAudioM4aResult.blob) {
        const m4aProjectAudioRendered = await window.MIX_PROJECT_AUDIO(
          projectAudioTimelineVideo,
          silenceAudioM4aResult.blob,
          { ...projectAudioTrack, mode: "replace", volume: 1 }
        );
        const decodedM4aProjectAudio =
          await window.TRANSCRIPTION_AUDIO.blobToMono16k(
            m4aProjectAudioRendered
          );
        m4aProjectAudioRenderedBytes = m4aProjectAudioRendered.size;
        m4aProjectAudioRms = Math.sqrt(
          decodedM4aProjectAudio.pcm.reduce(
            (sum, sample) => sum + sample * sample,
            0
          ) / Math.max(1, decodedM4aProjectAudio.pcm.length)
        );
      }
      const projectAudioRendered = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        projectAudioBlob,
        projectAudioTrack
      );
      const decodedProjectAudio =
        await window.TRANSCRIPTION_AUDIO.blobToMono16k(projectAudioRendered);
      projectAudioRenderedBytes = projectAudioRendered.size;
      projectAudioRenderedType = projectAudioRendered.type;
      projectAudioDuration = decodedProjectAudio.duration;
      projectAudioRms = Math.sqrt(
        decodedProjectAudio.pcm.reduce(
          (sum, sample) => sum + sample * sample,
          0
        ) / Math.max(1, decodedProjectAudio.pcm.length)
      );
      projectAudioNonLoopLateRms = rmsWindow(decodedProjectAudio, 1.6, 2.6);
      const loopedProjectAudioRendered = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        projectAudioBlob,
        { ...projectAudioTrack, loop: true }
      );
      const decodedLoopedProjectAudio =
        await window.TRANSCRIPTION_AUDIO.blobToMono16k(
          loopedProjectAudioRendered
        );
      projectAudioLoopLateRms = rmsWindow(decodedLoopedProjectAudio, 1.6, 2.6);
      const silentProjectAudioBlob = makeWavBlob(new Float32Array(16000));
      const mixRendered = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        silentProjectAudioBlob,
        {
          ...projectAudioTrack,
          mode: "mix",
          sourceVolume: 0.5,
          volume: 1,
          loop: true,
        }
      );
      const replaceRendered = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        silentProjectAudioBlob,
        {
          ...projectAudioTrack,
          mode: "replace",
          volume: 1,
          loop: true,
        }
      );
      const [decodedMix, decodedReplace] = await Promise.all([
        window.TRANSCRIPTION_AUDIO.blobToMono16k(mixRendered),
        window.TRANSCRIPTION_AUDIO.blobToMono16k(replaceRendered),
      ]);
      projectAudioMixRms = rmsWindow(decodedMix, 0.25, 0.9);
      projectAudioReplaceRms = rmsWindow(decodedReplace, 0.25, 0.9);
      const abortProjectAudioController = new AbortController();
      try {
        await window.MIX_PROJECT_AUDIO(
          projectAudioTimelineVideo,
          projectAudioBlob,
          projectAudioTrack,
          (progress) => {
            abortProjectAudioMaxProgress = Math.max(
              abortProjectAudioMaxProgress,
              progress
            );
            if (progress >= 0.9) abortProjectAudioController.abort();
          },
          abortProjectAudioController.signal
        );
      } catch (error) {
        abortProjectAudioErrorName = error?.name || String(error);
      }
      const retryProjectAudioExport = await window.MIX_PROJECT_AUDIO(
        projectAudioTimelineVideo,
        projectAudioBlob,
        projectAudioTrack
      );
      retryProjectAudioExportBytes = retryProjectAudioExport.size;
    }
    const transcriptExport = await lib.getLocalRecordingTranscriptExport(
      "rec-b"
    );
    const transcriptSidecar = JSON.parse(await transcriptExport.blob.text());
    const captionExport = await lib.getLocalRecordingCaptionExport("rec-b");
    const captionVtt = await captionExport.blob.text();
    const transcriptCacheMetadata =
      await transcriptCache.buildTranscriptCacheMetadata({
        blob: secondOriginal,
        recordingId: "rec-b",
        config: {
          providerId: "local-whisper",
          providerOptions: {
            "local-whisper": { model: "test-whisper" },
          },
        },
        language: "en",
      });
    await transcriptCache.saveCachedTranscript(transcriptCacheMetadata.key, {
      ...transcriptCacheMetadata,
      transcript: restoredProject.transcript,
    });
    const cachedTranscript = await transcriptCache.getCachedTranscript(
      transcriptCacheMetadata.key
    );
    await transcriptCache.deleteCachedTranscript(transcriptCacheMetadata.key);
    const cachedAfterDelete = await transcriptCache.getCachedTranscript(
      transcriptCacheMetadata.key
    );
    const duplicate = await lib.duplicateLocalRecording("rec-b");
    const duplicateBlobText = await blobText(
      await lib.readLocalRecordingBlob(duplicate)
    );
    const duplicateProject = await lib.getLocalRecordingProject(duplicate.id);
    const duplicateInspection = await lib.inspectLocalRecording(duplicate.id);
    const exportPackage = await lib.getLocalRecordingExport(duplicate.id);
    const exportedText = await blobText(exportPackage.blob);
    const storageEstimate = await lib.estimateLocalRecordingStorage();
    const missingInspection = await lib.inspectLocalRecording("rec-missing");
    const repairResult = await lib.repairLocalRecording("rec-missing");
    const missingAfterRepair = await lib.inspectLocalRecording("rec-missing");
    const imported = await lib.importLocalRecordingFile(
      new File(["imported-original"], "Imported Demo.webm"),
      { createdAt: 4000 }
    );
    const importedText = await blobText(
      await lib.readLocalRecordingBlob(imported)
    );
    const importedExport = await lib.getLocalRecordingExport(imported.id);
    const importedExportText = await blobText(importedExport.blob);
    const thumbnailDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwU9WQAAAABJRU5ErkJggg==";
    const thumbnailEntry = await lib.saveLocalRecordingThumbnail(
      imported.id,
      thumbnailDataUrl
    );
    const invalidGeneratedThumbnail = await lib.generateLocalRecordingThumbnail(
      imported.id,
      { timeoutMs: 250 }
    );
    await lib.registerLocalRecording({
      id: "rec-orphan",
      title: "Orphaned blob",
      blob: new Blob(["orphaned-original"], { type: "video/mp4" }),
      durationMs: 4000,
      createdAt: 5000,
    });
    const indexWithOrphan = await lib.getLocalRecordingIndex();
    delete indexWithOrphan["rec-orphan"];
    await chrome.storage.local.set({
      localRecordingLibraryIndex: indexWithOrphan,
    });
    let opfsOrphanFileName = null;
    if (opfsSupported) {
      opfsOrphanFileName = "recording-orphan-opfs.webm";
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle(opfsOrphanFileName, {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(
        new Blob(["x".repeat(5000)], { type: "video/webm" })
      );
      await writable.close();
    }
    const orphanInspection = await lib.inspectLocalRecordingStorage();
    const cleanupResult = await lib.cleanupLocalRecordingStorage();
    const orphanAfterCleanup = await lib.inspectLocalRecordingStorage();
    await lib.registerLocalRecording({
      id: "rec-bulk-a",
      title: "Bulk A",
      blob: new Blob(["bulk-a"], { type: "video/mp4" }),
      durationMs: 1000,
      createdAt: 6000,
    });
    await lib.registerLocalRecording({
      id: "rec-bulk-b",
      title: "Bulk B",
      blob: new Blob(["bulk-b"], { type: "video/webm" }),
      durationMs: 1000,
      createdAt: 7000,
    });
    const bulkExports = await lib.getLocalRecordingExports([
      "rec-bulk-a",
      "rec-bulk-b",
    ]);
    const bulkProjectExports = await lib.getLocalRecordingProjectExports([
      "rec-bulk-a",
      "rec-bulk-b",
    ]);
    const bulkExportTexts = [];
    for (const item of bulkExports) {
      bulkExportTexts.push(await blobText(item.blob));
    }
    const bulkDeleteResult = await lib.deleteLocalRecordings([
      "rec-bulk-a",
      "rec-bulk-b",
      "rec-bulk-missing",
    ]);
    const afterBulkDelete = await lib.listLocalRecordings({ sortBy: "newest" });
    const pressureUnknown = lib.classifyLocalRecordingStoragePressure({
      usage: null,
      quota: null,
    });
    const pressureNormal = lib.classifyLocalRecordingStoragePressure({
      usage: 50,
      quota: 100,
    });
    const pressureNearLimit = lib.classifyLocalRecordingStoragePressure({
      usage: 80,
      quota: 100,
    });
    const pressureCritical = lib.classifyLocalRecordingStoragePressure({
      usage: 95,
      quota: 100,
    });
    const exportJobState = window.EXPORT_JOB_STATE;
    const exportPanelState = window.EXPORT_PANEL_STATE;
    const exportLifecycleSnapshots = [];
    let exportState = { downloading: true, lastExportDownloadId: 99 };
    exportState = exportJobState.beginExportJobState(
      exportState,
      { kind: "mp4", label: "MP4 export" },
      1000
    );
    exportLifecycleSnapshots.push({
      name: "running-start",
      id: exportState.exportJob.id,
      status: exportState.exportJob.status,
      title: exportPanelState.buildExportJobTitle(exportState.exportJob),
      description: exportPanelState.buildExportJobDescription(
        exportState.exportJob,
        exportState.processingProgress
      ),
      canRetry: exportPanelState.canRetryExportJob(exportState.exportJob),
      canReveal: exportPanelState.canRevealExportJob(
        exportState.exportJob,
        exportState.lastExportDownloadId
      ),
      lastExportDownloadId: exportState.lastExportDownloadId,
    });
    exportState = exportJobState.updateExportJobProgressState(
      exportState,
      42.4
    );
    exportLifecycleSnapshots.push({
      name: "running-progress",
      status: exportState.exportJob.status,
      progress: exportState.exportJob.progress,
      description: exportPanelState.buildExportJobDescription(
        exportState.exportJob,
        exportState.processingProgress
      ),
    });
    exportState = exportJobState.cancelExportJobState(exportState, 2000);
    const retrySnapshot = exportPanelState.buildRetryExportSettings(
      {
        format: "gif",
        qualityPreset: "compressed",
        includeProjectSidecar: true,
        includeTranscriptSidecar: true,
        includeCaptionSidecar: true,
        audioOnly: true,
        audioFormat: "m4a",
        captionStyle: { preset: "high-contrast", burnIn: true },
        gif: { startSeconds: 0.25, durationSeconds: 2.5, fps: 24, width: 640 },
      },
      exportState.exportJob
    );
    exportLifecycleSnapshots.push({
      name: "cancelled",
      status: exportState.exportJob.status,
      progress: exportState.exportJob.progress,
      canCancel: exportState.exportJob.canCancel,
      canRetry: exportPanelState.canRetryExportJob(exportState.exportJob),
      retrySnapshot,
      downloading: exportState.downloading,
      downloadingGIF: exportState.downloadingGIF,
      processingProgress: exportState.processingProgress,
      title: exportPanelState.buildExportJobTitle(exportState.exportJob),
      description: exportPanelState.buildExportJobDescription(
        exportState.exportJob
      ),
    });
    exportState = exportJobState.beginExportJobState(
      exportState,
      { kind: "mp4", label: "MP4 export" },
      3000
    );
    exportState = exportJobState.finishExportJobState(
      { ...exportState, lastExportDownloadId: 321 },
      { status: "completed" },
      4000
    );
    exportLifecycleSnapshots.push({
      name: "completed",
      status: exportState.exportJob.status,
      progress: exportState.exportJob.progress,
      canRetry: exportPanelState.canRetryExportJob(exportState.exportJob),
      canReveal: exportPanelState.canRevealExportJob(
        exportState.exportJob,
        exportState.lastExportDownloadId
      ),
      title: exportPanelState.buildExportJobTitle(exportState.exportJob),
      description: exportPanelState.buildExportJobDescription(
        exportState.exportJob
      ),
      completionFromSaved: exportPanelState.buildExportCompletionFromSaveResult(
        {
          saved: true,
          downloadId: 321,
        }
      ),
      completionFromCancelled:
        exportPanelState.buildExportCompletionFromSaveResult({
          reason: "cancelled",
        }),
    });
    const exportStateAfterDismiss =
      exportJobState.dismissExportJobState(exportState);
    await lib.deleteLocalRecording("rec-a");
    const afterActions = await lib.listLocalRecordings({ sortBy: "newest" });
    const savedProject = await lib.getLocalRecordingProject("rec-b");
    let deletedReadError = null;
    try {
      await lib.readLocalRecordingBlob(firstEntry);
    } catch (err) {
      deletedReadError = String(err?.message || err);
    }

    return {
      newestIds: newest.map((item) => item.id),
      alphaIds: alpha.map((item) => item.id),
      transcriptFlowClipCount:
        reopenedTranscriptProject?.timeline?.clips?.length || 0,
      transcriptFlowDeletedWordPresent: transcriptFlowVtt.includes("remove"),
      transcriptFlowKeptWordsPresent:
        transcriptFlowVtt.includes("keep") &&
        transcriptFlowVtt.includes("tail"),
      transcriptFlowDurationBefore: editAudioBefore.duration,
      transcriptFlowDurationAfter: editAudioAfter.duration,
      timelineAacSupported,
      abortVideoProgressCount,
      abortVideoMaxProgress,
      abortVideoErrorName,
      longTimelineSegmentCount: longTimelineSegments.length,
      longTimelinePlannedDuration: longTimelineSegments.reduce(
        (duration, segment) =>
          duration + segment.sourceEnd - segment.sourceStart,
        0
      ),
      longTimelineAbortMaxProgress,
      longTimelineAbortErrorName,
      longTimelineAbortElapsedMs,
      longTimelineRetryBytes: longTimelineRetry.size,
      longTimelineRetryElapsedMs,
      longTimelineRetryMetadata,
      largeSourceBytes: largeSourceBlob.size,
      largeSourceMetadata,
      largeSourceAbortMaxProgress,
      largeSourceAbortErrorName,
      largeSourceAbortElapsedMs,
      largeSourceRetryBytes: largeSourceRetry.size,
      largeSourceRetryElapsedMs,
      largeSourceRetryMetadata,
      retryVideoExportBytes: retryVideoExport.size,
      captionBurnInExportBytes: captionBurnInExport.size,
      transcriptFlowAudioExportBytes: transcriptFlowAudioExport.size,
      transcriptFlowAudioExportType: transcriptFlowAudioExport.type,
      transcriptFlowM4aExportBytes: transcriptFlowM4aResult.blob?.size || 0,
      transcriptFlowM4aExportType: transcriptFlowM4aResult.blob?.type || "",
      transcriptFlowM4aUnsupportedReason:
        transcriptFlowM4aResult.unsupportedReason,
      browserAudioSilenceCount: browserAudioSilenceSuggestions.length,
      browserAudioSilenceStart: Number(
        (browserAudioSilenceSuggestions[0]?.start || 0).toFixed(2)
      ),
      browserAudioSilenceEnd: Number(
        (browserAudioSilenceSuggestions[0]?.end || 0).toFixed(2)
      ),
      browserAudioSilenceLabel: browserAudioSilenceSuggestions[0]?.label || "",
      m4aAudioSilenceExportBytes: silenceAudioM4aResult.blob?.size || 0,
      m4aAudioSilenceExportType: silenceAudioM4aResult.blob?.type || "",
      m4aAudioSilenceUnsupportedReason: silenceAudioM4aResult.unsupportedReason,
      m4aAudioSilenceDuration: Number(
        (decodedSilenceAudioM4a?.duration || 0).toFixed(2)
      ),
      m4aAudioSilenceCount: m4aAudioSilenceSuggestions.length,
      m4aAudioSilenceStart: Number(
        (m4aAudioSilenceSuggestions[0]?.start || 0).toFixed(2)
      ),
      m4aAudioSilenceEnd: Number(
        (m4aAudioSilenceSuggestions[0]?.end || 0).toFixed(2)
      ),
      m4aAudioSilenceLabel: m4aAudioSilenceSuggestions[0]?.label || "",
      abortAudioProgressCount,
      abortAudioMaxProgress,
      abortAudioErrorName,
      retryAudioExportBytes,
      noisyRoomSilenceCount: noisyRoomSilenceSuggestions.length,
      noisyRoomSilenceStart: Number(
        (noisyRoomSilenceSuggestions[0]?.start || 0).toFixed(2)
      ),
      noisyRoomSilenceEnd: Number(
        (noisyRoomSilenceSuggestions[0]?.end || 0).toFixed(2)
      ),
      noisyRoomSilenceLabel: noisyRoomSilenceSuggestions[0]?.label || "",
      zoomRenderedBytes: zoomWide.bytes,
      zoomCenterPixel: zoomWide.centerPixel,
      zoomSquareRenderedBytes: zoomSquare.bytes,
      zoomSquareCenterPixel: zoomSquare.centerPixel,
      zoomPortraitRenderedBytes: zoomPortrait.bytes,
      zoomPortraitCenterPixel: zoomPortrait.centerPixel,
      cropRenderedBytes: cropRendered.size,
      cropCenterPixel,
      cropZoomRenderedBytes: cropZoomRendered.size,
      cropZoomCenterPixel,
      projectAudioRenderedBytes,
      projectAudioRenderedType,
      projectAudioPreviewController,
      cancelledPostRenderWebm,
      retriedPostRenderWebm,
      cancelledPostRenderGif,
      retriedPostRenderGif,
      mp3ProjectAudioType: mp3ProjectAudioBlob.type,
      mp3ProjectAudioProbe,
      mp3ProjectAudioRenderedBytes,
      mp3ProjectAudioRms,
      m4aProjectAudioProbe,
      m4aProjectAudioRenderedBytes,
      m4aProjectAudioRms,
      corruptProjectAudioError,
      projectAudioDuration,
      projectAudioRms,
      projectAudioNonLoopLateRms,
      projectAudioLoopLateRms,
      projectAudioMixRms,
      projectAudioReplaceRms,
      abortProjectAudioErrorName,
      abortProjectAudioMaxProgress,
      retryProjectAudioExportBytes,
      editedBeforeClose,
      afterActionIds: afterActions.map((item) => item.id),
      duplicateId: duplicate.id,
      duplicateTitle: duplicate.title,
      duplicateBlobText,
      migratedProjectFileName: migratedProjectExport.fileName,
      migratedProjectSidecarRecordingId: migratedProjectSidecar.recording?.id,
      migratedProjectClipCount: migratedProject?.timeline?.clips?.length,
      migratedProjectDuration: migratedProject?.source?.duration,
      projectSidecarFileName: projectSidecarExport.fileName,
      projectSidecarKind: projectSidecar.kind,
      projectSidecarRecordingId: projectSidecar.recording?.id,
      projectSidecarSchemaVersion: projectSidecar.project?.version,
      projectSidecarExportFormat:
        projectSidecar.project?.exportSettings?.format,
      projectSidecarExportQuality:
        projectSidecar.project?.exportSettings?.qualityPreset,
      projectSidecarGifDuration:
        projectSidecar.project?.exportSettings?.gif?.durationSeconds,
      projectSidecarGifFps: projectSidecar.project?.exportSettings?.gif?.fps,
      projectSidecarChapterLabels: projectSidecar.project?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      projectSidecarZoomLabels: projectSidecar.project?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      projectSidecarCrop: projectSidecar.project?.crop,
      projectSidecarAudioTrack: projectSidecar.project?.audioTrack,
      projectAudioBeforeClearBytes: projectAudioBeforeClear.size,
      projectAudioAfterClearError,
      importedAudioMissingError,
      relinkedAudioAssetId: relinkedAudioTrack.assetId,
      projectAfterClear,
      restoredProjectClipIds: restoredProject?.timeline?.clips?.map(
        (clip) => clip.id
      ),
      restoredProjectChapterLabels: restoredProject?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      restoredProjectZoomLabels: restoredProject?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      restoredProjectCrop: restoredProject?.crop,
      restoredProjectAudioTrack: restoredProject?.audioTrack,
      restoredProjectTranscriptText: restoredProject?.transcript?.words
        ?.map((word) => word.text)
        .join(" "),
      restoredProjectExportFormat: restoredProject?.exportSettings?.format,
      restoredProjectCaptionStyle:
        restoredProject?.exportSettings?.captionStyle?.preset,
      transcriptExportFileName: transcriptExport.fileName,
      transcriptSidecarKind: transcriptSidecar.kind,
      transcriptTimelineAwareText: transcriptSidecar.timelineAwareWords
        ?.map((word) => word.text)
        .join(" "),
      captionExportFileName: captionExport.fileName,
      captionVtt,
      generatedThumbnailIsJpeg:
        generatedThumbnailDataUrl.startsWith("data:image/jpeg"),
      generatedThumbnailWidth: generatedThumbnailSize?.width || 0,
      generatedThumbnailHeight: generatedThumbnailSize?.height || 0,
      generatedThumbnailAspect:
        generatedThumbnailSize?.width && generatedThumbnailSize?.height
          ? Number(
              (
                generatedThumbnailSize.width / generatedThumbnailSize.height
              ).toFixed(3)
            )
          : 0,
      generatedThumbnailCenterPixel,
      transcriptCacheKeyIncludesLanguage:
        transcriptCacheMetadata.key.includes("en"),
      cachedTranscriptText: cachedTranscript?.transcript?.words
        ?.map((word) => word.text)
        .join(" "),
      cachedAfterDelete,
      duplicateProjectRecordingId: duplicateProject?.recordingId,
      duplicateProjectClipIds: duplicateProject?.timeline?.clips?.map(
        (clip) => clip.id
      ),
      duplicateProjectChapterLabels: duplicateProject?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      duplicateProjectZoomLabels: duplicateProject?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      duplicateProjectCrop: duplicateProject?.crop,
      duplicateProjectAudioTrack: duplicateProject?.audioTrack,
      duplicateProjectAudioBytes: duplicateProject?.audioTrack
        ? (
            await lib.readLocalRecordingAudioAsset(
              duplicate.id,
              duplicateProject.audioTrack
            )
          ).size
        : 0,
      duplicateProjectExportFormat: duplicateProject?.exportSettings?.format,
      duplicateInspectionStatus: duplicateInspection.status,
      duplicateInspectionOk: duplicateInspection.ok,
      exportFileName: exportPackage.fileName,
      exportedText,
      storageCount: storageEstimate.count,
      storageIndexedBytes: storageEstimate.indexedBytes,
      missingInspectionOk: missingInspection.ok,
      missingInspectionStatus: missingInspection.status,
      repairResultRepaired: repairResult.repaired,
      missingAfterRepairStatus: missingAfterRepair.status,
      importedId: imported.id,
      importedTitle: imported.title,
      importedMimeType: imported.mimeType,
      importedMetaSource: imported.recordingMeta?.source,
      importedText,
      importedExportFileName: importedExport.fileName,
      importedExportText,
      thumbnailPersisted: thumbnailEntry.thumbnailDataUrl === thumbnailDataUrl,
      invalidGeneratedThumbnail,
      orphanCount: orphanInspection.orphanCount,
      orphanBlobKeys: orphanInspection.orphanBlobKeys,
      orphanOpfsFileNames: orphanInspection.orphanOpfsFileNames,
      opfsOrphanFileName,
      opfsCleanupSupported: opfsSupported,
      cleanupRemovedCount: cleanupResult.removedCount,
      cleanupRemovedOpfsFileNames: cleanupResult.removedOpfsFileNames,
      orphanCountAfterCleanup: orphanAfterCleanup.orphanCount,
      bulkExportFileNames: bulkExports.map((item) => item.fileName),
      bulkExportTexts,
      bulkProjectExportFileNames: bulkProjectExports.map(
        (item) => item.fileName
      ),
      bulkDeleteCount: bulkDeleteResult.deletedCount,
      bulkDeleteResultIds: bulkDeleteResult.results.map((item) => item.id),
      bulkIdsAfterDelete: afterBulkDelete
        .map((item) => item.id)
        .filter((id) => id.startsWith("rec-bulk")),
      pressureUnknownLevel: pressureUnknown.level,
      pressureNormalLevel: pressureNormal.level,
      pressureNearLimitLevel: pressureNearLimit.level,
      pressureCriticalLevel: pressureCritical.level,
      pressureCriticalRatio: pressureCritical.ratio,
      exportLifecycleSnapshots,
      exportLifecycleDismissed: exportStateAfterDismiss.exportJob === null,
      renamedTitle: afterActions.find((item) => item.id === "rec-b")?.title,
      projectClipIds: savedProject?.timeline?.clips?.map((clip) => clip.id),
      projectSelectedClipId: savedProject?.selectedClipId,
      projectTranscriptText: savedProject?.transcript?.words
        ?.map((word) => word.text)
        .join(" "),
      projectChapterLabels: savedProject?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      projectZoomLabels: savedProject?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      projectCrop: savedProject?.crop,
      projectAudioTrack: savedProject?.audioTrack,
      projectExportSettings: savedProject?.exportSettings,
      deletedReadError,
      _sidecarProbeExports: [
        {
          fileName: projectSidecarExport.fileName,
          text: JSON.stringify(projectSidecar, null, 2),
        },
        {
          fileName: transcriptExport.fileName,
          text: JSON.stringify(transcriptSidecar, null, 2),
        },
        { fileName: captionExport.fileName, text: captionVtt },
      ],
    };
  }, forceTimelineAacUnsupported);

  await page.close();
  const reopened = await context.newPage();
  reopened.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await reopened.goto(harnessUrl);
  await reopened.waitForFunction("window.LOCAL_RECORDINGS_READY === true", {
    timeout: 30000,
  });

  const afterReopen = await reopened.evaluate(async () => {
    const lib = window.LOCAL_RECORDINGS;
    const newest = await lib.listLocalRecordings({ sortBy: "newest" });
    const secondEntry = newest.find((item) => item.id === "rec-b");
    const duplicateEntry = newest.find(
      (item) => item.title === "Beta renamed copy"
    );
    const importedEntry = newest.find((item) => item.title === "Imported Demo");
    const secondAfterReopen = await (
      await lib.readLocalRecordingBlob(secondEntry)
    ).text();
    const duplicateAfterReopen = await (
      await lib.readLocalRecordingBlob(duplicateEntry)
    ).text();
    const importedAfterReopen = await (
      await lib.readLocalRecordingBlob(importedEntry)
    ).text();
    const project = await lib.getLocalRecordingProject("rec-b");
    const transcriptFlowProject = await lib.getLocalRecordingProject(
      "rec-transcript-flow"
    );
    const duplicateProject = await lib.getLocalRecordingProject(
      duplicateEntry.id
    );
    return {
      count: newest.length,
      ids: newest.map((item) => item.id),
      renamedTitle: secondEntry?.title,
      secondAfterReopen,
      duplicateTitle: duplicateEntry?.title,
      duplicateAfterReopen,
      importedTitle: importedEntry?.title,
      importedAfterReopen,
      importedMetaSource: importedEntry?.recordingMeta?.source,
      importedThumbnailDataUrl: importedEntry?.thumbnailDataUrl,
      duplicateProjectRecordingId: duplicateProject?.recordingId,
      duplicateProjectClipIds: duplicateProject?.timeline?.clips?.map(
        (clip) => clip.id
      ),
      duplicateProjectChapterLabels: duplicateProject?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      duplicateProjectZoomLabels: duplicateProject?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      duplicateProjectCrop: duplicateProject?.crop,
      duplicateProjectAudioTrack: duplicateProject?.audioTrack,
      duplicateProjectAudioBytes: duplicateProject?.audioTrack
        ? (
            await lib.readLocalRecordingAudioAsset(
              duplicateEntry.id,
              duplicateProject.audioTrack
            )
          ).size
        : 0,
      duplicateProjectExportFormat: duplicateProject?.exportSettings?.format,
      projectClipIds: project?.timeline?.clips?.map((clip) => clip.id),
      projectMuted: project?.timeline?.clips?.[1]?.muted,
      projectSelectedClipId: project?.selectedClipId,
      projectTranscriptText: project?.transcript?.words
        ?.map((word) => word.text)
        .join(" "),
      projectChapterLabels: project?.chapterMarkers?.map(
        (marker) => marker.label
      ),
      projectZoomLabels: project?.zoomKeyframes?.map(
        (keyframe) => keyframe.label
      ),
      projectCrop: project?.crop,
      projectAudioTrack: project?.audioTrack,
      projectAudioBytes: project?.audioTrack
        ? (await lib.readLocalRecordingAudioAsset("rec-b", project.audioTrack))
            .size
        : 0,
      projectExportFormat: project?.exportSettings?.format,
      projectExportQuality: project?.exportSettings?.qualityPreset,
      transcriptFlowClipCount:
        transcriptFlowProject?.timeline?.clips?.length || 0,
      transcriptFlowTranscriptText: transcriptFlowProject?.transcript?.words
        ?.map((word) => word.text)
        .join(" "),
    };
  });

  await browser.close();
  server.close();

  const sidecarProbePaths = result._sidecarProbeExports.map((sidecar) => {
    const sidecarPath = path.join(work, sidecar.fileName);
    fs.writeFileSync(sidecarPath, sidecar.text);
    return sidecarPath;
  });
  const sidecarProbeRun = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "manual-qa-sidecar-probe.mjs"),
      "--json",
      "--require-complete",
      ...sidecarProbePaths,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (sidecarProbeRun.error) throw sidecarProbeRun.error;
  if (sidecarProbeRun.status !== 0) {
    throw new Error(
      `Product sidecar probe failed:\n${
        sidecarProbeRun.stderr || sidecarProbeRun.stdout
      }`
    );
  }
  const sidecarProbeReport = JSON.parse(sidecarProbeRun.stdout);
  result.productSidecarProbe = {
    kind: sidecarProbeReport.kind,
    status: sidecarProbeReport.status,
    fileCount: sidecarProbeReport.fileCount,
    coverage: sidecarProbeReport.coverage,
    files: sidecarProbeReport.files.map((file) => ({
      fileName: file.fileName,
      format: file.format,
      recordingId: file.recordingId || null,
      cueCount: file.cueCount || null,
      timelineAwareWordCount: file.timelineAwareWordCount || null,
      projectVersion: file.projectVersion || null,
      clipCount: file.clipCount ?? null,
    })),
  };
  delete result._sidecarProbeExports;

  console.log("=== LOCAL RECORDINGS HARNESS ===");
  console.log(JSON.stringify({ result, afterReopen }, null, 2));

  const isYellowPixel = (pixel) =>
    pixel?.r >= 180 && pixel?.g >= 140 && pixel?.b <= 80 && pixel?.a === 255;
  const isRedPixel = (pixel) =>
    pixel?.r >= 170 && pixel?.g <= 80 && pixel?.b <= 80 && pixel?.a === 255;
  const hasUnsupportedAudioEncoderReason = (reason) =>
    /encoder configuration/i.test(reason || "") &&
    /not supported by this browser/i.test(reason || "");
  const transcriptM4aOk =
    result.transcriptFlowM4aExportBytes > 0 &&
    result.transcriptFlowM4aExportType === "audio/mp4";
  const transcriptM4aSkipped = hasUnsupportedAudioEncoderReason(
    result.transcriptFlowM4aUnsupportedReason
  );
  const silenceM4aOk =
    result.m4aAudioSilenceExportBytes > 0 &&
    result.m4aAudioSilenceExportType === "audio/mp4" &&
    result.m4aAudioSilenceDuration >= 3 &&
    result.m4aAudioSilenceDuration <= 3.5 &&
    result.m4aAudioSilenceCount === 1 &&
    result.m4aAudioSilenceStart >= 0.9 &&
    result.m4aAudioSilenceStart <= 1.2 &&
    result.m4aAudioSilenceEnd >= 1.95 &&
    result.m4aAudioSilenceEnd <= 2.35 &&
    result.m4aAudioSilenceLabel.includes("silence");
  const silenceM4aSkipped = hasUnsupportedAudioEncoderReason(
    result.m4aAudioSilenceUnsupportedReason
  );
  const abortM4aOk =
    result.abortAudioProgressCount > 0 &&
    result.abortAudioMaxProgress >= 0.35 &&
    result.abortAudioErrorName === "AbortError" &&
    result.retryAudioExportBytes > 0;
  const abortM4aSkipped =
    silenceM4aSkipped &&
    result.abortAudioErrorName === "UnsupportedAudioEncoder";
  const m4aProjectAudioOk =
    result.m4aProjectAudioProbe?.duration >= 3 &&
    result.m4aProjectAudioProbe?.duration <= 3.5 &&
    result.m4aProjectAudioProbe?.numberOfChannels >= 1 &&
    result.m4aProjectAudioProbe?.sampleRate > 0 &&
    result.m4aProjectAudioRenderedBytes > 0 &&
    result.m4aProjectAudioRms > 0.05;
  const m4aProjectAudioSkipped =
    silenceM4aSkipped || !result.timelineAacSupported;

  const ok =
    result.newestIds.join(",") ===
      "rec-missing,rec-transcript-flow,rec-b,rec-a" &&
    result.alphaIds.join(",") ===
      "rec-a,rec-b,rec-missing,rec-transcript-flow" &&
    result.transcriptFlowClipCount === 2 &&
    result.transcriptFlowDeletedWordPresent === false &&
    result.transcriptFlowKeptWordsPresent === true &&
    result.transcriptFlowDurationBefore - result.transcriptFlowDurationAfter >
      0.7 &&
    result.transcriptFlowDurationBefore - result.transcriptFlowDurationAfter <
      1.5 &&
    result.abortVideoProgressCount > 0 &&
    result.abortVideoMaxProgress >= 0.35 &&
    result.abortVideoErrorName === "AbortError" &&
    result.longTimelineSegmentCount === 150 &&
    result.longTimelinePlannedDuration >= 179.9 &&
    result.longTimelinePlannedDuration <= 180.1 &&
    result.longTimelineAbortMaxProgress >= 0.25 &&
    result.longTimelineAbortErrorName === "AbortError" &&
    result.longTimelineRetryBytes > 0 &&
    result.longTimelineRetryMetadata.duration >= 178 &&
    result.longTimelineRetryMetadata.duration <= 181 &&
    result.longTimelineRetryMetadata.width === 320 &&
    result.longTimelineRetryMetadata.height === 180 &&
    result.largeSourceBytes >= 2_000_000 &&
    result.largeSourceMetadata.width === 960 &&
    result.largeSourceMetadata.height === 540 &&
    result.largeSourceAbortMaxProgress >= 0.35 &&
    result.largeSourceAbortErrorName === "AbortError" &&
    result.largeSourceRetryBytes > 0 &&
    result.largeSourceRetryMetadata.duration >= 4.8 &&
    result.largeSourceRetryMetadata.duration <= 5.2 &&
    result.largeSourceRetryMetadata.width === 960 &&
    result.largeSourceRetryMetadata.height === 540 &&
    result.retryVideoExportBytes > 0 &&
    result.captionBurnInExportBytes > 0 &&
    result.transcriptFlowAudioExportBytes > 0 &&
    result.transcriptFlowAudioExportType === "audio/wav" &&
    (transcriptM4aOk || transcriptM4aSkipped) &&
    result.browserAudioSilenceCount === 1 &&
    result.browserAudioSilenceStart >= 0.9 &&
    result.browserAudioSilenceStart <= 1.15 &&
    result.browserAudioSilenceEnd >= 2.0 &&
    result.browserAudioSilenceEnd <= 2.25 &&
    result.browserAudioSilenceLabel.includes("silence") &&
    (silenceM4aOk || silenceM4aSkipped) &&
    (abortM4aOk || abortM4aSkipped) &&
    result.noisyRoomSilenceCount === 1 &&
    result.noisyRoomSilenceStart >= 0.95 &&
    result.noisyRoomSilenceStart <= 1.15 &&
    result.noisyRoomSilenceEnd >= 2.25 &&
    result.noisyRoomSilenceEnd <= 2.45 &&
    result.noisyRoomSilenceLabel.includes("silence") &&
    result.zoomRenderedBytes > 0 &&
    result.zoomCenterPixel.width === 320 &&
    result.zoomCenterPixel.height === 180 &&
    isYellowPixel(result.zoomCenterPixel) &&
    result.zoomSquareRenderedBytes > 0 &&
    result.zoomSquareCenterPixel.width === 240 &&
    result.zoomSquareCenterPixel.height === 240 &&
    isYellowPixel(result.zoomSquareCenterPixel) &&
    result.zoomPortraitRenderedBytes > 0 &&
    result.zoomPortraitCenterPixel.width === 180 &&
    result.zoomPortraitCenterPixel.height === 320 &&
    isYellowPixel(result.zoomPortraitCenterPixel) &&
    result.cropRenderedBytes > 0 &&
    result.cropCenterPixel.width === 160 &&
    result.cropCenterPixel.height === 90 &&
    isYellowPixel(result.cropCenterPixel) &&
    result.cropZoomRenderedBytes > 0 &&
    result.cropZoomCenterPixel.width === 160 &&
    result.cropZoomCenterPixel.height === 108 &&
    isRedPixel(result.cropZoomCenterPixel) &&
    (!result.timelineAacSupported ||
      (result.projectAudioRenderedBytes > 0 &&
        result.projectAudioRenderedType === "video/mp4")) &&
    result.projectAudioPreviewController.previewSourceVolume === 0.4 &&
    result.projectAudioPreviewController.previewAfterPlay.currentTime === 0.5 &&
    result.projectAudioPreviewController.previewAfterPlay.playCalls === 1 &&
    result.projectAudioPreviewController.previewInDeletedGap === 0.5 &&
    result.projectAudioPreviewController.previewAfterReorderedSeek === 1 &&
    result.projectAudioPreviewController.previewPlaybackRate === 1.5 &&
    result.projectAudioPreviewController.previewPauseCallsBeforeDispose === 1 &&
    result.projectAudioPreviewController.previewPauseCallsAfterDispose === 2 &&
    result.projectAudioPreviewController.previewRestoredVolume === 0.8 &&
    result.projectAudioPreviewController.revokedPreviewUrls.join(",") ===
      "blob:project-audio-preview-proof" &&
    result.projectAudioPreviewController.detachedPlayListener === true &&
    result.cancelledPostRenderWebm.cancelled === true &&
    result.cancelledPostRenderWebm.maxProgress >= 0.25 &&
    result.cancelledPostRenderWebm.deliveryType === null &&
    result.retriedPostRenderWebm.deliveryType === "download-webm" &&
    result.retriedPostRenderWebm.progressMonotonic === true &&
    result.retriedPostRenderWebm.deliveryDataUrlPrefix.startsWith(
      "data:video/webm"
    ) &&
    result.retriedPostRenderWebm.deliveryDataUrlBytes > 100 &&
    result.cancelledPostRenderGif.cancelled === true &&
    result.cancelledPostRenderGif.maxProgress >= 0.25 &&
    result.cancelledPostRenderGif.deliveryType === null &&
    result.retriedPostRenderGif.deliveryType === "download-gif" &&
    result.retriedPostRenderGif.progressMonotonic === true &&
    result.retriedPostRenderGif.deliveryDataUrlPrefix.startsWith(
      "data:image/gif"
    ) &&
    result.retriedPostRenderGif.deliveryDataUrlBytes > 100 &&
    result.mp3ProjectAudioType === "audio/mpeg" &&
    result.mp3ProjectAudioProbe?.duration > 0 &&
    result.mp3ProjectAudioProbe?.numberOfChannels >= 1 &&
    result.mp3ProjectAudioProbe?.sampleRate > 0 &&
    (!result.timelineAacSupported ||
      (result.mp3ProjectAudioRenderedBytes > 0 &&
        result.mp3ProjectAudioRms > 0.001)) &&
    (m4aProjectAudioOk || m4aProjectAudioSkipped) &&
    result.corruptProjectAudioError === "project-audio-decode-unsupported" &&
    (!result.timelineAacSupported ||
      (result.projectAudioDuration >= 3 &&
        result.projectAudioDuration <= 3.5 &&
        result.projectAudioRms > 0.05 &&
        result.projectAudioNonLoopLateRms < 0.01 &&
        result.projectAudioLoopLateRms > 0.05 &&
        result.projectAudioMixRms > 0.1 &&
        result.projectAudioReplaceRms < 0.01 &&
        result.abortProjectAudioMaxProgress >= 0.9 &&
        result.abortProjectAudioErrorName === "AbortError" &&
        result.retryProjectAudioExportBytes > 0)) &&
    result.editedBeforeClose === "first-edited" &&
    result.afterActionIds.length === 4 &&
    result.afterActionIds.includes("rec-b") &&
    result.afterActionIds.includes("rec-transcript-flow") &&
    result.afterActionIds.includes(result.duplicateId) &&
    result.afterActionIds.includes(result.importedId) &&
    result.duplicateTitle === "Beta renamed copy" &&
    result.duplicateBlobText === "second-original" &&
    result.migratedProjectFileName === "Alpha demo.sayless-project.json" &&
    result.migratedProjectSidecarRecordingId === "rec-a" &&
    result.migratedProjectClipCount === 1 &&
    result.migratedProjectDuration === 1 &&
    result.projectSidecarFileName === "Beta renamed.sayless-project.json" &&
    result.projectSidecarKind === "sayless.localRecordingProject" &&
    result.projectSidecarRecordingId === "rec-b" &&
    result.projectSidecarSchemaVersion === 4 &&
    result.projectSidecarExportFormat === "gif" &&
    result.projectSidecarExportQuality === "compressed" &&
    result.projectSidecarGifDuration === 1.75 &&
    result.projectSidecarGifFps === 30 &&
    result.projectSidecarChapterLabels.join(",") === "Hello,Offline" &&
    result.projectSidecarZoomLabels.join(",") === "Click zoom" &&
    result.projectSidecarCrop.xRatio === 0.1 &&
    result.projectSidecarCrop.yRatio === 0.2 &&
    result.projectSidecarCrop.widthRatio === 0.75 &&
    result.projectSidecarCrop.heightRatio === 0.65 &&
    result.projectSidecarAudioTrack.fileName === "Project tone.wav" &&
    result.projectSidecarAudioTrack.mode === "replace" &&
    result.projectSidecarAudioTrack.volume === 0.8 &&
    /^[a-f0-9]{64}$/.test(result.projectSidecarAudioTrack.sha256) &&
    result.projectAudioBeforeClearBytes === 32044 &&
    result.projectAudioAfterClearError ===
      "local-recording-audio-asset-missing" &&
    result.importedAudioMissingError ===
      "local-recording-audio-asset-missing" &&
    result.relinkedAudioAssetId === result.projectSidecarAudioTrack.assetId &&
    result.projectAfterClear === null &&
    result.restoredProjectClipIds.join(",") === "clip-a,clip-b" &&
    result.restoredProjectChapterLabels.join(",") === "Hello,Offline" &&
    result.restoredProjectZoomLabels.join(",") === "Click zoom" &&
    result.restoredProjectCrop.widthRatio === 0.75 &&
    result.restoredProjectAudioTrack.assetId ===
      result.projectSidecarAudioTrack.assetId &&
    result.restoredProjectTranscriptText === "hello offline" &&
    result.restoredProjectExportFormat === "gif" &&
    result.restoredProjectCaptionStyle === "high-contrast" &&
    result.transcriptExportFileName === "Beta renamed.transcript.json" &&
    result.transcriptSidecarKind === "sayless.localRecordingTranscript" &&
    result.transcriptTimelineAwareText === "hello" &&
    result.captionExportFileName === "Beta renamed.vtt" &&
    result.captionVtt.startsWith("WEBVTT") &&
    result.captionVtt.includes("00:00:00.100 --> 00:00:00.400") &&
    result.captionVtt.includes("hello") &&
    !result.captionVtt.includes("offline") &&
    result.productSidecarProbe.kind === "sayless.manualQaSidecarProbe" &&
    result.productSidecarProbe.status === "inspected" &&
    result.productSidecarProbe.fileCount === 3 &&
    result.productSidecarProbe.coverage.status === "structurally-complete" &&
    result.productSidecarProbe.coverage.completeSetCount === 1 &&
    result.productSidecarProbe.coverage.sidecarSets[0].name ===
      "Beta renamed" &&
    result.productSidecarProbe.coverage.sidecarSets[0].recordingIds.join(
      ","
    ) === "rec-b" &&
    result.productSidecarProbe.files.find((file) => file.format === "vtt")
      ?.cueCount === 1 &&
    result.productSidecarProbe.files.find(
      (file) => file.format === "transcript-json"
    )?.timelineAwareWordCount === 1 &&
    result.productSidecarProbe.files.find(
      (file) => file.format === "sayless-project-json"
    )?.projectVersion === 4 &&
    result.generatedThumbnailIsJpeg === true &&
    result.generatedThumbnailWidth === 320 &&
    result.generatedThumbnailHeight === 180 &&
    result.generatedThumbnailAspect === 1.778 &&
    result.generatedThumbnailCenterPixel?.width === 320 &&
    result.generatedThumbnailCenterPixel?.height === 180 &&
    result.generatedThumbnailCenterPixel?.b > 120 &&
    result.generatedThumbnailCenterPixel?.b >
      result.generatedThumbnailCenterPixel?.r * 1.5 &&
    result.generatedThumbnailCenterPixel?.b >
      result.generatedThumbnailCenterPixel?.g * 1.5 &&
    result.generatedThumbnailCenterPixel?.a === 255 &&
    result.transcriptCacheKeyIncludesLanguage === true &&
    result.cachedTranscriptText === "hello offline" &&
    result.cachedAfterDelete === null &&
    result.duplicateProjectRecordingId === result.duplicateId &&
    result.duplicateProjectClipIds.join(",") === "clip-a,clip-b" &&
    result.duplicateProjectChapterLabels.join(",") === "Hello,Offline" &&
    result.duplicateProjectZoomLabels.join(",") === "Click zoom" &&
    result.duplicateProjectCrop.heightRatio === 0.65 &&
    result.duplicateProjectAudioTrack.assetId ===
      result.projectSidecarAudioTrack.assetId &&
    result.duplicateProjectAudioBytes === 32044 &&
    result.duplicateProjectExportFormat === "gif" &&
    result.duplicateInspectionOk === true &&
    result.duplicateInspectionStatus === "ok" &&
    result.exportFileName === "Beta renamed copy.mp4" &&
    result.exportedText === "second-original" &&
    result.storageCount === 5 &&
    result.storageIndexedBytes >= 0 &&
    result.missingInspectionOk === false &&
    result.missingInspectionStatus === "local-recording-blob-missing" &&
    result.repairResultRepaired === true &&
    result.missingAfterRepairStatus === "missing-entry" &&
    result.importedTitle === "Imported Demo" &&
    result.importedMimeType === "video/webm" &&
    result.importedMetaSource === "import" &&
    result.importedText === "imported-original" &&
    result.importedExportFileName === "Imported Demo.webm" &&
    result.importedExportText === "imported-original" &&
    result.thumbnailPersisted === true &&
    result.invalidGeneratedThumbnail === null &&
    result.opfsCleanupSupported === true &&
    result.orphanCount === 2 &&
    result.orphanBlobKeys.includes("original:rec-orphan") &&
    result.orphanOpfsFileNames.includes(result.opfsOrphanFileName) &&
    result.cleanupRemovedCount === 2 &&
    result.cleanupRemovedOpfsFileNames.includes(result.opfsOrphanFileName) &&
    result.orphanCountAfterCleanup === 0 &&
    result.bulkExportFileNames.join(",") === "Bulk A.mp4,Bulk B.webm" &&
    result.bulkExportTexts.join(",") === "bulk-a,bulk-b" &&
    result.bulkProjectExportFileNames.join(",") ===
      "Bulk A.sayless-project.json,Bulk B.sayless-project.json" &&
    result.bulkDeleteCount === 2 &&
    result.bulkDeleteResultIds.join(",") ===
      "rec-bulk-a,rec-bulk-b,rec-bulk-missing" &&
    result.bulkIdsAfterDelete.length === 0 &&
    result.pressureUnknownLevel === "unknown" &&
    result.pressureNormalLevel === "normal" &&
    result.pressureNearLimitLevel === "near-limit" &&
    result.pressureCriticalLevel === "critical" &&
    result.pressureCriticalRatio === 0.95 &&
    result.exportLifecycleSnapshots[0].name === "running-start" &&
    result.exportLifecycleSnapshots[0].id === "mp4-1000" &&
    result.exportLifecycleSnapshots[0].status === "running" &&
    result.exportLifecycleSnapshots[0].title === "MP4 export" &&
    result.exportLifecycleSnapshots[0].description === "Rendering locally." &&
    result.exportLifecycleSnapshots[0].canRetry === false &&
    result.exportLifecycleSnapshots[0].canReveal === false &&
    result.exportLifecycleSnapshots[0].lastExportDownloadId === null &&
    result.exportLifecycleSnapshots[1].name === "running-progress" &&
    result.exportLifecycleSnapshots[1].status === "running" &&
    result.exportLifecycleSnapshots[1].progress === 42 &&
    result.exportLifecycleSnapshots[1].description ===
      "Rendering locally (42%)" &&
    result.exportLifecycleSnapshots[2].name === "cancelled" &&
    result.exportLifecycleSnapshots[2].status === "cancelled" &&
    result.exportLifecycleSnapshots[2].progress === 42 &&
    result.exportLifecycleSnapshots[2].canCancel === false &&
    result.exportLifecycleSnapshots[2].canRetry === true &&
    result.exportLifecycleSnapshots[2].downloading === false &&
    result.exportLifecycleSnapshots[2].downloadingGIF === false &&
    result.exportLifecycleSnapshots[2].processingProgress === 0 &&
    result.exportLifecycleSnapshots[2].title === "MP4 export cancelled" &&
    result.exportLifecycleSnapshots[2].description === "Export cancelled." &&
    result.exportLifecycleSnapshots[2].retrySnapshot.format === "gif" &&
    result.exportLifecycleSnapshots[2].retrySnapshot.qualityPreset ===
      "compressed" &&
    result.exportLifecycleSnapshots[2].retrySnapshot.includeProjectSidecar ===
      true &&
    result.exportLifecycleSnapshots[2].retrySnapshot
      .includeTranscriptSidecar === true &&
    result.exportLifecycleSnapshots[2].retrySnapshot.includeCaptionSidecar ===
      true &&
    result.exportLifecycleSnapshots[2].retrySnapshot.audioOnly === true &&
    result.exportLifecycleSnapshots[2].retrySnapshot.audioFormat === "m4a" &&
    result.exportLifecycleSnapshots[2].retrySnapshot.captionStyle.preset ===
      "high-contrast" &&
    result.exportLifecycleSnapshots[2].retrySnapshot.captionStyle.burnIn ===
      true &&
    result.exportLifecycleSnapshots[2].retrySnapshot.gif.durationSeconds ===
      2.5 &&
    result.exportLifecycleSnapshots[3].name === "completed" &&
    result.exportLifecycleSnapshots[3].status === "completed" &&
    result.exportLifecycleSnapshots[3].progress === 100 &&
    result.exportLifecycleSnapshots[3].canRetry === false &&
    result.exportLifecycleSnapshots[3].canReveal === true &&
    result.exportLifecycleSnapshots[3].title === "MP4 export complete" &&
    result.exportLifecycleSnapshots[3].description === "Export finished." &&
    result.exportLifecycleSnapshots[3].completionFromSaved.status ===
      "completed" &&
    result.exportLifecycleSnapshots[3].completionFromSaved.downloadId === 321 &&
    result.exportLifecycleSnapshots[3].completionFromCancelled.status ===
      "cancelled" &&
    result.exportLifecycleDismissed === true &&
    result.renamedTitle === "Beta renamed" &&
    result.projectClipIds.join(",") === "clip-a,clip-b" &&
    result.projectSelectedClipId === "clip-b" &&
    result.projectTranscriptText === "hello offline" &&
    result.projectChapterLabels.join(",") === "Hello,Offline" &&
    result.projectZoomLabels.join(",") === "Click zoom" &&
    result.projectCrop.widthRatio === 0.75 &&
    result.projectAudioTrack.assetId ===
      result.projectSidecarAudioTrack.assetId &&
    result.projectExportSettings.format === "gif" &&
    result.projectExportSettings.qualityPreset === "compressed" &&
    result.projectExportSettings.includeTranscriptSidecar === true &&
    result.projectExportSettings.includeCaptionSidecar === true &&
    result.deletedReadError === "local-recording-blob-missing" &&
    afterReopen.count === 4 &&
    afterReopen.ids.includes("rec-b") &&
    afterReopen.ids.includes("rec-transcript-flow") &&
    afterReopen.ids.includes(result.duplicateId) &&
    afterReopen.ids.includes(result.importedId) &&
    afterReopen.renamedTitle === "Beta renamed" &&
    afterReopen.secondAfterReopen === "second-original" &&
    afterReopen.duplicateTitle === "Beta renamed copy" &&
    afterReopen.duplicateAfterReopen === "second-original" &&
    afterReopen.importedTitle === "Imported Demo" &&
    afterReopen.importedAfterReopen === "imported-original" &&
    afterReopen.importedMetaSource === "import" &&
    afterReopen.importedThumbnailDataUrl?.startsWith("data:image/png") &&
    afterReopen.duplicateProjectRecordingId === result.duplicateId &&
    afterReopen.duplicateProjectClipIds.join(",") === "clip-a,clip-b" &&
    afterReopen.duplicateProjectChapterLabels.join(",") === "Hello,Offline" &&
    afterReopen.duplicateProjectZoomLabels.join(",") === "Click zoom" &&
    afterReopen.duplicateProjectCrop.widthRatio === 0.75 &&
    afterReopen.duplicateProjectAudioTrack.assetId ===
      result.projectSidecarAudioTrack.assetId &&
    afterReopen.duplicateProjectAudioBytes === 32044 &&
    afterReopen.duplicateProjectExportFormat === "gif" &&
    afterReopen.projectClipIds.join(",") === "clip-a,clip-b" &&
    afterReopen.projectMuted === true &&
    afterReopen.projectSelectedClipId === "clip-b" &&
    afterReopen.projectTranscriptText === "hello offline" &&
    afterReopen.projectChapterLabels.join(",") === "Hello,Offline" &&
    afterReopen.projectZoomLabels.join(",") === "Click zoom" &&
    afterReopen.projectCrop.heightRatio === 0.65 &&
    afterReopen.projectAudioTrack.assetId ===
      result.projectSidecarAudioTrack.assetId &&
    afterReopen.projectAudioBytes === 32044 &&
    afterReopen.projectExportFormat === "gif" &&
    afterReopen.projectExportQuality === "compressed" &&
    afterReopen.transcriptFlowClipCount === 2 &&
    afterReopen.transcriptFlowTranscriptText === "keep remove tail";

  console.log(
    ok ? "LOCAL RECORDINGS HARNESS PASS" : "LOCAL RECORDINGS HARNESS FAIL"
  );
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("RUNNER ERROR", e);
  process.exit(2);
});
