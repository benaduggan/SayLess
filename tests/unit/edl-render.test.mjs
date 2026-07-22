import { test } from "node:test";
import assert from "node:assert/strict";

import { createEdl, addEdit } from "../../src/edl/model.ts";
import { planEdlOps, isEmptyEdl, applyEdl } from "../../src/edl/render.ts";

test("planEdlOps: mutes ascending, deletes descending, after mutes", () => {
  let edl = createEdl(20);
  edl = addEdit(edl, "delete", 2, 4, { id: "d1" });
  edl = addEdit(edl, "delete", 10, 12, { id: "d2" });
  edl = addEdit(edl, "mute", 6, 7, { id: "m1" });
  edl = addEdit(edl, "mute", 1, 1.5, { id: "m2" });
  assert.deepEqual(planEdlOps(edl), [
    { type: "mute", start: 1, end: 1.5 },
    { type: "mute", start: 6, end: 7 },
    { type: "cut", start: 10, end: 12 },
    { type: "cut", start: 2, end: 4 },
  ]);
});

test("isEmptyEdl", () => {
  assert.equal(isEmptyEdl(createEdl(5)), true);
  assert.equal(isEmptyEdl(addEdit(createEdl(5), "mute", 1, 2)), false);
});

test("applyEdl: returns source unchanged when no edits", async () => {
  const src = { tag: "src" };
  const out = await applyEdl(src, createEdl(10), {
    muteVideo: async () => ({ tag: "mute" }),
    cutVideo: async () => ({ tag: "cut" }),
  });
  assert.equal(out, src);
});

test("applyEdl: executes ops in order with correct shrinking duration", async () => {
  let edl = createEdl(20);
  edl = addEdit(edl, "delete", 2, 4, { id: "d1" }); // len 2
  edl = addEdit(edl, "delete", 10, 13, { id: "d2" }); // len 3
  edl = addEdit(edl, "mute", 6, 7, { id: "m1" });

  /** @type {any[]} */
  const calls = [];
  const out = await applyEdl(edl.source && "SRC", edl, {
    muteVideo: async (blob, s, e, dur) => {
      calls.push(["mute", s, e, dur]);
      return "after-mute";
    },
    cutVideo: async (blob, s, e, cut, dur) => {
      calls.push(["cut", s, e, dur]);
      return `after-cut-${s}`;
    },
  });

  assert.deepEqual(calls, [
    ["mute", 6, 7, 20], // mute first, full duration
    ["cut", 10, 13, 20], // later delete first, duration still 20
    ["cut", 2, 4, 17], // duration shrank by 3 after previous cut
  ]);
  assert.equal(out, "after-cut-2");
});
