import type { SelectionContext } from "../canvas/editor";

export const INSPECTOR_SUMMARY_IDS = [
  "organization-summary",
  "alignment-summary",
  "paint-summary",
  "text-summary",
  "geometry-summary",
] as const;

export type InspectorSummaryId = typeof INSPECTOR_SUMMARY_IDS[number];

export function inspectorSummaries(context: SelectionContext): Record<InspectorSummaryId, string> {
  const selected = context.selected;
  return {
    "organization-summary": context.selectedNodes.length > 1
      ? `${context.selectedNodes.length} layers`
      : selected ? (context.lockedKeys.has(selected.dataset.lineageKey ?? "") ? "Locked" : selected.localName) : "Unavailable",
    "alignment-summary": context.selectedNodes.length > 1 ? `${context.selectedNodes.length} selected` : "Select 2+",
    "paint-summary": selected
      ? `Fill ${selected.getAttribute("fill") ?? "inherited"} · stroke ${selected.getAttribute("stroke") ?? "inherited"}`
      : "Unavailable",
    "text-summary": selected?.localName === "text"
      ? `${(selected.textContent ?? "").slice(0, 22) || "Empty"} · ${selected.getAttribute("font-size") ?? "default size"}`
      : "Unavailable",
    "geometry-summary": selected
      ? `Opacity ${selected.getAttribute("opacity") ?? "1"} · stroke ${selected.getAttribute("stroke-width") ?? "default"}`
      : "Unavailable",
  };
}

export function renderInspectorSummaries(
  context: SelectionContext,
  lookup: (id: InspectorSummaryId) => HTMLElement | null = (id) => document.getElementById(id),
): void {
  const summaries = inspectorSummaries(context);
  for (const id of INSPECTOR_SUMMARY_IDS) {
    const output = lookup(id);
    if (output) output.textContent = summaries[id];
  }
}
