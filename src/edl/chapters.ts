const DEFAULT_MIN_SECTION_SECONDS = 8;
const DEFAULT_PAUSE_SECONDS = 1.2;
const MAX_LABEL_WORDS = 5;

export interface ChapterWord {
  text?: unknown;
  start?: unknown;
  end?: unknown;
}

export interface ChapterMarker {
  id: string;
  time: number;
  label: string;
  source: string;
}

export interface ChapterMarkerInput {
  id?: string;
  time?: unknown;
  label?: unknown;
  source?: unknown;
}

export interface SilenceSuggestion {
  kind?: string;
  end?: unknown;
}

export interface ChapterActivityEvent {
  type?: unknown;
  time?: unknown;
  label?: unknown;
}

export interface BuildChapterMarkersOptions {
  transcript?: { words?: ChapterWord[] } | null;
  silenceSuggestions?: SilenceSuggestion[];
  activityEvents?: ChapterActivityEvent[];
  duration?: number;
  minSectionSeconds?: number;
  pauseSeconds?: number;
  maxMarkers?: number;
}

const isFiniteTime = (value: unknown): boolean => Number.isFinite(Number(value));

const cleanWord = (text: unknown): string =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim();

const makeLabel = (words: readonly ChapterWord[], startTime: number, fallback: string): string => {
  const label = words
    .filter((word) => Number(word?.end) >= startTime - 0.1)
    .slice(0, MAX_LABEL_WORDS)
    .map((word) => cleanWord(word.text))
    .filter(Boolean)
    .join(" ");
  if (!label) return fallback;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const normalizeTime = (time: unknown, duration = Infinity): number =>
  Math.max(0, Math.min(Number(time) || 0, duration));

const markerId = (source: string, time: unknown): string =>
  `chapter-${source}-${Math.round((Number(time) || 0) * 1000)}`;

const pushMarker = (
  markers: ChapterMarker[],
  marker: ChapterMarker,
  minSectionSeconds: number,
): void => {
  const last = markers[markers.length - 1];
  if (last && marker.time - last.time < minSectionSeconds) return;
  markers.push(marker);
};

export const normalizeChapterMarkers = (
  markers: readonly ChapterMarkerInput[] = [],
  { duration = Infinity, maxMarkers = 40 } = {},
): ChapterMarker[] => {
  if (!Array.isArray(markers)) return [];
  const normalized = markers
    .map((marker, index) => {
      if (!isFiniteTime(marker?.time)) return null;
      const time = normalizeTime(marker.time, duration);
      return {
        id: marker.id || markerId(cleanWord(marker.source) || "manual", `${time}-${index}`),
        time,
        label: cleanWord(marker.label) || `Section ${index + 1}`,
        source: cleanWord(marker.source) || "manual",
      };
    })
    .filter((marker): marker is ChapterMarker => marker !== null)
    .sort((a, b) => a.time - b.time);

  const unique: ChapterMarker[] = [];
  for (const marker of normalized) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.time - marker.time) < 0.25) continue;
    unique.push(marker);
  }
  return unique.slice(0, maxMarkers);
};

export const buildChapterMarkers = ({
  transcript = null,
  silenceSuggestions = [],
  activityEvents = [],
  duration = Infinity,
  minSectionSeconds = DEFAULT_MIN_SECTION_SECONDS,
  pauseSeconds = DEFAULT_PAUSE_SECONDS,
  maxMarkers = 20,
}: BuildChapterMarkersOptions = {}): ChapterMarker[] => {
  const sourceDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : Infinity;
  const words = Array.isArray(transcript?.words) ? transcript.words : [];
  const markers: ChapterMarker[] = [
    {
      id: markerId("start", 0),
      time: 0,
      label: makeLabel(words, 0, "Start"),
      source: "start",
    },
  ];

  for (let i = 0; i < words.length - 1; i += 1) {
    const currentEnd = Number(words[i]?.end);
    const nextStart = Number(words[i + 1]?.start);
    if (!Number.isFinite(currentEnd) || !Number.isFinite(nextStart)) continue;
    if (nextStart - currentEnd < pauseSeconds) continue;
    pushMarker(
      markers,
      {
        id: markerId("transcript-pause", nextStart),
        time: normalizeTime(nextStart, sourceDuration),
        label: makeLabel(words.slice(i + 1), nextStart, `Section ${markers.length + 1}`),
        source: "transcript-pause",
      },
      minSectionSeconds,
    );
  }

  for (const silence of silenceSuggestions) {
    if (silence?.kind !== "silence" || !isFiniteTime(silence.end)) continue;
    const time = normalizeTime(silence.end, sourceDuration);
    pushMarker(
      markers,
      {
        id: markerId("audio-silence", time),
        time,
        label: makeLabel(words, time, `Section ${markers.length + 1}`),
        source: "audio-silence",
      },
      minSectionSeconds,
    );
  }

  for (const event of activityEvents) {
    if (!isFiniteTime(event?.time)) continue;
    const time = normalizeTime(event.time, sourceDuration);
    pushMarker(
      markers,
      {
        id: markerId(cleanWord(event.type) || "activity", time),
        time,
        label: cleanWord(event.label) || makeLabel(words, time, `Section ${markers.length + 1}`),
        source: cleanWord(event.type) || "activity",
      },
      minSectionSeconds,
    );
  }

  return normalizeChapterMarkers(markers, {
    duration: sourceDuration,
    maxMarkers,
  });
};
