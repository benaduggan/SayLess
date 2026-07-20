import assert from "node:assert/strict";
import test from "node:test";

import {
  collectMediaPermissionResult,
  queryMediaPermissionStates,
} from "../../src/pages/Permissions/mediaPermissions.js";

const createMocks = ({
  camera = "prompt",
  microphone = "prompt",
  requestResults = {},
} = {}) => {
  const states = { camera, microphone };
  const getUserMediaCalls = [];
  const stopped = [];
  const permissions = {
    async query({ name }) {
      return { state: states[name] };
    },
  };
  const mediaDevices = {
    async getUserMedia(constraints) {
      getUserMediaCalls.push(constraints);
      const type = constraints.video ? "camera" : "microphone";
      const result = requestResults[type] || "granted";
      if (result !== "granted") {
        throw Object.assign(new Error(result), { name: result });
      }
      states[type] = "granted";
      return {
        getTracks() {
          return [{ stop: () => stopped.push(type) }];
        },
      };
    },
    async enumerateDevices() {
      return [
        { kind: "videoinput", deviceId: "cam-1", label: "Camera" },
        { kind: "audioinput", deviceId: "mic-1", label: "Microphone" },
        { kind: "audiooutput", deviceId: "out-1", label: "Speakers" },
      ];
    },
  };
  return {
    permissions,
    mediaDevices,
    getUserMediaCalls,
    stopped,
    states,
  };
};

test("passive permission checks never trigger a browser permission prompt", async () => {
  const mocks = createMocks();

  const result = await collectMediaPermissionResult(mocks);

  assert.equal(mocks.getUserMediaCalls.length, 0);
  assert.equal(result.cameraPermission, false);
  assert.equal(result.microphonePermission, false);
  assert.equal(result.cameraPermissionState, "prompt");
  assert.equal(result.microphonePermissionState, "prompt");
});

test("granted permissions are reported independently with their devices", async () => {
  const mocks = createMocks({ camera: "granted", microphone: "denied" });

  const result = await collectMediaPermissionResult(mocks);

  assert.equal(result.cameraPermission, true);
  assert.equal(result.microphonePermission, false);
  assert.deepEqual(result.videoinput, [{ deviceId: "cam-1", label: "Camera" }]);
  assert.deepEqual(result.audioinput, []);
  assert.equal(mocks.getUserMediaCalls.length, 0);
});

test("an explicit request asks only for the selected media kind", async () => {
  const mocks = createMocks();

  const result = await collectMediaPermissionResult({
    ...mocks,
    request: true,
    requestedTypes: ["camera"],
  });

  assert.deepEqual(mocks.getUserMediaCalls, [{ video: true, audio: false }]);
  assert.deepEqual(mocks.stopped, ["camera"]);
  assert.equal(result.cameraPermission, true);
  assert.equal(result.microphonePermission, false);
  assert.equal(result.microphonePermissionState, "prompt");
});

test("a successful request wins when an embedded permission query stays stale", async () => {
  const mocks = createMocks();
  mocks.permissions.query = async () => ({ state: "prompt" });

  const result = await collectMediaPermissionResult({
    ...mocks,
    request: true,
    requestedTypes: ["camera"],
  });

  assert.equal(result.cameraPermission, true);
  assert.equal(result.cameraPermissionState, "granted");
});

test("a denied request does not erase a permission already granted", async () => {
  const mocks = createMocks({
    camera: "granted",
    microphone: "prompt",
    requestResults: { microphone: "NotAllowedError" },
  });

  const result = await collectMediaPermissionResult({
    ...mocks,
    request: true,
    requestedTypes: ["microphone"],
  });

  assert.equal(result.cameraPermission, true);
  assert.equal(result.microphonePermission, false);
  assert.equal(result.cameraPermissionState, "granted");
  assert.equal(result.error, "NotAllowedError");
});

test("permission query failures remain unknown instead of being treated as denied", async () => {
  const result = await queryMediaPermissionStates({
    async query({ name }) {
      if (name === "camera") throw new TypeError("unsupported");
      return { state: "granted" };
    },
  });

  assert.equal(result.camera, null);
  assert.equal(result.microphone.state, "granted");
});
