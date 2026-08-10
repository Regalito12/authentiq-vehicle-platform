# AUTHENTIQ — Design System

**AUTHENTIQ** is a bilingual (Spanish / English) premium & pre-owned vehicle marketplace. The brand positions itself as *editorial rather than automotive-retail* — closer to a Porsche brochure or an architectural monograph than a car-listing site.

The visual language is defined by:
- Warm cream backgrounds (`#faf8f5`) + near-black ink (`#0a0a0a`)
- A single muted champagne accent (`#c8a24b`) used surgically for italics, dots, hover states and pins
- Inter Tight display + IBM Plex Mono as the *only* two typefaces
- Hard corners (`border-radius: 0` almost everywhere) and 1px hairline borders
- Real, editorial vehicle photography — never illustrations, never stock icons
- Language toggle ES ↔ EN and a Buyer / Dealer (B2B) mode toggle that flips to a dark palette

The system covers one product surface today: a **responsive marketing + shopping web platform** with home, catalog, vehicle detail (with a 360° viewer), booking calendar, live chat, offer modal and side-by-side comparison.

---

## Sources this system was built from

- **Template project** [`/projects/514d7093-75ab-48f5-8f9c-ce6fa012ed72/`](/) — the AUTHENTIQ prototype (`AUTHENTIQ.html`, `styles.css`, JSX components, `data.jsx`, `i18n.jsx`).
- **Handoff doc** `source/HANDOFF.md` — pixel-level spec of every screen (325+ lines).
- Real vehicle photography in `assets/` — Porsche 911 GT3, Cayenne Turbo GT, Taycan Turbo S, Macan GTS, Panamera, BMW M4, Mercedes-AMG GT, Audi e-tron GT, plus a highway hero and three reviewer portraits.

The `source/` folder is a verbatim copy of the reference implementation. Consult it before making changes; the surface you're likely designing against is `source/styles.css` + the component JSX files.

---

## Index — where to look

| File / folder | What's inside |
|---|---|
| [`colors_and_type.css`](colors_and_type.css) | All design tokens — colors, typography, spacing, motion, elevation |
| [`assets/`](assets/) | Real vehicle photography, reviewer portraits, hero highway shot |
| [`preview/`](preview/) | Individual specimen cards that render in the Design System tab |
| [`ui_kits/authentiq-web/`](ui_kits/authentiq-web/) | High-fidelity click-thru recreation of the web platform |
| [`source/`](source/) | Original prototype code (read-only reference) |
| `SKILL.md` | Makes this system attachable to other projects |
| `thumbnail.png` | Cover image shown in the design-system picker |

---

## Content Fundamentals

**Bilingual first.** Every user-facing string exists in Spanish and English (`i18n.jsx` holds the dictionary). Spanish is the default; the copy voice below applies to both languages equally.

**Voice.** Editorial, quiet, confident. Short declarative sentences, often three words followed by a period. Never salesy, never exclamatory, never adjective-stacked. The brand talks about vehicles the way a curator talks about art.

Signature examples:

> **Conducir es elegir.** *(Driving is choosing.)* — hero title
>
> **Purista. Analógico. Definitivo.** — tagline for a 911 GT3
>
> **Fuerza sin compromiso.** *(Force without compromise.)* — Cayenne
>
> *"Una plataforma para descubrir, configurar y adquirir vehículos con la misma precisión con la que fueron diseñados. Cada modelo, verificado. Cada oferta, transparente."* — hero paragraph

**Casing.**
- **Body copy & titles**: Sentence case ("Catálogo activo", "Ubicación del vehículo"). Never Title Case.
- **Labels, buttons, tags, mono captions**: UPPERCASE with `letter-spacing: 0.08–0.15em`. Examples: "DESDE", "COMPARTIR", "EN VIVO", "CERTIFICADO".
- **Numbers**: Always in IBM Plex Mono with `font-feature-settings: "zero"` — the slashed zero is intentional.

**Grammar & person.** The brand addresses the user with the informal *tú* ("Tu oferta", "Selecciona una fecha"), never *usted*. It refers to itself in the third person or omits self-reference entirely.

