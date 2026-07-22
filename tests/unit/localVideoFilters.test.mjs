import assert from "node:assert/strict";
import test from "node:test";

import {
  filterLocalVideos,
  isRecordedToday,
  videoMatchesSearch,
} from "../../src/pages/Content/popup/layout/localVideoFilters.ts";

const NOW = new Date("2026-07-15T18:00:00Z").getTime();

const entries = [
  {
    id: "today-transcript",
    title: "API demo",
    createdAt: new Date("2026-07-15T12:00:00Z").getTime(),
    byteSize: 20 * 1024 * 1024,
    editedAt: 1784150000000,
    backendRef: { backend: "opfs" },
    project: {
      transcript: {
        words: [{ text: "offline" }, { text: "workflow" }],
      },
    },
  },
  {
    id: "large-old",
    title: "Long architecture review",
    createdAt: new Date("2026-07-10T12:00:00Z").getTime(),
    byteSize: 180 * 1024 * 1024,
    blobKey: "original:large-old",
    project: null,
  },
  {
    id: "missing",
    title: "Broken capture",
    createdAt: new Date("2026-07-12T12:00:00Z").getTime(),
    byteSize: 4 * 1024 * 1024,
    project: null,
  },
];

test("isRecordedToday uses local calendar day boundaries", () => {
  assert.equal(isRecordedToday(entries[0], NOW), true);
  assert.equal(isRecordedToday(entries[1], NOW), false);
});

test("videoMatchesSearch covers title, storage, and transcript text", () => {
  assert.equal(videoMatchesSearch(entries[0], "api"), true);
  assert.equal(videoMatchesSearch(entries[0], "offline workflow"), true);
  assert.equal(videoMatchesSearch(entries[0], "opfs"), true);
  assert.equal(videoMatchesSearch(entries[0], "nope"), false);
});

test("filterLocalVideos combines roadmap filters", () => {
  const healthById = {
    missing: { ok: false, status: "local-recording-blob-missing" },
  };

  assert.deepEqual(
    filterLocalVideos(entries, {
      filters: ["today", "transcript", "edited"],
      healthById,
      now: NOW,
    }).map((entry) => entry.id),
    ["today-transcript"],
  );

  assert.deepEqual(
    filterLocalVideos(entries, {
      filters: ["large"],
      healthById,
      now: NOW,
    }).map((entry) => entry.id),
    ["large-old"],
  );

  assert.deepEqual(
    filterLocalVideos(entries, {
      query: "capture",
      filters: ["missing"],
      healthById,
      now: NOW,
    }).map((entry) => entry.id),
    ["missing"],
  );
});
