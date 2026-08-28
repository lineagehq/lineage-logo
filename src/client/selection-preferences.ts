import type { MarqueeHitRule } from "./canvas/marquee-selection";

export type PreciseSelectionModifier = "platform" | "alt";
export type DefaultClickDepth = "logical" | "exact";
export type RegionSelectionActivation = "left-control" | "m";

export interface SelectionPreferences {
  preciseModifier: PreciseSelectionModifier;
  marqueeMode: MarqueeHitRule;
  clickDepth: DefaultClickDepth;
  individualOutlines: boolean;
  regionActivation: RegionSelectionActivation;
}

interface StoredSelectionPreferencesV2 extends SelectionPreferences {
  version: 2;
}

export interface SelectionPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SELECTION_PREFERENCES_STORAGE_KEY = "lineage.selection-preferences.v2";
export const LEGACY_SELECTION_PREFERENCES_STORAGE_KEY = "lineage.selection-preferences.v1";
export const DEFAULT_SELECTION_PREFERENCES: Readonly<SelectionPreferences> = Object.freeze({
  preciseModifier: "platform",
  marqueeMode: "contain",
  clickDepth: "logical",
  individualOutlines: true,
  regionActivation: "left-control",
});

function defaults(): SelectionPreferences {
  return { ...DEFAULT_SELECTION_PREFERENCES };
}

function parseStoredPreferences(raw: string | null): SelectionPreferences | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredSelectionPreferencesV2> | null;
    if (!value || typeof value !== "object"
      || Object.keys(value).sort().join(",") !== "clickDepth,individualOutlines,marqueeMode,preciseModifier,regionActivation,version"
      || value.version !== 2
      || (value.preciseModifier !== "platform" && value.preciseModifier !== "alt")
      || (value.marqueeMode !== "contain" && value.marqueeMode !== "touch")
      || (value.clickDepth !== "logical" && value.clickDepth !== "exact")
      || typeof value.individualOutlines !== "boolean"
      || (value.regionActivation !== "left-control" && value.regionActivation !== "m")) return undefined;
    return {
      preciseModifier: value.preciseModifier,
      marqueeMode: value.marqueeMode,
      clickDepth: value.clickDepth,
      individualOutlines: value.individualOutlines,
      regionActivation: value.regionActivation,
    };
  } catch {
    return undefined;
  }
}

function parseLegacyPreferences(raw: string | null): SelectionPreferences | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object"
      || Object.keys(value).sort().join(",") !== "clickDepth,individualOutlines,marqueeMode,preciseModifier,version"
      || value.version !== 1
      || (value.preciseModifier !== "platform" && value.preciseModifier !== "alt")
      || (value.marqueeMode !== "contain" && value.marqueeMode !== "touch")
      || (value.clickDepth !== "logical" && value.clickDepth !== "exact")
      || typeof value.individualOutlines !== "boolean") return undefined;
    return {
      preciseModifier: value.preciseModifier,
      marqueeMode: value.marqueeMode,
      clickDepth: value.clickDepth,
      individualOutlines: value.individualOutlines,
      regionActivation: "left-control",
    };
  } catch { return undefined; }
}

function memoryStorage(): SelectionPreferencesStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

export function safeSelectionPreferencesStorage(acquire: () => SelectionPreferencesStorage): SelectionPreferencesStorage {
  try { return acquire(); } catch { return memoryStorage(); }
}

export class SelectionPreferencesStore {
  readonly #storage: SelectionPreferencesStorage;
  #value: SelectionPreferences;

  constructor(storage: SelectionPreferencesStorage) {
    this.#storage = storage;
    try {
      const currentRaw = storage.getItem(SELECTION_PREFERENCES_STORAGE_KEY);
      if (currentRaw !== null) this.#value = parseStoredPreferences(currentRaw) ?? defaults();
      else {
        this.#value = parseLegacyPreferences(storage.getItem(LEGACY_SELECTION_PREFERENCES_STORAGE_KEY)) ?? defaults();
        this.#persist();
      }
    } catch { this.#value = defaults(); }
  }

  get value(): SelectionPreferences {
    return { ...this.#value };
  }

  update(next: SelectionPreferences): SelectionPreferences {
    this.#value = { ...next };
    this.#persist();
    return this.value;
  }

  reset(): SelectionPreferences {
    this.#value = defaults();
    this.#persist();
    return this.value;
  }

  #persist(): void {
    const stored: StoredSelectionPreferencesV2 = { version: 2, ...this.#value };
    try { this.#storage.setItem(SELECTION_PREFERENCES_STORAGE_KEY, JSON.stringify(stored)); }
    catch { /* The in-memory value remains usable for this tab. */ }
  }
}
