import "./styles.css";

interface SvgFileEntry {
  collection: "concepts" | "iterations";
  name: string;
  path: string;
}

interface WorkspaceResponse {
  rootName: string;
  files: SvgFileEntry[];
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
          <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
          <span id="zoom-label">100%</span>
          <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" id="zoom-reset">Reset</button>
        </div>
        <div class="toolbar-group" aria-label="Preview background">
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
let zoom = 1;
let currentObjectUrl: string | undefined;

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

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
  artboard.replaceChildren(document.importNode(svg, true));
  const renderedSvg = artboard.querySelector("svg");
  if (!renderedSvg) return;
  renderedSvg.removeAttribute("width");
  renderedSvg.removeAttribute("height");
  renderedSvg.setAttribute("role", "img");
  renderedSvg.setAttribute("aria-label", file.name);

  emptyState.hidden = true;
  artboard.hidden = false;
  setZoom(1);
  renderLayers(renderedSvg);
  renderFavicons(source);

  const viewBox = renderedSvg.getAttribute("viewBox") ?? "No viewBox";
  getElement("document-size").textContent = viewBox;
  setStatus(`${file.collection} / ${file.name}`);
}

function renderLayers(svg: SVGSVGElement): void {
  const elements = Array.from(svg.children).filter(
    (element) => element.localName !== "defs" && element.localName !== "metadata",
  );
  layerList.className = "layer-list";
  layerList.replaceChildren();
  getElement("layer-count").textContent = String(elements.length);

  for (const [index, element] of elements.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-button";
    const name = element.id || `${element.localName}-${index + 1}`;
    button.innerHTML = `<span class="layer-type">${element.localName}</span><span>${name}</span>`;
    button.addEventListener("click", () => {
      svg.querySelectorAll("[data-lineage-selected]").forEach((node) => node.removeAttribute("data-lineage-selected"));
      layerList.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
      element.setAttribute("data-lineage-selected", "true");
      button.classList.add("selected");
      setStatus(`Selected ${name}`);
    });
    layerList.append(button);
  }
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

for (const button of document.querySelectorAll<HTMLButtonElement>(".background-button")) {
  button.addEventListener("click", () => {
    stage.classList.remove("checker", "light", "dark");
    stage.classList.add(button.dataset.background ?? "checker");
    document.querySelectorAll(".background-button").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
  });
}

async function loadWorkspace(): Promise<void> {
  try {
    const response = await fetch("/api/workspace");
    const workspace = await response.json() as WorkspaceResponse & { error?: string };
    if (!response.ok) throw new Error(workspace.error ?? "Unable to load workspace.");

    getElement("workspace-name").textContent = workspace.rootName;
    getElement("file-count").textContent = String(workspace.files.length);
    const concepts = workspace.files.filter((file) => file.collection === "concepts");
    const iterations = workspace.files.filter((file) => file.collection === "iterations");
    fileList.replaceChildren(
      createFileSection("Concepts", concepts),
      createFileSection("Iterations", iterations),
    );
    setStatus(`${workspace.files.length} SVG files available`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to load workspace.");
  }
}

void loadWorkspace();
