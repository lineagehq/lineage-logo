import { SaxesParser, type SaxesTagNS } from "saxes";

export const AGENT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const CLEAN_RESERVED_ATTRIBUTE = /^data-(?:lineage|agent|review|transport)-/i;
const ACTIVE_SVG_ELEMENTS = new Set([
  "a", "animate", "animateMotion", "animateTransform", "discard", "foreignObject", "handler", "iframe",
  "link", "listener", "object", "script", "set", "style",
]);

export const CLEAN_AGENT_SVG_REJECTION_CORPUS: ReadonlyArray<{ name: string; svg: string }> = [
  { name: "malformed declaration", svg: '<?xml nope?><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: "XML 1.1 declaration", svg: '<?xml version="1.1"?><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: "mismatched declared encoding", svg: '<?xml version="1.0" encoding="UTF-16"?><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: "missing SVG namespace", svg: "<svg><path /></svg>" },
  { name: "unbound xlink prefix", svg: '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#mark" /></svg>' },
  { name: "incomplete root", svg: '<svg xmlns="http://www.w3.org/2000/svg"' },
  { name: "multiple roots", svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: "mismatched tags", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>' },
  { name: "doctype", svg: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: "internal entity declaration", svg: '<!DOCTYPE svg [<!ENTITY mark "x">]><svg xmlns="http://www.w3.org/2000/svg"><text>&mark;</text></svg>' },
  { name: "external entity declaration", svg: '<!DOCTYPE svg [<!ENTITY mark SYSTEM "https://example.com/mark">]><svg xmlns="http://www.w3.org/2000/svg"><text>&mark;</text></svg>' },
  { name: "processing instruction", svg: '<svg xmlns="http://www.w3.org/2000/svg"><?target body?></svg>' },
  { name: "undeclared entity", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="&unknown;" /></svg>' },
  { name: "raw less-than in attribute", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="<" /></svg>' },
  { name: "forbidden CDATA terminator text", svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>]]></text></svg>' },
  { name: "null reference", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="&#0;" /></svg>' },
  { name: "surrogate reference", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="&#xD800;" /></svg>' },
  { name: "noncharacter reference", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="&#xFFFE;" /></svg>' },
  { name: "out-of-range reference", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="&#x110000;" /></svg>' },
  { name: "forbidden literal control", svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>\u0001</text></svg>' },
  { name: "lone surrogate", svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>\ud800</text></svg>' },
  { name: "reserved editor metadata", svg: '<svg xmlns="http://www.w3.org/2000/svg" data-lineage-key="leak"></svg>' },
  { name: "legacy edit metadata", svg: '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="lineage-logo-edit">state</metadata></svg>' },
  { name: "editor handle", svg: '<svg xmlns="http://www.w3.org/2000/svg"><g class="svg_select_shape"></g></svg>' },
  { name: "script", svg: '<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>' },
  { name: "foreign object", svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>' },
  { name: "style import", svg: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://example.com/a.css");</style></svg>' },
  { name: "style external URL", svg: '<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:url("https://example.com/a.svg#p")}</style></svg>' },
  { name: "style attribute", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:red" /></svg>' },
  { name: "animation", svg: '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="opacity" values="0;1" /></svg>' },
  { name: "set mutation", svg: '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="display" to="none" /></svg>' },
  { name: "discard mutation", svg: '<svg xmlns="http://www.w3.org/2000/svg"><discard /></svg>' },
  { name: "event handler", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="alert(1)" /></svg>' },
  { name: "external image", svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png" /></svg>' },
  { name: "data URL", svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA==" /></svg>' },
  { name: "external paint URL", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.com/a.svg#p)" /></svg>' },
  { name: "CSS-escaped external paint URL", svg: '<svg xmlns="http://www.w3.org/2000/svg"><path fill="u\\72l(\\68ttps://example.com/a.svg#p)" /></svg>' },
  { name: "javascript link", svg: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path /></a></svg>' },
  { name: "foreign namespace", svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:iframe /></svg>' },
];

function reject(message: string): never {
  throw new Error(message);
}

function validateTag(tag: SaxesTagNS, depth: number): void {
  if (tag.prefix || tag.uri !== SVG_NAMESPACE) reject("Accepted artifact contains a foreign element namespace.");
  if (depth === 0 && tag.local !== "svg") reject("Accepted artifact must contain exactly one standalone SVG root.");
  const attributes = Object.values(tag.attributes);
  if (attributes.some((attribute) => CLEAN_RESERVED_ATTRIBUTE.test(attribute.name))
    || ACTIVE_SVG_ELEMENTS.has(tag.local) || tag.local.startsWith("animate")) reject("Accepted artifact contains editor, protocol, or active metadata.");

  const byName = new Map(attributes.map((attribute) => [attribute.name, attribute.value]));
  if (attributes.some((attribute) => attribute.local.toLowerCase().startsWith("on"))
    || byName.has("style")
    || (tag.local === "metadata" && byName.get("id") === "lineage-logo-edit")
    || /(?:^|\s)svg_select(?:_|\s|$)/.test(byName.get("class") ?? "")) reject("Accepted artifact contains editor, protocol, or active metadata.");

  for (const attribute of attributes) {
    if (!["", XML_NAMESPACE, XLINK_NAMESPACE, XMLNS_NAMESPACE].includes(attribute.uri)) reject("Accepted artifact contains an unsupported attribute namespace.");
    if (attribute.uri === XLINK_NAMESPACE && attribute.local !== "href") reject("Accepted artifact contains an unsupported XLink attribute.");
    if (attribute.uri === XML_NAMESPACE && !["lang", "space"].includes(attribute.local)) reject("Accepted artifact contains an unsupported XML attribute.");
    if (attribute.uri === XMLNS_NAMESPACE) {
      if (attribute.local === "xmlns" && attribute.value !== SVG_NAMESPACE) reject("Accepted artifact declares an unsupported default namespace.");
      if (attribute.local === "xlink" && attribute.value !== XLINK_NAMESPACE) reject("Accepted artifact declares an unsupported link namespace.");
      if (!["xmlns", "xlink"].includes(attribute.local)) reject("Accepted artifact declares a foreign namespace.");
      continue;
    }
    if ((attribute.local === "href" || attribute.local === "src") && !attribute.value.startsWith("#")) reject("Accepted artifact contains an external reference.");
    if (attribute.value.includes("\\") || attribute.value.includes("/*")) reject("Accepted artifact contains an escaped URL-bearing construct.");
    for (const match of attribute.value.matchAll(/url\(\s*([^)]*)\)/gi)) {
      if (!match[1].trim().replace(/^['"]|['"]$/g, "").startsWith("#")) reject("Accepted artifact contains an external URL.");
    }
    if (/(?:^|[\s('"=])(?:https?|file|data|javascript):|^\/\//i.test(attribute.value)) reject("Accepted artifact contains a URL-bearing construct.");
  }
}

/** Strictly parses, then semantically validates, without repairing or normalizing SVG input. */
export function validateCleanAgentSvg(svg: string): void {
  if (!svg || new TextEncoder().encode(svg).byteLength > AGENT_MAX_PAYLOAD_BYTES) reject("Accepted artifact SVG is empty or too large.");
  const parser = new SaxesParser({ xmlns: true, fragment: false, defaultXMLVersion: "1.0", forceXMLVersion: true });
  let depth = 0;
  let rootSeen = false;
  parser.on("error", (error) => { throw error; });
  parser.on("xmldecl", (declaration) => {
    if (declaration.version !== "1.0" || (declaration.encoding && declaration.encoding.toLowerCase() !== "utf-8")) {
      reject("Accepted artifact must use XML 1.0 with UTF-8 encoding.");
    }
  });
  parser.on("doctype", () => reject("Accepted artifact declarations are not allowed."));
  parser.on("processinginstruction", () => reject("Accepted artifact processing instructions are not allowed."));
  parser.on("opentag", (tag) => {
    validateTag(tag, depth);
    if (depth === 0) rootSeen = true;
    depth += 1;
  });
  parser.on("closetag", () => { depth -= 1; });
  try { parser.write(svg).close(); }
  catch (error) { throw new Error("Accepted artifact is not strict, clean SVG XML.", { cause: error }); }
  if (!rootSeen || depth !== 0) reject("Accepted artifact is incomplete or has no standalone SVG root.");
}
