/** Portable basenames only: the supplied name is never interpreted as a path. */
export function versionFilename(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(value) || value.trim() !== value
    || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?: |$)/i.test(value)) {
    throw new Error("Use 1–64 letters, numbers, spaces, hyphens or underscores; start with a letter or number. Reserved device names are unavailable.");
  }
  return `${value}.svg`;
}
