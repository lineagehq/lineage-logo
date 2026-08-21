import "./styles.css";
import { SvgEditor } from "./canvas/editor";

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
          <span class="toolbar-divider"></span>
          <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
          <span id="zoom-label">100%</span>
          <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" id="zoom-reset">Reset</button>
        </div>
        <div class="toolbar-group" aria-label="Preview background">
          <button type="button" id="save-iteration" class="primary-action" disabled>Save iteration</button>
          <button type="button" class="background-button active" data-background="checker">Grid</button>
          <button type="button" class="background-button" data-background="light">Light</button>
          <button type="button" class="background-button" data-background="dark">Dark</button>
        </div>
      </div>
      <div class="stage checker" id="stage">
        <div class="empty-state" id="empty-state">
          <span class="empty-icon">◇</span>
          <strong>Choose an SVG to inspect</strong>
          <span>Concepts and iterations appear in the workspace panel.</span>
        </div>
        <div id="artboard" class="artboard" hidden></div>
      </div>
      <footer class="statusbar">
        <span id="status">Ready</span>
        <span id="document-size">No document loaded</span>
      </footer>
    </section>
    <aside class="sidebar review-sidebar">
      <section>
        <div class="panel-heading"><span>Layers</span><span id="layer-count">0</span></div>
        <div id="layer-list" class="layer-list empty-copy">Open an SVG to inspect its structure.</div>
      </section>
      <section class="inspector-section">
        <div class="panel-heading"><span>Selection</span><strong id="selection-name">None</strong></div>
        <div id="selection-empty" class="empty-copy">Select a layer or click the canvas.</div>
        <div id="selection-panel" class="selection-panel" hidden>
          <div class="field-grid">
            <label>Fill<input id="fill" type="text" placeholder="none or #hex" /></label>
            <label>Stroke<input id="stroke" type="text" placeholder="none or #hex" /></label>
            <label>Stroke width<input id="stroke-width" type="number" min="0" step="0.5" /></label>
            <label>Opacity<input id="opacity" type="number" min="0" max="1" step="0.05" /></label>
            <label>X<input id="position-x" type="number" step="1" /></label>
            <label>Y<input id="position-y" type="number" step="1" /></label>
            <label>Scale %<input id="scale" type="number" min="1" step="1" /></label>
            <label>Rotation °<input id="rotation" type="number" step="1" /></label>
          </div>
          <div class="selection-actions">
            <button type="button" id="duplicate-selection">Duplicate</button>
            <button type="button" id="hide-selection">Hide</button>
            <button type="button" id="delete-selection" class="danger">Delete</button>
          </div>
          <p class="inspector-hint">Drag to move. Use the handles to resize or rotate. Double-click to select inside a group.</p>
        </div>
      </section>
      <section class="preview-section">
        <div class="panel-heading"><span>Small-size check</span></div>
        <div id="favicon-preview" class="favicon-preview empty-copy">Live previews appear here.</div>
      </section>
    </aside>
  </main>
