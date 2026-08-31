import "./styles.css";
import {
  getSelectableParent,
  getSelectionAncestry,
  getSelectionLabel,
  isSelectableNode,
  serializeSvg,
  SvgEditor,
  type SelectionContext,
} from "./canvas/editor";
import { AgentCanvasTransport, AgentDecisionError, AgentRecoveryError, type AgentRecoveryState } from "./agent/transport";
import { validateCleanAgentSvg, type AgentDocumentManifest } from "../shared/agent-protocol";
import { AgentSession } from "./agent/session";
import { buildPendingReview, outcomeReview, type AgentReviewModel } from "./agent/review";
import {
  commitAuthorizedFileSwitch,
  commitLatestFileOpen,
  FileOpenCoordinator,
  type FileSwitchAuthority,
} from "./file-open";
import { CanvasLayoutController, isLayoutShortcutTarget, PreferencesDialogController, safeLayoutStorage } from "./ui/layout";
import { UnsavedDialogController } from "./ui/unsaved-dialog";
import { createSvgPreview, eligiblePreviewTargetIds } from "./preview";
import { renderInspectorSummaries } from "./ui/inspector";
import { waitForWorkspaceAdvance } from "./workspace-refresh";
import {
  boundedSelectionPath,
  readWorkspaceSession,
  resolveSelectionPath,
  writeWorkspaceSession,
  type PreviewBackground,
  type WorkspaceSessionV1,
} from "./session-restoration";
import { ContextMenuSuppressionController, MarqueeActivationController, StageGestureController, type ClientRect, type StageGestureTransition } from "./canvas/marquee-selection";
import {
  SelectionPreferencesStore,
  safeSelectionPreferencesStorage,
  type SelectionPreferences,
} from "./selection-preferences";

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

interface PendingReviewRecovery {
  transactionId: string;
  sessionId: string;
  sourcePath: string;
  revision: number;
  svg: string;
  dirty: boolean;
}

const PENDING_REVIEW_RECOVERY_KEY = "lineage.pending-agent-review.v1";

function readPendingReviewRecovery(): PendingReviewRecovery | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_REVIEW_RECOVERY_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PendingReviewRecovery>;
    if (!value || Object.keys(value).length !== 6
      || typeof value.transactionId !== "string" || !value.transactionId
      || typeof value.sessionId !== "string" || !value.sessionId
      || typeof value.sourcePath !== "string" || !value.sourcePath
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
      || typeof value.svg !== "string"
      || typeof value.dirty !== "boolean") throw new Error("Invalid pending review recovery state.");
    validateCleanAgentSvg(value.svg);
    return value as PendingReviewRecovery;
  } catch {
    try { sessionStorage.removeItem(PENDING_REVIEW_RECOVERY_KEY); } catch { /* storage unavailable */ }
    return undefined;
  }
}

function clearPendingReviewRecovery(transactionId?: string): void {
  const recovery = readPendingReviewRecovery();
  if (transactionId && recovery?.transactionId !== transactionId) return;
  try { sessionStorage.removeItem(PENDING_REVIEW_RECOVERY_KEY); } catch { /* storage unavailable */ }
}

