// Shared data shapes for transcription. Plain JS + JSDoc to match the editor
// (EditorApp is .js/.jsx; only the mediabunny render libs are .ts).
//
// A Transcript is the single substrate shared by:
//   - the transcription providers (who produce it),
//   - edit-by-transcript (which maps word selections -> EDL edits), and
//   - captions (which render words on a timeline).
// Keep it provider-agnostic: every provider must normalize to this shape.

/**
 * @typedef {Object} Word
 * @property {string} text        The token as displayed (whitespace/punctuation preserved by the renderer).
 * @property {number} start       Start time in SECONDS, relative to the media's source timeline.
 * @property {number} end         End time in SECONDS.
 * @property {number} [confidence] 0..1 if the provider reports it.
 */

/**
 * @typedef {Object} TranscriptSegment
 * A sentence/paragraph grouping for display. Optional; derived from words if absent.
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {Word[]} words
 * @property {string} [speaker]   Optional diarization label.
 */

/**
 * @typedef {Object} Transcript
 * @property {1} version
 * @property {string} language    BCP-47 (e.g. "en", "en-US"); "auto" if detected unknown.
 * @property {Word[]} words       Flat, time-ordered word list (the source of truth).
 * @property {TranscriptSegment[]} [segments] Optional display grouping.
 * @property {string} [providerId] Which provider produced this (for cache/debug).
 */

/**
 * @typedef {Object} TranscribeInput
 * @property {Blob} [blob]            Media or audio blob to transcribe.
 * @property {AudioBuffer} [audio]    Decoded audio (alternative to blob).
 * @property {string} [language]      Hint, or "auto".
 * @property {AbortSignal} [signal]   For cancellation.
 * @property {(p: number) => void} [onProgress] 0..1 progress.
 */

/**
 * The contract every transcription provider implements. Registered by `id`
 * and selected at runtime from config, so the engine is provider-agnostic.
 *
 * @typedef {Object} TranscriptionProvider
 * @property {string} id                         Stable key (e.g. "local-whisper", "remote-api").
 * @property {string} label                      Human label for settings UI.
 * @property {boolean} [requiresNetwork]         True if it phones out (gate under privacy mode).
 * @property {(opts?: object) => Promise<boolean>} isAvailable  Cheap check: model present / endpoint configured.
 * @property {(input: TranscribeInput, opts?: object) => Promise<Transcript>} transcribe
 */

export {};
