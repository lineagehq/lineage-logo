import "./styles.css";
import {
  getSelectableParent,
  getSelectionAncestry,
  getSelectionLabel,
  isSelectableNode,
  SvgEditor,
  type SelectionContext,
} from "./canvas/editor";
import { AgentCanvasTransport } from "./agent/transport";
import type { AgentDocumentManifest } from "../shared/agent-protocol";
import { AgentSession } from "./agent/session";
import { buildPendingReview, outcomeReview, type AgentReviewModel } from "./agent/review";
import { commitLatestFileOpen, FileOpenCoordinator } from "./file-open";

const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.href = URL.createObjectURL(new Blob([
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='#161616'/><path d='M9 7v18h14v-4H14V7z' fill='white'/></svg>",
], { type: "image/svg+xml" }));
document.head.append(favicon);

interface SvgFileEntry {
  collection: "concepts" | "iterations";
  name: string;
  path: string;
}

interface WorkspaceResponse {
  rootName: string;
  files: SvgFileEntry[];
  nextIterationPath: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing.");

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">L</span><span>Lineage Logo</span></div>
    <div class="workspace-name" id="workspace-name">Connecting…</div>
  </header>
  <main class="shell">
    <aside class="sidebar file-sidebar">
      <div class="panel-heading"><span>Workspace</span><span id="file-count">0</span></div>
      <div id="file-list" class="file-list"></div>
    </aside>
    <section class="stage-panel">
      <div class="toolbar">
        <div class="toolbar-group">
          <button type="button" id="undo" disabled>Undo</button>
          <button type="button" id="redo" disabled>Redo</button>
          <button type="button" id="reset-edits" disabled>Reset edits</button>
          <span class="toolbar-divider"></span>
          <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
          <span id="zoom-label">100%</span>
          <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" id="zoom-reset" aria-label="Reset zoom">100%</button>
          <button type="button" id="zoom-fit" title="Fit the artboard in the available space">Fit</button>
          <button type="button" id="zoom-selection" title="Fit the selected layer in the available space" disabled>Fit selection</button>
          <button type="button" id="shortcut-help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
        </div>
        <div class="toolbar-group" aria-label="Preview background">
          <button type="button" id="save-iteration" class="primary-action" disabled>Save iteration</button>
          <button type="button" class="background-button active" data-background="checker" aria-pressed="true">Grid</button>
          <button type="button" class="background-button" data-background="light" aria-pressed="false">Light</button>
          <button type="button" class="background-button" data-background="dark" aria-pressed="false">Dark</button>
        </div>
      </div>
      <div class="stage checker" id="stage">
        <div id="connection-banner" class="connection-banner" role="status" hidden>
          <span>Preview disconnected. Restart the local editor, then try again.</span>
          <button type="button" id="retry-preview">Try again</button>
        </div>
        <div class="empty-state" id="empty-state">
          <span class="empty-icon">◇</span>
          <strong>Choose an SVG to inspect</strong>
          <span>Concepts and iterations appear in the workspace panel.</span>
        </div>
        <div id="artboard" class="artboard" hidden></div>
        <div id="agent-preview" class="artboard agent-preview" aria-label="Isolated agent change preview" hidden></div>
      </div>
      <footer class="statusbar">
        <span id="status">Ready</span>
        <span id="document-size">No document loaded</span>
      </footer>
    </section>
    <aside class="sidebar review-sidebar">
      <section id="agent-review" class="agent-review" aria-labelledby="agent-review-title" hidden>
        <div class="panel-heading"><span id="agent-review-title">Agent review</span><strong id="agent-review-status">Pending</strong></div>
        <div class="agent-review-body">
          <p id="agent-review-summary" class="agent-review-summary" role="status" aria-live="polite"></p>
          <button type="button" id="agent-preview-toggle" class="agent-preview-toggle" aria-pressed="false">Show proposed preview</button>
          <ul id="agent-impact-list" class="agent-impact-list" aria-label="Layers changed by agent"></ul>
          <div class="agent-review-actions">
            <button type="button" id="agent-revert">Revert</button>
            <button type="button" id="agent-accept" class="primary-action">Accept all</button>
          </div>
          <p id="agent-review-consequence" class="agent-review-consequence">Accept creates one undoable edit. Revert leaves the document unchanged.</p>
        </div>
      </section>
      <section>
        <div class="panel-heading"><span>Layers</span><span id="layer-count">0</span></div>
        <div class="layer-search">
          <input type="search" id="layer-search" aria-label="Search layers" placeholder="Search layers" disabled />
          <button type="button" id="clear-layer-search" aria-label="Clear layer search" disabled>×</button>
        </div>
        <div id="layer-list" class="layer-list empty-copy">Open an SVG to inspect its structure.</div>
      </section>
      <section class="inspector-section">
        <div class="panel-heading"><span>Selection</span><strong id="selection-name">None</strong></div>
        <nav id="selection-breadcrumb" class="selection-breadcrumb" aria-label="Selection ancestry"></nav>
        <div class="scope-actions">
          <button type="button" id="back-to-group" disabled>Back to group</button>
          <button type="button" id="edit-inside" disabled>Edit inside</button>
        </div>
        <div id="selection-empty" class="empty-copy">Select a layer or click the canvas.</div>
        <div id="selection-panel" class="selection-panel" hidden>
          <div class="name-field">
            <label for="layer-name">Layer name</label>
            <div class="name-control">
              <input id="layer-name" type="text" placeholder="Accessible layer name" />
              <button type="button" id="clear-layer-name" title="Remove the custom layer name">Clear</button>
            </div>
          </div>
          <div class="selection-actions sticky-selection-actions">
            <button type="button" id="duplicate-selection">Duplicate</button>
            <button type="button" id="hide-selection">Hide</button>
            <button type="button" id="delete-selection" class="danger">Delete</button>
          </div>
          <details class="inspector-group" id="organization-group" open>
            <summary>Organization</summary>
            <div class="organization-actions" aria-label="Layer organization">
              <button type="button" id="lock-selection">Lock</button>
              <button type="button" id="reorder-earlier" title="Move one SVG paint-order position backward">Send backward</button>
              <button type="button" id="reorder-later" title="Move one SVG paint-order position forward">Bring forward</button>
              <button type="button" id="group-selection">Group</button>
              <button type="button" id="ungroup-selection">Ungroup</button>
            </div>
            <p id="hierarchy-reason" class="hierarchy-reason">Select adjacent sibling layers to organize them.</p>
          </details>
          <details class="inspector-group" id="alignment-group">
            <summary>Alignment</summary>
            <div class="alignment-actions" aria-label="Align selected layers">
              <button type="button" id="align-left" title="Align left edges">Left</button>
              <button type="button" id="align-center" title="Align horizontal centers">Center</button>
              <button type="button" id="align-right" title="Align right edges">Right</button>
              <button type="button" id="align-top" title="Align top edges">Top</button>
              <button type="button" id="align-middle" title="Align vertical centers">Middle</button>
              <button type="button" id="align-bottom" title="Align bottom edges">Bottom</button>
            </div>
            <p id="alignment-reason" class="alignment-reason">Select at least two sibling layers to align.</p>
          </details>
          <details class="inspector-group" id="paint-group" open>
            <summary>Paint</summary>
            <div class="field-grid paint-grid">
            <label class="paint-field">
              <span>Fill</span>
              <span class="paint-control">
                <input id="fill" type="text" placeholder="none, color, or paint URL" aria-describedby="fill-error" />
                <input id="fill-picker" type="color" value="#000000" aria-label="Choose a solid fill color" />
              </span>
              <small id="fill-state" class="paint-state"></small>
              <small id="fill-error" class="field-error" aria-live="polite"></small>
            </label>
            <label class="paint-field">
              <span>Stroke</span>
              <span class="paint-control">
                <input id="stroke" type="text" placeholder="none, color, or paint URL" aria-describedby="stroke-error" />
                <input id="stroke-picker" type="color" value="#000000" aria-label="Choose a solid stroke color" />
              </span>
              <small id="stroke-state" class="paint-state"></small>
              <small id="stroke-error" class="field-error" aria-live="polite"></small>
            </label>
            </div>
          </details>
          <details class="inspector-group" id="geometry-group">
            <summary>Geometry</summary>
            <div class="field-grid">
            <label>Stroke width<input id="stroke-width" type="number" min="0" step="0.5" /></label>
            <label>Opacity<input id="opacity" type="number" min="0" max="1" step="0.05" /></label>
            <label>X<input id="position-x" type="number" step="1" /></label>
            <label>Y<input id="position-y" type="number" step="1" /></label>
            <label>Scale %<input id="scale" type="number" min="1" step="1" /></label>
            <label>Rotation °<input id="rotation" type="number" step="1" /></label>
          </div>
          </details>
          <p class="inspector-hint">Hover previews a normal click. Double-click or Alt-click selects the exact element. Press <button type="button" id="inline-shortcut-help">?</button> for shortcuts.</p>
        </div>
      </section>
      <section class="preview-section">
        <div class="panel-heading"><span>Small-size check</span></div>
        <div id="favicon-preview" class="favicon-preview empty-copy">Live previews appear here.</div>
      </section>
    </aside>
  </main>
  <dialog id="shortcut-dialog" class="shortcut-dialog" aria-labelledby="shortcut-title">
    <div class="dialog-heading">
      <h2 id="shortcut-title">Keyboard shortcuts</h2>
      <button type="button" id="close-shortcut-help" aria-label="Close keyboard shortcuts">×</button>
    </div>
    <dl>
      <div><dt>Undo / Redo</dt><dd>⌘/Ctrl+Z · ⌘/Ctrl+Shift+Z</dd></div>
      <div><dt>Duplicate</dt><dd>⌘/Ctrl+D</dd></div>
      <div><dt>Group / Ungroup</dt><dd>⌘/Ctrl+G · ⌘/Ctrl+Shift+G</dd></div>
      <div><dt>Nudge</dt><dd>Arrow keys · Shift for 10 units</dd></div>
      <div><dt>Delete</dt><dd>Delete or Backspace</dd></div>
      <div><dt>Fit artboard / selection</dt><dd>F · Shift+F</dd></div>
      <div><dt>Exact selection</dt><dd>Alt-click or double-click</dd></div>
      <div><dt>Leave group / clear selection</dt><dd>Escape</dd></div>
    </dl>
  </dialog>
`;

const fileList = getElement("file-list");
const artboard = getElement("artboard");
const agentPreview = getElement("agent-preview");
const emptyState = getElement("empty-state");
const layerList = getElement("layer-list");
const faviconPreview = getElement("favicon-preview");
const stage = getElement("stage");
const undoButton = getInput<HTMLButtonElement>("undo");
const redoButton = getInput<HTMLButtonElement>("redo");
const resetEditsButton = getInput<HTMLButtonElement>("reset-edits");
const saveButton = getInput<HTMLButtonElement>("save-iteration");
const backToGroupButton = getInput<HTMLButtonElement>("back-to-group");
const editInsideButton = getInput<HTMLButtonElement>("edit-inside");
const selectionBreadcrumb = getElement("selection-breadcrumb");
const alignmentGroup = getInput<HTMLDetailsElement>("alignment-group");
const shortcutDialog = getInput<HTMLDialogElement>("shortcut-dialog");
const zoomSelectionButton = getInput<HTMLButtonElement>("zoom-selection");
const layerSearch = getInput<HTMLInputElement>("layer-search");
const clearLayerSearchButton = getInput<HTMLButtonElement>("clear-layer-search");
const agentReviewPanel = getElement("agent-review");
const agentReviewStatus = getElement("agent-review-status");
const agentReviewSummary = getElement("agent-review-summary");
const agentPreviewToggle = getInput<HTMLButtonElement>("agent-preview-toggle");
const agentImpactList = getElement("agent-impact-list");
const agentAcceptButton = getInput<HTMLButtonElement>("agent-accept");
const agentRevertButton = getInput<HTMLButtonElement>("agent-revert");
const agentReviewConsequence = getElement("agent-review-consequence");
const fileButtons = new Map<string, HTMLButtonElement>();
const collapsedLayerKeys = new Set<string>();
let currentFile: SvgFileEntry | undefined;
let dirty = false;
let nextIterationPath = "iterations/iteration-1.svg";
let zoom = 1;
let currentObjectUrl: string | undefined;
let layerQuery = "";
let agentSession: AgentSession | undefined;
let agentManifestSync: Promise<void> = Promise.resolve();
let agentReview: AgentReviewModel | undefined;
let agentPreviewActive = false;
let reviewImpactKeys = new Set<string>();
let agentDecisionInFlight = false;
const fileOpenCoordinator = new FileOpenCoordinator();

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

function getInput<T extends HTMLElement>(id: string): T {
  return getElement(id) as T;
}

const editor = new SvgEditor(
  artboard,
  {
    alignBottomButton: getInput("align-bottom"),
    alignCenterButton: getInput("align-center"),
    alignLeftButton: getInput("align-left"),
    alignmentReason: getElement("alignment-reason"),
    alignMiddleButton: getInput("align-middle"),
    alignRightButton: getInput("align-right"),
    alignTopButton: getInput("align-top"),
    deleteButton: getInput("delete-selection"),
    duplicateButton: getInput("duplicate-selection"),
    fill: getInput("fill"),
    fillError: getElement("fill-error"),
    fillPicker: getInput("fill-picker"),
    fillState: getElement("fill-state"),
    groupButton: getInput("group-selection"),
    hierarchyReason: getElement("hierarchy-reason"),
    hideButton: getInput("hide-selection"),
    lockButton: getInput("lock-selection"),
    name: getInput("layer-name"),
    nameClearButton: getInput("clear-layer-name"),
    opacity: getInput("opacity"),
    positionX: getInput("position-x"),
    positionY: getInput("position-y"),
    reorderEarlierButton: getInput("reorder-earlier"),
    reorderLaterButton: getInput("reorder-later"),
    rotation: getInput("rotation"),
    scale: getInput("scale"),
    selectionEmpty: getElement("selection-empty"),
    selectionName: getElement("selection-name"),
    selectionPanel: getElement("selection-panel"),
    stroke: getInput("stroke"),
    strokeError: getElement("stroke-error"),
    strokePicker: getInput("stroke-picker"),
    strokeState: getElement("stroke-state"),
    strokeWidth: getInput("stroke-width"),
    ungroupButton: getInput("ungroup-selection"),
  },
  {
    onDocumentChange: (svg) => {
      renderLayers(svg);
      renderSelectionContext(editor.selectionContext);
      renderFavicons(editor.serializeClean());
      if (agentSession) {
        agentSession.documentChanged();
      }
    },
    onDirtyChange: (nextDirty) => {
      const changed = dirty !== nextDirty;
      dirty = nextDirty;
      saveButton.disabled = !dirty;
      resetEditsButton.disabled = !dirty && editor.selectionContext.lockedKeys.size === 0;
      if (nextDirty) setStatus("Unsaved manual corrections");
      else if (changed && currentFile) setStatus(`${currentFile.collection} / ${currentFile.name} · No unsaved changes`);
    },
    onHistoryChange: (canUndo, canRedo) => {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    onSelectionChange: (element) => {
      const root = editor.svgNode;
      if (element && root && layerQuery && !layerMatches(element, root, layerQuery)) {
        layerQuery = "";
        layerSearch.value = "";
        clearLayerSearchButton.disabled = true;
        renderLayers(root);
      }
      highlightLayers(editor.selectedNodes, element);
    },
    onSelectionContextChange: (context) => {
      renderSelectionContext(context);
      if (agentSession && currentFile?.path === agentSession.context.sourcePath) publishAgentDocument();
    },
    onStatus: setStatus,
  },
);

function publishAgentDocument(): void {
  const root = editor.svgNode;
  if (!agentSession || !root) return;
  const manifest = agentSession.manifest(agentLayers(root));
  agentManifestSync = agentManifestSync
    .catch(() => undefined)
    .then(() => agentTransport.publishDocument(manifest))
    .catch((error) => setStatus(error instanceof Error ? error.message : "Agent synchronization failed"));
}

agentSession = new AgentSession(editor, publishAgentDocument);

function agentLayers(svg: SVGSVGElement): AgentDocumentManifest["layers"] {
  const lockedKeys = editor.selectionContext.lockedKeys;
  return Array.from(svg.querySelectorAll<SVGGraphicsElement>("g, path, rect, circle, ellipse, polygon, polyline, line, text"))
    .filter((node) => isSelectableNode(node, svg) && Boolean(node.dataset.lineageKey))
    .map((node) => ({
      sessionKey: node.dataset.lineageKey!,
      name: getSelectionLabel(node, svg),
      type: node.localName,
      locked: Boolean(node.dataset.lineageKey && lockedKeys.has(node.dataset.lineageKey)),
    }));
}

const agentTransport = new AgentCanvasTransport({
  onTransaction: (transaction) => {
    if (!agentSession) return undefined;
    const pendingBeforeStage = agentSession.pending;
    const staged = agentSession.stage(transaction);
    if (staged?.result.status === "staged") {
      if (!pendingBeforeStage && agentSession.pending?.transaction.transactionId === transaction.transactionId) {
        fileOpenCoordinator.invalidate();
      }
      agentReview = buildPendingReview(transaction, staged, editor.selectionContext.lockedKeys);
      reviewImpactKeys = new Set(agentReview.layers.map((layer) => layer.sessionKey));
      editor.setAgentReviewHighlights(reviewImpactKeys);
      setReviewPreview(false);
      agentReviewConsequence.textContent = "Accept creates one undoable edit. Revert leaves the document unchanged.";
      renderAgentReview();
      setStatus(`Agent transaction ${transaction.transactionId} is staged for review`);
    } else if (staged?.result.status === "rejected") {
      agentReview = outcomeReview(staged.result.error.code === "stale_document" ? "stale" : "failed", transaction.transactionId, staged.result.error.message);
      renderAgentReview();
      setStatus(`Agent transaction rejected: ${staged.result.error.message}`);
    } else if (staged?.result.status === "applied") {
      agentReview = outcomeReview("accepted", transaction.transactionId, "Agent focus navigation was applied without changing the document.");
      renderAgentReview();
    }
    return staged;
  },
  onStateChange: (state, message) => {
    if (state === "disconnected") {
      agentReview = agentReview && agentSession?.pending
        ? { ...agentReview, status: "disconnected", summary: "Agent connection interrupted. You can still accept or revert the isolated proposal." }
        : outcomeReview("disconnected", agentReview?.transactionId);
      renderAgentReview();
    } else if (agentReview?.status === "disconnected" && agentSession?.pending) {
      agentReview = buildPendingReview(agentSession.pending.transaction, agentSession.pending.staged, editor.selectionContext.lockedKeys);
      renderAgentReview();
    }
    setStatus(message);
  },
});

function renderAgentReview(): void {
  if (!agentReview) {
    agentReviewPanel.hidden = true;
    return;
  }
  agentReviewPanel.hidden = false;
  agentReviewStatus.textContent = agentReview.status.replace("_", " ");
  agentReviewStatus.dataset.status = agentReview.status;
  agentReviewSummary.textContent = agentReview.summary;
  agentImpactList.replaceChildren();
  for (const layer of agentReview.layers) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = layer.sessionKey;
    button.setAttribute("aria-label", `Locate ${layer.name}, ${layer.type}${layer.hidden ? ", hidden" : ""}${layer.locked ? ", locked" : ""}`);
    const details = [layer.type, layer.hidden ? "hidden" : "", layer.locked ? "locked" : "", layer.operationIds.join(", ")].filter(Boolean).join(" · ");
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong")!.textContent = layer.name;
    button.querySelector("span")!.textContent = details;
    button.addEventListener("click", () => focusReviewLayer(layer.sessionKey));
    item.append(button);
    agentImpactList.append(item);
  }
  const pending = Boolean(agentSession?.pending);
  agentPreviewToggle.hidden = !pending;
  agentAcceptButton.hidden = !pending;
  agentRevertButton.hidden = !pending;
  agentReviewConsequence.hidden = !pending;
  agentAcceptButton.disabled = agentDecisionInFlight;
  agentRevertButton.disabled = agentDecisionInFlight;
  for (const button of fileButtons.values()) {
    button.disabled = pending;
    button.title = pending ? "Accept or revert the pending agent proposal before switching files." : "";
  }
  saveButton.disabled = pending || !dirty;
  resetEditsButton.disabled = pending || (!dirty && editor.selectionContext.lockedKeys.size === 0);
}

function setReviewPreview(active: boolean): void {
  const pending = agentSession?.pending;
  agentPreviewActive = Boolean(active && pending?.staged.candidate);
  agentPreviewToggle.setAttribute("aria-pressed", String(agentPreviewActive));
  agentPreviewToggle.textContent = agentPreviewActive ? "Show accepted document" : "Show proposed preview";
  agentPreview.replaceChildren();
  agentPreview.hidden = !agentPreviewActive;
  artboard.hidden = agentPreviewActive || !editor.svgNode;
  if (agentPreviewActive && pending?.staged.candidate) {
    const clone = document.importNode(pending.staged.candidate, true);
    for (const node of Array.from(clone.querySelectorAll<SVGGraphicsElement>("[data-lineage-key]"))) {
      if (node.dataset.lineageKey && reviewImpactKeys.has(node.dataset.lineageKey)) node.setAttribute("data-lineage-review-highlight", "true");
    }
    agentPreview.append(clone);
    renderLayers(clone);
  } else if (editor.svgNode) {
    editor.setAgentReviewHighlights(reviewImpactKeys);
    renderLayers(editor.svgNode);
  }
}

function focusReviewLayer(sessionKey: string): void {
  if (!editor.focusAgentLayer(sessionKey)) setReviewPreview(true);
  const previewNode = Array.from(agentPreview.querySelectorAll<SVGGraphicsElement>("[data-lineage-key]"))
    .find((node) => node.dataset.lineageKey === sessionKey);
  if (previewNode) {
    previewNode.setAttribute("tabindex", "-1");
    previewNode.focus();
    previewNode.scrollIntoView({ block: "center", inline: "center" });
  }
  const layerButton = Array.from(layerList.querySelectorAll<HTMLButtonElement>(".layer-button"))
    .find((button) => button.dataset.key === sessionKey);
  layerButton?.focus();
  layerButton?.scrollIntoView({ block: "nearest" });
}

function finishAgentReview(status: "accepted" | "reverted"): void {
  const transactionId = agentReview?.transactionId;
  reviewImpactKeys.clear();
  editor.setAgentReviewHighlights(reviewImpactKeys);
  setReviewPreview(false);
  agentReview = outcomeReview(status, transactionId);
  renderAgentReview();
}

agentPreviewToggle.addEventListener("click", () => setReviewPreview(!agentPreviewActive));

async function decideAgentReview(status: "accepted" | "reverted"): Promise<void> {
  const pending = agentSession?.pending;
  if (!pending || agentDecisionInFlight) return;
  agentDecisionInFlight = true;
  agentReviewConsequence.textContent = `Recording ${status} decision before changing the document…`;
  renderAgentReview();
  try {
    await agentTransport.decide(pending.transaction.transactionId, status);
    const completed = status === "accepted" ? agentSession?.accept() : agentSession?.revert();
    if (!completed) throw new Error("The pending agent proposal changed before its decision completed.");
    finishAgentReview(status);
  } catch (error) {
    agentReviewConsequence.textContent = error instanceof Error ? error.message : "Unable to record the agent decision.";
    setStatus(agentReviewConsequence.textContent);
  } finally {
    agentDecisionInFlight = false;
    renderAgentReview();
  }
}

agentAcceptButton.addEventListener("click", () => void decideAgentReview("accepted"));
agentRevertButton.addEventListener("click", () => void decideAgentReview("reverted"));

backToGroupButton.addEventListener("click", () => editor.backToGroup());
editInsideButton.addEventListener("click", () => editor.editInside());

function renderSelectionContext(context: SelectionContext): void {
  resetEditsButton.disabled = !dirty && context.lockedKeys.size === 0;
  backToGroupButton.disabled = !context.canDrillBack;
  editInsideButton.disabled = !context.canEditInside;
  const root = editor.svgNode;
  const selectedBox = context.selected?.getBoundingClientRect();
  const canFitSelection = Boolean(
    context.selected
    && context.selected.getAttribute("display") !== "none"
    && selectedBox
    && selectedBox.width > 0
    && selectedBox.height > 0,
  );
  zoomSelectionButton.disabled = !canFitSelection;
  zoomSelectionButton.title = canFitSelection
    ? "Fit the selected layer in the available space"
    : context.selected
      ? "Show the selected layer before fitting it"
      : "Select a visible layer to fit it";
  if (context.selectedNodes.length > 1) alignmentGroup.open = true;
  if (root && context.selected) {
    let expanded = false;
    for (const ancestor of getSelectionAncestry(context.selected, root).slice(0, -1)) {
      const key = ancestor.dataset.lineageKey;
      if (key && collapsedLayerKeys.delete(key)) expanded = true;
    }
    if (expanded) renderLayers(root);
  }
  selectionBreadcrumb.replaceChildren();
  if (!root || context.breadcrumb.length === 0) {
    selectionBreadcrumb.textContent = root && context.activeScope
      ? `Inside ${getSelectionLabel(context.activeScope, root)}`
      : "Top level";
  } else {
    context.breadcrumb.forEach((node, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "breadcrumb-separator";
        separator.textContent = "/";
        selectionBreadcrumb.append(separator);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = getSelectionLabel(node, root);
      button.className = index === context.breadcrumb.length - 1 ? "current" : "";
      button.addEventListener("click", () => editor.selectAncestor(node));
      selectionBreadcrumb.append(button);
    });
  }
  const hoveredKey = context.hovered?.dataset.lineageKey;
  const selectedKeys = new Set(context.selectedNodes.map((node) => node.dataset.lineageKey));
  const primaryKey = context.selected?.dataset.lineageKey;
  layerList.querySelectorAll<HTMLButtonElement>(".layer-button").forEach((button) => {
    button.classList.toggle("predicted", Boolean(hoveredKey) && button.dataset.key === hoveredKey);
    button.classList.toggle("selected", button.dataset.key === primaryKey);
    button.classList.toggle("secondary-selected", button.dataset.key !== primaryKey && selectedKeys.has(button.dataset.key));
    button.classList.toggle("locked", context.lockedKeys.has(button.dataset.key ?? ""));
    button.setAttribute("aria-pressed", String(selectedKeys.has(button.dataset.key)));
  });
  const selectedButton = primaryKey
    ? layerList.querySelector<HTMLButtonElement>(`.layer-button[data-key="${CSS.escape(primaryKey)}"]`)
    : undefined;
  if (selectedButton) {
    const listBox = layerList.getBoundingClientRect();
    const buttonBox = selectedButton.getBoundingClientRect();
    if (buttonBox.top < listBox.top) layerList.scrollTop -= listBox.top - buttonBox.top;
    else if (buttonBox.bottom > listBox.bottom) layerList.scrollTop += buttonBox.bottom - listBox.bottom;
  }
}

function setStatus(message: string): void {
  getElement("status").textContent = message;
}

function setZoom(nextZoom: number, center?: Element): void {
  zoom = Math.min(4, Math.max(0.25, nextZoom));
  artboard.style.transform = `scale(${zoom})`;
  getElement("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  if (center) {
    const centerTarget = () => {
    const target = center;
    const stageBox = stage.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    stage.scrollLeft += targetBox.left + targetBox.width / 2 - (stageBox.left + stageBox.width / 2);
    stage.scrollTop += targetBox.top + targetBox.height / 2 - (stageBox.top + stageBox.height / 2);
    };
    window.requestAnimationFrame(centerTarget);
    window.setTimeout(centerTarget, 170);
  }
}

function fittedZoom(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number,
  currentZoom = 1,
): number {
  if (availableWidth <= 0 || availableHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return currentZoom;
  return Math.min(4, Math.max(0.25, currentZoom * Math.min(availableWidth / contentWidth, availableHeight / contentHeight)));
}

function fitArtboard(): void {
  if (artboard.hidden) return;
  setZoom(fittedZoom(stage.clientWidth - 80, stage.clientHeight - 80, artboard.offsetWidth, artboard.offsetHeight), artboard);
}

function fitSelection(): void {
  const node = editor.selectedNode;
  if (!node) return;
  const box = node.getBoundingClientRect();
  setZoom(fittedZoom(stage.clientWidth - 120, stage.clientHeight - 120, box.width, box.height, zoom), node);
}

function createFileSection(title: string, files: SvgFileEntry[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "file-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);

  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-button";
    button.dataset.path = file.path;
    button.setAttribute("aria-current", "false");
    button.innerHTML = `<span class="file-glyph">◇</span><span>${file.name.replace(/\.svg$/i, "")}</span>`;
    button.addEventListener("click", () => {
      if (agentSession?.pending) {
        setStatus("Accept or revert the pending agent proposal before switching files.");
        agentReviewPanel.focus();
        return;
      }
      if (dirty && !window.confirm(`Discard unsaved changes and open ${file.name}?`)) return;
      void openSvg(file, button);
    });
    fileButtons.set(file.path, button);
    section.append(button);
  }
  return section;
}

async function openSvg(file: SvgFileEntry, button: HTMLButtonElement): Promise<void> {
  if (agentSession?.pending) return;
  await commitLatestFileOpen({
    coordinator: fileOpenCoordinator,
    isPending: () => Boolean(agentSession?.pending),
    load: async () => {
      const response = await fetch(`/api/svg?path=${encodeURIComponent(file.path)}`);
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Unable to open SVG.");
      }
      const source = await response.text();
      const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
      const svg = parsed.documentElement;
      if (svg.localName !== "svg" || parsed.querySelector("parsererror")) throw new Error("The selected file is not valid SVG.");
      return svg;
    },
    onEligibleError: (error) => setStatus(error instanceof Error ? error.message : "Unable to open SVG."),
    commit: (svg) => {
      if (agentSession && !agentSession.open(crypto.randomUUID(), file.path)) throw new Error("File-open commit gate lost pending eligibility.");
      for (const selected of fileList.querySelectorAll<HTMLButtonElement>(".selected")) {
        selected.classList.remove("selected");
        selected.setAttribute("aria-current", "false");
      }
      button.classList.add("selected");
      button.setAttribute("aria-current", "true");
      currentFile = file;
      window.scrollTo(0, 0);
      collapsedLayerKeys.clear();
      layerQuery = "";
      layerSearch.value = "";
      layerSearch.disabled = false;
      clearLayerSearchButton.disabled = true;
      dirty = false;
      saveButton.disabled = true;
      artboard.replaceChildren(document.importNode(svg, true));
      const renderedSvg = artboard.querySelector("svg");
      if (!renderedSvg) throw new Error("Committed SVG is missing from the artboard.");
      if (!renderedSvg.hasAttribute("role")) {
        renderedSvg.setAttribute("role", "img");
        renderedSvg.setAttribute("data-lineage-added-role", "true");
      }
      if (!renderedSvg.hasAttribute("aria-label")) {
        renderedSvg.setAttribute("aria-label", file.name);
        renderedSvg.setAttribute("data-lineage-added-label", "true");
      }
      emptyState.hidden = true;
      artboard.hidden = false;
      setZoom(1);
      editor.load(renderedSvg);
      publishAgentDocument();
      renderLayers(renderedSvg);
      renderFavicons(editor.serializeClean());
      getElement("document-size").textContent = renderedSvg.getAttribute("viewBox") ?? "No viewBox";
      setStatus(`${file.collection} / ${file.name}`);
    },
  });
}

function renderLayers(svg: SVGSVGElement): void {
  const allSelectable = Array.from(svg.querySelectorAll("g, path, rect, circle, ellipse, polygon, polyline, line, text"))
    .filter((element) => isLayerElement(element, svg));
  const elements = allSelectable.filter((element) => getSelectableParent(element, svg) === svg);
  layerList.className = "layer-list";
  layerList.replaceChildren();
  const allLayers = elements.flatMap((element) => collectLayerElements(element, svg));
  const directMatches = layerQuery
    ? allLayers.filter((element) => layerMatches(element, svg, layerQuery)).length
    : allLayers.length;
  getElement("layer-count").textContent = layerQuery ? `${directMatches} / ${allLayers.length}` : String(allLayers.length);

  elements.forEach((element, index) => appendLayer(element, index, 0, svg));
  if (layerQuery && directMatches === 0) {
    layerList.className = "layer-list empty-copy";
    layerList.textContent = `No layers match “${layerSearch.value.trim()}”.`;
  }
}

function highlightLayers(elements: SVGGraphicsElement[], primary?: SVGGraphicsElement): void {
  const selectedKeys = new Set(elements.map((element) => element.dataset.lineageKey));
  const primaryKey = primary?.dataset.lineageKey;
  layerList.querySelectorAll<HTMLButtonElement>(".layer-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.key === primaryKey);
    button.classList.toggle("secondary-selected", button.dataset.key !== primaryKey && selectedKeys.has(button.dataset.key));
    button.setAttribute("aria-pressed", String(selectedKeys.has(button.dataset.key)));
  });
}

function collectLayerElements(element: SVGGraphicsElement, root: SVGSVGElement): SVGGraphicsElement[] {
  return [
    element,
    ...Array.from(element.querySelectorAll("g, path, rect, circle, ellipse, polygon, polyline, line, text"))
      .filter((child): child is SVGGraphicsElement => isLayerElement(child, root) && getSelectableParent(child, root) === element)
      .flatMap((child) => collectLayerElements(child, root)),
  ];
}

function isLayerElement(element: Element, root: SVGSVGElement): element is SVGGraphicsElement {
  return isSelectableNode(element, root);
}

function appendLayer(element: SVGGraphicsElement, index: number, depth: number, root: SVGSVGElement): void {
    const children = directLayerChildren(element, root);
    if (layerQuery && !layerMatchesTree(element, root, layerQuery)) return;
    const key = element.dataset.lineageKey ?? "";
    const collapsed = Boolean(!layerQuery && key && collapsedLayerKeys.has(key));
    const row = document.createElement("div");
    row.className = "layer-row";
    row.classList.toggle("review-impacted", Boolean(key && reviewImpactKeys.has(key)));
    row.style.setProperty("--layer-depth", String(depth));

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "layer-disclosure";
    disclosure.disabled = children.length === 0;
    disclosure.textContent = children.length === 0 ? "" : collapsed ? "▸" : "▾";
    if (children.length === 0) disclosure.setAttribute("aria-hidden", "true");
    else disclosure.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${getSelectionLabel(element, root)}`);
    disclosure.setAttribute("aria-expanded", String(children.length > 0 && !collapsed));
    disclosure.addEventListener("click", () => {
      if (!key) return;
      if (collapsedLayerKeys.has(key)) collapsedLayerKeys.delete(key);
      else collapsedLayerKeys.add(key);
      renderLayers(root);
      renderSelectionContext(editor.selectionContext);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-button";
    button.dataset.key = element.dataset.lineageKey;
    button.setAttribute("aria-pressed", "false");
    const type = document.createElement("span");
    type.className = "layer-type";
    type.textContent = element.localName;
    const label = document.createElement("span");
    label.textContent = getSelectionLabel(element, root);
    button.append(type, label);
    button.addEventListener("click", (event) => {
      if (agentPreviewActive) focusReviewLayer(key);
      else editor.selectNode(element, event.shiftKey);
    });
    const visibility = document.createElement("button");
    const hidden = element.getAttribute("display") === "none";
    visibility.type = "button";
    visibility.className = "layer-visibility";
    visibility.innerHTML = layerVisibilityIcon(hidden);
    visibility.title = hidden ? "Show layer" : "Hide layer";
    visibility.setAttribute("aria-label", `${hidden ? "Show" : "Hide"} ${getSelectionLabel(element, root)}`);
    visibility.disabled = Boolean(agentSession?.pending) || agentPreviewActive;
    visibility.addEventListener("click", () => editor.toggleVisibility(element));
    row.classList.toggle("hidden-layer", hidden);
    row.append(disclosure, button, visibility);
    layerList.append(row);

    if (!collapsed) children.forEach((child, childIndex) => appendLayer(child, childIndex, depth + 1, root));
  }

function directLayerChildren(element: SVGGraphicsElement, root: SVGSVGElement): SVGGraphicsElement[] {
  return Array.from(element.querySelectorAll("g, path, rect, circle, ellipse, polygon, polyline, line, text"))
    .filter((child): child is SVGGraphicsElement => isLayerElement(child, root) && getSelectableParent(child, root) === element);
}

function layerMatches(element: SVGGraphicsElement, root: SVGSVGElement, query: string): boolean {
  const searchable = `${element.localName} ${getSelectionLabel(element, root)}`.toLocaleLowerCase();
  return searchable.includes(query);
}

function layerMatchesTree(element: SVGGraphicsElement, root: SVGSVGElement, query: string): boolean {
  return layerMatches(element, root, query)
    || directLayerChildren(element, root).some((child) => layerMatchesTree(child, root, query));
}

function layerVisibilityIcon(hidden: boolean): string {
  return hidden
    ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.2 10s2.8-4.5 7.8-4.5 7.8 4.5 7.8 4.5-2.8 4.5-7.8 4.5S2.2 10 2.2 10Z"/><path d="m3 3 14 14"/><circle cx="10" cy="10" r="2.2"/></svg>'
    : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.2 10s2.8-4.5 7.8-4.5 7.8 4.5 7.8 4.5-2.8 4.5-7.8 4.5S2.2 10 2.2 10Z"/><circle cx="10" cy="10" r="2.4"/></svg>';
}

function renderFavicons(source: string): void {
  const previousObjectUrl = currentObjectUrl;
  currentObjectUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  if (previousObjectUrl) window.setTimeout(() => URL.revokeObjectURL(previousObjectUrl), 1000);
  faviconPreview.className = "favicon-preview";
  faviconPreview.replaceChildren();

  for (const size of [64, 32, 16]) {
    const item = document.createElement("div");
    item.className = "favicon-item";
    const image = document.createElement("img");
    image.src = currentObjectUrl;
    image.width = size;
    image.height = size;
    image.alt = `${size}px logo preview`;
    const label = document.createElement("span");
    label.textContent = `${size}px`;
    item.append(image, label);
    faviconPreview.append(item);
  }
}

layerSearch.addEventListener("input", () => {
  layerQuery = layerSearch.value.trim().toLocaleLowerCase();
  clearLayerSearchButton.disabled = !layerQuery;
  const root = editor.svgNode;
  if (root) {
    renderLayers(root);
    renderSelectionContext(editor.selectionContext);
  }
});
clearLayerSearchButton.addEventListener("click", () => {
  layerSearch.value = "";
  layerQuery = "";
  clearLayerSearchButton.disabled = true;
  const root = editor.svgNode;
  if (root) {
    renderLayers(root);
    renderSelectionContext(editor.selectionContext);
  }
  layerSearch.focus();
});

getElement("zoom-in").addEventListener("click", () => setZoom(zoom + 0.25));
getElement("zoom-out").addEventListener("click", () => setZoom(zoom - 0.25));
getElement("zoom-reset").addEventListener("click", () => setZoom(1));
getElement("zoom-fit").addEventListener("click", fitArtboard);
zoomSelectionButton.addEventListener("click", fitSelection);
undoButton.addEventListener("click", () => editor.undo());
redoButton.addEventListener("click", () => editor.redo());
resetEditsButton.addEventListener("click", () => editor.reset());
saveButton.addEventListener("click", () => void saveIteration());

function openShortcutHelp(): void {
  if (!shortcutDialog.open) shortcutDialog.showModal();
}

getElement("shortcut-help").addEventListener("click", openShortcutHelp);
getElement("inline-shortcut-help").addEventListener("click", openShortcutHelp);
getElement("close-shortcut-help").addEventListener("click", () => shortcutDialog.close());
shortcutDialog.addEventListener("click", (event) => {
  if (event.target === shortcutDialog) shortcutDialog.close();
});

const connectionBanner = getElement("connection-banner");
const retryPreviewButton = getInput<HTMLButtonElement>("retry-preview");
const showDisconnectedPreview = () => {
  connectionBanner.hidden = false;
  setStatus("Preview disconnected");
};
const showConnectedPreview = () => {
  connectionBanner.hidden = true;
};
const hotModule = (import.meta as ImportMeta & {
  hot?: { on: (event: string, callback: () => void) => void };
}).hot;
hotModule?.on("vite:ws:disconnect", showDisconnectedPreview);
hotModule?.on("vite:ws:connect", showConnectedPreview);
retryPreviewButton.addEventListener("click", async () => {
  retryPreviewButton.disabled = true;
  retryPreviewButton.textContent = "Checking…";
  try {
    const response = await fetch(window.location.href, { cache: "no-store" });
    if (!response.ok) throw new Error("Preview is not ready");
    window.location.reload();
  } catch {
    setStatus("Preview is still disconnected");
    retryPreviewButton.disabled = false;
    retryPreviewButton.textContent = "Try again";
  }
});

let spacePressed = false;
let panPointerId: number | undefined;
let panStartX = 0;
let panStartY = 0;
let panStartLeft = 0;
let panStartTop = 0;

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (shortcutDialog.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      shortcutDialog.close();
    }
    return;
  }
  if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    openShortcutHelp();
    return;
  }
  if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.shiftKey) fitSelection();
    else fitArtboard();
    return;
  }
  if (event.code !== "Space") return;
  spacePressed = true;
  stage.classList.add("pan-ready");
  event.preventDefault();
});

