import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock(async () => null);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function installLocalStorage() {
  const values = new Map();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
        clear: () => {
          values.clear();
        },
      },
    },
  });

  return values;
}

function installFailingLocalStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
        removeItem: () => {},
        clear: () => {},
      },
    },
  });
}

let storageValues;

beforeEach(() => {
  invokeMock.mockReset();
  storageValues = installLocalStorage();
});

describe("summary language local fallback", () => {
  test("reads summary language from local fallback when meeting has no folder", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("summaryLanguageFallback:meeting-1", "fr");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.readMeetingSummaryLanguage("meeting-1")).resolves.toEqual({
      language: "fr",
      storage: "local_fallback",
    });
  });

  test("saves summary language locally when command reports no folder", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.saveMeetingSummaryLanguage("meeting-1", "es")).resolves.toEqual({
      language: "es",
      storage: "local_fallback",
    });

    expect(storageValues.get("summaryLanguageFallback:meeting-1")).toBe("es");
  });

  test("clears local fallback when Auto is saved for a folderless meeting", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("summaryLanguageFallback:meeting-1", "de");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.saveMeetingSummaryLanguage("meeting-1", null)).resolves.toEqual({
      language: null,
      storage: "local_fallback",
    });

    expect(storageValues.has("summaryLanguageFallback:meeting-1")).toBe(false);
  });

  test("caches detected language locally when meeting has no folder", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await prefs.saveCachedDetectedSummaryLanguage("meeting-1", "pt");

    expect(storageValues.get("detectedSummaryLanguageFallback:meeting-1")).toBe("pt");
  });

  test("rejects when folderless summary language cannot be persisted locally", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    installFailingLocalStorage();
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.saveMeetingSummaryLanguage("meeting-1", "it")).rejects.toThrow(
      "Failed to save summary language on this device",
    );
  });
});

describe("summary language pinned defaults", () => {
  test("reads and writes pinned summary language defaults", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");

    expect(prefs.readPinnedSummaryLanguageDefault()).toBe(null);

    prefs.writePinnedSummaryLanguageDefault("pt-BR");
    expect(storageValues.get("summaryLanguageDefault")).toBe("pt-BR");
    expect(prefs.readPinnedSummaryLanguageDefault()).toBe("pt");

    prefs.writePinnedSummaryLanguageDefault(null);
    expect(storageValues.has("summaryLanguageDefault")).toBe(false);
  });

  test("pinned summary language defaults are no-ops without browser storage", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });

    prefs.writePinnedSummaryLanguageDefault("fr");

    expect(prefs.readPinnedSummaryLanguageDefault()).toBe(null);
  });

  test("pinned summary language write failures are ignored", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    installFailingLocalStorage();

    expect(() => prefs.writePinnedSummaryLanguageDefault("fr")).not.toThrow();
  });

  test("pinned summary language read failures return null", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => {
            throw new Error("storage unavailable");
          },
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
        },
      },
    });

    expect(prefs.readPinnedSummaryLanguageDefault()).toBe(null);
  });
});

describe("summary language metadata storage", () => {
  test("normalises legacy metadata responses", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("summaryLanguageFallback:meeting-1", "de");
    invokeMock.mockResolvedValueOnce("fr-FR");

    await expect(prefs.readMeetingSummaryLanguage("meeting-1")).resolves.toEqual({
      language: "fr",
      storage: "metadata",
    });

    expect(storageValues.has("summaryLanguageFallback:meeting-1")).toBe(false);
  });

  test("normalises object metadata responses", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock.mockResolvedValueOnce({
      language: "es-ES",
      storage: "metadata",
    });

    await expect(prefs.readMeetingSummaryLanguage("meeting-1")).resolves.toEqual({
      language: "es",
      storage: "metadata",
    });
  });

  test("returns null when local fallback reads fail", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => {
            throw new Error("storage unavailable");
          },
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
        },
      },
    });
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.readMeetingSummaryLanguage("meeting-1")).resolves.toEqual({
      language: null,
      storage: "local_fallback",
    });
  });
});