`;

const fileList = getElement("file-list");
const artboard = getElement("artboard");
const emptyState = getElement("empty-state");
const layerList = getElement("layer-list");
const faviconPreview = getElement("favicon-preview");
const stage = getElement("stage");
const undoButton = getInput<HTMLButtonElement>("undo");
const redoButton = getInput<HTMLButtonElement>("redo");
const saveButton = getInput<HTMLButtonElement>("save-iteration");
const fileButtons = new Map<string, HTMLButtonElement>();
let currentFile: SvgFileEntry | undefined;
let dirty = false;
let nextIterationPath = "iterations/iteration-1.svg";
let zoom = 1;
let currentObjectUrl: string | undefined;

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
    deleteButton: getInput("delete-selection"),
    duplicateButton: getInput("duplicate-selection"),
    fill: getInput("fill"),
    hideButton: getInput("hide-selection"),
    opacity: getInput("opacity"),
    positionX: getInput("position-x"),
    positionY: getInput("position-y"),
    rotation: getInput("rotation"),
    scale: getInput("scale"),
    selectionEmpty: getElement("selection-empty"),
    selectionName: getElement("selection-name"),
    selectionPanel: getElement("selection-panel"),
    stroke: getInput("stroke"),
    strokeWidth: getInput("stroke-width"),
  },
  {
    onDocumentChange: (svg) => {
      renderLayers(svg);
      highlightLayer(editor.selectedNode);
      renderFavicons(editor.serializeClean());
      setStatus("Unsaved manual corrections");
    },
    onDirtyChange: (nextDirty) => {
      dirty = nextDirty;
      saveButton.disabled = !dirty;
    },
    onHistoryChange: (canUndo, canRedo) => {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    onSelectionChange: (element) => {
      highlightLayer(element);
    },
    onStatus: setStatus,
  },
);

function setStatus(message: string): void {
  getElement("status").textContent = message;
}

function setZoom(nextZoom: number): void {
  zoom = Math.min(4, Math.max(0.25, nextZoom));
  artboard.style.transform = `scale(${zoom})`;
  getElement("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
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
    button.innerHTML = `<span class="file-glyph">◇</span><span>${file.name.replace(/\.svg$/i, "")}</span>`;
    button.addEventListener("click", () => void openSvg(file, button));
    fileButtons.set(file.path, button);
    section.append(button);
  }
  return section;
}

async function openSvg(file: SvgFileEntry, button: HTMLButtonElement): Promise<void> {
  setStatus(`Opening ${file.name}…`);
  const response = await fetch(`/api/svg?path=${encodeURIComponent(file.path)}`);
  if (!response.ok) {
    const payload = await response.json() as { error?: string };
    setStatus(payload.error ?? "Unable to open SVG.");
    return;
  }

  const source = await response.text();
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg.localName !== "svg" || parsed.querySelector("parsererror")) {
    setStatus("The selected file is not valid SVG.");
    return;
  }

  for (const selected of fileList.querySelectorAll(".selected")) selected.classList.remove("selected");
  button.classList.add("selected");
  currentFile = file;
  dirty = false;
  saveButton.disabled = true;
  artboard.replaceChildren(document.importNode(svg, true));
  const renderedSvg = artboard.querySelector("svg");
  if (!renderedSvg) return;
  renderedSvg.removeAttribute("width");
  renderedSvg.removeAttribute("height");
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
  renderLayers(renderedSvg);
  renderFavicons(editor.serializeClean());

  const viewBox = renderedSvg.getAttribute("viewBox") ?? "No viewBox";
  getElement("document-size").textContent = viewBox;
  setStatus(`${file.collection} / ${file.name}`);
}

function renderLayers(svg: SVGSVGElement): void {
  const elements = Array.from(svg.children).filter(isLayerElement);
  layerList.className = "layer-list";
  layerList.replaceChildren();
  const allLayers = elements.flatMap(collectLayerElements);
  getElement("layer-count").textContent = String(allLayers.length);

  elements.forEach((element, index) => appendLayer(element, index, 0));
}

function highlightLayer(element?: SVGGraphicsElement): void {
  const selectedKey = element?.dataset.lineageKey;
  layerList.querySelectorAll<HTMLButtonElement>(".layer-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.key === selectedKey);
  });
}

function collectLayerElements(element: SVGGraphicsElement): SVGGraphicsElement[] {
  return [
    element,
    ...Array.from(element.children)
      .filter(isLayerElement)
      .flatMap(collectLayerElements),
  ];
}

function isLayerElement(element: Element): element is SVGGraphicsElement {
  return element instanceof SVGGraphicsElement
    && !["defs", "metadata"].includes(element.localName)
    && !element.matches(HANDLE_SELECTOR)
    && !element.querySelector(HANDLE_SELECTOR);
}

const HANDLE_SELECTOR = ".svg_select_shape, .svg_select_shape_pointSelect, .svg_select_handle, .svg_select_handle_rot";

function appendLayer(element: SVGGraphicsElement, index: number, depth: number): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-button";
    button.dataset.key = element.dataset.lineageKey;
    button.style.setProperty("--layer-depth", String(depth));
    const name = element.id || `${element.localName}-${index + 1}`;
    button.innerHTML = `<span class="layer-type">${element.localName}</span><span>${name}</span>`;
    button.addEventListener("click", () => editor.selectNode(element));
    layerList.append(button);

    Array.from(element.children)
      .filter(isLayerElement)
      .forEach((child, childIndex) => appendLayer(child, childIndex, depth + 1));
  }

function renderFavicons(source: string): void {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
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

getElement("zoom-in").addEventListener("click", () => setZoom(zoom + 0.25));
getElement("zoom-out").addEventListener("click", () => setZoom(zoom - 0.25));
getElement("zoom-reset").addEventListener("click", () => setZoom(1));
undoButton.addEventListener("click", () => editor.undo());
redoButton.addEventListener("click", () => editor.redo());
saveButton.addEventListener("click", () => void saveIteration());

for (const button of document.querySelectorAll<HTMLButtonElement>(".background-button")) {
  button.addEventListener("click", () => {
    stage.classList.remove("checker", "light", "dark");
    stage.classList.add(button.dataset.background ?? "checker");
    document.querySelectorAll(".background-button").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
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
