/** Shared conservative CSS override guard for manual and agent translations. */
export function hasCssControlledTransform(node: SVGGraphicsElement, root: SVGSVGElement): boolean {
  if (node.style.getPropertyValue("transform")) return true;
  for (const style of Array.from(root.querySelectorAll("style"))) {
    let rules: CSSRuleList;
    try {
      if (style.sheet) {
        rules = style.sheet.cssRules;
      } else {
        const Sheet = root.ownerDocument.defaultView?.CSSStyleSheet;
        if (!Sheet) return true;
        const sheet = new Sheet();
        sheet.replaceSync(style.textContent ?? "");
        rules = sheet.cssRules;
      }
    } catch {
      return true;
    }
    const pending = [...Array.from(rules)];
    while (pending.length > 0) {
      const rule = pending.shift() as CSSRule & { cssRules?: CSSRuleList; selectorText?: string; style?: CSSStyleDeclaration };
      if (rule.cssRules) pending.push(...Array.from(rule.cssRules));
      if (!rule.selectorText || !rule.style?.getPropertyValue("transform")) continue;
      try {
        if (node.matches(rule.selectorText)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}
