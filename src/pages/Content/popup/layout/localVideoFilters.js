export const LOCAL_VIDEO_FILTERS = [
  { id: "today", label: "Today" },
  { id: "transcript", label: "Transcript" },
  { id: "edited", label: "Edited" },
  { id: "large", label: "Large" },
  { id: "missing", label: "Missing" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_RECORDING_BYTES = 100 * 1024 * 1024;

const textIncludes = (value, needle) =>
  String(value || "").toLowerCase().includes(needle);

export const isRecordedToday = (entry, now = Date.now()) => {
  const createdAt = Number(entry?.createdAt || entry?.updatedAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return createdAt >= start.getTime() && createdAt < start.getTime() + DAY_MS;
};

export const videoMatchesSearch = (entry, query) => {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const transcriptWords = entry?.project?.transcript?.words;
  const transcriptText = Array.isArray(transcriptWords)
    ? transcriptWords.map((word) => word.text).join(" ")
    : transcriptWords;
  return (
    textIncludes(entry?.title, needle) ||
    textIncludes(entry?.mimeType, needle) ||
    textIncludes(entry?.backendRef?.backend, needle) ||
    textIncludes(entry?.project?.transcript?.text, needle) ||
    textIncludes(transcriptText, needle)
  );
};

export const videoMatchesFilters = (
  entry,
  activeFilters = [],
  { health = null, now = Date.now(), largeBytes = LARGE_RECORDING_BYTES } = {},
) => {
  const filters = new Set(activeFilters);
  if (filters.has("today") && !isRecordedToday(entry, now)) return false;
  if (filters.has("transcript") && !entry?.project?.transcript) return false;
  if (filters.has("edited") && !entry?.editedAt) return false;
  if (filters.has("large") && (Number(entry?.byteSize) || 0) < largeBytes) {
    return false;
  }
  if (filters.has("missing") && health?.ok !== false) return false;
  return true;
};

export const filterLocalVideos = (
  videos,
  { query = "", filters = [], healthById = {}, now = Date.now(), largeBytes } = {},
) =>
  (Array.isArray(videos) ? videos : []).filter((entry) => {
    const health = healthById?.[entry?.id] || null;
    return (
      videoMatchesSearch(entry, query) &&
      videoMatchesFilters(entry, filters, { health, now, largeBytes })
    );
  });
