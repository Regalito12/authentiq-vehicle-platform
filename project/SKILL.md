---
name: authentiq-design
description: AUTHENTIQ is a bilingual (ES/EN) premium vehicle marketplace design system with Porsche-inspired editorial minimalism — warm cream background, near-black ink, muted champagne accent, Inter Tight + IBM Plex Mono, hard corners, hairline borders, almost no icons.
user-invocable: true
---

# AUTHENTIQ Design System — Quick Map

## Root files
- `README.md` — brand context, content fundamentals, visual foundations, iconography
- `colors_and_type.css` — all design tokens (colors, type, spacing, motion). **Import this** into any new HTML: `<link rel="stylesheet" href="colors_and_type.css">`
- `SKILL.md` — this file
- `thumbnail.png` — cover image

## Folders
- `assets/` — real vehicle photography (Porsche 911 GT3, Cayenne Turbo GT, Taycan Turbo S, Macan GTS, Panamera, BMW M4, AMG GT, Audi e-tron GT), `hero-highway.jpg`, 3 reviewer portraits
- `preview/` — design-system-tab specimen cards
- `ui_kits/authentiq-web/` — high-fidelity click-thru of the web platform
- `source/` — reference implementation (read-only; do not modify)

## Brand-specific rules — READ BEFORE DESIGNING

1. **Two typefaces only.** Inter Tight (display + body) + IBM Plex Mono (all labels, numbers, buttons, tags). Never introduce a third.

2. **Hard corners everywhere.** `border-radius: 0` on cards, buttons, modals, inputs. The only rounded elements are: circular avatars & swatches (`50%`), the mode-toggle pill (`999px`), the chat/compare FABs.

3. **One accent, used surgically.** `--accent: #c8a24b` (muted champagne). Used on: italic word inside titles, pulsing "live" dot, hover-fill on primary button, active nav underline, `CERTIFICADO` tag, gold star ratings, map pin. Never as a bulk background.

4. **Warm cream base, not white.** `--bg: #faf8f5` and `--bg-alt: #f2eee7`. `--ink: #0a0a0a`. Never `#fff` or `#000`.

5. **Sentence case for headers, UPPERCASE for mono labels.** Never Title Case. Buttons like "Explorar catálogo" become `EXPLORAR CATÁLOGO` when set in Plex Mono with `letter-spacing: 0.1em`.

6. **No icons library.** No Lucide, no emoji. Symbols are: Unicode `· → ✓ ★ ‹ ›`, CSS-drawn arrows/close/chevrons, one inline SVG (chat bubble). If you want to represent a concept, prefer a mono uppercase label.

7. **Editorial photography only.** No illustrations, no 3D renders, no icon-cards. If a photo isn't available, leave a placeholder. Apply `filter: grayscale(20%) contrast(1.05) brightness(0.98)` for tonal consistency across mixed sources.

8. **Hairline borders, not shadows.** Cards use `1px solid var(--line)` (or `--line-2`). Never `box-shadow` on a card. Shadows are reserved for the chat panel, FABs, and hero vehicle drop-shadow.

9. **One easing curve.** `cubic-bezier(.22,.61,.36,1)` — exposed as `var(--ease)`. Everything uses it.

10. **Bilingual first.** Every user-facing string should have an ES and an EN variant. Spanish is the default. Voice is editorial: short declarative sentences ending in a period. No exclamation marks. Address with the informal *tú*.

11. **Dealer B2B mode inverts to dark.** Add `class="b2b"` on `<body>` to swap `--bg` for `--dark-bg` (`#0d0c0a`). Structure and type stay identical; only the palette flips.

## Signature CSS tokens (cheat sheet)

```css
--bg: #faf8f5;            --ink: #0a0a0a;
--bg-alt: #f2eee7;        --ink-soft: #3d3a35;
--muted: #6b6660;         --line: #d9d3c8;
--accent: #c8a24b;        --accent-deep: #a4832e;
--f-display: "Inter Tight";
--f-mono: "IBM Plex Mono";
--ease: cubic-bezier(.22,.61,.36,1);
```

## Signature copy patterns

- Hero title with italic accent word: `Conducir es <em class="italic-accent">elegir.</em>`
- Tagline: three short words, each with a period — `Purista. Analógico. Definitivo.`
- Price: `$189,500 USD`
- Mono label: `PRECIO DE VENTA` (letter-spacing 0.08–0.1em)
- Toast: `✓ Cita confirmada — 28 nov · 14:15`
- Section index: `№ 001 / 008`
