const webpack = require("webpack");
const path = require("path");
const fileSystem = require("fs-extra");
const env = require("./utils/env.cts");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

const isDev = env.NODE_ENV === "development";

const ASSET_PATH = process.env.ASSET_PATH || "";

if (process.env.SAYLESS_SKIP_ENV) {
  // open-source release build, no dotenv
} else if (isDev || process.env.SAYLESS_USE_LOCAL_ENV === "1") {
  // SAYLESS_USE_LOCAL_ENV=1 lets you do a NODE_ENV=production
  // (minified, fast) build that still points at localhost; useful
  // for testing local development flows while keeping the small prod-style
  // bundle.
  require("dotenv").config({ path: ".env.local" });
} else {
  require("dotenv").config({ path: ".env.production" });
}

// Entry points for the different pages
const entryPoints = {
  background: path.join(__dirname, "src", "pages", "Background", "index.ts"),
  contentScript: path.join(
    __dirname,
    "src",
    "pages",
    "Content",
    "index.content.tsx"
  ),
  recorder: path.join(__dirname, "src", "pages", "Recorder", "index.tsx"),
  recorderkeepalive: path.join(
    __dirname,
    "src",
    "pages",
    "Recorder",
    "recorderKeepalive.ts"
  ),
  offscreenrecorder: path.join(
    __dirname,
    "src",
    "pages",
    "OffscreenRecorder",
    "index.tsx"
  ),
  camera: path.join(__dirname, "src", "pages", "Camera", "index.tsx"),
  waveform: path.join(__dirname, "src", "pages", "Waveform", "index.tsx"),
  permissions: path.join(__dirname, "src", "pages", "Permissions", "index.tsx"),
  setup: path.join(__dirname, "src", "pages", "Setup", "index.tsx"),
  playground: path.join(__dirname, "src", "pages", "Playground", "index.tsx"),
  region: path.join(__dirname, "src", "pages", "Region", "index.tsx"),
  download: path.join(__dirname, "src", "pages", "Download", "index.tsx"),
  editor: path.join(__dirname, "src", "pages", "Editor", "index.tsx"),
  remuxoffscreen: path.join(
    __dirname,
    "src",
    "pages",
    "RemuxOffscreen",
    "index.ts"
  ),
  remuxworker: path.join(
    __dirname,
    "src",
    "pages",
    "RemuxOffscreen",
    "worker.ts"
  ),
  recorderopfsworker: path.join(
    __dirname,
    "src",
    "pages",
    "Recorder",
    "recorderStorage",
    "opfs",
    "writerWorker.ts"
  ),
};

const htmlPlugins = Object.keys(entryPoints)
  .map((entryName: string) => {
    // Skip background script and worker bundles; they have no HTML page.
    if (
      entryName === "background" ||
      entryName === "contentScript" ||
      entryName === "remuxworker" ||
      entryName === "recorderopfsworker" ||
      entryName === "recorderkeepalive"
    ) {
      return null;
    }

    // Map entry names to folder names (for multi-word entries)
    const folderNameMap: Record<string, string> = {
      offscreenrecorder: "OffscreenRecorder",
      remuxoffscreen: "RemuxOffscreen",
    };

    const folderName =
      folderNameMap[entryName] ||
      entryName.charAt(0).toUpperCase() + entryName.slice(1);

    const templatePath = path.join(
      __dirname,
      "src",
      "pages",
      folderName,
      "index.html"
    );

    // Inject keepalive before the main bundle so audio/locks/mediaSession
    // signals are live before heavy parse; otherwise hidden-tab throttling
    // drops encoders to ~5fps for the first 15s. Manual sort because auto
    // sort flips order based on the chunk graph.
    const needsKeepalive = entryName === "recorder";
    const chunks = needsKeepalive
      ? ["recorderkeepalive", entryName]
      : [entryName];

    const options: any = {
      template: templatePath,
      filename: `${entryName}.html`,
      chunks,
      cache: true,
      ...(needsKeepalive ? { chunksSortMode: "manual" } : {}),
    };

    options.favicon = path.join(__dirname, "src", "assets", "favicon.png");

    return new HtmlWebpackPlugin(options);
  })
  .filter(Boolean); // Filter out null values

const fileExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "eot",
  "otf",
  "svg",
  "ttf",
  "woff",
  "woff2",
];

const secretsPath = path.join(__dirname, `secrets.${env.NODE_ENV}.js`);
const alias: Record<string, string> = { "react-dom": "@hot-loader/react-dom" };

if (fileSystem.existsSync(secretsPath)) {
  alias["secrets"] = secretsPath;
}

