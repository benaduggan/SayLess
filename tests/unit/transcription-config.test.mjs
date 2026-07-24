import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  getBundledLocalWhisperOptions,
  LOCAL_WHISPER_ASSET_ROOT,
  LOCAL_WHISPER_MODEL_ID,
  mergeConfig,
  normalizeTranscriptionLanguage,
  normalizeTranscriptionConfigLayer,
  resolveConfig,
  saveTranscriptionSettings,
  TRANSCRIPTION_STORAGE_KEY,
} from "../../src/transcription/config.ts";

test("bundled local whisper options resolve through chrome.runtime.getURL", () => {
  const cfg = getBundledLocalWhisperOptions({
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
  });

  assert.equal(
    cfg.providerOptions["local-whisper"].localModelPath,
    `chrome-extension://test/${LOCAL_WHISPER_ASSET_ROOT}`,
  );
});

test("transcription defaults use offline timestamped whisper model", () => {
  const opts = DEFAULT_CONFIG.providerOptions["local-whisper"];

  assert.equal(DEFAULT_CONFIG.providerId, "local-whisper");
  assert.equal(DEFAULT_CONFIG.privacyMode, true);
  assert.equal(opts.allowRemoteModels, false);
  assert.equal(opts.model, LOCAL_WHISPER_MODEL_ID);
});

test("stored transcription options cannot disable release offline protections", () => {
  const cfg = mergeConfig(
    DEFAULT_CONFIG,
    getBundledLocalWhisperOptions({
      runtime: {
        getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
      },
    }),
    {
      privacyMode: false,
      providerOptions: {
        "local-whisper": {
          localModelPath: "http://localhost:8744/models/",
          allowRemoteModels: true,
        },
      },
    },
  );

  assert.equal(
    cfg.providerOptions["local-whisper"].localModelPath,
    `chrome-extension://test/${LOCAL_WHISPER_ASSET_ROOT}`,
  );
  assert.equal(cfg.privacyMode, true);
  assert.equal(cfg.providerOptions["local-whisper"].allowRemoteModels, false);
  assert.equal(cfg.providerOptions["local-whisper"].model, LOCAL_WHISPER_MODEL_ID);
});

test("dev mode can explicitly opt out of privacy mode and remote model protections", () => {
  const previous = process.env.SAYLESS_DEV_MODE;
  process.env.SAYLESS_DEV_MODE = "true";

  try {
    const cfg = mergeConfig(DEFAULT_CONFIG, {
      privacyMode: false,
      providerOptions: {
        "local-whisper": {
          localModelPath: "http://localhost:8744/models/",
          allowRemoteModels: true,
        },
      },
    });

    assert.equal(cfg.privacyMode, false);
    assert.equal(cfg.providerOptions["local-whisper"].allowRemoteModels, true);
  } finally {
    if (previous === undefined) {
      delete process.env.SAYLESS_DEV_MODE;
    } else {
      process.env.SAYLESS_DEV_MODE = previous;
    }
  }
});

test("transcription language settings are normalized", () => {
  assert.equal(normalizeTranscriptionLanguage("EN"), "en");
  assert.equal(normalizeTranscriptionLanguage("fr"), "fr");
  assert.equal(normalizeTranscriptionLanguage("not-a-language"), "auto");

  const cfg = mergeConfig(DEFAULT_CONFIG, { defaultLanguage: "ES" });
  assert.equal(cfg.defaultLanguage, "es");
});

test("untrusted transcription config layers retain only valid boundary fields", () => {
  assert.deepEqual(normalizeTranscriptionConfigLayer(null), {});
  assert.deepEqual(
    normalizeTranscriptionConfigLayer({
      providerId: 42,
      privacyMode: "false",
      defaultLanguage: "KLINGON",
      providerOptions: {
        "local-whisper": "not-an-options-object",
        valid: { model: "local", nested: { retained: true } },
      },
      injected: true,
    }),
    {
      defaultLanguage: "auto",
      providerOptions: {
        valid: { model: "local", nested: { retained: true } },
      },
    },
  );
});

test("malformed stored transcription settings fall back to safe defaults", async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
    storage: {
      local: {
        async get(key) {
          return {
            [key]: {
              providerId: { injected: true },
              privacyMode: "false",
              providerOptions: "invalid",
            },
          };
        },
        async set() {},
      },
    },
  };

  try {
    const resolved = await resolveConfig();
    assert.equal(resolved.providerId, "local-whisper");
    assert.equal(resolved.privacyMode, true);
    assert.equal(
      resolved.providerOptions["local-whisper"].localModelPath,
      `chrome-extension://test/${LOCAL_WHISPER_ASSET_ROOT}`,
    );
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("saved transcription settings persist only user overrides", async () => {
  const previousChrome = globalThis.chrome;
  const stored = {};
  globalThis.chrome = {
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(value) {
          Object.assign(stored, value);
        },
      },
    },
  };

  try {
    const resolved = await saveTranscriptionSettings({
      defaultLanguage: "FR",
      privacyMode: false,
    });
    assert.equal(stored[TRANSCRIPTION_STORAGE_KEY].defaultLanguage, "fr");
    assert.equal(stored[TRANSCRIPTION_STORAGE_KEY].privacyMode, false);
    assert.equal(stored[TRANSCRIPTION_STORAGE_KEY].providerOptions?.["local-whisper"], undefined);
    assert.equal(resolved.privacyMode, true);
    assert.equal(
      resolved.providerOptions["local-whisper"].localModelPath,
      `chrome-extension://test/${LOCAL_WHISPER_ASSET_ROOT}`,
    );
  } finally {
    globalThis.chrome = previousChrome;
  }
});
