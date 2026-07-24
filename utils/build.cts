const nodeEnv = process.env.NODE_ENV || "production";
process.env.BABEL_ENV = nodeEnv;
process.env.NODE_ENV = nodeEnv;
process.env.ASSET_PATH = "";

const webpack = require("webpack");
const config = require("../webpack.config.cts");

const ALLOWED_WEBPACK_WARNINGS = [
  {
    name: "transformers import.meta standalone warning",
    moduleName:
      /(?:^|[\\/])@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js$|\.\/node_modules\/@huggingface\/transformers\/dist\/transformers\.web\.js/,
    message:
      /Critical dependency: 'import\.meta' cannot be used as a standalone expression\. For static analysis, its properties must be accessed directly/,
  },
];

const isAllowedWebpackWarning = (warning: any) => {
  const moduleName = warning?.moduleName || warning?.moduleIdentifier || "";
  const message = warning?.message || String(warning || "");
  return ALLOWED_WEBPACK_WARNINGS.some(
    (allowed) => allowed.moduleName.test(moduleName) && allowed.message.test(message),
  );
};

//delete config.chromeExtensionBoilerplate;
delete config.custom;

config.mode = nodeEnv;

webpack(config, (err: any, stats: any) => {
  if (err) {
    console.error("Webpack compilation error:", err);
    throw err;
  }

  if (stats.hasErrors()) {
    console.error("Webpack compilation failed with errors:");
    const info = stats.toJson();
    console.error(info.errors);
    process.exit(1);
  }

  if (stats.hasWarnings()) {
    const info = stats.toJson({ all: false, warnings: true });
    const warnings = info.warnings || [];
    const unexpectedWarnings = warnings.filter((warning: any) => !isAllowedWebpackWarning(warning));
    if (unexpectedWarnings.length) {
      console.error("Webpack compilation had unexpected warnings:");
      console.error(unexpectedWarnings);
      process.exit(1);
    }
    console.warn("Webpack compilation had allowed warnings:");
    console.warn(warnings);
  }

  console.log("Production build completed successfully!");
});
