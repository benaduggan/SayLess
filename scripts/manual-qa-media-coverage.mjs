export const MIN_LONG_RECORDING_DURATION_SECONDS = 180;
export const MIN_LARGE_RECORDING_BYTE_SIZE = 25 * 1024 * 1024;

const REQUIRED_RECORDING_FORMATS = ["mp4", "webm"];
const REQUIRED_PROJECT_AUDIO_FORMATS = ["wav", "m4a", "mp3"];
const uniqueSorted = (values) => [...new Set(values)].sort();

export const buildReleaseThresholds = ({ durationSeconds, byteSize }) => ({
  durationAtLeast180Seconds:
    durationSeconds >= MIN_LONG_RECORDING_DURATION_SECONDS,
  byteSizeAtLeast25MiB: byteSize >= MIN_LARGE_RECORDING_BYTE_SIZE,
  longAndLarge:
    durationSeconds >= MIN_LONG_RECORDING_DURATION_SECONDS &&
    byteSize >= MIN_LARGE_RECORDING_BYTE_SIZE,
});

export const buildReleaseCoverage = (files) => {
  const recordingCandidates = files.filter((file) => file.recordingFields);
  const projectAudioCandidates = files.filter(
    (file) => file.projectAudioInputFields
  );
  const recordingFormats = uniqueSorted(
    recordingCandidates.map((file) => file.format)
  );
  const dimensionPairs = uniqueSorted(
    recordingCandidates.map(
      (file) => `${file.video.width}x${file.video.height}`
    )
  );
  const aspectRatios = uniqueSorted(
    recordingCandidates.map((file) =>
      Number((file.video.width / file.video.height).toFixed(4))
    )
  );
  const longAndLargeCandidates = recordingCandidates
    .filter((file) => file.releaseThresholds.longAndLarge)
    .map((file) => file.fileName);
  const projectAudioFormats = uniqueSorted(
    projectAudioCandidates.map((file) => file.format)
  );
  const checks = [
    {
      id: "source-recording-count",
      label: "At least two MP4/WebM source-recording candidates",
      passed: recordingCandidates.length >= 2,
    },
    {
      id: "source-container-coverage",
      label: "MP4 and WebM source-container candidates",
      passed: REQUIRED_RECORDING_FORMATS.every((format) =>
        recordingFormats.includes(format)
      ),
    },
    {
      id: "long-and-large-source",
      label: "One source candidate at least 180 seconds and 25 MiB",
      passed: longAndLargeCandidates.length > 0,
    },
    {
      id: "varied-video-geometry",
      label: "At least two distinct video dimension pairs and aspect ratios",
      passed: dimensionPairs.length >= 2 && aspectRatios.length >= 2,
    },
    {
      id: "project-audio-formats",
      label: "WAV, M4A, and MP3 project-audio candidates",
      passed: REQUIRED_PROJECT_AUDIO_FORMATS.every((format) =>
        projectAudioFormats.includes(format)
      ),
    },
  ];
  const passedCheckCount = checks.filter((check) => check.passed).length;
  return {
    status:
      passedCheckCount === checks.length
        ? "measurable-set-complete"
        : "incomplete",
    passedCheckCount,
    totalCheckCount: checks.length,
    recordingCandidateCount: recordingCandidates.length,
    recordingFormats,
    dimensionPairs,
    aspectRatios,
    longAndLargeCandidates,
    projectAudioCandidateCount: projectAudioCandidates.length,
    projectAudioFormats,
    checks,
    remainingMeasurableRequirements: checks
      .filter((check) => !check.passed)
      .map((check) => check.label),
    limitations: [
      "Confirm which video files are original source recordings rather than exports.",
      "Record capture source, microphones, noise environments, speakers, click metadata, and all playback or perceptual observations manually.",
    ],
  };
};
