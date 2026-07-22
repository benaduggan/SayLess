// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = "development";
process.env.NODE_ENV = "development";
process.env.ASSET_PATH = "/";

const WebpackDevServer = require("webpack-dev-server");
const webpack = require("webpack");
const config = require("../webpack.config.cts");
const env = require("./env.cts");
const path = require("path");
const { debounce } = require("lodash");

const customOptions = require("../custom.config.cts");

for (const entryName in config.entry) {
  if (!customOptions.notHMR.includes(entryName)) {
    config.entry[entryName] = [
      "webpack/hot/dev-server.js",
      `webpack-dev-server/client/index.js?hot=true&hostname=localhost&port=${env.PORT}`,
    ].concat(config.entry[entryName]);
  }
}

if (
  customOptions.enableBackgroundAutoReload ||
  customOptions.enableContentScriptsAutoReload
) {
  config.entry["background"] = [
    path.resolve(
      __dirname,
      `autoReloadClients/backgroundClient.ts?port=${env.PORT}`
    ),
  ].concat(config.entry["background"]);
}

if (customOptions.enableContentScriptsAutoReload) {
  config.entry["contentScript"] = [
    path.resolve(__dirname, "autoReloadClients/contentScriptClient.ts"),
  ].concat(config.entry["contentScript"]);
}

config.plugins = [new webpack.HotModuleReplacementPlugin()].concat(
  config.plugins || []
);

delete config.custom;

const compiler = webpack(config);

const server = new WebpackDevServer(
  {
    https: false,
    hot: false, // We're handling HMR manually
    client: false,
    compress: false, // Important: Keep false for SSE to work
    host: "localhost",
    port: env.PORT,
    static: {
      directory: path.join(__dirname, "../build"),
    },
    devMiddleware: {
      publicPath: `http://localhost:${env.PORT}/`,
      writeToDisk: true,
    },
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    allowedHosts: "all",
    setupMiddlewares: (middlewares: any[], devServer: any) => {
      // Skip middleware setup if auto-reload is disabled
      if (
        !customOptions.enableBackgroundAutoReload &&
        !customOptions.enableContentScriptsAutoReload
      ) {
        return middlewares;
      }

      if (!devServer) {
        throw new Error("webpack-dev-server is not defined");
      }

      // Add SSE middleware for extension reloading
      middlewares.push({
        path: "/__server_sent_events__",
        middleware: (_req: any, res: any) => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify("Dev server connected")}\n\n`);

          const writeMessage = ({ event, data }: any) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
          };

          let closed = false;

          // Debounce compile events to prevent excessive reloads
          const compileDoneHandler = debounce((stats: any) => {
            if (closed || stats.hasErrors()) return;

            const { modules } = stats.toJson({ all: false, modules: true });
            const updatedJsModules = modules.filter(
              (module: any) =>
                module.type === "module" &&
                module.moduleType === "javascript/auto"
            );

            // Check which parts of the extension have been updated
            const isBackgroundUpdated = updatedJsModules.some((module: any) =>
              module.nameForCondition.startsWith(
                path.resolve(__dirname, "../src/pages/Background")
              )
            );

            const isContentScriptsUpdated = updatedJsModules.some(
              (module: any) =>
                module.nameForCondition.startsWith(
                  path.resolve(__dirname, "../src/pages/Content")
                )
            );

            // Determine what needs to be reloaded based on changes and config
            const shouldBackgroundReload =
              isBackgroundUpdated && customOptions.enableBackgroundAutoReload;

            const shouldContentScriptsReload =
              isContentScriptsUpdated &&
              customOptions.enableContentScriptsAutoReload;

            // Send appropriate events through SSE
            if (shouldBackgroundReload) {
              writeMessage({
                event: "background-updated",
                data: {},
              });
            }

            if (shouldContentScriptsReload) {
              writeMessage({
                event: "content-scripts-updated",
                data: {},
              });
            }
          }, 1000);

          // Register plugin with webpack compiler
          compiler.hooks.done.tap(
            "extension-auto-reload-plugin",
            (stats: any) => {
              if (!closed) {
                compileDoneHandler(stats);
              }
            }
          );

          // Clean up when connection closes
          res.on("close", () => {
            closed = true;
            res.end();
          });
        },
      });

      return middlewares;
    },
  },
  compiler
);

const startServer = async () => {
  try {
    await server.start();
    console.log(`Dev server running at http://localhost:${env.PORT}`);
  } catch (error: any) {
    console.error("Failed to start dev server:", error);
    process.exit(1);
  }
};

startServer();
