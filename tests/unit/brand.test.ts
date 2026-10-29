import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AONIX_LOGO_PATHS, AONIX_LOGO_VIEWBOX, aonixLogoMarkup } from '../../src/shared/brand/logo-paths';
import { BRAND } from '../../src/shared/brand/tokens';

const root = resolve(import.meta.dirname, '../..');

describe('Aonix mark', () => {
  it('matches the official 4-path SVG asset exactly', () => {
    const svg = readFileSync(resolve(root, 'assets/brand/aonix-mark.svg'), 'utf8');
    const paths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map((m) => ({ d: m[1], fill: m[2] }));
    expect(svg).toContain(`viewBox="${AONIX_LOGO_VIEWBOX}"`);
    expect(paths).toEqual(AONIX_LOGO_PATHS.map((p) => ({ d: p.d, fill: p.fill })));
  });

  it('renders static markup with all four paths', () => {
    const html = aonixLogoMarkup(24);
    expect(html.match(/<path /g)).toHaveLength(4);
    expect(html).toContain('viewBox="0 0 327 255"');
  });
});

describe('brand tokens', () => {
  it('keeps tokens.ts and the Tailwind @theme in sync', () => {
    const css = readFileSync(resolve(root, 'src/shared/brand/tokens.css'), 'utf8');
    const pairs: [string, string][] = [
      ['obsidian', BRAND.obsidian],
      ['graphite', BRAND.graphite],
      ['graphite-2', BRAND.graphite2],
      ['alabaster', BRAND.text],
      ['muted', BRAND.muted],
      ['subtle', BRAND.subtle],
      ['violet', BRAND.violet],
      ['violet-hover', BRAND.violetHover],
      ['luminous', BRAND.luminous],
      ['crimson', BRAND.crimson],
      ['amber', BRAND.amber],
      ['emerald', BRAND.emerald],
      ['hairline', BRAND.hairline],
      ['hairline-brand', BRAND.hairlineBrand],
    ];
    for (const [name, value] of pairs) {
      expect(css, name).toContain(`--color-${name}: ${value};`);
    }
  });
});
