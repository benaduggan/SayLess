export interface StreamingData {
  micActive: unknown;
  defaultAudioInput: unknown;
  defaultAudioOutput: unknown;
  defaultVideoInput: unknown;
  systemAudio: unknown;
  recordingType: unknown;
}

export const getStreamingData = async (): Promise<StreamingData | null> => {
  try {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: { get: (keys: string[]) => Promise<Record<string, unknown>> };
          };
        };
      }
    ).chrome;
    const {
      micActive,
      defaultAudioInput,
      defaultAudioOutput,
      defaultVideoInput,
      systemAudio,
      recordingType,
    } = await chromeApi.storage.local.get([
      "micActive",
      "defaultAudioInput",
      "defaultAudioOutput",
      "defaultVideoInput",
      "systemAudio",
      "recordingType",
    ]);

    return {
      micActive,
      defaultAudioInput,
      defaultAudioOutput,
      defaultVideoInput,
      systemAudio,
      recordingType,
    };
  } catch (error) {
    console.error("Failed to retrieve streaming data:", error);
    return null;
  }
};