function persistPendingReviewRecovery(recovery: PendingReviewRecovery): boolean {
  try {
    sessionStorage.setItem(PENDING_REVIEW_RECOVERY_KEY, JSON.stringify(recovery));
    return sessionStorage.getItem(PENDING_REVIEW_RECOVERY_KEY) === JSON.stringify(recovery);
  } catch {
    clearPendingReviewRecovery(recovery.transactionId);
    return false;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing.");

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">L</span><span>Lineage Logo</span></div>
    <div class="workspace-name" id="workspace-name">Connecting…</div>
  </header>
  <main class="shell" id="canvas-shell">
    <aside class="sidebar file-sidebar" aria-label="Workspace files">
      <div class="sidebar-rail">
        <button type="button" id="toggle-left-sidebar" class="sidebar-toggle" aria-controls="workspace-panel" title="Toggle workspace panel ([)"><span aria-hidden="true">‹</span><span class="rail-label">Files</span></button>
      </div>
      <div class="sidebar-content" id="workspace-panel">
        <div class="panel-heading"><span>Workspace</span><span id="file-count">0</span></div>
        <div id="file-list" class="file-list"></div>
      </div>
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
          <button type="button" id="shortcut-help" aria-label="Preferences and shortcuts" title="Preferences and shortcuts">⚙</button>
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
        <span id="selection-count-badge" class="selection-count-badge" role="status" aria-live="polite" aria-atomic="true" hidden></span>
        <span id="document-size">No document loaded</span>
      </footer>
    </section>
    <aside class="sidebar review-sidebar" aria-label="Layers and inspector">
      <div class="sidebar-rail">
        <button type="button" id="toggle-right-sidebar" class="sidebar-toggle" aria-controls="inspector-panel" title="Toggle layers and inspector panel (])"><span aria-hidden="true">›</span><span class="rail-label">Inspect</span><span id="pending-review-badge" class="pending-review-badge" aria-label="Pending agent review" hidden>!</span></button>
      </div>
      <div class="sidebar-content" id="inspector-panel">
      <section id="agent-review" class="agent-review" aria-labelledby="agent-review-title" aria-describedby="agent-review-lock agent-review-summary" tabindex="-1" hidden>
        <div class="panel-heading"><span id="agent-review-title">Agent review</span><strong id="agent-review-status">Pending</strong></div>
        <div class="agent-review-body">
          <p id="agent-review-lock" class="agent-review-lock"><strong>Editing locked.</strong> Accept or revert before editing.</p>
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
            <summary>Organization <span id="organization-summary" class="group-summary"></span></summary>
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
            <summary>Alignment <span id="alignment-summary" class="group-summary"></span></summary>
            <div class="alignment-actions" aria-label="Align selected layers">
              <button type="button" id="align-left" title="Align left edges">Left</button>
              <button type="button" id="align-center" title="Align horizontal centers">Center</button>
              <button type="button" id="align-right" title="Align right edges">Right</button>
              <button type="button" id="align-top" title="Align top edges">Top</button>
              <button type="button" id="align-middle" title="Align vertical centers">Middle</button>
              <button type="button" id="align-bottom" title="Align bottom edges">Bottom</button>
            </div>
            <div class="distribution-actions" aria-label="Distribute and space selected layers">
              <button type="button" id="distribute-horizontal" title="Distribute horizontal centers with fixed outer layers">Distribute H</button>
              <button type="button" id="distribute-vertical" title="Distribute vertical centers with fixed outer layers">Distribute V</button>
              <button type="button" id="space-horizontal" title="Equalize horizontal edge gaps with fixed outer layers">Space H</button>
              <button type="button" id="space-vertical" title="Equalize vertical edge gaps with fixed outer layers">Space V</button>
            </div>
            <p id="alignment-reason" class="alignment-reason">Select at least two sibling layers to align.</p>
          </details>
          <details class="inspector-group" id="paint-group" open>
            <summary>Paint <span id="paint-summary" class="group-summary"></span></summary>
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
          <details class="inspector-group" id="text-group">
            <summary>Text <span id="text-summary" class="group-summary"></span></summary>
            <div class="field-grid text-grid">
              <label class="wide-field">Content<input id="text-content" type="text" maxlength="2048" aria-describedby="text-error" /></label>
              <label>Font size<input id="text-size" type="number" min="0.0001" max="1000" step="0.5" aria-describedby="text-error" /></label>
              <label>Weight<input id="text-weight" type="text" maxlength="7" placeholder="normal or 1–1000" aria-describedby="text-error" /></label>
              <label class="wide-field">Font family<input id="text-family" type="text" maxlength="128" placeholder="Local family list" aria-describedby="text-error" /></label>
              <label>Alignment<select id="text-anchor" aria-describedby="text-error"><option value="start">Start</option><option value="middle">Middle</option><option value="end">End</option></select></label>
              <label>Letter spacing<input id="text-letter-spacing" type="text" maxlength="12" placeholder="normal or number" aria-describedby="text-error" /></label>
            </div>
            <small id="text-error" class="field-error" aria-live="polite"></small>
          </details>
          <details class="inspector-group" id="geometry-group">
            <summary>Geometry <span id="geometry-summary" class="group-summary"></span></summary>
            <div class="field-grid">
            <label>Stroke width<input id="stroke-width" type="number" min="0" step="0.5" /></label>
            <label>Opacity<input id="opacity" type="number" min="0" max="1" step="0.05" /></label>
            <p id="geometry-mode" class="geometry-mode wide-field" aria-live="polite"></p>
            <label>Oriented frame X<input id="position-x" type="text" inputmode="decimal" aria-describedby="geometry-mode geometry-error" /></label>
            <label>Oriented frame Y<input id="position-y" type="text" inputmode="decimal" aria-describedby="geometry-mode geometry-error" /></label>
            <label>Oriented frame width<input id="position-width" type="text" inputmode="decimal" aria-describedby="geometry-mode geometry-error" /></label>
            <label>Oriented frame height<input id="position-height" type="text" inputmode="decimal" aria-describedby="geometry-mode geometry-error" /></label>
            <label>Absolute frame rotation °<input id="rotation" type="text" inputmode="decimal" aria-describedby="geometry-mode geometry-error" /></label>
            <label class="preference-check geometry-aspect-lock"><input id="aspect-lock" type="checkbox" checked /> Lock aspect ratio</label>
            <input id="scale" type="hidden" value="100" aria-hidden="true" />
          </div>
          <small id="geometry-error" class="field-error" aria-live="polite"></small>
          </details>
          <p class="inspector-hint"><span id="region-selection-hint">Hold left Control and drag from artwork or empty canvas to region-select; hold Shift too to add.</span> Double-click or Alt-click selects exactly. Open <button type="button" id="inline-shortcut-help">preferences &amp; shortcuts</button>.</p>
        </div>
      </section>
      <section class="preview-section">
        <div class="panel-heading"><span>Small-size check</span></div>
        <label class="preview-target">Target<input id="preview-target" type="text" value="#icon" list="preview-targets" maxlength="128" aria-describedby="preview-status" /></label>
        <datalist id="preview-targets"><option value="#icon"></option></datalist>
        <p id="preview-status" class="preview-status" role="status" aria-live="polite">Whole SVG until a document is loaded.</p>
        <div id="favicon-preview" class="favicon-preview empty-copy">Live previews appear here.</div>
      </section>
      </div>
    </aside>
  </main>
  <dialog id="shortcut-dialog" class="shortcut-dialog" aria-labelledby="shortcut-title">
    <div class="dialog-heading">
      <h2 id="shortcut-title">Preferences &amp; shortcuts</h2>
      <button type="button" id="close-shortcut-help" aria-label="Close preferences and shortcuts">×</button>
    </div>
    <fieldset class="selection-preferences">
      <legend>Selection</legend>
      <label>Precise-selection modifier
        <select id="preference-precise-modifier">
          <option value="platform">Command / Control</option>
          <option value="alt">Option / Alt</option>
        </select>
      </label>
      <label>Marquee selects
        <select id="preference-marquee-mode">
          <option value="contain">Fully enclosed layers</option>
          <option value="touch">Touching layers</option>
        </select>
      </label>
      <label>Region-selection activation
        <select id="preference-region-activation">
          <option value="left-control">Hold left Control</option>
          <option value="m">Hold M</option>
        </select>
      </label>
      <label>Default click selects
        <select id="preference-click-depth">
          <option value="logical">Logical group</option>
          <option value="exact">Exact object</option>
        </select>
      </label>
      <label class="preference-check"><input id="preference-individual-outlines" type="checkbox" /> Enhanced selection outlines</label>
      <label class="preference-check"><input id="preference-alignment-snapping" type="checkbox" /> Smart alignment</label>
      <label class="preference-check"><input id="preference-snap-canvas" type="checkbox" /> Snap to canvas</label>
      <label class="preference-check"><input id="preference-snap-objects" type="checkbox" /> Snap to nearby objects</label>
      <label>Snap tolerance (CSS px)<input id="preference-snap-tolerance" type="number" min="2" max="20" step="1" inputmode="numeric" /></label>
      <button type="button" id="restore-selection-preferences">Restore defaults</button>
    </fieldset>
    <h3>Keyboard shortcuts</h3>
    <dl>
      <div><dt>Undo / Redo</dt><dd>⌘/Ctrl+Z · ⌘/Ctrl+Shift+Z</dd></div>
      <div><dt>Duplicate</dt><dd>⌘/Ctrl+D</dd></div>
      <div><dt>Group / Ungroup</dt><dd>⌘/Ctrl+G · ⌘/Ctrl+Shift+G</dd></div>
      <div><dt>Nudge</dt><dd>Arrow keys · Shift for 10 units</dd></div>
      <div><dt>Smart alignment</dt><dd>Option / Alt suspends · Shift snaps rotation to 15°</dd></div>
      <div><dt>Delete</dt><dd>Delete or Backspace</dd></div>
      <div><dt>Fit artboard / selection</dt><dd>F · Shift+F</dd></div>
      <div><dt>Workspace / Inspector panels</dt><dd>[ · ]</dd></div>
      <div><dt>Region-select visible objects</dt><dd id="region-selection-shortcut">Hold left Control and drag · add Shift</dd></div>
      <div><dt>Exact selection</dt><dd id="exact-selection-shortcut">⌘/Ctrl-click toggles · Alt-click or double-click replaces</dd></div>
      <div><dt>Leave group / clear selection</dt><dd>Escape</dd></div>
    </dl>
  </dialog>
  <dialog id="unsaved-dialog" class="unsaved-dialog" aria-labelledby="unsaved-title" aria-describedby="unsaved-message unsaved-error">
    <h2 id="unsaved-title">Unsaved corrections</h2>
    <p id="unsaved-message"></p>
    <p id="unsaved-error" class="dialog-error" role="alert" aria-live="assertive"></p>
    <div class="unsaved-actions">
      <button type="button" id="unsaved-cancel">Cancel</button>
      <button type="button" id="unsaved-discard">Discard</button>
      <button type="button" id="unsaved-save" class="primary-action">Save</button>
    </div>
  </dialog>
`;

const fileList = getElement("file-list");
const artboard = getElement("artboard");
const agentPreview = getElement("agent-preview");
const emptyState = getElement("empty-state");
const layerList = getElement("layer-list");
const faviconPreview = getElement("favicon-preview");
const previewTarget = getInput<HTMLInputElement>("preview-target");
const previewTargets = getElement("preview-targets");
const previewStatus = getElement("preview-status");
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
const agentReviewLock = getElement("agent-review-lock");
const agentReviewSummary = getElement("agent-review-summary");
const agentPreviewToggle = getInput<HTMLButtonElement>("agent-preview-toggle");
const agentImpactList = getElement("agent-impact-list");
const agentAcceptButton = getInput<HTMLButtonElement>("agent-accept");
const agentRevertButton = getInput<HTMLButtonElement>("agent-revert");
const agentReviewConsequence = getElement("agent-review-consequence");
const workspaceSessionStorage = (() => {
  try { return localStorage; } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
})();
const selectionPreferencesStore = new SelectionPreferencesStore(safeSelectionPreferencesStorage(() => localStorage));
let selectionPreferences = selectionPreferencesStore.value;
const layout = new CanvasLayoutController({
  shell: getElement("canvas-shell"),
  leftToggle: getInput("toggle-left-sidebar"),
  rightToggle: getInput("toggle-right-sidebar"),
  pendingBadge: getElement("pending-review-badge"),
  storage: safeLayoutStorage(() => localStorage),
  onPreferenceChange: () => persistWorkspaceSession(),
});
const unsavedDialog = new UnsavedDialogController({
  dialog: getInput("unsaved-dialog"),
  message: getElement("unsaved-message"),
  error: getElement("unsaved-error"),
  cancel: getInput("unsaved-cancel"),
  discard: getInput("unsaved-discard"),
  save: getInput("unsaved-save"),
});
const fileButtons = new Map<string, HTMLButtonElement>();
const collapsedLayerKeys = new Set<string>();
let currentFile: SvgFileEntry | undefined;
let currentWorkspaceName: string | undefined;
let workspaceSessionInitialized = false;
let restoringWorkspaceSession = false;
let dirty = false;
let nextIterationPath = "iterations/iteration-1.svg";
let zoom = 1;
let previewBackground: PreviewBackground = "checker";
let currentObjectUrl: string | undefined;
let layerQuery = "";
let agentSession: AgentSession | undefined;
let agentManifestSync: Promise<void> = Promise.resolve();
let agentReview: AgentReviewModel | undefined;
let agentPreviewActive = false;
let reviewImpactKeys = new Set<string>();
let agentDecisionInFlight = false;
let agentReviewReturnFocus: HTMLElement | undefined;
let agentTransportStarted = false;
let agentTransportClosed = false;
let agentManifestRetry: number | undefined;
let workspaceRefreshGeneration = 0;
const agentTerminalReconciliationInFlight = new Set<string>();
const fileOpenCoordinator = new FileOpenCoordinator();
const fileSwitchCoordinator = new FileOpenCoordinator();

function selectionIdentityPath(): string[] {
  const root = editor.svgNode;
  const selected = editor.selectionContext.selected;
  if (!root || !selected) return [];
  return boundedSelectionPath(getSelectionAncestry(selected, root).map((node) => node.id));
}

function persistWorkspaceSession(): void {
  if (restoringWorkspaceSession || !currentWorkspaceName || !currentFile) return;
  const preferences = layout.preferences;
  writeWorkspaceSession(workspaceSessionStorage, {
    version: 1,
    workspace: currentWorkspaceName,
    activePath: currentFile.path,
    selectionPath: selectionIdentityPath(),
    zoom,
    previewBackground,
    leftCollapsed: preferences.leftCollapsed,
    rightCollapsed: preferences.rightCollapsed,
  });
}

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
    distributeHorizontalButton: getInput("distribute-horizontal"),
    distributeVerticalButton: getInput("distribute-vertical"),
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
    positionWidth: getInput("position-width"),
    positionHeight: getInput("position-height"),
    geometryMode: getElement("geometry-mode"),
    geometryError: getElement("geometry-error"),
    aspectLock: getInput("aspect-lock"),
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
    spaceHorizontalButton: getInput("space-horizontal"),
    spaceVerticalButton: getInput("space-vertical"),
    textAnchor: getInput("text-anchor"),
    textContent: getInput("text-content"),
    textError: getElement("text-error"),
    textFamily: getInput("text-family"),
    textLetterSpacing: getInput("text-letter-spacing"),
    textSize: getInput("text-size"),
    textWeight: getInput("text-weight"),
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
      saveButton.disabled = Boolean(agentSession?.pending) || !dirty;
      resetEditsButton.disabled = Boolean(agentSession?.pending) || (!dirty && editor.selectionContext.lockedKeys.size === 0);
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
      persistWorkspaceSession();
    },
    onSelectionContextChange: (context) => {
      renderSelectionContext(context);
      if (agentSession && currentFile?.path === agentSession.context.sourcePath) publishAgentDocument();
    },
    onStatus: setStatus,
  },
);
editor.setSelectionPreferences(selectionPreferences);

function publishAgentDocument(): void {
  const root = editor.svgNode;
  if (!agentSession || !root) return;
  const manifest = agentSession.manifest(agentLayers(root));
  agentManifestSync = agentManifestSync
    .catch(() => undefined)
    .then(() => agentTransport.publishDocument(manifest))
    .then(() => {
      if (agentManifestRetry !== undefined) {
        window.clearTimeout(agentManifestRetry);
        agentManifestRetry = undefined;
      }
      if (!agentTransportStarted) {
        agentTransportStarted = true;
        agentTransport.start();
      }
    })
    .catch((error) => {
      setStatus(error instanceof Error ? error.message : "Agent synchronization failed");
      if (!agentTransportClosed && agentManifestRetry === undefined) {
        agentManifestRetry = window.setTimeout(() => {
          agentManifestRetry = undefined;
          publishAgentDocument();
        }, 500);
      }
    });
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
  connect: false,
  onTransaction: (transaction) => {
    if (!agentSession) return undefined;
    const pendingBeforeStage = agentSession.pending;
    const staged = agentSession.stage(transaction);
    if (staged?.result.status === "staged") {
      if (!pendingBeforeStage && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        agentReviewReturnFocus = document.activeElement;
      }
      const persisted = persistPendingReviewRecovery({
        transactionId: transaction.transactionId,
        sessionId: transaction.document.sessionId,
        sourcePath: transaction.document.sourcePath,
        revision: transaction.document.baseRevision,
        svg: editor.serializeClean(),
        dirty,
      });
      if (!persisted) {
        agentSession.revert();
        const rejected = {
          result: {
            transactionId: transaction.transactionId,
            status: "rejected" as const,
            error: { code: "invalid_payload" as const, message: "Browser tab storage is unavailable, so the proposal was not staged for recoverable review." },
          },
        };
        agentReview = outcomeReview("failed", transaction.transactionId, "This proposal was not staged because browser tab storage is unavailable. Ask the producer to retry after storage is enabled.");
        renderAgentReview();
        setStatus("Agent proposal rejected: browser tab storage is unavailable");
        return rejected;
      }
      if (!pendingBeforeStage && agentSession.pending?.transaction.transactionId === transaction.transactionId) {
        fileOpenCoordinator.invalidate();
        fileSwitchCoordinator.invalidate();
        if (unsavedDialog.preempt()) agentReviewReturnFocus = saveButton;
      }
      agentReview = buildPendingReview(transaction, staged, editor.selectionContext.lockedKeys);
      reviewImpactKeys = new Set(agentReview.layers.map((layer) => layer.sessionKey));
      editor.setAgentReviewHighlights(reviewImpactKeys);
      setReviewPreview(false);
      agentReviewConsequence.textContent = "Accept creates one undoable edit. Revert leaves the document unchanged.";
      renderAgentReview();
      setStatus(`Agent transaction ${transaction.transactionId} is staged for review`);
      if (!pendingBeforeStage) queueMicrotask(() => agentAcceptButton.focus());
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
  onTerminalState: (state) => { void reconcileStreamTerminal(state); },
  onServerReplacement: () => {
    const transactionId = agentSession?.pending?.transaction.transactionId;
    const outcome = agentSession?.serverReplaced() ?? "none";
    if (outcome === "detached-cleared") {
      clearPendingReviewRecovery(transactionId);
      finishAgentReview("reverted");
      agentReview = outcomeReview("reverted", transactionId, "The local agent server restarted. Its detached proposal was cleared without changing the document.");
    } else if (outcome === "provisional-uncertain" && agentReview) {
      agentReview = { ...agentReview, status: "disconnected", summary: "The local agent server restarted before the provisional acceptance was confirmed. Inspect the canvas, then restore the previous document explicitly." };
      agentReviewConsequence.textContent = "Restore previous document rolls back only this exact provisional transaction. Editing, file switching, and saving remain locked until recovery.";
    }
    renderAgentReview();
    setStatus("Agent server restarted; review recovery is required");
  },
  onStateChange: (state, message) => {
    if (state === "disconnected") {
      agentReview = agentReview && agentSession?.pending
        ? agentSession.recoveryRequired
          ? { ...agentReview, status: "disconnected", summary: "The provisional acceptance has no authoritative server identity. Inspect the canvas, then restore the previous document explicitly." }
          : { ...agentReview, status: "disconnected", summary: "Agent connection interrupted. You can still accept or revert the isolated proposal." }
        : outcomeReview("disconnected", agentReview?.transactionId);
      renderAgentReview();
    } else if (agentReview?.status === "disconnected" && agentSession?.pending && !agentSession.recoveryRequired) {
      agentReview = buildPendingReview(agentSession.pending.transaction, agentSession.pending.staged, editor.selectionContext.lockedKeys);
      renderAgentReview();
    }
    setStatus(message);
  },
});

async function reconcileStreamTerminal({ transactionId, status }: { transactionId: string; status: "accepted" | "reverted" | "rejected" | "stale" }): Promise<void> {
  // The deciding page converges from its acknowledgement response. Reacting to
  // its concurrently broadcast terminal event would race that local finalize.
  if (agentDecisionInFlight) return;
  if (agentTerminalReconciliationInFlight.has(transactionId)) return;
  agentTerminalReconciliationInFlight.add(transactionId);
  try {
    if (status !== "accepted" && agentSession?.reconcileTerminal(transactionId, status)) {
      clearPendingReviewRecovery(transactionId);
      finishAgentReview("reverted");
      agentReview = outcomeReview(status === "stale" ? "stale" : status === "rejected" ? "failed" : "reverted", transactionId,
        status === "reverted"
          ? "The server reverted this exact proposal without changing the document."
          : "The server rejected this exact proposal; its isolated changes were not kept.");
      renderAgentReview();
      setStatus(`Agent transaction ${transactionId}: ${status}`);
      return;
    }
    const recovery = readPendingReviewRecovery();
    if (!recovery || recovery.transactionId !== transactionId) return;
    try {
      const recovered = await agentTransport.recover(recovery);
      if (!("state" in recovered) || recovered.state.status !== status) {
        throw new AgentRecoveryError("Terminal recovery did not match the announced authoritative state.", false);
      }
      reconcileRecoveredTerminal(recovered);
    } catch (error) {
      agentReview = outcomeReview("disconnected", transactionId, "The server announced a terminal review state, but its authoritative details could not be read. Reload to retry; the stored document remains unchanged.");
      renderAgentReview();
      setStatus(error instanceof Error ? error.message : "Authoritative agent recovery is temporarily unavailable");
    }
  } finally {
    agentTerminalReconciliationInFlight.delete(transactionId);
  }
}

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
  layout.setPendingReview(pending);
  const recoveryRequired = agentSession?.recoveryRequired === true;
  agentPreviewToggle.hidden = !pending;
  agentAcceptButton.hidden = !pending || recoveryRequired;
  agentRevertButton.hidden = !pending;
  agentReviewConsequence.hidden = !pending;
  agentReviewLock.hidden = !pending;
  agentAcceptButton.disabled = agentDecisionInFlight;
  agentRevertButton.disabled = agentDecisionInFlight;
  agentRevertButton.textContent = recoveryRequired ? "Restore previous document" : "Revert";
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
  renderSelectionContext(editor.selectionContext);
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
  clearPendingReviewRecovery(transactionId);
  reviewImpactKeys.clear();
  editor.setAgentReviewHighlights(reviewImpactKeys);
  setReviewPreview(false);
  agentReview = outcomeReview(status, transactionId);
  renderAgentReview();
  const returnFocus = agentReviewReturnFocus?.isConnected ? agentReviewReturnFocus : layerSearch;
  agentReviewReturnFocus = undefined;
  queueMicrotask(() => returnFocus.focus());
  if (status === "accepted") refreshWorkspaceAfterAgentAccept();
}

agentPreviewToggle.addEventListener("click", () => setReviewPreview(!agentPreviewActive));

async function decideAgentReview(status: "accepted" | "reverted"): Promise<void> {
  const pending = agentSession?.pending;
  if (!pending || agentDecisionInFlight) return;
  agentDecisionInFlight = true;
  agentReviewConsequence.textContent = status === "accepted"
    ? "Applying the proposal and capturing its clean accepted revision…"
    : "Recording reverted decision…";
  renderAgentReview();
  try {
    if (agentSession?.recoveryRequired) {
      if (status !== "reverted" || !agentSession.restoreAfterServerReplacement(pending.transaction.transactionId)) {
        throw new Error("This recovery action no longer matches the provisional transaction.");
      }
      finishAgentReview("reverted");
      setStatus("Previous document restored after agent server restart");
      return;
    }
    if (status === "accepted") {
      if (!agentSession?.beginAccept()) throw new Error("The pending agent proposal changed before it could be applied.");
      const artifact = {
        sourcePath: agentSession.context.sourcePath,
        revision: agentSession.revision,
        svg: editor.serializeClean(),
      };
      await agentTransport.decide(pending.transaction.transactionId, status, artifact);
      if (!agentSession.finalizeAccept(pending.transaction.transactionId)) throw new Error("The provisional acceptance could not be finalized.");
      finishAgentReview("accepted");
    } else {
      await agentTransport.decide(pending.transaction.transactionId, status);
      const completed = pending.provisional
        ? agentSession?.rollbackAccept(pending.transaction.transactionId)
        : agentSession?.revert();
      if (!completed) throw new Error("The pending agent proposal changed before its decision completed.");
      finishAgentReview("reverted");
    }
  } catch (error) {
    if (error instanceof AgentDecisionError && agentSession?.pending?.transaction.transactionId === pending.transaction.transactionId) {
      if (["reverted", "rejected", "stale"].includes(error.state?.status ?? "") && pending.provisional) {
        agentSession.rollbackAccept(pending.transaction.transactionId);
        finishAgentReview("reverted");
        return;
      } else if (error.state?.status === "accepted" && pending.provisional
        && JSON.stringify(error.state.artifact) === JSON.stringify({
          sourcePath: agentSession.context.sourcePath, revision: agentSession.revision, svg: editor.serializeClean(),
        })) {
        agentSession.finalizeAccept(pending.transaction.transactionId);
        finishAgentReview("accepted");
        return;
      } else if (error.state?.status === "accepted" && pending.provisional) {
        const svg = error.state.artifact?.svg;
        if (svg) {
          const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
          const accepted = parsed.documentElement;
          if (accepted instanceof SVGSVGElement && !parsed.querySelector("parsererror")
            && agentSession.convergeAcceptedArtifact(pending.transaction.transactionId, accepted)) {
            finishAgentReview("accepted");
            setStatus("Applied the authoritative accepted artifact returned by the canvas server");
            return;
          }
        }
        agentReviewConsequence.textContent = "The server accepted a different artifact, but the canvas could not apply it. Editing and saving remain locked.";
        setStatus(agentReviewConsequence.textContent);
        return;
      }
    }
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
  const selected = context.selected;
  const countBadge = getElement("selection-count-badge");
  const nextCountText = context.selectedNodes.length > 1 ? `${context.selectedNodes.length} objects selected` : "";
  if (countBadge.textContent !== nextCountText) countBadge.textContent = nextCountText;
  countBadge.hidden = context.selectedNodes.length <= 1;
  renderInspectorSummaries(context);
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
  if (root && context.selectedNodes.length > 0) {
    let expanded = false;
    if (layerQuery && context.selectedNodes.some((node) => !layerList.querySelector(`.layer-button[data-key="${CSS.escape(node.dataset.lineageKey ?? "")}"]`))) {
      layerSearch.value = "";
      layerQuery = "";
      clearLayerSearchButton.disabled = true;
      expanded = true;
    }
    for (const selectedNode of context.selectedNodes) {
      for (const ancestor of getSelectionAncestry(selectedNode, root).slice(0, -1)) {
        const key = ancestor.dataset.lineageKey;
        if (key && collapsedLayerKeys.delete(key)) expanded = true;
      }
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
  const refreshAffordances = () => editor.refreshSelectionAffordances();
  window.requestAnimationFrame(refreshAffordances);
  window.setTimeout(refreshAffordances, 170);
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
  persistWorkspaceSession();
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
    button.addEventListener("click", () => void requestFileSwitch(file, button));
    fileButtons.set(file.path, button);
    section.append(button);
  }
  return section;
}

async function requestFileSwitch(file: SvgFileEntry, button: HTMLButtonElement): Promise<void> {
  if (agentSession?.pending) {
    setStatus("Accept or revert the pending agent proposal before switching files.");
    layout.reveal("right");
    agentReviewPanel.focus();
    return;
  }
  workspaceRefreshGeneration += 1;
  const request = fileSwitchCoordinator.begin();
  if (!dirty) {
    if (!fileSwitchCoordinator.canCommit(request, Boolean(agentSession?.pending))) return;
    await openSvg(file, button);
    return;
  }
  let decision = await unsavedDialog.request(file.name, button);
  while (true) {
    if (!fileSwitchCoordinator.canCommit(request, Boolean(agentSession?.pending))) return;
    if (decision === "cancel") return;
    if (decision === "discard") {
      await openSvg(file, button);
      return;
    }
    unsavedDialog.setBusy(true);
    const saved = await saveIteration(false);
    if (!fileSwitchCoordinator.canCommit(request, Boolean(agentSession?.pending))) return;
    if (saved) break;
    unsavedDialog.showError("The iteration could not be saved. Your current document is unchanged; try Save again or Cancel.");
    decision = await unsavedDialog.waitForDecision();
  }
  if (!fileSwitchCoordinator.canCommit(request, Boolean(agentSession?.pending))) return;
  unsavedDialog.closeAfterSuccess();
  await loadWorkspace(file.path, {
    coordinator: fileSwitchCoordinator,
    request,
    isPending: () => Boolean(agentSession?.pending),
  });
}

async function openSvg(file: SvgFileEntry, button: HTMLButtonElement, restoration?: WorkspaceSessionV1): Promise<void> {
  if (agentSession?.pending) return;
  let recovery = readPendingReviewRecovery();
  if (recovery?.sourcePath !== file.path) recovery = undefined;
  let recovered: AgentRecoveryState | undefined;
  if (recovery) {
    try {
      recovered = await agentTransport.recover(recovery);
    } catch (error) {
      if (!(error instanceof AgentRecoveryError) || !error.terminal) {
        setStatus("Agent review recovery is temporarily unavailable. The stored document was not opened or changed.");
        return;
      }
      clearPendingReviewRecovery(recovery.transactionId);
      recovery = undefined;
      agentReview = outcomeReview("disconnected", undefined, "The stored review no longer matches an authoritative server transaction. The workspace file was reopened without restoring stale tab state.");
      renderAgentReview();
    }
    if (recovered && "status" in recovered && recovered.status === "unknown") {
      clearPendingReviewRecovery(recovery?.transactionId);
      recovery = undefined;
      agentReview = outcomeReview("disconnected", recovered.transactionId, "The previous server no longer knows this review. The workspace file was reopened without restoring stale tab state.");
      renderAgentReview();
    }
  }
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
      return svg as unknown as SVGSVGElement;
    },
    onEligibleError: (error) => setStatus(error instanceof Error ? error.message : "Unable to open SVG."),
    commit: (svg) => {
      workspaceRefreshGeneration += 1;
      const storedRecovery = readPendingReviewRecovery();
      if (recovery && JSON.stringify(storedRecovery) !== JSON.stringify(recovery)) {
        throw new Error("Agent review recovery changed while the SVG was loading. Reload to reconcile the authoritative state.");
      }
      const savedBaseline = serializeSvg(svg, true);
      if (recovery?.sourcePath === file.path) {
        const parsed = new DOMParser().parseFromString(recovery.svg, "image/svg+xml");
        if (parsed.documentElement.localName !== "svg" || parsed.querySelector("parsererror")) {
          clearPendingReviewRecovery(recovery.transactionId);
          throw new Error("Pending review recovery SVG is invalid.");
        }
        svg = parsed.documentElement as unknown as SVGSVGElement;
      }
      const sessionId = recovery?.sourcePath === file.path ? recovery.sessionId : crypto.randomUUID();
      const revision = recovery?.sourcePath === file.path ? recovery.revision : 0;
      if (agentSession && !agentSession.open(sessionId, file.path, revision)) throw new Error("File-open commit gate lost pending eligibility.");
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
      const restoreUi = restoration?.activePath === file.path && !recovery ? restoration : undefined;
      restoringWorkspaceSession = Boolean(restoreUi);
      try {
        setZoom(restoreUi?.zoom ?? 1);
        editor.load(renderedSvg, recovery?.dirty ? savedBaseline : undefined);
        if (restoreUi) {
          applyPreviewBackground(restoreUi.previewBackground);
          const root = editor.svgNode;
          const selected = root
            ? resolveSelectionPath(root, restoreUi.selectionPath, (element): element is SVGGraphicsElement => isSelectableNode(element, root))
            : undefined;
          if (selected) editor.selectNode(selected);
        }
      } finally {
        restoringWorkspaceSession = false;
      }
      if (recovery && recovered && "state" in recovered) {
        if (recovered.state.status === "pending_review") restoreRecoveredPending(recovered);
        else reconcileRecoveredTerminal(recovered);
      }
      const activeSvg = editor.svgNode;
      if (!activeSvg) throw new Error("Committed SVG is missing after agent recovery.");
      publishAgentDocument();
      renderLayers(activeSvg);
      renderFavicons(editor.serializeClean());
      getElement("document-size").textContent = activeSvg.getAttribute("viewBox") ?? "No viewBox";
      persistWorkspaceSession();
      if (!recovered) setStatus(`${file.collection} / ${file.name}`);
      if (recovered && "status" in recovered) queueMicrotask(() => layerSearch.focus());
    },
  });
}

function restoreRecoveredPending(recovered: Extract<AgentRecoveryState, { state: unknown }>): void {
  const { transaction, state } = recovered;
  if (!agentSession || state.status !== "pending_review") throw new Error("Pending agent recovery is unavailable.");
  const staged = agentSession.stage(transaction);
  if (staged?.result.status !== "staged" || JSON.stringify(staged.result) !== JSON.stringify(state.result)) {
    agentSession.revert();
    throw new Error("Recovered pending review no longer evaluates to its authoritative result.");
  }
  fileOpenCoordinator.invalidate();
  fileSwitchCoordinator.invalidate();
  agentReview = buildPendingReview(transaction, staged, editor.selectionContext.lockedKeys);
  reviewImpactKeys = new Set(agentReview.layers.map((layer) => layer.sessionKey));
  editor.setAgentReviewHighlights(reviewImpactKeys);
  setReviewPreview(false);
  agentReviewConsequence.textContent = "Accept creates one undoable edit. Revert leaves the document unchanged.";
  renderAgentReview();
  setStatus(`Agent transaction ${transaction.transactionId} was restored for review`);
  queueMicrotask(() => agentAcceptButton.focus());
}

function reconcileRecoveredTerminal(recovered: Extract<AgentRecoveryState, { state: unknown }>): void {
  const { transaction, state } = recovered;
  if (!agentSession) throw new Error("Agent session is unavailable during terminal recovery.");
  if (state.status === "accepted") {
    if (!state.artifact) throw new Error("Authoritative acceptance has no artifact receipt.");
    const parsed = new DOMParser().parseFromString(state.artifact.svg, "image/svg+xml");
    const accepted = parsed.documentElement;
    if (!(accepted instanceof SVGSVGElement) || parsed.querySelector("parsererror")
      || !agentSession.recoverAcceptedArtifact(transaction, accepted)) {
      throw new Error("Authoritative accepted artifact could not be restored.");
    }
    agentReview = outcomeReview("accepted", transaction.transactionId, "The server had already accepted this exact proposal. Its authoritative artifact was restored as one undoable edit.");
  } else {
    agentReview = outcomeReview(state.status === "stale" ? "stale" : state.status === "rejected" ? "failed" : "reverted", transaction.transactionId,
      state.status === "reverted"
        ? "The server had already reverted this exact proposal. The accepted document remains unchanged."
        : "The server had already terminated this exact proposal without applying it.");
  }
  clearPendingReviewRecovery(transaction.transactionId);
  renderAgentReview();
  setStatus(`Recovered authoritative agent transaction ${transaction.transactionId}: ${state.status}`);
  queueMicrotask(() => layerSearch.focus());
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
  const eligibleIds = eligiblePreviewTargetIds(source);
  const previousTarget = previewTarget.value;
  const options = ["icon", ...eligibleIds.filter((id) => id !== "icon")];
  previewTargets.replaceChildren(...options.map((id) => {
    const option = document.createElement("option");
    option.value = `#${id}`;
    return option;
  }));
  previewTarget.value = previousTarget || "#icon";
  const preview = createSvgPreview(source, previewTarget.value || "#icon");
  previewStatus.textContent = preview.status;
  const previousObjectUrl = currentObjectUrl;
  currentObjectUrl = URL.createObjectURL(new Blob([preview.svg], { type: "image/svg+xml" }));
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
    image.alt = `${size}px ${preview.fallback ? "whole SVG fallback" : `#${preview.targetId}`} preview`;
    const label = document.createElement("span");
    label.textContent = `${size}px`;
    item.append(image, label);
    faviconPreview.append(item);
  }
}

