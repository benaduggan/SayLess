const RETIRED_ZOOM_TEMPLATE_PLACEHOLDERS = {
  recordingId: "replace-with-tab-or-region-recording-id",
  sourceHadClickMetadata: false,
  previewVerified: false,
  mp4ExportVerified: false,
  keepRemoveVerified: false,
  persistedAfterReopen: false,
  exportInspection:
    "Replace with how the MP4 export was inspected for the saved zoom framing.",
};
const RETIRED_ZOOM_TEMPLATE_NOTES =
  "Replace with observed zoom suggestion, preview, and export behavior.";
const RETIRED_EXTENSION_ID_PLACEHOLDERS = new Set([
  "replace-with-32-character-unpacked-extension-id",
  "replace-with-extension-id",
]);
const RETIRED_TESTER_EMAIL_PLACEHOLDER = "tester@example.com";

export const mergeTemplateDefaults = (defaults, existing) => {
  if (existing === undefined) return defaults;
  if (Array.isArray(defaults)) {
    if (!Array.isArray(existing)) return existing;
    const length = Math.max(defaults.length, existing.length);
    return Array.from({ length }, (_, index) =>
      index < defaults.length
        ? mergeTemplateDefaults(defaults[index], existing[index])
        : existing[index]
    );
  }
  if (defaults && typeof defaults === "object") {
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return existing;
    }
    const merged = { ...existing };
    for (const [key, value] of Object.entries(defaults)) {
      merged[key] = mergeTemplateDefaults(value, existing[key]);
    }
    return merged;
  }
  return existing;
};

export const migrateRetiredTemplatePlaceholders = (
  template,
  canonicalTemplate
) => {
  let migrated = template;
  if (
    template?.zoom &&
    typeof template.zoom === "object" &&
    !Array.isArray(template.zoom)
  ) {
    const zoom = { ...template.zoom };
    for (const [key, retiredValue] of Object.entries(
      RETIRED_ZOOM_TEMPLATE_PLACEHOLDERS
    )) {
      if (zoom[key] === retiredValue) delete zoom[key];
    }
    if (zoom.notes === RETIRED_ZOOM_TEMPLATE_NOTES) {
      zoom.notes = canonicalTemplate.zoom?.notes;
    }
    migrated = { ...migrated, zoom };
  }
  if (
    template?.tester &&
    typeof template.tester === "object" &&
    !Array.isArray(template.tester) &&
    template.tester.email === RETIRED_TESTER_EMAIL_PLACEHOLDER
  ) {
    const tester = { ...template.tester };
    delete tester.email;
    migrated = { ...migrated, tester };
  }
  return migrated;
};

export const mergeAndMigrateManualTemplate = (canonicalTemplate, evidence) =>
  migrateRetiredTemplatePlaceholders(
    mergeTemplateDefaults(canonicalTemplate, evidence),
    canonicalTemplate
  );

export const buildSynchronizedManualTemplate = ({
  canonicalTemplate,
  evidence,
  releaseVersion,
  automatedEvidenceGeneratedAt,
  environmentPrefill = {},
}) => {
  const sessionMatchesAutomatedEvidence =
    evidence?.releaseVersion === releaseVersion &&
    evidence?.automatedEvidenceGeneratedAt === automatedEvidenceGeneratedAt;
  const mergedTemplate = mergeAndMigrateManualTemplate(
    canonicalTemplate,
    evidence
  );
  const synchronizedEnvironment = {
    ...(mergedTemplate.environment || {}),
    extensionSource: "build",
    cleanChromeProfile: true,
  };
  for (const field of ["os", "chromeVersion", "unpackedExtensionId"]) {
    const detectedValue = environmentPrefill[field];
    if (
      typeof detectedValue === "string" &&
      detectedValue.trim().length > 0 &&
      (synchronizedEnvironment[field] ===
        canonicalTemplate.environment?.[field] ||
        (field === "unpackedExtensionId" &&
          RETIRED_EXTENSION_ID_PLACEHOLDERS.has(
            synchronizedEnvironment[field]
          )))
    ) {
      synchronizedEnvironment[field] = detectedValue.trim();
    }
  }
  return {
    ...mergedTemplate,
    releaseVersion,
    automatedEvidencePath: "release-artifacts/release-qa-automated.json",
    automatedEvidenceGeneratedAt,
    manualSession: sessionMatchesAutomatedEvidence
      ? mergedTemplate.manualSession
      : canonicalTemplate.manualSession,
    environment: synchronizedEnvironment,
  };
};

export const analyzeManualTemplateSync = ({
  canonicalTemplate,
  evidence,
  automatedEvidence,
}) => {
  const reasons = [];
  const mergedTemplate = mergeTemplateDefaults(canonicalTemplate, evidence);
  if (JSON.stringify(mergedTemplate) !== JSON.stringify(evidence)) {
    reasons.push("canonical template fields are missing");
  }
  if (
    JSON.stringify(
      migrateRetiredTemplatePlaceholders(mergedTemplate, canonicalTemplate)
    ) !== JSON.stringify(mergedTemplate)
  ) {
    reasons.push("retired template placeholders are still present");
  }
  if (evidence.releaseVersion !== automatedEvidence.releaseVersion) {
    reasons.push("release version is stale");
  }
  if (
    evidence.automatedEvidencePath !==
    "release-artifacts/release-qa-automated.json"
  ) {
    reasons.push("automated evidence path is stale");
  }
  if (evidence.automatedEvidenceGeneratedAt !== automatedEvidence.generatedAt) {
    reasons.push("automated evidence timestamp is stale");
  }
  if (evidence.environment?.extensionSource !== "build") {
    reasons.push("extension source is not build");
  }
  if (evidence.environment?.cleanChromeProfile !== true) {
    reasons.push("clean Chrome profile provenance is stale");
  }
  return { required: reasons.length > 0, reasons };
};
