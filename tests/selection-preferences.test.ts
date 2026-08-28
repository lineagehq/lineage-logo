import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELECTION_PREFERENCES,
  LEGACY_SELECTION_PREFERENCES_STORAGE_KEY,
  SELECTION_PREFERENCES_STORAGE_KEY,
  SelectionPreferencesStore,
  safeSelectionPreferencesStorage,
} from "../src/client/selection-preferences";

function storage(raw?: string) {
  const values = new Map<string, string>();
  if (raw !== undefined) values.set(SELECTION_PREFERENCES_STORAGE_KEY, raw);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("selection preferences", () => {
  it("uses chartered defaults and persists one strict global v2 record", () => {
    const target = storage();
    const store = new SelectionPreferencesStore(target);
    expect(store.value).toEqual(DEFAULT_SELECTION_PREFERENCES);
    const updated = store.update({ preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, regionActivation: "m" });
    expect(updated).toEqual({ preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, regionActivation: "m" });
    expect(JSON.parse(target.values.get(SELECTION_PREFERENCES_STORAGE_KEY) ?? "")).toEqual({
      version: 2, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, regionActivation: "m",
    });
    expect(store.reset()).toEqual(DEFAULT_SELECTION_PREFERENCES);
  });

  it.each([
    "{",
    "null",
    JSON.stringify({ version: 3, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, regionActivation: "m" }),
    JSON.stringify({ version: 1, preciseModifier: "control", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false }),
    JSON.stringify({ version: 1, preciseModifier: "alt", marqueeMode: "overlap", clickDepth: "exact", individualOutlines: false }),
    JSON.stringify({ version: 1, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "deep", individualOutlines: false }),
    JSON.stringify({ version: 1, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: "false" }),
    JSON.stringify({ version: 1, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, extra: true }),
  ])("falls back atomically for malformed, future, invalid, or non-exact storage: %s", (raw) => {
    expect(new SelectionPreferencesStore(storage(raw)).value).toEqual(DEFAULT_SELECTION_PREFERENCES);
  });

  it("migrates an exact v1 record only when v2 is absent and never resurrects it behind invalid v2", () => {
    const target = storage();
    target.values.set(LEGACY_SELECTION_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1, preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false,
    }));
    expect(new SelectionPreferencesStore(target).value).toEqual({
      preciseModifier: "alt", marqueeMode: "touch", clickDepth: "exact", individualOutlines: false, regionActivation: "left-control",
    });
    expect(JSON.parse(target.values.get(SELECTION_PREFERENCES_STORAGE_KEY) ?? "").version).toBe(2);
    target.values.set(SELECTION_PREFERENCES_STORAGE_KEY, "{");
    expect(new SelectionPreferencesStore(target).value).toEqual(DEFAULT_SELECTION_PREFERENCES);
  });

  it("retains bounded tab-local behavior when storage acquisition or writes fail", () => {
    const fallback = safeSelectionPreferencesStorage(() => { throw new DOMException("Blocked", "SecurityError"); });
    const fallbackStore = new SelectionPreferencesStore(fallback);
    fallbackStore.update({ ...DEFAULT_SELECTION_PREFERENCES, clickDepth: "exact" });
    expect(new SelectionPreferencesStore(fallback).value.clickDepth).toBe("exact");

    const blockedWrite = new SelectionPreferencesStore({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
    expect(() => blockedWrite.update({ ...DEFAULT_SELECTION_PREFERENCES, marqueeMode: "touch" })).not.toThrow();
    expect(blockedWrite.value.marqueeMode).toBe("touch");
  });
});
