# Handoff: AUTHENTIQ — Premium Vehicle Marketplace

## Overview

**AUTHENTIQ** is a bilingual (Spanish default / English secondary) premium & pre-owned vehicle marketplace with a dual-mode surface — **Buyer** (light, editorial) and **Dealer / B2B** (dark inversion). The design positions the product as *editorial rather than automotive-retail* — closer to a Porsche brochure or an architectural monograph than a car-listing site.

The bundle delivers a complete navigable buyer flow:

**Home** → browse a full catalog with filter pills → **Vehicle Detail** (with a fake-360° viewer + color picker + specs + Carfax-style history strip + primary/secondary actions) → **Test drive booking calendar** / **Live chat panel** / **Offer modal** / **Location & map block**. A floating **Compare** button opens a side-by-side comparator for up to 3 vehicles.

## About the Design Files

The files in this bundle are **design references created in HTML/React (Babel-in-browser)** — prototypes showing intended look and behavior, **not production code to ship as-is**. The task is to **recreate these designs in the target codebase's existing environment** (Next.js / Nuxt / SwiftUI / Flutter / native web / etc.) using its established patterns, component library, state management and design system.

If no environment exists yet, we recommend **Next.js 14+ (App Router) with TypeScript + Tailwind CSS** or **Remix + Tailwind** — the design's flat editorial style and CSS custom properties translate directly to Tailwind's utility model, and both give SSR for SEO on catalog pages. State can stay simple (Zustand or React Context); listings should be fetched server-side.

Deploy path: **Genspark Code** picks this bundle up and can develop + deploy online.

## Fidelity

**High-fidelity (hifi).** All colors, typography, spacing, interactions, animations and copy are final and specified in exact values below. Recreate the UI pixel-perfectly.

The single deviation from pixel-perfect intent is the 360° viewer: it simulates rotation by keying through 2–4 real photos per vehicle rather than a true 24–36 frame turntable sequence (which requires a professional shoot per vehicle). A production implementation should use a real image sequence (or a lightweight 3D viewer such as `@react-three/fiber` with GLB models) when photography is available.

---

## Screens / Views

### 1. Home (`01 Home`)

**Purpose:** Entry point. User sees the brand hero, browses the full catalog, reads customer trust signals.

**Layout:**
- Fixed top nav (`height: 64px`, `padding: 0 32px`, `backdrop-filter: blur(20px)`)
- Hero section (`min-height: calc(100vh - 64px)`, `padding: 60px 48px 40px`, CSS grid `auto 1fr auto`, gap 40px, `overflow: hidden`, `isolation: isolate`)
- Catalog section (`padding: 100px 48px 80px`, top border `1px solid var(--line)`)
- Reviews section (`padding: 100px 48px 80px`, background `var(--bg-alt)`)

**Components:**

**Top Nav** — logo (18px bold, `letter-spacing: -0.02em`, CSS-drawn circular emblem with two crossed diagonal lines before it), 5 nav links (13px, `letter-spacing: 0.02em`, 28px gap, active state = 2px accent underline 22px below), mode toggle (rounded pill segmented control "COMPRADOR / CONCESIONARIO", mono 11px uppercase, active fills with `--ink`), language toggle (mono 11px uppercase `ES` / `EN`, opacity 0.6 default → 1 on hover).

**Hero:**
- **Background:** `.hero-bg img` fills 100% × 100% with `object-fit: cover`, `filter: grayscale(20%) contrast(1.05) brightness(0.98)`, animates via `heroDrift` 30s ease-in-out (scale 1.02 → 1.08). A `::after` gradient overlay `rgba(250,248,245, 0.7 → 0.55 → 0.95)` keeps text legible.
- **Meta row (z-index 3):** left has small accent-color dot + eyebrow text ("ED. 2026 — COLECCIÓN DE OTOÑO", mono 11px, `letter-spacing: 0.1em`, uppercase, `color: var(--muted)`). Right has "№ 001 / 008" in mono.
- **Hero title (z-index 3, `mix-blend-mode: multiply`):** `font-size: clamp(72px, 12vw, 180px)`, `line-height: 0.88`, `letter-spacing: -0.04em`, weight 500. Three parts: `.thin` (weight 300) + normal + `.accent` (`color: var(--accent)`, `font-style: italic`, weight 400). Copy: "Conducir es *elegir.*"
- **Hero vehicle (z-index 2):** `position: absolute; right: 48px; top: 55%; width: 48–55%; max-width: 900px; aspect-ratio: 16/9`. Image `object-fit: contain/cover`, `filter: drop-shadow(0 30px 60px rgba(10,10,10,0.25))`, animates via `heroFloat` 6s ease-in-out alternate (`translateY -4px ↔ 4px`).
- **Hero bottom row (z-index 3):** 3-col grid `1fr auto 1fr` with top border. Left = copy paragraph (14px, max-width 380px, `line-height: 1.55`). Center = CTA buttons (primary "Explorar catálogo" + ghost "Agendar visita", both mono 11px uppercase, arrow icon grows 14 → 22px on hover). Right = big number "08" (48px `--f-display`) + label "modelos disponibles" (mono 11px muted uppercase).

