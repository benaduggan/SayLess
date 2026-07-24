export interface TranscriptWordSelection {
  anchorWordIndex: number;
  focusWordIndex: number;
}

export interface TranscriptWordIndexRange {
  fromIndex: number;
  toIndex: number;
}

export function updateTranscriptWordSelection(
  selection: TranscriptWordSelection | null,
  wordIndex: number,
  extend: boolean,
): TranscriptWordSelection {
  if (extend && selection) {
    return { ...selection, focusWordIndex: wordIndex };
  }

  if (
    selection &&
    selection.anchorWordIndex === selection.focusWordIndex &&
    selection.anchorWordIndex !== wordIndex
  ) {
    return { ...selection, focusWordIndex: wordIndex };
  }

  return { anchorWordIndex: wordIndex, focusWordIndex: wordIndex };
}

export function selectedTranscriptWordIndexes(
  displayWordIndexes: readonly number[],
  selection: TranscriptWordSelection | null,
): number[] {
  if (!selection) return [];

  const anchorPosition = displayWordIndexes.indexOf(selection.anchorWordIndex);
  const focusPosition = displayWordIndexes.indexOf(selection.focusWordIndex);
  if (anchorPosition < 0 || focusPosition < 0) return [];

  const from = Math.min(anchorPosition, focusPosition);
  const to = Math.max(anchorPosition, focusPosition);
  return displayWordIndexes.slice(from, to + 1);
}

export function contiguousTranscriptWordIndexRanges(
  wordIndexes: readonly number[],
): TranscriptWordIndexRange[] {
  const sortedIndexes = Array.from(
    new Set(wordIndexes.filter((index) => Number.isInteger(index) && index >= 0)),
  ).sort((left, right) => left - right);
  if (!sortedIndexes.length) return [];

  const ranges: TranscriptWordIndexRange[] = [];
  let fromIndex = sortedIndexes[0];
  let toIndex = fromIndex;

  for (const index of sortedIndexes.slice(1)) {
    if (index === toIndex + 1) {
      toIndex = index;
      continue;
    }
    ranges.push({ fromIndex, toIndex });
    fromIndex = index;
    toIndex = index;
  }

  ranges.push({ fromIndex, toIndex });
  return ranges;
}
