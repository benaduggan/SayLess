import test from "node:test";
import assert from "node:assert/strict";

import {
  beginExportJobState,
  cancelExportJobState,
  createExportJob,
  dismissExportJobState,
  finishExportJobState,
  updateExportJobProgressState,
} from "../../src/pages/EditorApp/context/exportJobState.js";

test("createExportJob builds a running export job with stable defaults", () => {
  const job = createExportJob({}, 101);

  assert.deepEqual(job, {
    id: "export-101",
    kind: "export",
    label: "Export",
    status: "running",
    progress: 0,
    canCancel: true,
    canRetry: false,
    startedAt: 101,
    completedAt: null,
    error: null,
  });
});

test("beginExportJobState starts a job and clears stale reveal download id", () => {
  const next = beginExportJobState(
    {
      exportJob: null,
      lastExportDownloadId: 42,
      untouched: true,
    },
    { kind: "mp4", label: "MP4 export", canCancel: false },
    202,
  );

  assert.equal(next.untouched, true);
  assert.equal(next.lastExportDownloadId, null);
  assert.deepEqual(next.exportJob, {
    id: "mp4-202",
    kind: "mp4",
    label: "MP4 export",
    status: "running",
    progress: 0,
    canCancel: false,
    canRetry: false,
    startedAt: 202,
    completedAt: null,
    error: null,
  });
});

test("updateExportJobProgressState clamps rounded progress while running", () => {
  const base = { exportJob: createExportJob({ kind: "gif" }, 1) };

  assert.equal(updateExportJobProgressState(base, 55.6).exportJob.progress, 56);
  assert.equal(updateExportJobProgressState(base, -10).exportJob.progress, 0);
  assert.equal(updateExportJobProgressState(base, 125).exportJob.progress, 100);
});

test("updateExportJobProgressState ignores missing or non-running jobs", () => {
  const empty = { exportJob: null };
  const completed = {
    exportJob: { ...createExportJob({}, 1), status: "completed", progress: 100 },
  };

  assert.equal(updateExportJobProgressState(empty, 50), empty);
  assert.equal(updateExportJobProgressState(completed, 50), completed);
});

test("finishExportJobState completes a running job and forces progress to 100", () => {
  const base = updateExportJobProgressState(
    { exportJob: createExportJob({ kind: "webm" }, 1) },
    35,
  );
  const next = finishExportJobState(base, { status: "completed" }, 303);

  assert.equal(next.exportJob.status, "completed");
  assert.equal(next.exportJob.progress, 100);
  assert.equal(next.exportJob.canCancel, false);
  assert.equal(next.exportJob.canRetry, false);
  assert.equal(next.exportJob.completedAt, 303);
  assert.equal(next.exportJob.error, null);
});

test("finishExportJobState marks failures retryable and preserves progress", () => {
  const base = updateExportJobProgressState(
    { exportJob: createExportJob({ kind: "mp4" }, 1) },
    64,
  );
  const next = finishExportJobState(
    base,
    { status: "failed", error: "Export failed." },
    404,
  );

  assert.equal(next.exportJob.status, "failed");
  assert.equal(next.exportJob.progress, 64);
  assert.equal(next.exportJob.canCancel, false);
  assert.equal(next.exportJob.canRetry, true);
  assert.equal(next.exportJob.completedAt, 404);
  assert.equal(next.exportJob.error, "Export failed.");
});

test("finishExportJobState marks save-dialog cancellations retryable", () => {
  const base = updateExportJobProgressState(
    { exportJob: createExportJob({ kind: "audio" }, 1) },
    82,
  );
  const next = finishExportJobState(base, { status: "cancelled" }, 405);

  assert.equal(next.exportJob.status, "cancelled");
  assert.equal(next.exportJob.progress, 82);
  assert.equal(next.exportJob.canCancel, false);
  assert.equal(next.exportJob.canRetry, true);
  assert.equal(next.exportJob.completedAt, 405);
});

test("finishExportJobState ignores missing or non-running jobs", () => {
  const empty = { exportJob: null };
  const failed = {
    exportJob: { ...createExportJob({}, 1), status: "failed", progress: 10 },
  };

  assert.equal(finishExportJobState(empty, { status: "completed" }, 2), empty);
  assert.equal(finishExportJobState(failed, { status: "completed" }, 2), failed);
});

test("cancelExportJobState resets download flags and makes running job retryable", () => {
  const base = updateExportJobProgressState(
    {
      downloading: true,
      downloadingWEBM: true,
      downloadingGIF: true,
      isFfmpegRunning: true,
      processingProgress: 72,
      exportJob: createExportJob({ kind: "webm" }, 1),
    },
    72,
  );
  const next = cancelExportJobState(base, 505);

  assert.equal(next.downloading, false);
  assert.equal(next.downloadingWEBM, false);
  assert.equal(next.downloadingGIF, false);
  assert.equal(next.isFfmpegRunning, false);
  assert.equal(next.processingProgress, 0);
  assert.equal(next.exportJob.status, "cancelled");
  assert.equal(next.exportJob.progress, 72);
  assert.equal(next.exportJob.canCancel, false);
  assert.equal(next.exportJob.canRetry, true);
  assert.equal(next.exportJob.completedAt, 505);
});

test("cancelExportJobState leaves non-running job status unchanged", () => {
  const base = {
    downloading: true,
    exportJob: { ...createExportJob({}, 1), status: "completed" },
  };
  const next = cancelExportJobState(base, 2);

  assert.equal(next.downloading, false);
  assert.equal(next.exportJob, base.exportJob);
});

test("dismissExportJobState clears the job and preserves other state", () => {
  const next = dismissExportJobState({
    exportJob: createExportJob({}, 1),
    lastExportDownloadId: 9,
  });

  assert.equal(next.exportJob, null);
  assert.equal(next.lastExportDownloadId, 9);
});

test("export job lifecycle clears stale reveal ids before a retryable cancellation", () => {
  const completed = finishExportJobState(
    updateExportJobProgressState(
      beginExportJobState(
        { exportJob: null, lastExportDownloadId: 9 },
        { kind: "mp4", label: "MP4 export" },
        100,
      ),
      95,
    ),
    { status: "completed" },
    200,
  );
  const revealable = {
    ...completed,
    lastExportDownloadId: 44,
  };

  const retryStarted = beginExportJobState(
    revealable,
    { kind: "mp4", label: "MP4 export" },
    300,
  );
  const cancelled = cancelExportJobState(
    updateExportJobProgressState(retryStarted, 37),
    400,
  );

  assert.equal(completed.exportJob.status, "completed");
  assert.equal(retryStarted.lastExportDownloadId, null);
  assert.equal(cancelled.lastExportDownloadId, null);
  assert.equal(cancelled.exportJob.status, "cancelled");
  assert.equal(cancelled.exportJob.progress, 37);
  assert.equal(cancelled.exportJob.canRetry, true);
  assert.equal(cancelled.exportJob.canCancel, false);
});