**Catalog:**
- Head: h2 title "Catálogo activo" (36px, weight 500, `letter-spacing: -0.02em`) + filter row (5 pill buttons: Todos / Nuevos / Seminuevos / Deportivos / SUV, `padding: 8px 14px`, 1px border, mono 11px uppercase, active fills with `--ink`).
- Grid: `grid-template-columns: repeat(3, 1fr); gap: 32px 24px`. Breakpoint at 1100px → `repeat(2, 1fr)`.
- **Card** (cursor pointer, `translateY(-4px)` on hover with 400ms ease):
  - `.card-img`: `aspect-ratio: 4/3`, 1px `--line-2` border. Contains `<img>` (100% cover) that scales 1.04× on hover with 700ms ease.
  - Top-left `.card-tag`: mono 10px uppercase, `padding: 4px 8px`. Variants: `.new` (ink bg, cream text — copy "Nuevo") and `.used` (accent bg, ink text — copy "Certificado").
  - Under image: title (20px, weight 500, sentence case, e.g. "Porsche 911 GT3") + subtitle (mono 11px muted, "YEAR · POWER hp") on left + price on right (mono 12px, prefixed by tiny mono 9px "DESDE" label).

**Reviews section:**
- Head: h2 "Clientes que *confían.*" (44px weight 400, "confían." italic in accent color) + right column showing `4.9/5` big display numeral + gold ★★★★★ stars + label "· 1,247 reseñas verificadas".
- Grid: `repeat(3, 1fr)` gap 24px.
- **Review card:** `padding: 28px`, 1px `--line-2` border, `--bg` background. Contents: gold stars row (13px, `letter-spacing: 4px`), quote text (15px, `line-height: 1.55`, `text-wrap: pretty`), vehicle name (mono 10px accent uppercase with top border), author row (44px circular avatar + name 14px + role mono 10px muted).

### 2. Vehicle Detail (`02 Detail`)

**Purpose:** Product page. User inspects vehicle, changes color, chooses an action.

**Layout:** `padding: 40px 48px`
- **Detail head:** flex, space-between, align-end, 24px bottom padding + 1px border. Left = breadcrumb (mono 11px uppercase muted, `/` separators) + h1 title (72px, `letter-spacing: -0.03em`, `line-height: 0.95`; last word wrapped in `.italic` with accent color) + tagline (mono 12px muted uppercase) + live-count badge. Right = "Precio de venta" label (mono 10px muted uppercase) + price (32px, currency 14px muted) + "o desde $X/mes" (mono 10px muted).
- **Detail main:** grid `1.6fr 1fr` gap 40px, breakpoint at 1100px → single column.
  - **Left column:** `<Viewer360>` (or gallery/split variant) + thumbnail strip + `<ColorPicker>`.
  - **Right column (`.detail-side`):** two stacked `.side-block` panels (`padding: 24px`, 1px border). Each has an h3 with mono uppercase label + accent index number. Specs block lists 8–9 spec-rows (`.k` mono 11px muted uppercase / `.v` mono 12px weight 500), then a `HistoryStrip`. Actions block has a 2×N grid: primary spans full width ("Test drive" — black bg, hover fills accent), plus 2 secondary ("Chat en vivo", "Hacer oferta").
