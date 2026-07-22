import assert from "node:assert/strict";
import test from "node:test";

import {
  isRoutedMessage,
  messageDispatcher,
  registerMessage,
} from "../../src/messaging/messageRouter.ts";

test("message router rejects malformed runtime payloads before dispatch", () => {
  for (const payload of [null, [], {}, { type: 42 }, { type: "" }]) {
    let response;
    const result = messageDispatcher(payload, {}, (value) => {
      response = value;
    });
    assert.equal(result, undefined);
    assert.deepEqual(response, { error: "Invalid extension message." });
    assert.equal(isRoutedMessage(payload), false);
  }
});

test("message router dispatches valid payloads and returns handler results", () => {
  const type = `unit-message-${Date.now()}`;
  registerMessage(type, (message) => ({ ok: true, value: message.value }));

  let response;
  messageDispatcher({ type, value: "accepted" }, {}, (value) => {
    response = value;
  });

  assert.deepEqual(response, { ok: true, value: "accepted" });
});