previewTarget.addEventListener("change", () => {
  const source = editor.serializeClean();
  if (source) renderFavicons(source);
});
previewTarget.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const source = editor.serializeClean();
  if (source) renderFavicons(source);
});

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

const preciseModifierPreference = getInput<HTMLSelectElement>("preference-precise-modifier");
const marqueeModePreference = getInput<HTMLSelectElement>("preference-marquee-mode");
const clickDepthPreference = getInput<HTMLSelectElement>("preference-click-depth");
const individualOutlinesPreference = getInput<HTMLInputElement>("preference-individual-outlines");
const regionActivationPreference = getInput<HTMLSelectElement>("preference-region-activation");
const alignmentSnappingPreference = getInput<HTMLInputElement>("preference-alignment-snapping");
const snapCanvasPreference = getInput<HTMLInputElement>("preference-snap-canvas");
const snapObjectsPreference = getInput<HTMLInputElement>("preference-snap-objects");
const snapTolerancePreference = getInput<HTMLInputElement>("preference-snap-tolerance");
const regionSelectionShortcut = getElement("region-selection-shortcut");
const regionSelectionHint = getElement("region-selection-hint");
const exactSelectionShortcut = getElement("exact-selection-shortcut");
const preferencesDialog = new PreferencesDialogController({
  dialog: shortcutDialog,
  closeButton: getInput("close-shortcut-help"),
  initialFocus: preciseModifierPreference,
});

