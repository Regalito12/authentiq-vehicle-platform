// Deriva una variante de un color de marca que sí pasa contraste WCAG AA (4.5:1)
// sobre fondos claros, sin cambiar el matiz ni la saturación — la paleta del dealer
// se conserva, solo se oscurece lo necesario para que el texto sea legible.

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]) {
  const channel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexToRgb(hexA)) + 0.05;
  const b = relativeLuminance(hexToRgb(hexB)) + 0.05;
  return a > b ? a / b : b / a;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function toHex([r, g, b]) { return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`; }

/** Oscurece `hex` (mismo matiz/saturación) hasta pasar `minRatio` de contraste contra `bgHex`. */
export function contrastSafeShade(hex, bgHex, minRatio = 4.55) {
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ""))) return hex;
  if (contrastRatio(hex, bgHex) >= minRatio) return hex;
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  for (let step = 1; step <= 100; step++) {
    const candidate = toHex(hslToRgb(h, s, Math.max(0, l - step * 0.01)));
    if (contrastRatio(candidate, bgHex) >= minRatio) return candidate;
  }
  return "#000000";
}