describe("summary language detected cache", () => {
  test("saves summary language in metadata storage and clears fallback", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("summaryLanguageFallback:meeting-1", "de");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "metadata",
    });

    await expect(prefs.saveMeetingSummaryLanguage("meeting-1", "en-GB")).resolves.toEqual({
      language: "en",
      storage: "metadata",
    });

    expect(storageValues.has("summaryLanguageFallback:meeting-1")).toBe(false);
  });

  test("applies pinned summary language to meetings", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("summaryLanguageDefault", "fr");
    invokeMock.mockResolvedValueOnce({
      language: "fr",
      storage: "metadata",
    });

    await expect(prefs.applyPinnedSummaryLanguageToMeeting("meeting-1")).resolves.toBe("fr");
    expect(invokeMock).toHaveBeenCalledWith("api_save_meeting_summary_language", {
      meetingId: "meeting-1",
      summaryLanguage: "fr",
    });
  });

  test("skips pinned summary language when no default exists", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");

    await expect(prefs.applyPinnedSummaryLanguageToMeeting("meeting-1")).resolves.toBe(null);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("reads detected summary language from metadata and clears fallback", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("detectedSummaryLanguageFallback:meeting-1", "es");
    invokeMock.mockResolvedValueOnce({
      language: "de-DE",
      storage: "metadata",
    });

    await expect(prefs.readCachedDetectedSummaryLanguage("meeting-1")).resolves.toBe("de");
    expect(storageValues.has("detectedSummaryLanguageFallback:meeting-1")).toBe(false);
  });

  test("reads detected summary language from local fallback", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("detectedSummaryLanguageFallback:meeting-1", "ja");
    invokeMock.mockResolvedValueOnce({
      language: null,
      storage: "local_fallback",
    });

    await expect(prefs.readCachedDetectedSummaryLanguage("meeting-1")).resolves.toBe("ja");
  });

  test("saves detected summary language in metadata storage and clears fallback", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    storageValues.set("detectedSummaryLanguageFallback:meeting-1", "es");
    invokeMock.mockResolvedValueOnce({
      language: "it",
      storage: "metadata",
    });

    await prefs.saveCachedDetectedSummaryLanguage("meeting-1", "it");

    expect(storageValues.has("detectedSummaryLanguageFallback:meeting-1")).toBe(false);
  });

  test("detects transcript summary language and normalises result", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock.mockResolvedValueOnce({
      language: "pt-BR",
      reason: "detected",
    });

    await expect(prefs.detectTranscriptSummaryLanguage(["ola"])).resolves.toEqual({
      language: "pt",
      reason: "detected",
    });
  });

  test("detects and caches summary language when available", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock
      .mockResolvedValueOnce({
        language: "fr-FR",
        reason: "detected",
      })
      .mockResolvedValueOnce({
        language: "fr",
        storage: "metadata",
      });

    await expect(prefs.detectAndCacheSummaryLanguage("meeting-1", ["bonjour"])).resolves.toEqual({
      language: "fr",
      reason: "detected",
    });
  });

  test("detects summary language without caching unavailable languages", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    invokeMock.mockResolvedValueOnce({
      language: null,
      reason: "empty",
    });

    await expect(prefs.detectAndCacheSummaryLanguage("meeting-1", [])).resolves.toEqual({
      language: null,
      reason: "empty",
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("detect and cache logs cache failures without failing detection", async () => {
    const prefs = await import("../../src/lib/summary-language-preferences");
    const warnMock = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnMock;
    invokeMock
      .mockResolvedValueOnce({
        language: "de",
        reason: "detected",
      })
      .mockRejectedValueOnce(new Error("database locked"));

    try {
      await expect(prefs.detectAndCacheSummaryLanguage("meeting-1", ["hallo"])).resolves.toEqual({
        language: "de",
        reason: "detected",
      });
      expect(warnMock).toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("summary languages", () => {
  test("normalises regional language codes", async () => {
    const languages = await import("../../src/lib/summary-languages");

    expect(languages.normaliseLanguageCode("pt-BR")).toBe("pt");
    expect(languages.normaliseLanguageCode("zh-TW")).toBe("zh-tw");
    expect(languages.normaliseLanguageCode("unknown")).toBe(null);
  });

  test("returns labels for known codes and falls back to the code", async () => {
    const languages = await import("../../src/lib/summary-languages");

    expect(languages.labelForCode("fr")).toBe("French");
    expect(languages.labelForCode("xx")).toBe("xx");
  });
});
