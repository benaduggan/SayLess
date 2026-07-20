export const MEDIA_PERMISSION_TYPES = ["camera", "microphone"];

const permissionNameFor = (type) => type;

const constraintsFor = (types) => ({
  video: types.includes("camera"),
  audio: types.includes("microphone"),
});

const stopStream = (stream) => {
  stream?.getTracks?.().forEach((track) => track.stop());
};

export const queryMediaPermissionStates = async (
  permissions = navigator.permissions
) => {
  const entries = await Promise.all(
    MEDIA_PERMISSION_TYPES.map(async (type) => {
      try {
        const status = await permissions.query({
          name: permissionNameFor(type),
        });
        return [type, status];
      } catch {
        return [type, null];
      }
    })
  );

  return Object.fromEntries(entries);
};

export const collectMediaPermissionResult = async ({
  permissions = navigator.permissions,
  mediaDevices = navigator.mediaDevices,
  requestedTypes = [],
  request = false,
} = {}) => {
  const statuses = await queryMediaPermissionStates(permissions);
  const requestSucceeded = new Set();
  let requestError = null;

  if (request) {
    // Request each kind independently. A missing/blocked microphone must not
    // make an otherwise usable camera look denied (and vice versa).
    for (const type of requestedTypes.filter((candidate) =>
      MEDIA_PERMISSION_TYPES.includes(candidate)
    )) {
      if (statuses[type]?.state === "granted") continue;
      try {
        const stream = await mediaDevices.getUserMedia(constraintsFor([type]));
        stopStream(stream);
        requestSucceeded.add(type);
      } catch (error) {
        requestError ||= error;
      }
    }
  }

  const refreshedStatuses = request
    ? await queryMediaPermissionStates(permissions)
    : statuses;
  const states = Object.fromEntries(
    MEDIA_PERMISSION_TYPES.map((type) => [
      type,
      requestSucceeded.has(type)
        ? "granted"
        : refreshedStatuses[type]?.state || "unknown",
    ])
  );

  let devices = [];
  try {
    devices = await mediaDevices.enumerateDevices();
  } catch (error) {
    requestError ||= error;
  }

  const cameraPermission = states.camera === "granted";
  const microphonePermission = states.microphone === "granted";

  return {
    success: true,
    cameraPermission,
    microphonePermission,
    cameraPermissionState: states.camera,
    microphonePermissionState: states.microphone,
    audioinput: microphonePermission
      ? devices
          .filter((device) => device.kind === "audioinput")
          .map(({ deviceId, label }) => ({ deviceId, label }))
      : [],
    audiooutput: microphonePermission
      ? devices
          .filter((device) => device.kind === "audiooutput")
          .map(({ deviceId, label }) => ({ deviceId, label }))
      : [],
    videoinput: cameraPermission
      ? devices
          .filter((device) => device.kind === "videoinput")
          .map(({ deviceId, label }) => ({ deviceId, label }))
      : [],
    ...(requestError ? { error: requestError.name || "unknown" } : {}),
  };
};