**No emoji. No exclamation marks.** The only decorative unicode used is `·` (middle dot, e.g. "3.2s · 502 hp") and `—` (em dash, e.g. "Camila Mendoza — Asesor").

**Micro-copy patterns.**
- Prices: `$189,500 USD` (comma thousand-separator, currency after)
- Time: `45 min`, `3.2s`, `318 km/h`
- Dates: `28 nov` (short-month lowercase, no year unless needed)
- Confirmation toasts: `✓ Cita confirmada — 28 nov · 14:15` (check + dash + mono time)
- Section indices: `№ 001 / 008` (using the numero sign)

---

## Visual Foundations

### Colors
The palette is deliberately restrained: one warm off-white background, one deep ink, one champagne accent, plus semantic red/green used only for offer-above-asking and success confirmations. Buyer mode is light; **Dealer (B2B) mode** is a dark inversion (`--dark-bg #0d0c0a`) applied by adding `body.b2b`.

### Typography
Two families, no more. **Inter Tight** carries all display, titles and body — with weights 300 (thin hero accents), 400 (paragraphs), 500 (titles, prices), 700 (logo). Italics of Inter Tight are used only for the accent color word inside titles. **IBM Plex Mono** carries every uppercase label, every number, every button, every tag, every timestamp — its slashed zero and geometric proportions read as *technical precision*, opposite to the display's editorial warmth.

Hero titles get `mix-blend-mode: multiply` to interact with hero imagery. Tracking is aggressive: `-0.04em` at display sizes; `+0.08 to +0.15em` on mono labels. Line-height is tight — `0.88` on hero, `0.95` on H1, `1.4–1.55` on body.

### Spacing & Layout
Section padding follows `100px 48px 80px` for major sections (top, sides, bottom). Grids use 24–32px gutters. Nav is 64px fixed. Card grids are `repeat(3, 1fr)` desktop → `repeat(2, 1fr)` at 1100px → single column below.

### Backgrounds
- **Editorial photography** is the default — full-bleed on hero, filtered `grayscale(20%) contrast(1.05) brightness(0.98)` to unify color temperature across mixed sources.
- The hero image drifts slowly (`scale(1.02) → scale(1.08)` over 30s) and is protected by a top-to-bottom gradient `rgba(250,248,245, 0.7 → 0.55 → 0.95)`.
- No repeating patterns. No SVG blobs. No mesh gradients.

### Animation
One easing curve — `cubic-bezier(.22,.61,.36,1)` — used everywhere. Durations: `200ms` for micro (opacity/color), `250ms` for buttons, `400ms` for modals & fades, `700ms` for card image scales, `30s` for hero drift. Recurring named keyframes: `fadeIn` (opacity + 6px translateY), `modalIn` (opacity + 20px translateY), `slideIn` (translateX 100% → 0), `heroFloat` (vehicle bob ±4px), `heroDrift` (scale 1.02 → 1.08), `pulse` (accent dot, scale + opacity), `bounce` (typing indicator).

### Hover states
- Buttons: fill inverts (black → cream) or turns champagne; ghost buttons fill black
- Cards: `transform: translateY(-4px)` + inner image scales `1.04`
- Nav links: opacity `0.7 → 1`
- Swatches: `scale(1.1)`
- Underline appears as a 2px accent bar 22px below active nav item

### Press / active states
- Selected cells & slots: solid black fill, cream text
- Active mode-toggle segment: filled with `--ink`
- Active swatch: `::after` ring at `inset: -5px` (1px ink, `border-radius: 50%`)

### Borders & radius
Everything is square. Hairline `1px` borders in `--line` / `--line-2` provide almost all visual separation — no drop shadows on cards, no rounded corners. The only rounded elements are: circular avatars & swatches (`border-radius: 50%`), the mode-toggle pill (`border-radius: 999px`), and the chat/compare FABs.

### Shadows
Shadows are surgical. `drop-shadow(0 30px 60px rgba(10,10,10,0.25))` under the hero vehicle image. `-20px 0 60px rgba(10,10,10,0.08)` cast by the chat slide-out. `0 10px 40px rgba(10,10,10,0.2)` under the compare FAB. No cards or panels use box-shadow.

