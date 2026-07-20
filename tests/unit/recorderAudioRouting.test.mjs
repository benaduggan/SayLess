import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecorderAudioRouteSnapshot,
  getRecorderAudioRoute,
  shouldUseDirectMicTrack,
  shouldRejectMicEnableWithoutMixer,
} from "../../src/pages/Recorder/recorderAudioRouting.js";

test("shouldUseDirectMicTrack bypasses Web Audio for mic-only capture", () => {
  assert.equal(
    shouldUseDirectMicTrack({
      micTrackCount: 1,
      systemTrackCount: 0,
      systemAudio: false,
    }),
    true,
  );
});

test("shouldUseDirectMicTrack keeps Web Audio for mic plus system audio", () => {
  assert.equal(
    shouldUseDirectMicTrack({
      micTrackCount: 1,
      systemTrackCount: 1,
      systemAudio: true,
    }),
    false,
  );
});

test("shouldUseDirectMicTrack ignores unused captured system tracks", () => {
  assert.equal(
    shouldUseDirectMicTrack({
      micTrackCount: 1,
      systemTrackCount: 1,
      systemAudio: false,
    }),
    true,
  );
});

test("getRecorderAudioRoute attaches a direct mic track for mic-only capture", () => {
  assert.deepEqual(
    getRecorderAudioRoute({
      micTrackCount: 1,
      systemTrackCount: 0,
      systemAudio: false,
    }),
    {
      useDirectMicTrack: true,
      connectMicToMixer: false,
      connectSystemToMixer: false,
      attachMixedAudioTrack: false,
      stopUnusedSystemTrack: false,
    },
  );
});

test("getRecorderAudioRoute mixes mic and requested system audio", () => {
  assert.deepEqual(
    getRecorderAudioRoute({
      micTrackCount: 1,
      systemTrackCount: 1,
      systemAudio: true,
    }),
    {
      useDirectMicTrack: false,
      connectMicToMixer: true,
      connectSystemToMixer: true,
      attachMixedAudioTrack: true,
      stopUnusedSystemTrack: false,
    },
  );
});

test("getRecorderAudioRoute records requested system audio without mic", () => {
  assert.deepEqual(
    getRecorderAudioRoute({
      micTrackCount: 0,
      systemTrackCount: 1,
      systemAudio: true,
    }),
    {
      useDirectMicTrack: false,
      connectMicToMixer: false,
      connectSystemToMixer: true,
      attachMixedAudioTrack: true,
      stopUnusedSystemTrack: false,
    },
  );
});

test("getRecorderAudioRoute stops unused system audio during mic-only capture", () => {
  assert.deepEqual(
    getRecorderAudioRoute({
      micTrackCount: 1,
      systemTrackCount: 1,
      systemAudio: false,
    }),
    {
      useDirectMicTrack: true,
      connectMicToMixer: false,
      connectSystemToMixer: false,
      attachMixedAudioTrack: false,
      stopUnusedSystemTrack: true,
    },
  );
});

test("getRecorderAudioRoute leaves no audio track when no source is active", () => {
  assert.deepEqual(
    getRecorderAudioRoute({
      micTrackCount: 0,
      systemTrackCount: 0,
      systemAudio: false,
    }),
    {
      useDirectMicTrack: false,
      connectMicToMixer: false,
      connectSystemToMixer: false,
      attachMixedAudioTrack: false,
      stopUnusedSystemTrack: false,
    },
  );
});

test("buildRecorderAudioRouteSnapshot records direct mic track evidence", () => {
  const route = getRecorderAudioRoute({
    micTrackCount: 1,
    systemTrackCount: 0,
    systemAudio: false,
  });
  const micTrack = {
    label: "USB Mic",
    enabled: true,
    readyState: "live",
    getSettings() {
      return {
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        deviceId: "mic-1",
      };
    },
  };
  const liveStream = {
    getAudioTracks() {
      return [micTrack];
    },
  };

  assert.deepEqual(
    buildRecorderAudioRouteSnapshot({
      route,
      audioContextSampleRate: 48000,
      micTrack,
      liveStream,
      at: 123,
    }),
    {
      at: 123,
      mode: "direct-mic",
      audioContextSampleRate: 48000,
      route,
      liveStreamAudioTrackCount: 1,
      micTrack: {
        label: "USB Mic",
        enabled: true,
        readyState: "live",
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        deviceId: "mic-1",
      },
      systemTrack: null,
      liveAudioTrack: {
        label: "USB Mic",
        enabled: true,
        readyState: "live",
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        deviceId: "mic-1",
      },
    },
  );
});

test("buildRecorderAudioRouteSnapshot supports direct mic without an AudioContext", () => {
  const route = getRecorderAudioRoute({
    micTrackCount: 1,
    systemTrackCount: 0,
    systemAudio: false,
  });
  const micTrack = {
    label: "Direct Mic",
    enabled: true,
    readyState: "live",
    getSettings() {
      return { sampleRate: 48000, channelCount: 1 };
    },
  };

  const snapshot = buildRecorderAudioRouteSnapshot({
    route,
    audioContextSampleRate: null,
    micTrack,
    liveStream: { getAudioTracks: () => [micTrack] },
    at: 789,
  });

  assert.equal(snapshot.mode, "direct-mic");
  assert.equal(snapshot.audioContextSampleRate, null);
  assert.equal(snapshot.liveStreamAudioTrackCount, 1);
  assert.equal(snapshot.liveAudioTrack.sampleRate, 48000);
});

test("buildRecorderAudioRouteSnapshot records no-audio starts explicitly", () => {
  const route = getRecorderAudioRoute({
    micTrackCount: 0,
    systemTrackCount: 0,
    systemAudio: false,
  });

  assert.deepEqual(
    buildRecorderAudioRouteSnapshot({
      route,
      audioContextSampleRate: 48000,
      liveStream: { getAudioTracks: () => [] },
      at: 456,
    }),
    {
      at: 456,
      mode: "no-audio",
      audioContextSampleRate: 48000,
      route,
      liveStreamAudioTrackCount: 0,
      micTrack: null,
      systemTrack: null,
      liveAudioTrack: null,
    },
  );
});

test("shouldRejectMicEnableWithoutMixer rejects enabling when no mixer exists", () => {
  assert.equal(
    shouldRejectMicEnableWithoutMixer({
      requestedActive: true,
      hasAudioContext: false,
      hasDestination: false,
    }),
    true,
  );
  assert.equal(
    shouldRejectMicEnableWithoutMixer({
      requestedActive: true,
      hasAudioContext: true,
      hasDestination: false,
    }),
    true,
  );
});

test("shouldRejectMicEnableWithoutMixer allows disabling or mixer-backed enabling", () => {
  assert.equal(
    shouldRejectMicEnableWithoutMixer({
      requestedActive: false,
      hasAudioContext: false,
      hasDestination: false,
    }),
    false,
  );
  assert.equal(
    shouldRejectMicEnableWithoutMixer({
      requestedActive: true,
      hasAudioContext: true,
      hasDestination: true,
    }),
    false,
  );
});