function renderSelectionPreferences(): void {
  preciseModifierPreference.value = selectionPreferences.preciseModifier;
  marqueeModePreference.value = selectionPreferences.marqueeMode;
  clickDepthPreference.value = selectionPreferences.clickDepth;
  individualOutlinesPreference.checked = selectionPreferences.individualOutlines;
  regionActivationPreference.value = selectionPreferences.regionActivation;
  alignmentSnappingPreference.checked = selectionPreferences.alignmentSnappingEnabled;
  snapCanvasPreference.checked = selectionPreferences.snapToCanvas;
  snapObjectsPreference.checked = selectionPreferences.snapToObjects;
  snapTolerancePreference.value = String(selectionPreferences.snapTolerancePx);
  snapCanvasPreference.disabled = !selectionPreferences.alignmentSnappingEnabled;
  snapObjectsPreference.disabled = !selectionPreferences.alignmentSnappingEnabled;
  snapTolerancePreference.disabled = !selectionPreferences.alignmentSnappingEnabled;
  regionSelectionShortcut.textContent = selectionPreferences.regionActivation === "m"
    ? "Hold M and drag · add Shift"
    : "Hold left Control and drag · add Shift; click to toggle exact object";
  regionSelectionHint.textContent = selectionPreferences.regionActivation === "m"
    ? "Hold M and drag from artwork or empty canvas to region-select; hold Shift too to add."
    : "Hold left Control and drag from artwork or empty canvas to region-select; hold Shift too to add; Control-click toggles an exact object.";
  exactSelectionShortcut.textContent = selectionPreferences.preciseModifier === "alt"
    ? "Option/Alt-click toggles · double-click replaces"
    : "⌘/Ctrl-click toggles · Alt-click or double-click replaces";
}

