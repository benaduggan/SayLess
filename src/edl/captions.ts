import { clipWords } from "./timeline.ts";
import type { Timeline } from "./timeline.ts";
import type { Word } from "../transcription/types.ts";

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionCue extends CaptionWord {}

export interface CaptionProject {
  transcript?: { words?: Word[] } | null;
  timeline?: Timeline | null;
}

export interface CaptionCueOptions {
  maxGapSeconds?: number;
  maxWords?: number;
  maxDurationSeconds?: number;
}

export const CAPTION_STYLE_PRESET_DETAILS = Object.freeze({
  clean: Object.freeze({
    fontScale: 0.042,
    boxAlpha: 0.72,
    textColor: "#ffffff",
    boxColor: "#111827",
    strokeColor: "rgba(0, 0, 0, 0.55)",
  }),
  large: Object.freeze({
    fontScale: 0.058,
    boxAlpha: 0.78,
    textColor: "#ffffff",
    boxColor: "#0f172a",
    strokeColor: "rgba(0, 0, 0, 0.65)",
  }),
  "high-contrast": Object.freeze({
    fontScale: 0.052,
    boxAlpha: 0.92,
    textColor: "#ffffff",
    boxColor: "#000000",
    strokeColor: "#000000",
  }),
});

export const sanitizeCaptionText = (text: unknown): string =>
  String(text || "")
    .replace(/-->/g, "->")
    .replace(/[\r\n]+/g, " ")
    .trim();

export function normalizeCaptionWords(project: CaptionProject | null): CaptionWord[] {
  const words = Array.isArray(project?.transcript?.words)
    ? project.transcript.words
    : [];
  if (!words.length) return [];
  if (project?.timeline?.version === 2) {
    try {
      return clipWords(project.timeline, words)
        .filter((group) => !group.muted)
        .flatMap((group) =>
          group.words.map((word) => ({
            text: word.text,
            start: word.outStart,
            end: word.outEnd,
          })),
        )
        .filter(isValidCaptionWord);
    } catch {
      // Fall back to source-time words if a future timeline shape is unsupported.
    }
  }
  return words
    .map((word) => ({
      text: word.text,
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter(isValidCaptionWord);
}

export function buildCaptionCues(
  words: readonly CaptionWord[],
  {
    maxGapSeconds = 0.8,
    maxWords = 7,
    maxDurationSeconds = 4,
  }: CaptionCueOptions = {},
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let current: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (!current || !current.words.length) return;
    cues.push({
      start: current.start,
      end: current.end,
      text: current.words.join(" "),
    });
    current = null;
  };
  for (const word of words || []) {
    const text = sanitizeCaptionText(word.text);
    if (!text) continue;
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    if (
      !current ||
      start - current.end > maxGapSeconds ||
      current.words.length >= maxWords ||
      end - current.start > maxDurationSeconds
    ) {
      flush();
      current = { start, end, words: [text] };
    } else {
      current.end = end;
      current.words.push(text);
    }
  }
  flush();
  return cues;
}

function isValidCaptionWord(word: CaptionWord): boolean {
  return (
    Boolean(sanitizeCaptionText(word.text)) &&
    Number.isFinite(Number(word.start)) &&
    Number.isFinite(Number(word.end)) &&
    Number(word.end) > Number(word.start)
  );
}
