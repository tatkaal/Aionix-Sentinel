// Brand tokens for surfaces that cannot use Tailwind (Shadow DOM drawer, canvas/SVG charts).
// Mirrors the @theme block in tokens.css — tests/unit/brand.test.ts keeps the two in sync.

export const BRAND = {
  obsidian: '#090A10',
  graphite: '#11131F',
  graphite2: '#181B2C',
  text: '#F8FAFC',
  muted: '#A1A9BC',
  subtle: '#6E768C',
  violet: '#5921c3',
  violetHover: '#6b2ce0',
  luminous: '#9553fb',
  crimson: '#EF4444',
  amber: '#F59E0B',
  emerald: '#10B981',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineBrand: 'rgba(149, 83, 251, 0.14)',
} as const;

export const FONT_STACK = {
  display: "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  body: "'DM Sans Variable', 'DM Sans', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;