function applySelectionPreferences(next: SelectionPreferences): void {
  const activationChanged = next.regionActivation !== selectionPreferences.regionActivation;
  selectionPreferences = selectionPreferencesStore.update(next);
  if (activationChanged) {
    applyStageGesture(stageGestures.cancel());
    marqueeActivation.configure(selectionPreferences.regionActivation);
    cancelMarqueeForDisarm();
  }
  editor.setSelectionPreferences(selectionPreferences);
  renderSelectionPreferences();
  setStatus("Selection preferences updated");
}

function readSelectionPreferencesForm(): SelectionPreferences {
  const tolerance = snapTolerancePreference.valueAsNumber;
  return {
    preciseModifier: preciseModifierPreference.value === "alt" ? "alt" : "platform",
    marqueeMode: marqueeModePreference.value === "touch" ? "touch" : "contain",
    clickDepth: clickDepthPreference.value === "exact" ? "exact" : "logical",
    individualOutlines: individualOutlinesPreference.checked,
    regionActivation: regionActivationPreference.value === "m" ? "m" : "left-control",
    alignmentSnappingEnabled: alignmentSnappingPreference.checked,
    snapToCanvas: snapCanvasPreference.checked,
    snapToObjects: snapObjectsPreference.checked,
    snapTolerancePx: Number.isInteger(tolerance) && tolerance >= 2 && tolerance <= 20
      ? tolerance
      : selectionPreferences.snapTolerancePx,
  };
}

