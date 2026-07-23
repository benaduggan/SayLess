const MEDIA_REPORT_KIND = "sayless.manualQaMediaProbe";
const SIDECAR_REPORT_KIND = "sayless.manualQaSidecarProbe";
const SIDECAR_EXPORT_FORMATS = new Set([
  "vtt",
  "transcript-json",
  "sayless-project-json",
]);

const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const isSha256 = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

const isPositiveNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const buildFileMap = (report, label, errors) => {
  const files = Array.isArray(report?.files) ? report.files : [];
  if (!Array.isArray(report?.files)) {
    errors.push(`${label} files must be an array.`);
  } else if (report.fileCount !== files.length) {
    errors.push(`${label} fileCount must match files.length.`);
  }
  const map = new Map();
  for (const [index, file] of files.entries()) {
    if (typeof file?.fileName !== "string" || !file.fileName.trim()) {
      errors.push(`${label} files[${index}].fileName is required.`);
      continue;
    }
    if (map.has(file.fileName)) {
      errors.push(`${label} fileName must be unique: ${file.fileName}.`);
      continue;
    }
    map.set(file.fileName, file);
  }
  return map;
};

const recordChanges = (target, measured, fields, path, changes) => {
  for (const field of fields) {
    const before = target[field];
    const after = measured[field];
    if (before !== after) {
      target[field] = after;
      changes.push({ path: `${path}.${field}`, before, after });
    }
  }
};

const requireMeasuredIdentity = (file, label, errors) => {
  if (!isPositiveInteger(file?.byteSize)) {
    errors.push(`${label} measured byteSize must be a positive integer.`);
  }
  if (!isSha256(file?.sha256)) {
    errors.push(`${label} measured sha256 must be a 64-character SHA-256.`);
  }
};

const requireRecordingFields = (file, label, errors) => {
  const fields = file.recordingFields;
  if (
    fields.fileName !== file.fileName ||
    fields.sha256 !== file.sha256 ||
    fields.byteSize !== file.byteSize
  ) {
    errors.push(
      `${label} recordingFields must match the measured file identity.`
    );
  }
  if (!isPositiveNumber(fields.durationSeconds)) {
    errors.push(`${label} measured durationSeconds must be positive.`);
  }
  if (!isPositiveInteger(fields.width) || !isPositiveInteger(fields.height)) {
    errors.push(
      `${label} measured width and height must be positive integers.`
    );
  }
  if (!["mp4", "webm"].includes(fields.container)) {
    errors.push(`${label} measured container must be mp4 or webm.`);
  }
};

const requireProjectAudioFields = (file, label, errors) => {
  const fields = file.projectAudioInputFields;
  if (
    fields.fileName !== file.fileName ||
    fields.sha256 !== file.sha256 ||
    fields.byteSize !== file.byteSize
  ) {
    errors.push(
      `${label} projectAudioInputFields must match the measured file identity.`
    );
  }
  if (!isPositiveNumber(fields.durationSeconds)) {
    errors.push(`${label} measured durationSeconds must be positive.`);
  }
  if (!isPositiveInteger(fields.channels)) {
    errors.push(`${label} measured channels must be a positive integer.`);
  }
  if (!isPositiveInteger(fields.sampleRate)) {
    errors.push(`${label} measured sampleRate must be a positive integer.`);
  }
};

