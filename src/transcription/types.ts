// Shared data shapes for transcription.
//
// A Transcript is the single substrate shared by:
//   - the transcription providers (who produce it),
//   - edit-by-transcript (which maps word selections -> EDL edits), and
//   - captions (which render words on a timeline).
// Keep it provider-agnostic: every provider must normalize to this shape.

export interface Word {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: Word[];
  speaker?: string;
}

export interface Transcript {
  version: 1;
  language: string;
  words: Word[];
  segments?: TranscriptSegment[];
  providerId?: string;
}

export interface TranscribeInput {
  blob?: Blob;
  audio?: AudioBuffer;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface TranscriptionProviderOptions {
  [key: string]: unknown;
}

export interface TranscriptionProvider {
  id: string;
  label: string;
  requiresNetwork?: boolean;
  isAvailable: (options?: TranscriptionProviderOptions) => Promise<boolean>;
  transcribe: (
    input: TranscribeInput,
    options?: TranscriptionProviderOptions,
  ) => Promise<Transcript>;
}
