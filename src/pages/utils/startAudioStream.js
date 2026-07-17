// Microphone acquisition shared by recorder contexts.
// getUserMediaWithFallback re-resolves the device by label if the id drifted;
// falls back to generic getUserMedia({ audio: ... }) before giving up with null.
// Per-page options:
//   bailOnNone:     return null for a "none"/empty id (Recorder)
//   bluetoothDiag:  diag-forward when the mic comes up at a low sample rate (Recorder)
//   toastOnBlocked: toast when even the generic fallback fails.
//   logger:         optional { debug, warn } for dev breadcrumbs
import { getUserMediaWithFallback } from "./mediaDeviceFallback";

const buildAudioConstraints = (id) => {
  const base = {
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: false },
  };
  return id && id !== "none"
    ? { ...base, deviceId: { exact: id } }
    : base;
};

export async function startAudioStream(
  id,
  { bailOnNone = false, bluetoothDiag = false, toastOnBlocked = false, logger = null } = {},
) {
  logger?.debug?.("startAudioStream()", { id });

  // "none" sentinel: bail before getUserMedia grabs the default mic (Recorder only).
  if (bailOnNone && (!id || id === "none")) {
    logger?.debug?.("startAudioStream() skipped: no audio input selected");
    return null;
  }

  const useExact = id && id !== "none";
  const audioStreamOptions = {
    mimeType: "video/webm;codecs=vp8,opus",
    audio: buildAudioConstraints(useExact ? id : null),
  };

  const { defaultAudioInputLabel, audioinput } = await chrome.storage.local.get([
    "defaultAudioInputLabel",
    "audioinput",
  ]);
  const desiredLabel =
    defaultAudioInputLabel ||
    audioinput?.find((device) => device.deviceId === id)?.label ||
    "";

  try {
    const stream = await getUserMediaWithFallback({
      constraints: audioStreamOptions,
      fallbacks:
        useExact && desiredLabel
          ? [
              {
                kind: "audioinput",
                desiredDeviceId: id,
                desiredLabel,
                onResolved: (resolvedId) => {
                  chrome.storage.local.set({
                    defaultAudioInput: resolvedId,
                    defaultAudioInputLabel: desiredLabel,
                  });
                },
              },
            ]
          : [],
    });

    if (bluetoothDiag && stream) {
      // BT mic switches A2DP (48k) to HFP (8/16k mono); the 48k AudioContext then upsamples garbage.
      try {
        const aTrack = stream.getAudioTracks?.()[0];
        const trackSampleRate = Number(aTrack?.getSettings?.()?.sampleRate) || null;
        if (trackSampleRate && trackSampleRate <= 24000) {
          const label = String(aTrack?.label || "").slice(0, 80);
          console.warn(
            "[recorder] mic acquired at low sample rate; likely Bluetooth HFP profile",
            { trackSampleRate, label },
          );
          try {
            chrome.runtime.sendMessage({
              type: "diag-forward",
              event: "recorder-low-sample-rate-mic",
              data: { trackSampleRate, label },
            });
          } catch {}
          try {
            chrome.runtime.sendMessage({
              type: "show-toast",
              message:
                "Your microphone is running in a low-quality Bluetooth call mode. Use the built-in mic, a wired mic, or switch your Bluetooth headphones to a different input.",
              timeout: 10000,
            });
          } catch {}
        }
      } catch {}
    }

    return stream;
  } catch (err) {
    logger?.warn?.("startAudioStream() exact device failed, retrying generic", err);
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(null),
      });
    } catch (err2) {
      logger?.warn?.("startAudioStream() failed completely", err2);
      if (toastOnBlocked) {
        try {
          chrome.runtime.sendMessage({
            type: "show-toast",
            message: "Microphone permission is blocked. Recording will be silent.",
          });
        } catch {}
      }
      return null;
    }
  }
}