export const buildManualQaMeasurementImport = ({
  evidence,
  mediaReport,
  sidecarReport,
}) => {
  const errors = [];
  if (evidence?.kind !== "sayless.manualQaEvidence") {
    errors.push("manual QA evidence kind must be sayless.manualQaEvidence.");
  }
  if (evidence?.status !== "template") {
    errors.push(
      'manual QA evidence status must be "template"; passed evidence is never rewritten.'
    );
  }
  if (!isIsoDate(evidence?.automatedEvidenceGeneratedAt)) {
    errors.push(
      "manual QA evidence automatedEvidenceGeneratedAt must be an ISO UTC timestamp."
    );
  }
  if (
    evidence?.probeReports?.media !==
      "release-artifacts/manual-qa-media-probe.json" ||
    evidence?.probeReports?.sidecars !==
      "release-artifacts/manual-qa-sidecar-probe.json"
  ) {
    errors.push(
      "manual QA evidence must reference both canonical probe reports."
    );
  }
  if (mediaReport?.kind !== MEDIA_REPORT_KIND) {
    errors.push(`media report kind must be ${MEDIA_REPORT_KIND}.`);
  }
  if (
    mediaReport?.status !== "measured" ||
    mediaReport?.requireComplete !== true ||
    mediaReport?.releaseCoverage?.status !== "measurable-set-complete"
  ) {
    errors.push("media report must be a strict, measurably complete report.");
  }
  if (
    mediaReport?.reportPath !== "release-artifacts/manual-qa-media-probe.json"
  ) {
    errors.push("media report must name its canonical report path.");
  }
  if (sidecarReport?.kind !== SIDECAR_REPORT_KIND) {
    errors.push(`sidecar report kind must be ${SIDECAR_REPORT_KIND}.`);
  }
  if (
    sidecarReport?.status !== "inspected" ||
    sidecarReport?.requireComplete !== true ||
    sidecarReport?.coverage?.status !== "structurally-complete"
  ) {
    errors.push(
      "sidecar report must be a strict, structurally complete report."
    );
  }
  if (
    sidecarReport?.reportPath !==
    "release-artifacts/manual-qa-sidecar-probe.json"
  ) {
    errors.push("sidecar report must name its canonical report path.");
  }
  for (const [label, report] of [
    ["media report", mediaReport],
    ["sidecar report", sidecarReport],
  ]) {
    if (!isIsoDate(report?.generatedAt)) {
      errors.push(`${label} generatedAt must be an ISO UTC timestamp.`);
    } else if (
      isIsoDate(evidence?.automatedEvidenceGeneratedAt) &&
      Date.parse(report.generatedAt) <
        Date.parse(evidence.automatedEvidenceGeneratedAt)
    ) {
      errors.push(`${label} must be generated after automated QA evidence.`);
    }
  }

  const mediaFiles = buildFileMap(mediaReport, "media report", errors);
  const sidecarFiles = buildFileMap(sidecarReport, "sidecar report", errors);
  const updated = JSON.parse(JSON.stringify(evidence));
  const changes = [];

  const recordings = Array.isArray(updated.recordings)
    ? updated.recordings
    : [];
  for (const [index, recording] of recordings.entries()) {
    const label = `recordings[${index}]`;
    const measured = mediaFiles.get(recording?.fileName);
    if (!measured) {
      errors.push(
        `${label}.fileName must exactly match a file in the media report.`
      );
      continue;
    }
    if (!measured.recordingFields) {
      errors.push(
        `${label}.fileName must identify a measured MP4/WebM source.`
      );
      continue;
    }
    requireMeasuredIdentity(measured, label, errors);
    requireRecordingFields(measured, label, errors);
    recordChanges(
      recording,
      measured.recordingFields,
      ["sha256", "durationSeconds", "byteSize", "width", "height", "container"],
      label,
      changes
    );
  }

  const exports = Array.isArray(updated?.exports?.files)
    ? updated.exports.files
    : [];
  for (const [index, exported] of exports.entries()) {
    const label = `exports.files[${index}]`;
    const reportFiles = SIDECAR_EXPORT_FORMATS.has(exported?.format)
      ? sidecarFiles
      : mediaFiles;
    const measured = reportFiles.get(exported?.fileName);
    if (!measured) {
      errors.push(
        `${label}.fileName must exactly match its file in the ${
          SIDECAR_EXPORT_FORMATS.has(exported?.format) ? "sidecar" : "media"
        } report.`
      );
      continue;
    }
    if (measured.format !== exported.format) {
      errors.push(
        `${label}.format ${exported.format} does not match measured format ${measured.format}.`
      );
      continue;
    }
    requireMeasuredIdentity(measured, label, errors);
    recordChanges(exported, measured, ["byteSize", "sha256"], label, changes);
  }

  const projectAudioInputs = Array.isArray(updated?.projectAudio?.inputs)
    ? updated.projectAudio.inputs
    : [];
  for (const [index, input] of projectAudioInputs.entries()) {
    const label = `projectAudio.inputs[${index}]`;
    const measured = mediaFiles.get(input?.fileName);
    if (!measured) {
      errors.push(
        `${label}.fileName must exactly match a file in the media report.`
      );
      continue;
    }
    if (!measured.projectAudioInputFields) {
      errors.push(
        `${label}.fileName must identify a measured WAV, M4A, or MP3 input.`
      );
      continue;
    }
    if (measured.projectAudioInputFields.format !== input.format) {
      errors.push(
        `${label}.format ${input.format} does not match measured format ${measured.projectAudioInputFields.format}.`
      );
      continue;
    }
    requireMeasuredIdentity(measured, label, errors);
    requireProjectAudioFields(measured, label, errors);
    recordChanges(
      input,
      measured.projectAudioInputFields,
      ["sha256", "byteSize", "durationSeconds", "channels", "sampleRate"],
      label,
      changes
    );
  }

  if (!recordings.length || !exports.length || !projectAudioInputs.length) {
    errors.push(
      "manual QA evidence must contain recordings, exports.files, and projectAudio.inputs."
    );
  }
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return {
    evidence: updated,
    changes,
    matched: {
      recordings: recordings.length,
      exports: exports.length,
      projectAudioInputs: projectAudioInputs.length,
    },
  };
};
