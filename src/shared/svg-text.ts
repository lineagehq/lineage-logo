export type SvgTextProperty = "content" | "font-size" | "font-weight" | "font-family" | "text-anchor" | "letter-spacing";

export interface SvgTextEdit {
  property: SvgTextProperty;
  value: string;
}

export interface SvgTextValidation {
  valid: boolean;
  normalized?: string;
  error?: string;
}

const TEXT_LIMITS = {
  content: 2048,
  family: 128,
  size: 1000,
  spacing: 100,
};

const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Preserve the existing family-list grammar with constant-state scanning. */
function isLocalFontFamilyList(value: string): boolean {
  let inName = false;
  let beforeComma = false;
  let afterComma = false;
  let first = true;
  for (const character of value) {
    const nameCharacter = /^[\p{L}\p{N} _,'".-]$/u.test(character);
    const whitespace = /^\s$/u.test(character);
    const nextName: boolean = nameCharacter && (first || inName || afterComma);
    const nextBeforeComma: boolean = whitespace && (inName || beforeComma);
    const nextAfterComma: boolean = (character === "," && (inName || beforeComma)) || (whitespace && afterComma);
    inName = nextName;
    beforeComma = nextBeforeComma;
    afterComma = nextAfterComma;
    first = false;
  }
  return inName;
}

export function validateSvgTextEdit(edit: SvgTextEdit): SvgTextValidation {
  const value = edit.value.trim();
  if (edit.property === "content") {
    if (edit.value.length > TEXT_LIMITS.content) return { valid: false, error: `Text is limited to ${TEXT_LIMITS.content} characters.` };
    if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(edit.value)) {
      return { valid: false, error: "Text must be plain content without markup or control characters." };
    }
    return { valid: true, normalized: edit.value };
  }
  if (edit.property === "text-anchor") {
    const keyword = value.toLowerCase();
    return ["start", "middle", "end"].includes(keyword)
      ? { valid: true, normalized: keyword }
      : { valid: false, error: "Alignment must be start, middle, or end." };
  }
  if (edit.property === "font-weight") {
    const keyword = value.toLowerCase();
    if (["normal", "bold", "bolder", "lighter"].includes(keyword)) return { valid: true, normalized: keyword };
    const weight = Number(value);
    return CSS_NUMBER.test(value) && Number.isInteger(weight) && weight >= 1 && weight <= 1000
      ? { valid: true, normalized: String(weight) }
      : { valid: false, error: "Weight must be normal, bold, bolder, lighter, or an integer from 1 to 1000." };
  }
  if (edit.property === "font-family") {
    if (!value || value.length > TEXT_LIMITS.family || /(?:url\s*\(|@import|[;{}<>\\])/i.test(value)
      || !isLocalFontFamilyList(value)) {
      return { valid: false, error: "Use a bounded local font-family list without URLs, CSS, or external font rules." };
    }
    return { valid: true, normalized: value };
  }
  if (edit.property === "font-size") {
    const size = Number(value);
    const normalized = Number(size.toFixed(4));
    return CSS_NUMBER.test(value) && Number.isFinite(size) && normalized > 0 && normalized <= TEXT_LIMITS.size
      ? { valid: true, normalized: String(normalized) }
      : { valid: false, error: `Font size must be at least 0.0001 and at most ${TEXT_LIMITS.size}.` };
  }
  const spacing = Number(value);
  if (value.toLowerCase() === "normal") return { valid: true, normalized: "normal" };
  return CSS_NUMBER.test(value) && Number.isFinite(spacing) && Math.abs(spacing) <= TEXT_LIMITS.spacing
    ? { valid: true, normalized: String(Number(spacing.toFixed(4))) }
    : { valid: false, error: `Letter spacing must be normal or between -${TEXT_LIMITS.spacing} and ${TEXT_LIMITS.spacing}.` };
}