const config: any = {
  mode: process.env.NODE_ENV || "production",
  performance: { hints: false },
  entry: entryPoints,

  // Persistent filesystem cache for fast rebuilds
  cache: {
    type: "filesystem",
    buildDependencies: {
      config: [__filename],
    },
  },

  output: {
    filename: "[name].bundle.js",
    // chrome rejects extension files starting with "_". force a "chunk."
    // prefix so webpack's default _f608.bundle.js etc. don't trip it.
    chunkFilename: "chunk.[name].[contenthash:8].bundle.js",
    path: path.resolve(__dirname, "build"),
    clean: !isDev, // Only wipe build dir in production; dev keeps it to avoid re-copying 40MB of assets
    publicPath: ASSET_PATH,
  },
  module: {
    rules: [
      {
        test: /\.(css|scss)$/,
        use: [
          { loader: "style-loader" },
          {
            loader: "css-loader",
            options: { url: false },
          },
          {
            loader: "sass-loader",
            options: { sourceMap: true },
          },
        ],
      },
      {
        test: new RegExp(`.(${fileExtensions.join("|")})$`),
        type: "asset/resource",
        exclude: /node_modules/,
      },
      {
        test: /\.html$/,
        loader: "html-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.(ts|tsx)$/,
        loader: "ts-loader",
        exclude: /node_modules/,
        options: {
          transpileOnly: isDev,
        },
      },
      {
        test: /\.(js|jsx)$/,
        use: isDev
          ? [{ loader: "babel-loader" }]
          : [{ loader: "source-map-loader" }, { loader: "babel-loader" }],
        exclude: /node_modules/,
      },
      {
        // onnxruntime-web contains static `new URL("*.wasm", import.meta.url)`
        // fallbacks. The local Whisper provider always sets wasmPaths to the
        // copied build/ort/ runtime, so letting webpack emit those fallback
        // assets just duplicates the 21 MB ORT binary in release builds.
        test: /node_modules[\\/]onnxruntime-web[\\/]dist[\\/].*\.(mjs|js)$/,
        parser: {
          url: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      react: path.resolve("./node_modules/react"),
      "react-dom": path.resolve("./node_modules/react-dom"),
      "react/jsx-runtime": path.resolve("./node_modules/react/jsx-runtime"),
    },
    // Code extensions first; image/font extensions are only needed for explicit imports with extensions
    extensions: [".ts", ".tsx", ".js", ".jsx", ".css"],
    // TypeScript rewrites explicit .ts imports to their runtime .js form. During
    // bundling, resolve that emitted specifier back to the TypeScript source.
    extensionAlias: {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  plugins: [
    new webpack.ProgressPlugin(),
    new webpack.DefinePlugin({
      "process.env.MAX_RECORDING_DURATION": JSON.stringify(
        process.env.MAX_RECORDING_DURATION || 3600 // Default to 1 hour
      ),
      "process.env.RECORDING_WARNING_THRESHOLD": JSON.stringify(
        process.env.RECORDING_WARNING_THRESHOLD || 60 // Default to 1 minute
      ),
      "process.env.SAYLESS_DEV_MODE": JSON.stringify(
        isDev && process.env.SAYLESS_DEV_MODE === "true" ? "true" : ""
      ),
    }),

    // Copy manifest and transform with package info
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/manifest.json",
          to: path.join(__dirname, "build"),
          force: true,
          transform: (content: Buffer) => {
            const manifest = {
              description: process.env.npm_package_description,
              version: process.env.npm_package_version,
              ...JSON.parse(content.toString()),
            };

            return Buffer.from(JSON.stringify(manifest));
          },
        },
        {
          from: "src/schema.json",
          to: path.join(__dirname, "build/schema.json"),
          force: true,
        },
        {
          from: "src/assets/",
          to: path.join(__dirname, "build/assets"),
          force: true,
          globOptions: {
            ignore: ["**/vision_wasm_internal.ts", "**/gif.worker.ts"],
          },
        },
        {
          from: "src/assets/mediapipeVision/vision_wasm_internal.ts",
          to: path.join(
            __dirname,
            "build/assets/mediapipeVision/vision_wasm_internal.js"
          ),
          force: true,
        },
        {
          from: "src/assets/vendor/gif.js/gif.worker.ts",
          to: path.join(__dirname, "build/assets/vendor/gif.js/gif.worker.js"),
          force: true,
        },
        {
          from: "src/_locales/",
          to: path.join(__dirname, "build/_locales"),
          force: true,
        },
        {
          // ONNX Runtime Web (used by @huggingface/transformers for on-device
          // Whisper). Hosted locally because the extension CSP (script-src
          // 'self') blocks transformers' default jsdelivr CDN import. The
          // provider points env.backends.onnx.wasm.wasmPaths at build/ort/.
          from: "node_modules/@huggingface/transformers/dist/ort-wasm-*",
          to: path.join(__dirname, "build/ort/[name].[ext]"),
          force: true,
        },
      ],
    }),
    ...htmlPlugins,
  ],
};

if (isDev) {
  config.devtool = "cheap-module-source-map";
} else {
  config.optimization = {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        // Parallelize across CPU cores. Default is os.cpus().length-1
        // but being explicit makes the intent clear.
        parallel: true,
        terserOptions: {
          ecma: 2020,
          compress: {
            ecma: 2020,
            // Two compress passes catches more dead code than one
            // (DCE during pass 1 enables further inlining in pass 2).
            // Adds ~10-20% to build time, shaves 3-7% off bundle size.
            passes: 2,
            // strip log/debug/info in prod, keep warn/error for support.
            // Array form catches calls inside callbacks too.
            drop_console: ["log", "debug", "info"],
            pure_funcs: ["console.log", "console.debug", "console.info"],
          },
          mangle: {
            // Off; would mangle _-prefixed properties only. Measure
            // before flipping.
          },
          format: {
            // Drop all comments, including @preserve from deps.
            comments: false,
          },
        },
      }),
    ],
  };
}

module.exports = config;
