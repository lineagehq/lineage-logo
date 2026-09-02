import { SvgEditor, serializeSvg } from "../client/canvas/editor";

const maximumPayloadBytes = 10_000_000;
const fragment = new URLSearchParams(location.hash.slice(1));
const parentOrigin = fragment.get("lineageParentOrigin");
const channelBinding = fragment.get("lineageChannelBinding");
const negotiatedProtocol = fragment.get("lineageProtocol");
const status = element<HTMLElement>("status");
const artboard = element<HTMLElement>("artboard");
const save = element<HTMLButtonElement>("save");
const cancel = element<HTMLButtonElement>("cancel");
const summary = element<HTMLInputElement>("summary");
let channel: MessagePort | undefined;
let connectAttempts = 0;
let retryTimer: number | undefined;
const candidates = new Set<MessagePort>();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing plugin control: ${id}`);
  return found as T;
}

function exactOrigin(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function closeCandidates(except?: MessagePort): void {
  for (const candidate of candidates) if (candidate !== except) candidate.close();
  candidates.clear();
  if (except) candidates.add(except);
}

const editor = new SvgEditor(artboard, {
  alignBottomButton: element("align-bottom"), alignCenterButton: element("align-center"), alignLeftButton: element("align-left"),
  alignmentReason: element("alignment-reason"), alignMiddleButton: element("align-middle"), alignRightButton: element("align-right"), alignTopButton: element("align-top"),
  distributeHorizontalButton: element("distribute-horizontal"), distributeVerticalButton: element("distribute-vertical"),
  groupButton: element("group-selection"), hierarchyReason: element("hierarchy-reason"), lockButton: element("lock-selection"),
  name: element("layer-name"), nameClearButton: element("clear-layer-name"), reorderEarlierButton: element("reorder-earlier"), reorderLaterButton: element("reorder-later"),
  deleteButton: element("delete-selection"), duplicateButton: element("duplicate-selection"), fill: element("fill"), fillError: element("fill-error"), fillPicker: element("fill-picker"), fillState: element("fill-state"),
  hideButton: element("hide-selection"), opacity: element("opacity"), positionX: element("position-x"), positionY: element("position-y"), positionWidth: element("position-width"), positionHeight: element("position-height"),
  geometryMode: element("geometry-mode"), geometryError: element("geometry-error"), aspectLock: element("aspect-lock"), rotation: element("rotation"), scale: element("scale"),
  selectionEmpty: element("selection-empty"), selectionName: element("selection-name"), selectionPanel: element("selection-panel"), stroke: element("stroke"), strokeError: element("stroke-error"), strokePicker: element("stroke-picker"), strokeState: element("stroke-state"), strokeWidth: element("stroke-width"),
  spaceHorizontalButton: element("space-horizontal"), spaceVerticalButton: element("space-vertical"), textAnchor: element("text-anchor"), textContent: element("text-content"), textError: element("text-error"), textFamily: element("text-family"), textLetterSpacing: element("text-letter-spacing"), textSize: element("text-size"), textWeight: element("text-weight"), ungroupButton: element("ungroup-selection"),
}, {
  onDocumentChange: () => undefined,
  onDirtyChange: (dirty) => { if (dirty) channel?.postMessage({ type: "lineage.node-editor.dirty", dirty: true }); },
  onHistoryChange: () => undefined,
  onSelectionChange: () => undefined,
  onSelectionContextChange: () => undefined,
  onStatus: (message) => { status.textContent = message; },
});

async function receiveDocument(message: unknown): Promise<void> {
  if (!message || typeof message !== "object") throw new Error("Invalid Lineage document transfer.");
  const record = message as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "checksumSha256,mimeType,payload,sizeBytes,type"
    || record.type !== "lineage.node-editor.document" || record.mimeType !== "image/svg+xml"
    || !(record.payload instanceof ArrayBuffer) || !Number.isSafeInteger(record.sizeBytes) || Number(record.sizeBytes) < 1
    || Number(record.sizeBytes) > maximumPayloadBytes || record.payload.byteLength !== record.sizeBytes
    || typeof record.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.checksumSha256)) throw new Error("Invalid Lineage document transfer.");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", record.payload))].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== record.checksumSha256) throw new Error("Lineage document transfer checksum mismatch.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(record.payload);
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") throw new Error("Lineage document is not valid SVG.");
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  artboard.replaceChildren(svg);
  editor.load(svg, serializeSvg(svg, true));
  save.disabled = false;
  status.textContent = "Current immutable SVG loaded. Select a shape to edit.";
}

function receive(message: MessageEvent): void {
  const data = message.data as Record<string, unknown> | undefined;
  if (!data) return;
  if (data.type === "lineage.node-editor.state" && Object.keys(data).sort().join(",") === "message,type" && typeof data.message === "string" && data.message.length >= 1 && data.message.length <= 2048) status.textContent = data.message;
  if (data.type === "lineage.node-editor.document") void receiveDocument(data).catch((error) => { status.textContent = error instanceof Error ? error.message : "Document transfer failed."; save.disabled = true; });
}

function connect(): void {
  if (channel || !exactOrigin(parentOrigin) || negotiatedProtocol !== "1.3" || !channelBinding || !/^[A-Za-z0-9_-]{16,128}$/.test(channelBinding)) return;
  if (connectAttempts >= 20) { closeCandidates(); status.textContent = "Could not establish a secure Lineage connection."; return; }
  connectAttempts += 1;
  const pair = new MessageChannel();
  const candidate = pair.port1;
  candidates.add(candidate);
  candidate.onmessage = (message) => {
    const data = message.data as Record<string, unknown> | undefined;
    if (!channel && data?.type === "lineage.node-editor.connected" && data.channelBinding === channelBinding
      && Object.keys(data).sort().join(",") === "channelBinding,message,type" && typeof data.message === "string" && data.message.length >= 1 && data.message.length <= 2048) {
      channel = candidate; clearTimeout(retryTimer); closeCandidates(candidate); status.textContent = data.message; cancel.disabled = false; candidate.onmessage = receive; candidate.start();
    }
  };
  parent.postMessage({ type: "lineage.node-editor.connect", channelBinding }, parentOrigin, [pair.port2]);
  retryTimer = window.setTimeout(connect, 100);
}

save.addEventListener("click", () => {
  const editSummary = summary.value.trim();
  const markup = serializeSvg(editor.svgNode, true);
  const bytes = new TextEncoder().encode(markup);
  if (!channel || editSummary.length < 1 || editSummary.length > 2048 || bytes.byteLength < 8 || bytes.byteLength > maximumPayloadBytes) { status.textContent = "Add a summary and keep the edited SVG within the plugin limit."; return; }
  const payload = bytes.buffer;
  channel.postMessage({ type: "lineage.node-editor.save", summary: editSummary, mimeType: "image/svg+xml", payload }, [payload]);
  save.disabled = true;
});
cancel.addEventListener("click", () => channel?.postMessage({ type: "lineage.node-editor.cancel" }));
connect();
