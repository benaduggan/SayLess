import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

export const parseReportOutputOption = (args) => {
  const options = args.filter((arg) => arg.startsWith("--output="));
  if (options.length > 1) {
    throw new Error("--output may be provided only once.");
  }
  if (!options.length) return null;
  const outputPath = options[0].slice("--output=".length).trim();
  if (!outputPath) throw new Error("--output requires a file path.");
  return outputPath;
};

export const displayReportPath = (root, outputPath) => {
  if (!outputPath) return null;
  const absolutePath = resolve(outputPath);
  const rootRelative = relative(root, absolutePath);
  return rootRelative && !rootRelative.startsWith("..")
    ? rootRelative
    : basename(absolutePath);
};

export const writeReportAtomically = ({ outputPath, inputPaths, report }) => {
  if (!outputPath) return;
  const absoluteOutputPath = resolve(outputPath);
  if (
    inputPaths.some((inputPath) => resolve(inputPath) === absoluteOutputPath)
  ) {
    throw new Error("--output must not overwrite an inspected input file.");
  }

  const outputDirectory = dirname(absoluteOutputPath);
  mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = resolve(
    outputDirectory,
    `.${basename(absoluteOutputPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, absoluteOutputPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already be renamed.
    }
    throw error;
  }
};