- **Location block:** grid `1fr 1fr`, min-height 340px, 1px border. Left = dealer info (dealer name 28px, address mono 12px preserving line breaks, 4-item metadata grid). Right = stylized SVG map with real Polanco/CDMX street grid, gold dashed route, gold pin at destination, white pin at origin, "12 MIN" ETA badge, compass, scale bar.

**Viewer360 component (variant="rotate", default):**
- Container: `aspect-ratio: 16/10`, 1px border, `cursor: grab` (`grabbing` when dragging).
- Top-left mode selector: 3 pills (360° / Galería / Interior), mono 10px uppercase, 1px border, active fills with ink.
- Real photos are layered `position: absolute; inset: 0`. Rotation state `0..359` selects `frameIdx = floor((rotation/360) * frameCount) % frameCount`. Only one frame gets `.active` (opacity 1); others opacity 0 with 120ms transition. Each frame transforms `scale(0.94 + 0.06*|cos(rotY)|) scaleX(±1)` (flipped between 90°–270°).
- Color tint overlay: `mix-blend-mode: multiply`, opacity 0.22, filled with selected color hex (hidden in Interior mode).
- Radial vignette: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.15))`.
- Hover hint (400ms fade): "Arrastra para rotar ↔" mono 10px centered, 1px border, cream bg.
- HUD (bottom): left = "En vivo · 360°" badge with pulsing accent dot on black bg (mono 10px uppercase). Right = "Rotación" label + 120×2px progress bar (fills ink) + degree readout mono padded to 3 digits.
- Drag physics: on pointerdown capture `{ x: pointerX, rot: currentRot }`; on move `rot = (start.rot + (delta / rect.width) * 360) % 360` (wrap negative → positive). Use `mousemove/mouseup` on `window`, not the element.

**Viewer360 variant="gallery":** grid `3fr 1fr` main image + column of thumbs. Selected thumb has 2px accent border; unselected `filter: brightness(0.85)`. Main image top-left mono badge shows "01 / 04 · Perfil".

**Viewer360 variant="split":** grid `1fr 1fr`, exterior left (1px right border) + second image right. Both get mono "Exterior" / "Interior" bottom-left label with `text-shadow`.

**ColorPicker:** 20px padding, 1px border. Head has "Color exterior" mono uppercase label + current color name (mono 12px). Swatches row: 36×36px circles, 1px border, `transform: scale(1.1)` on hover. Active swatch: `::after` ring at `inset: -5px; 1px solid var(--ink); border-radius: 50%`.

**HistoryStrip (Carfax-style):** `grid-template-columns: repeat(4, 1fr)`, dashed borders top+bottom. Each item = centered 28px circle border (success green) + mono value (11px) + mono key (9px muted uppercase). For used vehicles: Dueños=1 / Servicio=Al día / Sin siniestros=Verificado / Certificación=150 pts. For new: Garantía=4 años / Servicio incluido=60,000 km / Asistencia=24/7 / Origen=Directo fábrica.

**Live count badge:** inline-flex, `padding: 6px 12px`, 1px `--line-2` border, mono 10px uppercase. Pulsing red dot before number. Value updates ±1 every 4s via `setInterval`.

### 3. Calendar Modal — Test Drive Booking

**Purpose:** Book a 45-minute test drive.

**Layout:** Overlay `rgba(10,10,10,0.5)` + `backdrop-filter: blur(8px)`. Modal `max-width: 720px`, animates in 400ms (opacity 0 → 1, translateY 20 → 0). Modal head: 28px 32px padding, 1px bottom border, h2 title 24px weight 500 + sub mono 11px uppercase.

- **Cal head:** month title (20px weight 500) + `MM / YYYY` mono 12px muted on left; 2 nav buttons (32×32, 1px border, chevrons `‹` `›`) on right.
- **Day labels row:** 7-col grid gap 4px. Each label mono 10px uppercase muted, centered.
- **Cal grid:** 7 cols, aspect-ratio 1 cells, 1px `--line-2` border. States: `.disabled` (`--line` color, no pointer), `.today` (4×4px accent dot top-right), `.selected` (fills ink), hover `border-color: var(--ink)`. Each cell shows day number 16px + "N slots" mono 8px.
- **Slots grid** (revealed on date select): `repeat(4, 1fr)` gap 8px. Each slot button `padding: 12px`, mono 12px. States: default / `.selected` (ink fill) / `.taken` (opacity 0.35, `text-decoration: line-through`). Time list: 09:30, 10:15, 11:00, 12:00, 13:30, 14:15, 15:00, 16:30. 2 slots per date deterministically "taken" via `date.getDate() % 8` and `(date.getDate() * 3) % 8`.
- **Actions row:** summary "Cita para <date> · <time>" (highlight portion in ink) + Cancel ghost / Confirm primary buttons.

### 4. Chat Panel

**Purpose:** Live chat with a sales advisor about a specific vehicle.

**Layout:** `position: fixed; right: 0; top: 0; bottom: 0; width: 400px`. Slides in 400ms translateX 100% → 0. Left border 1px + shadow `-20px 0 60px rgba(10,10,10,0.08)`.

- **Head:** 20px 24px padding, 1px bottom border. 40×40 avatar (linear-gradient `--accent → --accent-deep`, mono 13px initials "CM", 10×10 success dot bottom-right with 2px bg border) + name "Camila Mendoza — Asesor" (14px weight 500) + role mono 10px muted uppercase "● En línea ahora".
- **Messages:** flex-1 scroll, 24px padding, 14px gap.
  - **Context chip:** 12px 14px, `bg-alt` background, mono 10px muted, contains 40×30 thumb + vehicle info.
  - **Bubbles:** max-width 80%, `padding: 10px 14px`, 13px, 300ms entry (opacity + translateY 6px). `.agent` = `bg-alt` bg, aligned start. `.user` = ink bg, cream text, aligned end. Each has mono 9px timestamp at bottom.
  - **Typing indicator:** 3 dots, `bounce` keyframes staggered 0.15s, same `bg-alt` bubble.
- **Quick replies:** 4 chips before input (mono 10px uppercase, 1px border). Clicking one sends its label as a user message.
- **Input row:** 16px 24px padding, 1px top border. Borderless text input (14px) + 36×36 send button (ink bg, hover fills accent).

**Bubble variant:** 60×60 circular FAB bottom-right, ink bg, chat-bubble inline SVG icon, red notification dot top-right with 2px cream border.

### 5. Offer Modal

**Purpose:** Submit a purchase offer with payment terms.

Same overlay + modal chrome as calendar. `max-width: 720px`.

**Price display (centered, top):**
- Label "Tu oferta" mono 10px `letter-spacing: 0.15em` uppercase muted.
- Big price: 64px, `letter-spacing: -0.03em`. Currency "$" is 24px muted. `.amount` color transitions 200ms: ink default, `--accent-deep` when below asking, `--success` when at/above.
- Diff line mono 11px: "−$X (Y.Y%) por debajo del pedido · Precio pedido $XXX". Color `--danger` for below, `--success` for above.

**Slider variant (default):**
- Track 2px `--line`, filled portion ink.
- Asking marker: 2px × 14px accent vertical bar with "ASKING" mono 9px accent label above.
- Thumb: 24×24 circle, cream bg with 2px ink border, `cursor: grab`.
- Range: min = `round(asking * 0.7)`, max = `round(asking * 1.1)`.
- Below track: min/max values mono 10px muted.

**Form variant:** big number input (14px mono, 1px border, focus border-color ink) + 3 quick-fill buttons "90% · $X" / "95% · $X" / "100% · $X" (ghost small).

**Auction variant:** row of active bids (bidder ID / amount / relative time). "Más alta" callout mono 11px accent. Number input below.

**Terms grid:** 3 rows `grid-template-columns: 1fr 2fr`:
- Forma de pago (select: Contado / Financiado / Leasing).
- Trade-in (select: No / Sí, tengo un vehículo).
- Mensaje al vendedor (textarea, min-height 60px).

**Actions:** Descartar (ghost) + Enviar oferta (primary, growing arrow).

### 6. Compare Modal

**Purpose:** Side-by-side comparison of up to 3 vehicles.

**Layout:** `max-width: 1200px; width: 96%`.

- **Slot picker:** 3-col grid gap 12px. Empty slot = 1px dashed border, "+ Añadir vehículo" mono placeholder. Filled slot = solid border, thumbnail (aspect 4/3) + name 14px + price mono 11px muted + `×` remove button top-right.
- **Available list** (shown when < 3 slots filled): `repeat(4, 1fr)` grid gap 8px of picker buttons. Each: 40×30 thumb + name + price. Selected/full items `disabled` with opacity 0.3.
- **Compare table** (shown when ≥ 2 vehicles):
  - Header row (`bg-alt`): `grid-template-columns: 140px repeat(3, 1fr)`. Each vehicle cell: display name 16px weight 500 + sub "YEAR · Nuevo/Certificado" mono 10px muted.
  - Body rows: key on left (mono 10px muted uppercase, right-bordered) + values (mono 12px). Cells marked `.best` render in accent, weight 500. Best logic: highest power / lowest 0-100 / highest top speed / lowest price.
  - Rows: Motor, Potencia, Par motor, 0-100, Vel. máx., Transmisión, Tracción, Año, Kilometraje, Precio, Concesionario.
- **Trigger:** floating `.compare-fab` bottom-left when `compareIds.length > 0`. Ink bg, mono uppercase label + accent count pill.

---

## Interactions & Behavior

- **Navigation:** Home ↔ Detail via card click / breadcrumb. Single-page conditional render — no hard routing in the prototype. Production: use Next.js App Router or React Router with `/`, `/v/[id]` URLs.
- **Persistence (all in `localStorage`):** `authentiq_lang`, `authentiq_screen`, `authentiq_vehicle` (id), `authentiq_mode` (buyer/dealer), `authentiq_compare` (JSON array of ids).
- **Dealer mode:** toggles `body.b2b` class which swaps to a dark palette (`--bg #0d0c0a`, `--ink #f2eee7`, `--line #2a2620`) via CSS custom-property redeclaration.
- **Language toggle:** flips a React context; every user-visible string is looked up via `t(key)` from the ES/EN dictionary.
- **Notification toast:** appears bottom-center for 3s on booking/offer confirmation. Ink bg, mono 12px, `animation: modalIn 300ms cubic-bezier(.22,.61,.36,1)`. Copy: `✓ Cita confirmada — 28 nov · 14:15` (Unicode check, em dash, mono time).
- **Viewer drag:** captures pointer at mousedown, tracks delta over viewer width, maps to 360° rotation. `mousemove`/`mouseup` bound to `window` (not the element) so drags outside still register.
- **Color picker:** updates the tint overlay on the viewer in real time.
- **Live view count:** simulated with `setInterval(4000)` adding a random `±1`. Production: wire to websocket / polling.

