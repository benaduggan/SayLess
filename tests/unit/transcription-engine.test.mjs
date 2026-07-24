import assert from "node:assert/strict";
import test from "node:test";

import { getActiveProvider, registerProvider } from "../../src/transcription/index.ts";
import { TRANSCRIPTION_ERROR_CODES } from "../../src/transcription/errors.ts";

const REMOTE_TEST_PROVIDER_ID = "unit-remote-provider";

registerProvider({
  id: REMOTE_TEST_PROVIDER_ID,
  label: "Unit remote provider",
  requiresNetwork: true,
  async isAvailable() {
    return true;
  },
  async transcribe() {
    throw new Error("not used");
  },
});

test("explicit configs cannot disable release privacy mode for network providers", async () => {
  await assert.rejects(
    () =>
      getActiveProvider({
        providerId: REMOTE_TEST_PROVIDER_ID,
        privacyMode: false,
        providerOptions: {},
      }),
    (error) => {
      assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.PRIVACY_BLOCKED);
      return true;
    },
  );
});

test("dev mode can explicitly select a network transcription provider", async () => {
  const previous = process.env.SAYLESS_DEV_MODE;
  process.env.SAYLESS_DEV_MODE = "true";

  try {
    const { provider, config } = await getActiveProvider({
      providerId: REMOTE_TEST_PROVIDER_ID,
      privacyMode: false,
      providerOptions: {},
    });

    assert.equal(provider.id, REMOTE_TEST_PROVIDER_ID);
    assert.equal(config.privacyMode, false);
  } finally {
    if (previous === undefined) {
      delete process.env.SAYLESS_DEV_MODE;
    } else {
      process.env.SAYLESS_DEV_MODE = previous;
    }
  }
});