for (const control of [
  preciseModifierPreference, marqueeModePreference, clickDepthPreference, individualOutlinesPreference,
  regionActivationPreference, alignmentSnappingPreference, snapCanvasPreference, snapObjectsPreference,
  snapTolerancePreference,
]) {
  control.addEventListener("change", () => {
    if (control === snapTolerancePreference) {
      const tolerance = snapTolerancePreference.valueAsNumber;
      if (!Number.isInteger(tolerance) || tolerance < 2 || tolerance > 20) {
        renderSelectionPreferences();
        setStatus("Snap tolerance must be a whole number from 2 to 20");
        return;
      }
    }
    applySelectionPreferences(readSelectionPreferencesForm());
  });
}
getElement("restore-selection-preferences").addEventListener("click", () => {
  applySelectionPreferences(selectionPreferencesStore.reset());
  preciseModifierPreference.focus();
  setStatus("Restored default selection preferences");
});
renderSelectionPreferences();

function openShortcutHelp(event?: Event): void {
  const invoker = event?.currentTarget instanceof HTMLElement ? event.currentTarget : getElement("shortcut-help");
  preferencesDialog.open(invoker);
}

getElement("shortcut-help").addEventListener("click", openShortcutHelp);
getElement("inline-shortcut-help").addEventListener("click", openShortcutHelp);

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
let panStartLeft = 0;
let panStartTop = 0;
let capturedStagePointer: number | undefined;
let marqueeOverlay: HTMLDivElement | undefined;
const stageGestures = new StageGestureController<SVGGraphicsElement>();
const marqueeActivation = new MarqueeActivationController(selectionPreferences.regionActivation);
const contextMenuSuppression = new ContextMenuSuppressionController();
document.addEventListener("pointerdown", () => contextMenuSuppression.pointerDown(), true);

