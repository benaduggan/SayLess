const DEFAULT_FILLER_WORDS = new Set([
  "ah",
  "ahh",
  "er",
  "erm",
  "hm",
  "hmm",
  "like",
  "uh",
  "uhh",
  "um",
  "umm",
]);

const DEFAULT_PHRASE_FILLERS = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];

const DEFAULT_SILENCE_THRESHOLD_DB = -45;

const normalizeToken = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

const rangeText = (words, startIndex, endIndex) =>
  words
    .slice(startIndex, endIndex + 1)
    .map((word) => word.text)
    .join(" ")
    .trim();

const makeWordSuggestion = ({
  id,
  kind,
  reason,
  words,
  startIndex,
  endIndex,
  action = "delete",
}) => {
  const first = words[startIndex];
  const last = words[endIndex];
  if (!first || !last) return null;
  return {
    id,
    kind,
    reason,
    action,
    start: Number(first.start) || 0,
    end: Number(last.end) || Number(first.end) || Number(first.start) || 0,
    fromIndex: startIndex,
    toIndex: endIndex,
    label: rangeText(words, startIndex, endIndex),
  };
};

const formatSeconds = (seconds) => `${seconds.toFixed(1)}s`;

const rangesOverlap = (a, b, tolerance = 0.08) =>
  a.start < b.end - tolerance && b.start < a.end - tolerance;

export const buildTranscriptSuggestions = (
  transcript,
  {
    minSilenceSeconds = 0.7,
    maxSuggestions = 20,
    fillerWords = DEFAULT_FILLER_WORDS,
    phraseFillers = DEFAULT_PHRASE_FILLERS,
  } = {},
) => {
  const words = Array.isArray(transcript?.words) ? transcript.words : [];
  const suggestions = [];

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const token = normalizeToken(word.text);
    if (!token) continue;

    const phrase = phraseFillers.find((candidate) =>
      candidate.every(
        (part, offset) => normalizeToken(words[i + offset]?.text) === part,
      ),
    );
    if (phrase) {
      const endIndex = i + phrase.length - 1;
      const suggestion = makeWordSuggestion({
        id: `filler-phrase-${i}-${endIndex}`,
        kind: "filler",
        reason: "Filler phrase",
        words,
        startIndex: i,
        endIndex,
      });
      if (suggestion) suggestions.push(suggestion);
      i = endIndex;
      continue;
    }

    if (fillerWords.has(token)) {
      const suggestion = makeWordSuggestion({
        id: `filler-word-${i}`,
        kind: "filler",
        reason: "Filler word",
        words,
        startIndex: i,
        endIndex: i,
      });
      if (suggestion) suggestions.push(suggestion);
      continue;
    }

    const prevToken = normalizeToken(words[i - 1]?.text);
    const prevPrevToken = normalizeToken(words[i - 2]?.text);
    if (token && token === prevToken && token !== prevPrevToken) {
      const suggestion = makeWordSuggestion({
        id: `repeat-word-${i}`,
        kind: "repeated-word",
        reason: "Repeated word",
        words,
        startIndex: i,
        endIndex: i,
      });
      if (suggestion) suggestions.push(suggestion);
    }
  }

  for (let i = 0; i < words.length - 1; i += 1) {
    const current = words[i];
    const next = words[i + 1];
    const start = Number(current?.end);
    const end = Number(next?.start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const gap = end - start;
    if (gap >= minSilenceSeconds) {
      suggestions.push({
        id: `silence-${i}-${i + 1}`,
        kind: "silence",
        reason: "Long pause",
        action: "delete",
        start,
        end,
        fromIndex: null,
        toIndex: null,
        label: `${formatSeconds(gap)} pause`,
      });
    }
  }

  return suggestions
    .filter((suggestion) => suggestion.end > suggestion.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, maxSuggestions);
};

export const buildAudioSilenceSuggestions = (
  audio,
  {
    frameSeconds = 0.05,
    minSilenceSeconds = 0.7,
    silenceThresholdDb = DEFAULT_SILENCE_THRESHOLD_DB,
    paddingSeconds = 0.08,
    maxSuggestions = 20,
  } = {},
) => {
  const sampleRate = Number(audio?.sampleRate);
  const channels = Array.isArray(audio?.channels) ? audio.channels : [];
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !channels.length) {
    return [];
  }

  const length = Math.max(
    0,
    ...channels.map((channel) => Number(channel?.length) || 0),
  );
  if (!length) return [];

  const frameSize = Math.max(1, Math.round(sampleRate * frameSeconds));
  const threshold = Math.pow(10, silenceThresholdDb / 20);
  const silentRanges = [];
  let currentStart = null;

  for (let frameStart = 0; frameStart < length; frameStart += frameSize) {
    const frameEnd = Math.min(length, frameStart + frameSize);
    let sumSquares = 0;
    let samples = 0;

    for (const channel of channels) {
      if (!channel?.length) continue;
      const end = Math.min(frameEnd, channel.length);
      for (let i = frameStart; i < end; i += 1) {
        const value = Number(channel[i]) || 0;
        sumSquares += value * value;
        samples += 1;
      }
    }

    const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
    const isSilent = rms <= threshold;
    if (isSilent && currentStart === null) {
      currentStart = frameStart;
    } else if (!isSilent && currentStart !== null) {
      silentRanges.push([currentStart, frameStart]);
      currentStart = null;
    }
  }
  if (currentStart !== null) silentRanges.push([currentStart, length]);

  return silentRanges
    .map(([startSample, endSample], index) => {
      const rawStart = startSample / sampleRate;
      const rawEnd = endSample / sampleRate;
      const rawDuration = rawEnd - rawStart;
      if (rawDuration < minSilenceSeconds) return null;

      const paddedStart = Math.min(rawEnd, rawStart + paddingSeconds);
      const paddedEnd = Math.max(rawStart, rawEnd - paddingSeconds);
      const start = paddedEnd > paddedStart ? paddedStart : rawStart;
      const end = paddedEnd > paddedStart ? paddedEnd : rawEnd;
      const duration = end - start;
      if (duration <= 0) return null;

      return {
        id: `audio-silence-${index}-${Math.round(start * 1000)}-${Math.round(end * 1000)}`,
        kind: "silence",
        reason: "Audio silence",
        action: "delete",
        start,
        end,
        fromIndex: null,
        toIndex: null,
        label: `${formatSeconds(duration)} silence`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, maxSuggestions);
};

export const mergeEditSuggestions = (...groups) => {
  const suggestions = groups
    .flat()
    .filter(
      (suggestion) =>
        suggestion &&
        Number.isFinite(Number(suggestion.start)) &&
        Number.isFinite(Number(suggestion.end)) &&
        Number(suggestion.end) > Number(suggestion.start),
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const suggestion of suggestions) {
    const duplicateSilence =
      suggestion.kind === "silence" &&
      merged.some(
        (existing) =>
          existing.kind === "silence" &&
          rangesOverlap(existing, suggestion),
      );
    if (!duplicateSilence) merged.push(suggestion);
  }
  return merged;
};
