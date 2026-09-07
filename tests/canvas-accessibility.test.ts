// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { ensureLayerAccessibilityRole, serializeSvg } from '../src/client/canvas/editor';
it('gives named canvas geometry runtime semantics without changing authored SVG on save',()=>{
 const root=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g aria-label="Brand"><rect aria-label="Mark"/><text role="img" aria-label="Authored text">Brand</text></g></svg>','image/svg+xml').documentElement as unknown as SVGSVGElement;
 const before=root.outerHTML;
 for(const node of root.querySelectorAll<SVGGraphicsElement>('[aria-label]'))ensureLayerAccessibilityRole(node);
 expect(root.querySelector('g')?.getAttribute('role')).toBe('group');expect(root.querySelector('rect')?.getAttribute('role')).toBe('img');
 expect(root.querySelector('text')?.hasAttribute('data-lineage-added-role')).toBe(false);
 expect(serializeSvg(root,true)).toBe(before);
 const rect=root.querySelector('rect')!;rect.removeAttribute('aria-label');ensureLayerAccessibilityRole(rect);
 expect(rect.hasAttribute('role')).toBe(false);
});

it('restores an authored root image role when serializing an interactive canvas group',()=>{
 const root=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" role="group" data-lineage-original-role="img" aria-label="Brand"><rect width="20" height="20"/></svg>','image/svg+xml').documentElement as unknown as SVGSVGElement;
 const saved=serializeSvg(root,true);expect(saved).toContain('role="img"');expect(saved).not.toContain('data-lineage-');
 expect(root.getAttribute('role')).toBe('group');
});

it('leaves authored stylesheet role selectors unaffected by canvas accessibility metadata',()=>{
 const root=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><style>rect[role="img"] { fill:red }</style><rect aria-label="Mark" fill="blue"/></svg>','image/svg+xml').documentElement as unknown as SVGSVGElement;
 const before=root.outerHTML;ensureLayerAccessibilityRole(root.querySelector('rect')!);
 expect(root.querySelector('rect')?.hasAttribute('role')).toBe(false);expect(serializeSvg(root,true)).toBe(before);
});