### Transparency & blur
Only two places use blur: the top nav (`backdrop-filter: blur(20px)` over `rgba(250,248,245,0.85)`) and the modal overlay (`backdrop-filter: blur(8px)` over `rgba(10,10,10,0.5)`). No frosted cards, no glassmorphism motifs elsewhere.

### Imagery character
Warm-neutral, low-saturation, subtle grain from the light filter. Cars sit against natural environments (highways, mountains, showrooms). Reviewers are shown as real portraits, not illustrations. No 3D renders. No product-on-white cutouts unless it's the hero float.

### Cards
Border `1px solid var(--line-2)` or `--line`. **No rounded corners, no drop shadow.** A card is simply an image + a label + a price. The hover lift (`translateY(-4px)`, 400ms) is the only motion tell that a card is interactive.

---

## Iconography

**AUTHENTIQ deliberately uses almost no icons.** Where a lesser system would add an icon, AUTHENTIQ adds a mono label instead — "AGENDAR", "COMPARAR", "VER RUTA". This is the brand's most opinionated stance.

The tiny number of icons that do exist are:

| Icon | Where | How it's drawn |
|---|---|---|
| Brand emblem | Logo (nav, favicon) | Pure CSS — a `22 × 22px` circle with two crossed diagonal lines using `linear-gradient(45deg, …)` + `linear-gradient(-45deg, …)` as backgrounds |
| Arrow | Buttons ("Explorar catálogo →") | Pure CSS — a `1px × 14px` bar with a rotated 45° corner as `::after`; grows to `22px` on hover |
| Close (×) | Modal close button | Pure CSS — two rotated 1px bars (`::before`, `::after`) |
| Chevron `‹ ›` | Calendar month navigation | Actual Unicode single-angle-quotes, monospaced |
| Send arrow (→) | Chat input | Unicode arrow character |
| Chat bubble | Chat FAB (bubble variant) | Small inline SVG (2 concentric rounded shapes) — the only bitmap-style SVG in the system |
| Pulsing dot | "En vivo" badge, review section, live-count | `6 × 6px` `background: var(--accent) or --danger`, `border-radius: 50%`, animated via `@keyframes pulse` |
| Star (★) | Reviews | Unicode `★` in `var(--accent)` with `letter-spacing: 3–4px` |
| Check (✓) | Confirmation toasts, history strip | Unicode `✓` |

**No icon libraries are used.** No Lucide, no Heroicons, no Font Awesome. If a new icon is truly needed, the substitution rule is: **prefer a mono uppercase label; if a symbol is unavoidable, use Unicode (·, →, ✓, ★, ‹›). Only fall back to a hand-drawn inline SVG for a genuinely visual concept (e.g. the chat bubble).** Do not import an icon set — it would look wrong against the type.

**No emoji.** Anywhere. Ever. The single `✓` on the toast is a Unicode check, not the emoji `✅`.

---

## Font substitutions

None. Both faces (**Inter Tight**, **IBM Plex Mono**) are loaded directly from Google Fonts and require no substitution. If Google Fonts is not available in the target environment, self-host the WOFF2 files from `fonts.gstatic.com`.

---

## Products in the system

Only one product exists today:

### AUTHENTIQ Web Platform → [`ui_kits/authentiq-web/`](ui_kits/authentiq-web/)
The consumer-facing responsive marketing + shopping site. Contains the hero, catalog grid, review section, vehicle detail (with 360° viewer + color picker + specs + actions + location), calendar, chat and offer flows.

*(A future dealer/CMS admin surface would live at `ui_kits/authentiq-admin/` when built.)*

---

## For humans iterating on this system

1. **Never introduce a third typeface.** The Inter Tight / IBM Plex Mono pairing is load-bearing.
2. **Never round a corner** that isn't already round. Squareness is a brand attribute.
3. **Never add an icon** where a mono label would do. See iconography above.
4. **Never brighten the accent.** `#c8a24b` and `#a4832e` are the only champagne values — don't push toward yellow, don't push toward gold.
5. **Photograph, don't illustrate.** If you need a car and can't source a photo, leave a placeholder.
