export const LOCAL_VIDEO_FILTERS = [
  { id: "today", label: "Today" },
  { id: "transcript", label: "Transcript" },
  { id: "edited", label: "Edited" },
  { id: "large", label: "Large" },
  { id: "missing", label: "Missing" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_RECORDING_BYTES = 100 * 1024 * 1024;

export interface LocalVideoEntry {
  id?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  title?: unknown;
  mimeType?: unknown;
  byteSize?: unknown;
  editedAt?: unknown;
  backendRef?: { backend?: unknown } | null;
  project?: {
    transcript?: { text?: unknown; words?: unknown } | null;
  } | null;
}

export interface LocalVideoHealth {
  ok?: boolean;
}

const textIncludes = (value: unknown, needle: string): boolean =>
  String(value || "")
    .toLowerCase()
    .includes(needle);

export const isRecordedToday = (entry: LocalVideoEntry | null, now = Date.now()): boolean => {
  const createdAt = Number(entry?.createdAt || entry?.updatedAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return createdAt >= start.getTime() && createdAt < start.getTime() + DAY_MS;
};

export const videoMatchesSearch = (entry: LocalVideoEntry | null, query: unknown): boolean => {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  const transcriptWords = entry?.project?.transcript?.words;
  const transcriptText = Array.isArray(transcriptWords)
    ? transcriptWords
        .map((word) =>
          typeof word === "object" && word && "text" in word
            ? (word as { text?: unknown }).text
            : "",
        )
        .join(" ")
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
  entry: LocalVideoEntry | null,
  activeFilters: readonly string[] = [],
  {
    health = null,
    now = Date.now(),
    largeBytes = LARGE_RECORDING_BYTES,
  }: {
    health?: LocalVideoHealth | null;
    now?: number;
    largeBytes?: number;
  } = {},
): boolean => {
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
  videos: unknown,
  {
    query = "",
    filters = [],
    healthById = {},
    now = Date.now(),
    largeBytes,
  }: {
    query?: unknown;
    filters?: string[];
    healthById?: Record<string, LocalVideoHealth | null>;
    now?: number;
    largeBytes?: number;
  } = {},
): LocalVideoEntry[] =>
  (Array.isArray(videos) ? videos : []).filter((entry) => {
    const health = healthById?.[entry?.id] || null;
    return (
      videoMatchesSearch(entry, query) &&
      videoMatchesFilters(entry, filters, { health, now, largeBytes })
    );
  });
