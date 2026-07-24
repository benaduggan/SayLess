import { buildDiagnosticZip, type DiagnosticZipOptions } from "./buildDiagnosticZip";

// Anchor-tag download of the local diagnostic ZIP.
export const triggerSupportDownload = async (
  opts: DiagnosticZipOptions = {},
): Promise<string | null> => {
  try {
    const { blob, filename } = await buildDiagnosticZip(opts);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  } catch (err) {
    console.error("[SayLess] Support zip download failed:", err);
    return null;
  }
};
