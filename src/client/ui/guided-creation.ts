import { bindAgentHandoff, HANDOFF_REFRESH_MESSAGE, type AgentHandoff, type HandoffRequest } from "../../shared/agent-handoff";
import { LOGO_IMPORT_MAX_BYTES, validateLogoImport } from "../../shared/logo-creation";

export type HandoffCanvasState = Omit<HandoffRequest, "intent" | "target">;
export interface GuidedCreationOptions {
  host: HTMLElement;
  current: () => HandoffCanvasState | undefined;
  /** Must use the ordinary unsaved-work guard when opening the newly created file. */
  openCreated: (file: { collection: "concepts"; name: string; path: string }) => Promise<void>;
  fetch?: typeof fetch;
}
const equalCanvas = (a: HandoffCanvasState | undefined, b: HandoffCanvasState) => Boolean(a
  && a.editorId === b.editorId && a.sessionId === b.sessionId && a.revision === b.revision && a.sourcePath === b.sourcePath
  && a.selectedLayerIds.length === b.selectedLayerIds.length && a.selectedLayerIds.every((id, index) => id === b.selectedLayerIds[index]));

/** Owns only its modal and downloads. It never mutates the canvas or starts an agent. */
export class GuidedCreationController {
  readonly #dialog: HTMLDialogElement;
  readonly #options: GuidedCreationOptions;
  #generation = 0;
  constructor(options: GuidedCreationOptions) {
    this.#options = options;
    this.#dialog = document.createElement("dialog");
    this.#dialog.className = "unsaved-dialog guided-creation-dialog";
    this.#dialog.setAttribute("aria-labelledby", "guided-creation-title");
    this.#dialog.addEventListener("close", () => { this.#generation++; });
    options.host.append(this.#dialog);
  }
  #layout(title: string, copy: string) {
    this.#generation++;
    this.#dialog.replaceChildren();
    const heading = document.createElement("h2"); heading.id = "guided-creation-title"; heading.textContent = title;
    const description = document.createElement("p"); description.textContent = copy;
    const error = document.createElement("p"); error.className = "dialog-error"; error.setAttribute("role", "alert");
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.addEventListener("click", () => this.#dialog.close());
    this.#dialog.append(heading, description, error, cancel);
    return { error, cancel, generation: this.#generation };
  }
  #field(label: string, control: HTMLElement) {
    const row = document.createElement("label"); row.className = "guided-creation-field";
    const caption = document.createElement("span"); caption.textContent = label;
    row.append(caption, control); return row;
  }
  openCreate(mode: "create" | "import") {
    const importing = mode === "import";
    const { error, cancel, generation } = this.#layout(importing ? "Import an SVG" : "Create a logo", "A new file is added to concepts. Existing files are preserved; matching names receive a number.");
    const name = document.createElement("input"); name.type = "text"; name.value = "my-logo"; name.maxLength = 256;
    const file = document.createElement("input"); file.type = "file"; file.accept = ".svg,image/svg+xml";
    file.addEventListener("change", () => { if (file.files?.[0]) name.value = file.files[0].name.replace(/\.svg$/i, "").slice(0, 256); });
    const submit = document.createElement("button"); submit.type = "button"; submit.textContent = importing ? "Import SVG" : "Create blank logo";
    this.#dialog.insertBefore(this.#field("Logo name", name), error);
    if (importing) this.#dialog.insertBefore(this.#field("SVG file (up to 5 MB)", file), error);
    this.#dialog.insertBefore(submit, cancel);
    submit.addEventListener("click", async () => {
      submit.disabled = true; error.textContent = "";
      try {
        let svg: string | undefined;
        if (importing) {
          const selected = file.files?.[0];
          if (!selected) throw new Error("Choose an SVG file to import.");
          if (selected.size > LOGO_IMPORT_MAX_BYTES) throw new Error("Choose an SVG smaller than 5 MB.");
          svg = validateLogoImport(await selected.text());
        }
        if (generation !== this.#generation || !this.#dialog.open) return;
        const response = await (this.#options.fetch ?? fetch)("/api/concepts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.value, ...(svg === undefined ? {} : { svg }) }) });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The logo could not be created. Try another name.");
        const created = body.file;
        if (!created || created.collection !== "concepts" || typeof created.name !== "string" || created.path !== `concepts/${created.name}` || /[\\/]/.test(created.name)) throw new Error("The server returned an invalid file. Refresh the file list.");
        if (generation !== this.#generation || !this.#dialog.open) return;
        this.#dialog.close();
        await this.#options.openCreated(created);
      } catch (cause) {
        if (generation === this.#generation && this.#dialog.open) error.textContent = cause instanceof Error ? cause.message : "Unable to create the logo.";
      } finally { submit.disabled = false; }
    });
    this.#dialog.showModal(); name.focus(); name.select();
  }
  openHandoff() {
    const { error, cancel, generation } = this.#layout("Prepare an agent handoff", "Choose a target and describe your change. Download current artwork and instructions for your own local agent. No agent is connected or generating through this dialog.");
    const target = document.createElement("select");
    for (const [value, text] of [["document", "Whole document"], ["selection", "Selected layers"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; target.append(option);
    }
    target.value = this.#options.current()?.selectedLayerIds.length ? "selection" : "document";
    const intent = document.createElement("textarea"); intent.maxLength = 4000; intent.rows = 4;
    const prepare = document.createElement("button"); prepare.type = "button"; prepare.textContent = "Prepare current handoff";
    const download = document.createElement("button"); download.type = "button"; download.textContent = "Download handoff JSON"; download.hidden = true;
    const status = document.createElement("p"); status.setAttribute("role", "status");
    this.#dialog.insertBefore(this.#field("Target", target), error);
    this.#dialog.insertBefore(this.#field("What should change?", intent), error);
    this.#dialog.insertBefore(status, error); this.#dialog.insertBefore(prepare, cancel); this.#dialog.insertBefore(download, cancel);
    let prepared: { handoff: AgentHandoff; request: HandoffRequest } | undefined;
    const invalidate = () => { prepared = undefined; download.hidden = true; status.textContent = ""; };
    intent.addEventListener("input", invalidate); target.addEventListener("change", invalidate);
    prepare.addEventListener("click", async () => {
      invalidate(); error.textContent = ""; prepare.disabled = true;
      try {
        const current = this.#options.current();
        if (!current) throw new Error("Open or create a logo first, then prepare a handoff.");
        const request: HandoffRequest = { ...current, selectedLayerIds: [...current.selectedLayerIds], intent: intent.value, target: target.value as HandoffRequest["target"] };
        const response = await (this.#options.fetch ?? fetch)("/api/agent/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(10000) });
        const body = await response.json();
        if (!response.ok) throw new Error(`${typeof body.error === "string" ? body.error : "Handoff unavailable."} ${HANDOFF_REFRESH_MESSAGE}`);
        const handoff = bindAgentHandoff(request, body.snapshot);
        if (generation !== this.#generation || !this.#dialog.open) return;
        if (!equalCanvas(this.#options.current(), request) || request.intent !== intent.value || request.target !== target.value) throw new Error(HANDOFF_REFRESH_MESSAGE);
        prepared = { handoff, request }; download.hidden = false;
        status.textContent = `Ready: ${request.sourcePath}, revision ${request.revision}. Includes current unsaved artwork. Download locally; no agent has been invoked.`;
      } catch (cause) {
        if (generation === this.#generation && this.#dialog.open) error.textContent = cause instanceof Error ? cause.message : HANDOFF_REFRESH_MESSAGE;
      } finally { prepare.disabled = false; }
    });
    download.addEventListener("click", () => {
      if (!prepared || !equalCanvas(this.#options.current(), prepared.request)) { invalidate(); error.textContent = HANDOFF_REFRESH_MESSAGE; return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.handoff, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "lineage-logo-handoff.json"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    this.#dialog.showModal(); intent.focus();
  }
  destroy() { this.#generation++; this.#dialog.close(); this.#dialog.remove(); }
}