**Timings & easing (all via `--ease: cubic-bezier(.22,.61,.36,1)`):**
- Card hover: 400ms translate + 700ms image scale
- Modal in: 400ms opacity + translateY
- Button hover fills: 250ms
- Message enter: 300ms
- Chat panel slide: 400ms translateX
- Hero background drift: 30s infinite alternate
- Hero vehicle float: 6s infinite alternate

**Responsive breakpoint (@ 1100px):**
- `.detail-main` → single column
- `.catalog-grid` → 2 columns
- `.hero-vehicle` → static in flow (`position: relative`)
- `.location-block` → single column

---

## State Management

Top-level `App` component owns:
- `screen: "home" | "detail"`
- `vehicle: Vehicle` (currently selected)
- `mode: "buyer" | "dealer"`
- `modal: null | "calendar" | "offer" | "compare"`
- `chatOpen: boolean`
- `notification: string | null`
- `compareIds: string[]`
- `tweaks: { viewerVariant, chatVariant, offerVariant }` — **prototype-only, remove for production**

`LangProvider` (React context) provides `{ lang, setLang, t }`.

**For production:**
- Move vehicle catalog to a REST/GraphQL endpoint (`GET /vehicles`, `GET /vehicles/:id`).
- Chat should use websockets (Socket.IO / Ably / Pusher) with real advisor identity and typing indicators.
- Test-drive booking should hit a scheduling backend that enforces slot availability atomically.
- Offer submission should create a lead record + trigger dealer notification (email/SMS).
- Auth: buyer accounts + dealer accounts + role gating for the Dealer mode.
- Currency hardcoded to USD — add `Intl.NumberFormat` locale-aware formatting.
- Copy is in `i18n.jsx` — migrate to `next-intl` / `react-intl` / `i18next`. Keys are already namespaced (`nav.*`, `hero.*`, `catalog.*`, `detail.*`, `cal.*`, `chat.*`, `offer.*`, `location.*`).

