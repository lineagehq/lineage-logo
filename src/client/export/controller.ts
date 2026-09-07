import { buildSvgAsset, renderPngAsset } from "./assets";
import { eligiblePreviewTargetIds } from "../preview";
import { versionFilename } from "../../shared/version-name";

interface ExportContext { svg: string; sourcePath: string; }
export class AssetExportController {
  readonly dialog = document.createElement("dialog");
  constructor(private readonly options: {
    current: () => ExportContext;
    namedVersion: (name: string, context: ExportContext) => Promise<{ path: string }>;
  }) { document.body.append(this.dialog); this.dialog.className = "asset-export-dialog"; }

  open(invoker: HTMLElement): void {
    let context: ExportContext;
    try { context = this.options.current(); } catch (error) { this.showFailure(error, invoker); return; }
    this.dialog.innerHTML = `<form method="dialog"><h2 id="asset-export-title">Save a named version or export</h2>
      <label>Version name <input name="version" maxlength="64" autocomplete="off"></label><button type="button" name="save">Save named version</button>
      <label>Artwork <select name="target"><option value="">Full logo</option></select></label>
      <p>For a mark-only or wordmark export, choose its existing layer ID. SVG keeps editable text; fonts are not outlined.</p>
      <label>Format <select name="format"><option value="svg">SVG</option><option value="png">PNG</option></select></label>
      <label>PNG size <select name="size"><option>16</option><option>32</option><option>64</option><option selected>512</option></select> pixels square</label>
      <label>PNG background <select name="background"><option value="transparent">Transparent</option><option value="white">White</option><option value="black">Black</option></select></label>
      <p>Small images are PNG, not ICO. PNG preserves aspect ratio with empty space around wide or tall artwork.</p>
      <button type="button" name="download">Download export</button><p role="status" aria-live="polite"></p><button value="close">Close</button></form>`;
    this.dialog.removeAttribute("aria-label");
    this.dialog.setAttribute("aria-labelledby", "asset-export-title");
    const form = this.dialog.querySelector("form")!;
    const control = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const status = this.dialog.querySelector<HTMLElement>('[role="status"]')!;
    const select = control("target") as HTMLSelectElement;
    const artwork = new DOMParser().parseFromString(context.svg, "image/svg+xml");
    for (const id of eligiblePreviewTargetIds(context.svg)) {
      const layer = Array.from(artwork.querySelectorAll("[id]")).find(node => node.id === id);
      const title = Array.from(layer?.children ?? []).find(node => node.localName === "title")?.textContent?.trim();
      const label = layer?.getAttribute("aria-label")?.trim() || title;
      select.add(new Option(label ? `${label} (#${id})` : `#${id}`, id));
    }
    let busy = false;
    const run = async (action: () => Promise<void>) => {
      if (busy) return; busy = true;
      const buttons = Array.from(form.querySelectorAll("button")); buttons.forEach(button => button.disabled = true);
      status.textContent = "Preparing…";
      try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : "Export failed. Try again."; }
      finally { busy = false; buttons.forEach(button => button.disabled = false); }
    };
    (form.elements.namedItem("save") as HTMLButtonElement).onclick = () => void run(async () => {
      versionFilename(control("version").value);
      const current = this.options.current();
      const result = await this.options.namedVersion(control("version").value, current);
      status.textContent = `Named version saved: ${result.path}. Your current editing history is unchanged.`;
    });
    (form.elements.namedItem("download") as HTMLButtonElement).onclick = () => void run(async () => {
      const current = this.options.current();
      await document.fonts.ready;
      const svg = buildSvgAsset(current.svg, { targetId: control("target").value || undefined });
      const format = control("format").value;
      const blob = format === "png" ? await renderPngAsset(svg, { size: Number(control("size").value), background: control("background").value as "transparent" | "white" | "black" }) : new Blob([svg], { type: "image/svg+xml" });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
      link.download = `logo-${control("target").value ? "layer" : "full"}${format === "png" ? `-${control("size").value}px` : ""}.${format}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status.textContent = `Prepared ${link.download}. Find the file in your browser downloads.`;
    });
    this.dialog.oncancel = event => { if (busy) event.preventDefault(); };
    this.dialog.onclose = () => { if (invoker.isConnected) invoker.focus(); };
    this.dialog.showModal(); control("version").focus();
  }
  private showFailure(error: unknown, invoker: HTMLElement): void {
    this.dialog.replaceChildren();
    this.dialog.removeAttribute("aria-labelledby");
    this.dialog.setAttribute("aria-label", "Export unavailable");
    const message = document.createElement("p"); message.textContent = error instanceof Error ? error.message : "Open a logo before exporting.";
    const close = document.createElement("button"); close.textContent = "Close"; close.onclick = () => this.dialog.close();
    this.dialog.append(message, close); this.dialog.onclose = () => invoker.focus(); this.dialog.showModal(); close.focus();
  }
}
