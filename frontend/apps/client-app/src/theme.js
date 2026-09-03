// theme.js — white-label theming utils (ported from prototype app.jsx +
// screen-cliente.jsx, plus the previously-missing onColor helper).

export function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(h, target, amt) {
  const a = hex2rgb(h), b = hex2rgb(target);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * amt).toString(16).padStart(2, '0')).join('');
}

export const darken = (h) => mix(h, '#000000', 0.28);
export const tintOf = (h) => mix(h, '#ffffff', 0.86);

/** Readable on-color for a brand hex: white on dark brands, ink on light ones. */
export function onColor(hex) {
  const [r, g, b] = hex2rgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; // relative luminance approx.
  return lum > 0.62 ? '#211C18' : '#FFFFFF';
}

/** Build a brand object from a base color (from /api/core/public/branding). */
export function makeBrand({ color, name, slug, logoUrl, address = '', phone = '', openingHours = '', privacyUrl = '', type = 'serif' }) {
  return {
    color,
    ink: darken(color),
    tint: tintOf(color),
    on: onColor(color),
    name,
    slug,
    logo: logoUrl || null,
    address,
    phone,
    openingHours,
    privacyUrl, // informativa privacy DEL SALONE (è lui il titolare del trattamento)
    type, // 'serif' | 'grotesk' — heading typography flavour
  };
}

/** CSS custom props to spread on a style prop: <div style={brandVars(brand)}> */
export function brandVars(brand) {
  return {
    '--brand': brand.color,
    '--brand-ink': brand.ink,
    '--brand-tint': brand.tint,
    '--brand-on': onColor(brand.color),
  };
}

export const headFont = (brand) => (brand.type === 'serif' ? 'var(--serif)' : 'var(--sans)');
