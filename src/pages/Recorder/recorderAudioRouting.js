export function shouldUseDirectMicTrack({
  micTrackCount,
  systemTrackCount,
  systemAudio,
}) {
  return getRecorderAudioRoute({
    micTrackCount,
    systemTrackCount,
    systemAudio,
  }).useDirectMicTrack;
}

export function getRecorderAudioRoute({
  micTrackCount,
  systemTrackCount,
  systemAudio,
}) {
  const hasMicTrack = Number(micTrackCount) > 0;
  const hasSystemTrack = Number(systemTrackCount) > 0;
  const useSystemAudio = hasSystemTrack && Boolean(systemAudio);
  const useDirectMicTrack = hasMicTrack && !useSystemAudio;
  const connectMicToMixer = hasMicTrack && !useDirectMicTrack;
  const connectSystemToMixer = useSystemAudio;

  return {
    useDirectMicTrack,
    connectMicToMixer,
    connectSystemToMixer,
    attachMixedAudioTrack: connectMicToMixer || connectSystemToMixer,
    stopUnusedSystemTrack: hasSystemTrack && !useSystemAudio,
  };
}

const getTrackSettings = (track) => {
  try {
    return track?.getSettings?.() || {};
  } catch {
    return {};
  }
};

const describeAudioTrack = (track) => {
  if (!track) return null;
  const settings = getTrackSettings(track);
  return {
    label: String(track.label || "").slice(0, 80),
    enabled: track.enabled ?? null,
    readyState: track.readyState ?? null,
    sampleRate: settings.sampleRate ?? null,
    channelCount: settings.channelCount ?? null,
    echoCancellation: settings.echoCancellation ?? null,
    noiseSuppression: settings.noiseSuppression ?? null,
    autoGainControl: settings.autoGainControl ?? null,
    deviceId: settings.deviceId ?? null,
  };
};

export function getRecorderAudioRouteMode(route) {
  if (route?.useDirectMicTrack) return "direct-mic";
  if (route?.connectMicToMixer && route?.connectSystemToMixer) {
    return "mixed-mic-system";
  }
  if (route?.connectMicToMixer) return "mixed-mic";
  if (route?.connectSystemToMixer) return "mixed-system";
  return "no-audio";
}

export function buildRecorderAudioRouteSnapshot({
  route,
  audioContextSampleRate = null,
  micTrack = null,
  systemTrack = null,
  liveStream = null,
  at = Date.now(),
}) {
  const liveAudioTracks = liveStream?.getAudioTracks?.() ?? [];
  return {
    at,
    mode: getRecorderAudioRouteMode(route),
    audioContextSampleRate,
    route: {
      useDirectMicTrack: Boolean(route?.useDirectMicTrack),
      connectMicToMixer: Boolean(route?.connectMicToMixer),
      connectSystemToMixer: Boolean(route?.connectSystemToMixer),
      attachMixedAudioTrack: Boolean(route?.attachMixedAudioTrack),
      stopUnusedSystemTrack: Boolean(route?.stopUnusedSystemTrack),
    },
    liveStreamAudioTrackCount: liveAudioTracks.length,
    micTrack: describeAudioTrack(micTrack),
    systemTrack: describeAudioTrack(systemTrack),
    liveAudioTrack: describeAudioTrack(liveAudioTracks[0] || null),
  };
}

export function shouldRejectMicEnableWithoutMixer({
  requestedActive,
  hasAudioContext,
  hasDestination,
}) {
  return (
    Boolean(requestedActive) &&
    !(Boolean(hasAudioContext) && Boolean(hasDestination))
  );
}