function removeMarqueeOverlay(): void {
  const capturedPointer = capturedStagePointer;
  marqueeOverlay?.remove();
  marqueeOverlay = undefined;
  capturedStagePointer = undefined;
  stage.classList.remove("marquee-active");
  if (capturedPointer !== undefined && stage.hasPointerCapture(capturedPointer)) {
    stage.releasePointerCapture(capturedPointer);
  }
}

function renderMarqueeOverlay(rect: ClientRect): void {
  const stageRect = stage.getBoundingClientRect();
  marqueeOverlay ??= (() => {
    const overlay = document.createElement("div");
    overlay.className = "marquee-selection";
    overlay.setAttribute("aria-hidden", "true");
    stage.append(overlay);
    return overlay;
  })();
  marqueeOverlay.style.left = `${rect.left - stageRect.left + stage.scrollLeft}px`;
  marqueeOverlay.style.top = `${rect.top - stageRect.top + stage.scrollTop}px`;
  marqueeOverlay.style.width = `${rect.width}px`;
  marqueeOverlay.style.height = `${rect.height}px`;
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.key === "Escape" && marqueeActivation.held) {
    event.preventDefault();
    disarmMarquee();
    return;
  }
  if (event.code === "KeyM" || event.code === "ControlLeft") {
    const armed = marqueeActivation.keyDown({
      altKey: event.altKey,
      code: event.code,
      composing: event.isComposing,
      ctrlKey: event.ctrlKey,
      editableOrModal: isLayoutShortcutTarget(target) || Boolean(document.querySelector("dialog[open]")),
      metaKey: event.metaKey,
      repeat: event.repeat,
    });
    if (armed) {
      stage.classList.add("marquee-ready");
      setStatus(selectionPreferences.regionActivation === "m"
        ? "Region selection ready · drag while holding M"
        : "Region selection ready · drag or click while holding left Control");
      event.preventDefault();
    }
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    && (event.key === "[" || event.key === "]")
    && !document.querySelector("dialog[open]") && !isLayoutShortcutTarget(target)) {
    event.preventDefault();
    layout.toggle(event.key === "[" ? "left" : "right");
    return;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)) return;
  if (shortcutDialog.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      preferencesDialog.close();
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
  if (event.code === "KeyM" || event.code === "ControlLeft") {
    if (marqueeActivation.keyUp(event.code)) cancelMarqueeForDisarm();
    return;
  }
  if (event.code !== "Space") return;
  spacePressed = false;
  if (stageGestures.activeKind !== "pan") stage.classList.remove("pan-ready");
});

function cancelMarqueeForDisarm(): void {
  stage.classList.remove("marquee-ready");
  if (stageGestures.activeKind === "marquee") applyStageGesture(stageGestures.cancel());
}

function disarmMarquee(): void {
  if (marqueeActivation.disarm()) cancelMarqueeForDisarm();
}

window.addEventListener("blur", disarmMarquee);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") disarmMarquee();
});
document.addEventListener("focusin", (event) => {
  if (isLayoutShortcutTarget(event.target)) disarmMarquee();
});

function applyStageGesture(transition: StageGestureTransition<SVGGraphicsElement>): boolean {
  switch (transition.type) {
    case "none":
    case "marquee-pending":
    case "background-pending":
    case "background-inert":
      return false;
    case "pan-start":
      panStartLeft = stage.scrollLeft;
      panStartTop = stage.scrollTop;
      capturedStagePointer = transition.pointerId;
      stage.setPointerCapture(transition.pointerId);
      stage.classList.add("panning");
      return true;
    case "pan-move":
      stage.scrollLeft = panStartLeft - transition.dx;
      stage.scrollTop = panStartTop - transition.dy;
      return true;
    case "pan-end":
      capturedStagePointer = undefined;
      stage.classList.remove("panning");
      if (!spacePressed) stage.classList.remove("pan-ready");
      return true;
    case "background-start":
      capturedStagePointer = transition.pointerId;
      stage.setPointerCapture(transition.pointerId);
      return true;
    case "background-click":
      editor.completeBackgroundGesture(false, transition.additive);
      removeMarqueeOverlay();
      return true;
    case "background-inert-end":
      editor.completeBackgroundGesture(true);
      removeMarqueeOverlay();
      return true;
    case "background-cancel":
      editor.suppressCanvasClick();
      removeMarqueeOverlay();
      return true;
    case "control-click":
      editor.completeControlGesture(transition.candidate, transition.additive);
      removeMarqueeOverlay();
      return true;
    case "region-noop":
      editor.suppressCanvasClick();
      removeMarqueeOverlay();
      return true;
    case "marquee-start":
      if (!editor.beginMarquee()) {
        stageGestures.cancel(transition.pointerId);
        return false;
      }
      capturedStagePointer = transition.pointerId;
      stage.setPointerCapture(transition.pointerId);
      return true;
    case "marquee-active":
      stage.classList.add("marquee-active");
      renderMarqueeOverlay(transition.rect);
      editor.previewMarquee(transition.rect, transition.additive);
      return true;
    case "marquee-commit":
      if (marqueeActivation.held) editor.commitMarquee(transition.rect, transition.additive);
      else editor.cancelMarquee();
      removeMarqueeOverlay();
      return true;
    case "marquee-cancel":
      editor.cancelMarquee();
      removeMarqueeOverlay();
      return true;
  }
}

