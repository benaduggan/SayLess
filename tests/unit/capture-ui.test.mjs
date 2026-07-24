import assert from "node:assert/strict";
import test from "node:test";

import {
  isRecorderToolbarHidden,
  shouldEnableAnnotationPointerEvents,
  shouldShowRecorderToast,
} from "../../src/pages/Content/captureUi.ts";

test("capture-clean mode hides recorder chrome without disabling annotations", () => {
  const state = {
    drawingMode: true,
    hideToolbar: true,
    hideUI: true,
    hideUIAlerts: true,
  };

  assert.equal(isRecorderToolbarHidden(state), true);
  assert.equal(shouldShowRecorderToast(state), false);
  assert.equal(shouldEnableAnnotationPointerEvents(state), true);
});

test("notification-only hiding suppresses recorder hints without hiding controls", () => {
  const state = {
    drawingMode: false,
    hideToolbar: false,
    hideUI: false,
    hideUIAlerts: true,
  };

  assert.equal(isRecorderToolbarHidden(state), false);
  assert.equal(shouldShowRecorderToast(state), false);
  assert.equal(shouldEnableAnnotationPointerEvents(state), false);
});