document.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  spacePressed = false;
  if (panPointerId === undefined) stage.classList.remove("pan-ready");
});

stage.addEventListener("pointerdown", (event) => {
  const canPan = event.button === 1 || (event.button === 0 && (spacePressed || event.target === stage));
  if (!canPan) return;
  panPointerId = event.pointerId;
  panStartX = event.clientX;
  panStartY = event.clientY;
  panStartLeft = stage.scrollLeft;
  panStartTop = stage.scrollTop;
  stage.setPointerCapture(event.pointerId);
  stage.classList.add("panning");
  event.preventDefault();
});

stage.addEventListener("pointermove", (event) => {
  if (event.pointerId !== panPointerId) return;
  stage.scrollLeft = panStartLeft - (event.clientX - panStartX);
  stage.scrollTop = panStartTop - (event.clientY - panStartY);
});

function finishPan(event: PointerEvent): void {
  if (event.pointerId !== panPointerId) return;
  panPointerId = undefined;
  stage.classList.remove("panning");
  if (!spacePressed) stage.classList.remove("pan-ready");
}

stage.addEventListener("pointerup", finishPan);
stage.addEventListener("pointercancel", finishPan);
stage.addEventListener("lostpointercapture", finishPan);

window.addEventListener("beforeunload", (event) => {
  if (!dirty && !agentSession?.pending) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => {
  const transactionId = agentSession?.pending?.transaction.transactionId;
  if (transactionId) agentTransport.decideOnUnload(transactionId);
  agentTransport.close();
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".background-button")) {
  button.addEventListener("click", () => {
    stage.classList.remove("checker", "light", "dark");
    stage.classList.add(button.dataset.background ?? "checker");
    document.querySelectorAll<HTMLButtonElement>(".background-button").forEach((node) => {
      node.classList.remove("active");
      node.setAttribute("aria-pressed", "false");
    });
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
  });
}

async function saveIteration(): Promise<void> {
  if (!currentFile || !dirty) return;
  setStatus(`Saving ${nextIterationPath}…`);
  try {
    const response = await fetch("/api/iterations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath: currentFile.path,
        svg: editor.serializeClean(),
      }),
    });
    const result = await response.json() as {
      error?: string;
      file?: SvgFileEntry;
      nextIterationPath?: string;
    };
    if (!response.ok || !result.file) {
      throw new Error(result.error ?? "Unable to save the iteration.");
    }
    await loadWorkspace(result.file.path);
    setStatus(`Saved ${result.file.path}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to save the iteration.");
  }
}

async function loadWorkspace(openPath?: string): Promise<void> {
  try {
    const response = await fetch("/api/workspace");
    const workspace = await response.json() as WorkspaceResponse & { error?: string };
    if (!response.ok) throw new Error(workspace.error ?? "Unable to load workspace.");

    getElement("workspace-name").textContent = workspace.rootName;
    getElement("file-count").textContent = String(workspace.files.length);
    nextIterationPath = workspace.nextIterationPath;
    saveButton.textContent = `Save ${nextIterationPath.split("/").at(-1)?.replace(/\.svg$/i, "")}`;
    saveButton.title = `Create ${nextIterationPath}`;
    const concepts = workspace.files.filter((file) => file.collection === "concepts");
    const iterations = workspace.files.filter((file) => file.collection === "iterations");
    fileButtons.clear();
    fileList.replaceChildren(
      createFileSection("Concepts", concepts),
      createFileSection("Iterations", iterations),
    );
    if (openPath) {
      const file = workspace.files.find((candidate) => candidate.path === openPath);
      const button = fileButtons.get(openPath);
      if (file && button) await openSvg(file, button);
    }
    setStatus(`${workspace.files.length} SVG files available`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to load workspace.");
  }
}

void loadWorkspace();