stage.addEventListener("pointerdown", (event) => {
  const armed = marqueeActivation.held;
  const canvasTarget = event.target === stage || editor.canStartRegionSelection(event.target);
  const handled = applyStageGesture(stageGestures.pointerDown({
    activation: marqueeActivation.activation,
    additive: event.shiftKey,
    altKey: event.altKey,
    button: event.button,
    canMarquee: armed ? canvasTarget : editor.canStartMarquee(event.target),
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    marqueeArmed: armed,
    point: { x: event.clientX, y: event.clientY },
    pointerId: event.pointerId,
    spacePressed,
    candidate: armed ? editor.exactRegionCandidate(event.target) : undefined,
  }));
  if (handled) {
    if (armed && marqueeActivation.activation === "left-control") {
      contextMenuSuppression.accept(event.pointerId, { x: event.clientX, y: event.clientY }, performance.now());
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

stage.addEventListener("contextmenu", (event) => {
  if (!contextMenuSuppression.consume({
    canvasTarget: event.target === stage || editor.canStartRegionSelection(event.target),
    ctrlKey: event.ctrlKey,
    point: { x: event.clientX, y: event.clientY },
    time: performance.now(),
  })) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

stage.addEventListener("pointermove", (event) => {
  contextMenuSuppression.pointerMove(event.pointerId, { x: event.clientX, y: event.clientY });
  applyStageGesture(stageGestures.pointerMove(event.pointerId, { x: event.clientX, y: event.clientY }));
});

stage.addEventListener("pointerup", (event) => {
  applyStageGesture(stageGestures.pointerUp(event.pointerId));
});
stage.addEventListener("pointercancel", (event) => applyStageGesture(stageGestures.cancel(event.pointerId)));
stage.addEventListener("lostpointercapture", (event) => applyStageGesture(stageGestures.cancel(event.pointerId)));
artboard.addEventListener("lineage-marquee-end", () => {
  stageGestures.cancel();
  removeMarqueeOverlay();
  marqueeActivation.disarm();
  stage.classList.remove("marquee-ready");
});

window.addEventListener("beforeunload", (event) => {
  // A clean pending review is recoverable from tab-scoped state. Manual edits
  // still require the ordinary warning because closing the tab destroys that
  // recovery state along with the unsaved document.
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => {
  agentTransportClosed = true;
  workspaceRefreshGeneration += 1;
  if (agentManifestRetry !== undefined) window.clearTimeout(agentManifestRetry);
  agentTransport.close();
});

function applyPreviewBackground(background: PreviewBackground): void {
  previewBackground = background;
  stage.classList.remove("checker", "light", "dark");
  stage.classList.add(background);
  document.querySelectorAll<HTMLButtonElement>(".background-button").forEach((node) => {
    const active = node.dataset.background === background;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
  persistWorkspaceSession();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".background-button")) {
  button.addEventListener("click", () => {
    const background = button.dataset.background;
    if (background === "checker" || background === "light" || background === "dark") applyPreviewBackground(background);
  });
}

async function saveIteration(openSaved = true): Promise<boolean> {
  if (!currentFile || !dirty || agentSession?.pending) {
    if (agentSession?.pending) setStatus("Accept or revert the pending agent proposal before saving.");
    return false;
  }
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
    if (openSaved) await loadWorkspace(result.file.path);
    setStatus(`Saved ${result.file.path}`);
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to save the iteration.");
    return false;
  }
}

async function fetchWorkspace(): Promise<WorkspaceResponse> {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  const workspace = await response.json() as WorkspaceResponse & { error?: string };
  if (!response.ok) throw new Error(workspace.error ?? "Unable to load workspace.");
  return workspace;
}

function commitWorkspaceSnapshot(workspace: WorkspaceResponse, selectedPath = currentFile?.path): void {
  getElement("workspace-name").textContent = workspace.rootName;
  getElement("file-count").textContent = String(workspace.files.length);
  nextIterationPath = workspace.nextIterationPath;
  saveButton.textContent = `Save ${nextIterationPath.split("/").at(-1)?.replace(/\.svg$/i, "")}`;
  saveButton.title = `Create ${nextIterationPath}`;
  const concepts = workspace.files.filter((candidate) => candidate.collection === "concepts");
  const iterations = workspace.files.filter((candidate) => candidate.collection === "iterations");
  fileButtons.clear();
  fileList.replaceChildren(
    createFileSection("Concepts", concepts),
    createFileSection("Iterations", iterations),
  );
  const selected = selectedPath ? fileButtons.get(selectedPath) : undefined;
  selected?.classList.add("selected");
  selected?.setAttribute("aria-current", "true");
}

function refreshWorkspaceAfterAgentAccept(): void {
  const baselineNextIterationPath = nextIterationPath;
  const sourcePath = currentFile?.path;
  const generation = ++workspaceRefreshGeneration;
  void waitForWorkspaceAdvance(
    baselineNextIterationPath,
    () => fetchWorkspace().catch(() => undefined),
  ).then((workspace) => {
    if (!workspace || generation !== workspaceRefreshGeneration || currentFile?.path !== sourcePath) return;
    commitWorkspaceSnapshot(workspace);
  });
}

async function loadWorkspace(openPath?: string, authority?: FileSwitchAuthority): Promise<void> {
  try {
    const workspace = await fetchWorkspace();
    currentWorkspaceName = workspace.rootName;
    let restoration: WorkspaceSessionV1 | undefined;
    if (!workspaceSessionInitialized) {
      workspaceSessionInitialized = true;
      restoration = readWorkspaceSession(workspaceSessionStorage, workspace.rootName);
      if (restoration) {
        layout.restorePreferences(restoration.leftCollapsed, restoration.rightCollapsed);
        openPath ??= restoration.activePath;
        if (openPath !== restoration.activePath) restoration = undefined;
      }
    }

    let file: SvgFileEntry | undefined;
    let button: HTMLButtonElement | undefined;
    const commitWorkspace = () => {
      commitWorkspaceSnapshot(workspace, openPath ?? currentFile?.path);
      if (openPath) {
        file = workspace.files.find((candidate) => candidate.path === openPath);
        button = fileButtons.get(openPath);
      }
    };
    if (authority) {
      if (!commitAuthorizedFileSwitch(authority, commitWorkspace)) return;
    } else {
      commitWorkspace();
    }
    if (openPath) {
      if (file && button) {
        await openSvg(file, button, restoration);
        return;
      }
    }
    setStatus(`${workspace.files.length} SVG files available`);
  } catch (error) {
    if (authority && !authority.coordinator.canCommit(authority.request, authority.isPending())) return;
    setStatus(error instanceof Error ? error.message : "Unable to load workspace.");
  }
}

void loadWorkspace(readPendingReviewRecovery()?.sourcePath);
const updateResponsiveLayout = () => layout.responsive(window.innerWidth);
window.addEventListener("resize", updateResponsiveLayout);
updateResponsiveLayout();