---

## Design Tokens

**Colors — light (Buyer, default):**
```css
--bg:          #faf8f5;   /* warm off-white base */
--bg-alt:      #f2eee7;   /* subtle raised surface */
--ink:         #0a0a0a;   /* near-black primary */
--ink-2:       #1a1917;
--ink-soft:    #3d3a35;   /* body copy */
--muted:       #6b6660;   /* secondary text */
--line:        #d9d3c8;   /* primary borders */
--line-2:      #ebe6dc;   /* subtle inner borders */
--accent:      #c8a24b;   /* muted champagne */
--accent-deep: #a4832e;
--danger:      #b04a3a;
--success:     #4b7a5c;
```

**Colors — dark (Dealer, `body.b2b` override):**
```css
--bg:       #0d0c0a;
--bg-alt:   #17150f;
--ink:      #f2eee7;
--ink-2:    #ebe6dc;
--ink-soft: #c8c3ba;
--muted:    #8a857c;
--line:     #2a2620;
--line-2:   #1e1c17;
```

**Type stack:**
- Display: `"Inter Tight", "Helvetica Neue", sans-serif` — Google Fonts, weights 300, 400, 500, 600, 700 + italic 400
- Mono: `"IBM Plex Mono", ui-monospace, monospace` — Google Fonts, weights 400, 500
- Feature settings: `"ss01", "cv11"` on Inter Tight; `"zero"` on IBM Plex Mono
- Base body: 15px / line-height 1.4

