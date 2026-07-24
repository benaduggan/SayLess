export const MEDIA_PERMISSION_TYPES = ["camera", "microphone"] as const;
export type MediaPermissionType = (typeof MEDIA_PERMISSION_TYPES)[number];
export type MediaPermissionState = PermissionState | "unknown";

interface PermissionsLike {
  query: (descriptor: { name: MediaPermissionType }) => Promise<PermissionStatus>;
}

interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
}

export interface MediaPermissionResult {
  success: true;
  cameraPermission: boolean;
  microphonePermission: boolean;
  cameraPermissionState: MediaPermissionState;
  microphonePermissionState: MediaPermissionState;
  audioinput: Array<{ deviceId: string; label: string }>;
  audiooutput: Array<{ deviceId: string; label: string }>;
  videoinput: Array<{ deviceId: string; label: string }>;
  error?: string;
}

const permissionNameFor = (type: MediaPermissionType): MediaPermissionType => type;

const constraintsFor = (types: readonly MediaPermissionType[]): MediaStreamConstraints => ({
  video: types.includes("camera"),
  audio: types.includes("microphone"),
});

const stopStream = (stream: MediaStream | null): void => {
  stream?.getTracks?.().forEach((track) => track.stop());
};

export const queryMediaPermissionStates = async (
  permissions: PermissionsLike = navigator.permissions as unknown as PermissionsLike,
): Promise<Record<MediaPermissionType, PermissionStatus | null>> => {
  const entries = await Promise.all(
    MEDIA_PERMISSION_TYPES.map(async (type) => {
      try {
        const status = await permissions.query({
          name: permissionNameFor(type),
        });
        return [type, status] as const;
      } catch {
        return [type, null] as const;
      }
    }),
  );

  return Object.fromEntries(entries) as Record<MediaPermissionType, PermissionStatus | null>;
};

export const collectMediaPermissionResult = async ({
  permissions = navigator.permissions,
  mediaDevices = navigator.mediaDevices,
  requestedTypes = [],
  request = false,
}: {
  permissions?: PermissionsLike;
  mediaDevices?: MediaDevicesLike;
  requestedTypes?: MediaPermissionType[];
  request?: boolean;
} = {}): Promise<MediaPermissionResult> => {
  const statuses = await queryMediaPermissionStates(permissions);
  const requestSucceeded = new Set();
  let requestError: unknown = null;

  if (request) {
    // Request each kind independently. A missing/blocked microphone must not
    // make an otherwise usable camera look denied (and vice versa).
    for (const type of requestedTypes.filter((candidate) =>
      MEDIA_PERMISSION_TYPES.includes(candidate),
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

  const refreshedStatuses = request ? await queryMediaPermissionStates(permissions) : statuses;
  const states = Object.fromEntries(
    MEDIA_PERMISSION_TYPES.map((type) => [
      type,
      requestSucceeded.has(type) ? "granted" : refreshedStatuses[type]?.state || "unknown",
    ]),
  ) as Record<MediaPermissionType, MediaPermissionState>;

  let devices: MediaDeviceInfo[] = [];
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
    ...(requestError
      ? {
          error: requestError instanceof Error ? requestError.name : "unknown",
        }
      : {}),
  };
};
