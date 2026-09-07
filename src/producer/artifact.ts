import { SaxesParser } from "saxes";
import { AgentProtocolError, validateCleanAgentSvg } from "../shared/agent-protocol.js";

interface Node { name: string; attributes: Record<string, string>; children: Array<Node | string>; parent?: Node }
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function serialize(node: Node): string {
  return `<${node.name}${Object.entries(node.attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join("")}>${node.children.map((child) => typeof child === "string" ? escape(child) : serialize(child)).join("")}</${node.name}>`;
}
function descendants(node: Node): Node[] { return [node, ...node.children.flatMap((child) => typeof child === "string" ? [] : descendants(child))]; }
function references(node: Node): string[] {
  return descendants(node).flatMap((item) => Object.entries(item.attributes).flatMap(([name, value]) => {
    const ids = [...value.matchAll(/url\(\s*['"]?#([^\s)'"}]+)['"]?\s*\)/gi)].map((match) => match[1]);
    if ((name === "href" || name === "xlink:href") && value.startsWith("#")) ids.push(value.slice(1));
    return ids;
  }));
}
function fail(code: "invalid_svg" | "missing_target" | "ambiguous_target" | "reference_damage" | "invalid_payload"): never {
  throw new AgentProtocolError({ code, message: "Artifact group extraction failed.", path: "artifact" });
}

/** Stable ID selection, strict standalone policy, and transitive local resource closure. */
export function extractArtifactGroup(source: string, groupId: string): string {
  try { validateCleanAgentSvg(source); } catch { throw new AgentProtocolError({ code: "unsafe_svg", message: "Artifact is not safe SVG.", path: "artifact" }); }
  if (!groupId || groupId.length > 512) fail("invalid_payload");
  const nodes: Node[] = []; const stack: Node[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    const node: Node = { name: tag.local, attributes: Object.fromEntries(Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value])), children: [], parent: stack.at(-1) };
    node.parent?.children.push(node); nodes.push(node); stack.push(node);
  });
  parser.on("text", (value) => stack.at(-1)?.children.push(value));
  parser.on("cdata", (value) => stack.at(-1)?.children.push(value));
  parser.on("closetag", () => { stack.pop(); });
  parser.write(source).close();
  const matches = nodes.filter((node) => node.attributes.id === groupId);
  if (!matches.length) fail("missing_target");
  if (matches.length !== 1) fail("ambiguous_target");
  const selected = matches[0];
  if (selected.name !== "g" || selected.parent !== nodes[0]) fail("invalid_svg");
  // Ancestor presentation/transform state cannot be silently dropped. Select a
  // self-contained root group instead when the artifact needs inherited context.
  for (let parent: Node | undefined = selected.parent; parent; parent = parent.parent) {
    if (parent.name !== "svg" || Object.keys(parent.attributes).some((key) => !["xmlns", "xmlns:xlink", "width", "height", "viewBox", "version"].includes(key))) fail("invalid_svg");
  }
  const included = new Set(descendants(selected));
  const resources: Node[] = [];
  const pending = references(selected);
  while (pending.length) {
    const id = pending.shift()!;
    const targets = nodes.filter((node) => node.attributes.id === id);
    if (targets.length !== 1) fail("reference_damage");
    const resource = targets[0];
    if (included.has(resource)) continue;
    // Resource references must come from defs; importing arbitrary outside
    // artwork would silently lose its inherited transform/presentation context.
    if (resource.parent?.name !== "defs" || resource.parent.parent !== nodes[0] || Object.keys(resource.parent.attributes).some((key) => !["xmlns", "xmlns:xlink", "id"].includes(key))) fail("reference_damage");
    if (descendants(resource).some((node) => included.has(node))) fail("reference_damage");
    resources.push(resource);
    descendants(resource).forEach((node) => included.add(node));
    pending.push(...references(resource));
  }
  const ids = [...included].map((node) => node.attributes.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) fail("ambiguous_target");
  // Unlike stop-color, these presentation properties inherit into resource
  // descendants. Moving a root resource under a painted group could change a
  // mask from black to white, or otherwise change its rendering. Keep this
  // bounded extraction fail-closed rather than inventing default resource paint.
  const inheritedPresentation = new Set([
    "color", "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-opacity", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
    "font", "font-family", "font-size", "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight",
    "letter-spacing", "word-spacing", "text-anchor", "text-decoration", "direction", "writing-mode",
    "visibility", "pointer-events", "cursor", "paint-order", "marker-start", "marker-mid", "marker-end",
    "shape-rendering", "text-rendering", "image-rendering", "color-rendering", "color-interpolation", "color-interpolation-filters",
  ]);
  if (resources.length && Object.keys(selected.attributes).some((name) => inheritedPresentation.has(name))) {
    throw new AgentProtocolError({ code: "reference_damage", message: "External resources would inherit the group’s presentation. Put resources inside the artifact group with verified appearance, or move group presentation onto artwork children before submitting.", path: "artifact" });
  }
  const group: Node = { ...selected, attributes: { ...selected.attributes, xmlns: "http://www.w3.org/2000/svg", "xmlns:xlink": "http://www.w3.org/1999/xlink" }, children: [...(resources.length ? [{ name: "defs", attributes: {}, children: resources } satisfies Node] : []), ...selected.children] };
  return serialize(group);
}

/** Artifact input is a single structural operation with its SVG omitted. */
export function deriveArtifactProposal(payload: string, source: string, groupId: string): string {
  let proposal: { operations?: Array<Record<string, unknown>> };
  try { proposal = JSON.parse(payload); } catch { fail("invalid_payload"); }
  if (!proposal || !Array.isArray(proposal.operations)) fail("invalid_payload");
  const structural = proposal.operations.filter((op) => op && (op.type === "addLayer" || op.type === "replaceLayer"));
  if (structural.length !== 1) fail("invalid_payload");
  const svg = extractArtifactGroup(source, groupId);
  if (structural[0].svg !== undefined && structural[0].svg !== svg) fail("invalid_payload");
  structural[0].svg = svg;
  return JSON.stringify(proposal);
}