**Type scale:**
| Role | Font | Size | Weight | Tracking |
|---|---|---|---|---|
| Hero title | Inter Tight | `clamp(72px, 12vw, 180px)` | 500 | −0.04em |
| Detail h1 | Inter Tight | 72px | 400 | −0.03em |
| Section h2 | Inter Tight | 36–44px | 400–500 | −0.02em |
| Card title | Inter Tight | 20px | 500 | −0.01em |
| Body | Inter Tight | 14–15px | 400 | normal |
| Mono lg (price) | IBM Plex Mono | 13px | 500 | +0.02em |
| Mono (spec values) | IBM Plex Mono | 12px | 400 | +0.05em |
| Mono sm (labels) | IBM Plex Mono | 11px | 400 | +0.08em, UPPERCASE |
| Mono xs (eyebrow) | IBM Plex Mono | 10px | 400 | +0.1em, UPPERCASE |
| Mono xxs (micro) | IBM Plex Mono | 9px | 400 | +0.1em, UPPERCASE |

**Spacing scale (px, used pragmatically):** 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 60, 80, 100.

**Border radius:** almost always **0** — editorial flat style. Exceptions:
- `50%` — circular avatars, swatches, pulsing dots, chat/compare FABs
- `999px` — Buyer/Dealer mode-toggle pill
- `20px` — the small count badge on the Compare FAB

**Shadows:** used surgically, never on cards.
- `0 10px 40px rgba(10,10,10,0.2)` — FABs (chat bubble, compare)
- `-20px 0 60px rgba(10,10,10,0.08)` — Chat slide-out panel cast to the left
- `drop-shadow(0 30px 60px rgba(10,10,10,0.25))` — hero vehicle
- `text-shadow: 0 1px 8px rgba(0,0,0,0.6)` — labels overlaid on images

**Animations to preserve:**
- `heroDrift` — 30s ease-in-out infinite alternate, `scale(1.02) → scale(1.08)` on hero bg
- `heroFloat` — 6s ease-in-out infinite alternate, translateY ±4px on hero vehicle
- `pulse` — 1.8s infinite, opacity 1→0.4 + scale 1→1.4 on live-dot indicators
- `bounce` — 1.4s infinite, staggered translateY on typing dots
- `msgIn` — 300ms ease, opacity + translateY 6px on chat messages
- `slideIn` — 400ms ease, translateX 100% → 0 on chat panel
- `modalIn` — 400ms ease, opacity + translateY 20px on modals
- `fadeIn` — 400ms ease, opacity + translateY 6px on screen changes

---

## Assets

**Vehicle photography** (all in `assets/`):

