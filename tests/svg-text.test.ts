import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateSvgTextEdit } from '../src/shared/svg-text';

describe('bounded font-family validation', () => {
  it('accepts local family lists and separator whitespace without changing their spelling', () => {
    for (const value of ['Arial', '"Open Sans", sans-serif', "'Noto Sans', Arial", '日本語, serif', 'Arial\t,\nserif', ',,']) {
      expect(validateSvgTextEdit({ property: 'font-family', value })).toEqual({ valid: true, normalized: value });
    }
  });
  it('rejects malformed families and repeated ambiguous separators without backtracking', () => {
    for (const value of [' ,'.repeat(40) + '!', 'Arial\tSans', 'url(font.woff)', 'Arial;fill:red', 'x'.repeat(129), '']) {
      expect(validateSvgTextEdit({ property: 'font-family', value }).valid).toBe(false);
    }
  });
  it('preserves the previous bounded syntax on a small exhaustive separator corpus', () => {
    // Frozen from the pre-change validator over all 4,681 ordered inputs.
    // Do not retain its backtracking expression in the shipped test suite.
    const decisions: string[] = [];
    const alphabet = ['A', ',', ' ', '\t', '\n', '!', "'", '.'];
    const visit = (value: string, remaining: number) => {
      decisions.push(validateSvgTextEdit({ property: 'font-family', value }).valid ? '1' : '0');
      if (remaining) for (const character of alphabet) visit(value + character, remaining - 1);
    };
    visit('', 4);
    expect(decisions).toHaveLength(4681);
    expect(createHash('sha256').update(decisions.join('')).digest('hex')).toBe('f3aae6f0a0e685ba7cffe7b1678934d1bbf7ab1f1cc10001cf5976ef2dc2df6f');
  });
});
