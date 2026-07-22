const DEVICE_ID_ERRORS = new Set(["OverconstrainedError", "NotFoundError"]);

const getErrorName = (err: unknown): string | null =>
  err instanceof DOMException || err instanceof Error ? err.name : null;

const isDeviceIdError = (err: unknown): boolean => {
  const name = getErrorName(err);
  return name !== null && DEVICE_ID_ERRORS.has(name);
};

// Bluetooth/USB audio devices commonly return NotReadableError for 1-2s
// after wake/connect while the OS spins up the endpoint. A short retry
// turns the "headphones didn't record" complaint into a one-second pause.
const TRANSIENT_RETRY_DELAYS_MS = [350, 700];
const isTransientReadError = (err: unknown): boolean => {
  const name = getErrorName(err);
  return name === "NotReadableError" || name === "AbortError";
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Constraints can contain nested objects (deviceId.exact) so a deep clone is required.
const cloneConstraints = (
  constraints: MediaStreamConstraints,
): MediaStreamConstraints => {
  const src = constraints || {};
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(src);
    } catch {}
  }
  return JSON.parse(JSON.stringify(src)) as MediaStreamConstraints;
};

const updateConstraintsDeviceId = (
  constraints: MediaStreamConstraints,
  kind: MediaDeviceKind,
  deviceId: string,
): void => {
  if (!constraints || !deviceId) return;

  if (kind === "audioinput") {
    if (!constraints.audio || typeof constraints.audio !== "object") return;
    constraints.audio = {
      ...constraints.audio,
      deviceId: { exact: deviceId },
    };
    return;
  }

  if (kind === "videoinput") {
    if (!constraints.video || typeof constraints.video !== "object") return;
    constraints.video = {
      ...constraints.video,
      deviceId: { exact: deviceId },
    };
  }
};

export const enumerateCurrentDevices = async (): Promise<MediaDeviceInfo[]> => {
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    console.warn("Failed to enumerate devices:", err);
    return [];
  }
};

export const resolveDeviceIdByLabel = async (
  kind: MediaDeviceKind,
  desiredLabel: string,
): Promise<string | null> => {
  if (!desiredLabel) return null;
  const devices = await enumerateCurrentDevices();
  const matches = devices.filter(
    (device) => device.kind === kind && device.label === desiredLabel
  );
  if (matches.length !== 1) return null;
  return matches[0].deviceId;
};

const attemptGetUserMediaWithTransientRetry = async (
  constraints: MediaStreamConstraints,
): Promise<MediaStream> => {
  let lastErr: unknown = new Error("get-user-media-failed");
  const attempts = [0, ...TRANSIENT_RETRY_DELAYS_MS];
  for (let i = 0; i < attempts.length; i += 1) {
    if (attempts[i] > 0) await sleep(attempts[i]);
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Permission/overconstrained errors must bail immediately so
      // callers can run their label fallback or surface the prompt.
      if (!isTransientReadError(err)) break;
    }
  }
  throw lastErr;
};

export const getUserMediaWithFallback = async ({
  constraints,
  fallbacks = [],
}: {
  constraints: MediaStreamConstraints;
  fallbacks?: DeviceFallback[];
}): Promise<MediaStream> => {
  try {
    return await attemptGetUserMediaWithTransientRetry(constraints);
  } catch (err) {
    if (!isDeviceIdError(err) || fallbacks.length === 0) {
      throw err;
    }

    const nextConstraints = cloneConstraints(constraints);
    const resolved: Array<DeviceFallback & { resolvedId: string }> = [];

    for (const fallback of fallbacks) {
      const { kind, desiredLabel, desiredDeviceId } = fallback || {};
      if (!kind || !desiredLabel || !desiredDeviceId) continue;
      const resolvedId = await resolveDeviceIdByLabel(kind, desiredLabel);
      if (!resolvedId || resolvedId === desiredDeviceId) continue;
      updateConstraintsDeviceId(nextConstraints, kind, resolvedId);
      resolved.push({ ...fallback, resolvedId });
    }

    if (resolved.length === 0) {
      throw err;
    }

    console.warn(
      "[SayLess] Retrying getUserMedia with label-matched device IDs"
    );

    const stream = await attemptGetUserMediaWithTransientRetry(
      nextConstraints,
    );
    resolved.forEach(({ resolvedId, onResolved }) => {
      if (typeof onResolved === "function") {
        onResolved(resolvedId);
      }
    });
    return stream;
  }
};

export interface DeviceFallback {
  kind: "audioinput" | "videoinput";
  desiredLabel: string;
  desiredDeviceId: string;
  onResolved?: (resolvedId: string) => void;
}