| File | Vehicle |
|---|---|
| `porsche-911-gt3.jpg` | Porsche 911 GT3 RS — studio white/green |
| `porsche-911-gt3-alt.jpg` | Porsche 911 GT3 RS — alt studio (rotation frame) |
| `porsche-911-st.jpg` | Porsche 911 S/T — dynamic on-bridge |
| `porsche-911-three-quarter.jpg` | Porsche 911 detailing three-quarter |
| `porsche-interior.jpg` | Porsche 911 interior/cockpit |
| `cayenne-turbo-gt.jpg` / `-2.jpg` | Porsche Cayenne Turbo GT |
| `taycan-turbo-s.jpg` / `-2.jpg` / `-alamy.jpg` | Porsche Taycan Turbo S |
| `macan-gts.jpg` | Porsche Macan GTS |
| `panamera.jpg` | Porsche Panamera |
| `bmw-m4.jpg` / `-2.jpg` | BMW M4 Competition |
| `amg-gt.jpg` / `-2.jpg` | Mercedes-AMG GT 63 S |
| `audi-etron-gt.jpg` | Audi RS e-tron GT |
| `hero-highway.jpg` | Hero background loop |

**Reviewer avatars:** `reviewer-1.jpg`, `reviewer-2.jpg`, `reviewer-3.jpg`.

All images were sourced via license-filtered search (CC/PD). **For production, replace with your own or dealer-provided studio photography** — ideally a 24–36 frame turntable sequence per vehicle for a true 360° effect. Reviewer avatars should be real customer photos (with consent) or dealer-branded silhouettes.

**No icon library.** Arrows / chevrons / × / checks are text glyphs (Unicode `→ ‹ › · ✓ ★`) or minimal CSS-drawn shapes. If your codebase already has Heroicons / Lucide / etc., **do not import it here** — the brand's stance is explicitly no-icons. Add a mono uppercase label instead.

**Map SVG:** hand-drawn stylized street grid (see `detail.jsx → RealisticMap`). Production: use Mapbox GL (custom "editorial" style — muted cream + gold), Google Maps Static, or MapLibre with an OSM style — pin the dealer at real lat/lng from the vehicle's `location` object.

---

## Files

Design references included in this handoff (`design_handoff_authentiq_platform/`):

| File | Purpose |
|---|---|
| `AUTHENTIQ.html` | Main app shell — sets up React root, LangProvider, Tweaks defaults |
| `styles.css` | Complete design-system CSS (tokens + every component's styles) |
| `colors_and_type.css` | Token-only CSS (for consumers who want to import just the palette + type) |
| `i18n.jsx` | Bilingual ES/EN dictionary + `LangProvider` context + `useT` hook |
| `data.jsx` | Vehicle catalog (8 models with real photos) + reviews array |
| `nav-home.jsx` | Top nav + Home screen (hero, catalog grid, reviews) |
| `viewer.jsx` | Viewer360 (3 variants) + ColorPicker |
| `detail.jsx` | VehicleDetail screen + LocationMap + RealisticMap SVG + HistoryStrip |
| `calendar.jsx` | Test-drive calendar modal |
| `chat-offer.jsx` | ChatPanel + ChatBubble + OfferModal (3 variants) |
| `compare.jsx` | Side-by-side comparator modal |
| `tweaks_panel.jsx` | Prototype-only variant switcher — do NOT ship |

### Notes for implementation

1. **Babel-in-browser is prototyping only.** Migrate to Vite / Next / Remix with a real bundler.
2. **Global sharing via `Object.assign(window, {...})`** in each file — replace with ES module imports.
3. **Do not ship the Tweaks UI to production.** Decide per-variant during handoff conversations, then bake the winning variant (recommended defaults: `viewer=rotate`, `chat=panel`, `offer=slider`).
4. **The 360° viewer is fake.** Real implementation: either (a) load a 24–36 image sequence per vehicle from a CDN and swap based on drag delta, or (b) use `@react-three/fiber` with a per-model GLB.
5. **Currency is hardcoded USD.** Add locale-aware currency formatting via `Intl.NumberFormat`.
6. **Dates computed against `new Date()`.** Wire the calendar to a real availability API before shipping.
7. **Preserve the brand rules from `SKILL.md`:**
   - Never introduce a third typeface (Inter Tight + IBM Plex Mono only)
   - Never round a corner that isn't already round
   - Never add an icon where a mono label would do
   - Never brighten the accent (`#c8a24b` / `#a4832e` are the only champagne values)
   - Photograph, don't illustrate
