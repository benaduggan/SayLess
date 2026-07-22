export interface StreamingDataPayload {
  micActive: boolean;
  defaultAudioInput: string | null;
  defaultAudioOutput: string | null;
  defaultVideoInput: string | null;
  systemAudio: boolean;
  recordingType: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const normalizeStreamingDataPayload = (
  value: unknown
): StreamingDataPayload | null => {
  if (!isRecord(value)) return null;
  return {
    micActive: value.micActive === true,
    defaultAudioInput: optionalString(value.defaultAudioInput),
    defaultAudioOutput: optionalString(value.defaultAudioOutput),
    defaultVideoInput: optionalString(value.defaultVideoInput),
    systemAudio: value.systemAudio === true,
    recordingType: optionalString(value.recordingType) ?? "screen",
  };
};

export const parseStreamingDataPayload = (
  serialized: unknown
): StreamingDataPayload | null => {
  if (typeof serialized !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return normalizeStreamingDataPayload(parsed);
  } catch {
    return null;
  }
};
