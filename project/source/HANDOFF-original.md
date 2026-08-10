# Handoff: AUTHENTIQ — Premium Vehicle Sales Platform

## Overview

AUTHENTIQ is a bilingual (Spanish/English) premium vehicle sales platform inspired by Porsche's editorial minimalism. It provides a complete navigable buyer flow: browse catalog → view detail with 360° viewer → book test drive / chat with advisor / make an offer / view dealer location. Includes a dual mode (Buyer / Dealer B2B), a side-by-side vehicle comparator, customer reviews, and a Tweaks panel to switch between 3 variants each of the 360° viewer, chat, and offer components.

## About the Design Files

The files in this bundle are **design references created in HTML/React (via Babel in-browser)** — prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **recreate these designs in the target codebase's existing environment** (Next.js / Nuxt / SwiftUI / Flutter / native web / etc.) using its established patterns, component library, state management, and design system.

If no environment exists yet, we recommend **Next.js 14+ (App Router) with TypeScript + Tailwind CSS** or **Remix + Tailwind** — the design's flat editorial style and CSS custom properties translate directly to Tailwind's utility model, and both give SSR for SEO on catalog pages.

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, interactions, animations and copy are all specified. Recreate the UI pixel-perfectly using the codebase's existing libraries and patterns. The single deviation from pixel-perfect intent is the 360° viewer: it simulates rotation by keying through 2–4 real photos per vehicle rather than 24–36 (which requires a professional turntable shoot per vehicle). A production implementation should use a real image sequence (or a lightweight 3D viewer such as `@react-three/fiber` with GLB models) when assets are available.

## Screens / Views

### 1. Home (`01 Home`)

**Purpose:** Entry point. User sees brand hero, browses full catalog, and reads customer trust signals.

**Layout:**
- Fixed top nav (64px height, `padding: 0 32px`, `backdrop-filter: blur(20px)`)
- Hero section (`min-height: calc(100vh - 64px)`, `padding: 60px 48px 40px`, CSS grid `auto 1fr auto`, gap 40px, `overflow: hidden`, `isolation: isolate`)
- Catalog section (`padding: 100px 48px 80px`, top border `1px solid var(--line)`)
- Reviews section (`padding: 100px 48px 80px`, background `var(--bg-alt)`)

**Components:**

**Top Nav** — logo (18px bold, `letter-spacing: -0.02em`, circular emblem with cross before it), 5 nav links (13px, `letter-spacing: 0.02em`, 28px gap, active state underlined with 2px accent bar), mode toggle (rounded pill segmented control "COMPRADOR/CONCESIONARIO", mono 11px, active fills with `--ink`), language toggle (mono 11px, opacity 0.6 default).

**Hero:**
- **Background:** `.hero-bg img` fills 100%/100% with `object-fit: cover`, `filter: grayscale(20%) contrast(1.05)`, animates via `heroDrift` 30s ease-in-out (scale 1.02→1.08). A `::after` gradient overlay `rgba(250,248,245, 0.7 → 0.55 → 0.95)` keeps text legible.
- **Meta row (z-index 3):** left has small dot + eyebrow text ("ED. 2026 — COLECCIÓN DE OTOÑO", mono 11px, `letter-spacing: 0.1em`, `text-transform: uppercase`, `color: var(--muted)`). Right has "№ 001 / 008" in mono.
- **Hero title (z-index 3, `mix-blend-mode: multiply`):** `font-size: clamp(72px, 12vw, 180px)`, `line-height: 0.88`, `letter-spacing: -0.04em`, weight 500. Three parts: `.thin` (300 weight) + normal + `.accent` (`color: var(--accent)`, `font-style: italic`, weight 400).
- **Hero vehicle (z-index 2):** `position: absolute; right: 48px; top: 55%; width: 55%; max-width: 900px; aspect-ratio: 16/9`. Image uses `object-fit: contain`, `filter: drop-shadow(0 30px 60px rgba(10,10,10,0.25))`, animates via `heroFloat` 6s ease-in-out alternate (`translateY -4px ↔ 4px`).
- **Hero bottom row (z-index 3):** 3-col grid `1fr auto 1fr` with top border. Left = copy paragraph (14px, max-width 380px, `line-height: 1.55`). Center = CTA buttons (primary + ghost, both mono 11px uppercase, arrow icon grows on hover from 14px→22px). Right = big number "08" + label "modelos disponibles".

**Catalog:**
- Head: h2 title "Catálogo activo" (36px, weight 500, `letter-spacing: -0.02em`) + filter row (5 pill buttons, `padding: 8px 14px`, mono 11px uppercase, active fills with `--ink`).
- Grid: `repeat(3, 1fr)` gap `32px 24px`.
- **Card:** cursor pointer, translate up 4px on hover with 400ms ease.
  - `.card-img`: aspect-ratio 4/3, 1px border. Contains `<img>` (100/100 cover) that scales 1.04× on hover.
  - Top-left `.card-tag`: mono 10px uppercase, `padding: 4px 8px`. Variants `.new` (black bg white text) and `.used` (accent bg dark text — labeled "CERTIFICADO").
  - Bottom overlay `.card-meta`: mono 10px white text with `text-shadow: 0 1px 8px rgba(0,0,0,0.6)`. Left = "N vistas hoy" with pulsing accent dot before it. Right = "N disp.".
  - Under image: title (20px, weight 500) + subtitle (mono 11px muted, "YEAR · POWER") + price on the right (mono 13px with "DESDE" label mono 9px above).
  - Bottom "+ Comparar" button (ghost small, `justifyContent: center`, `width: 100%`). Toggles to "✓ En comparador" when active.

**Reviews section:**
- Head: h2 "Clientes que confían." (44px weight 400, "confían." italic in accent color) + right column showing `4.9/5` big mono numeral + gold ★★★★★ stars + label "· 1,247 reseñas verificadas".
- Grid: `repeat(3, 1fr)` gap 24px.
- **Review card:** `padding: 28px`, 1px border, white bg. Contains: gold stars row (13px, `letter-spacing: 4px`), quote text (15px, `line-height: 1.55`, `text-wrap: pretty`), vehicle name (mono 10px accent uppercase with top border), author row (44px circular avatar + name 14px + role mono 10px muted).

### 2. Vehicle Detail (`02 Detail`)

**Purpose:** Product page. User inspects vehicle, changes color, chooses an action.

**Layout:** `padding: 40px 48px`
- **Detail head:** flex, space-between, align-end, 24px bottom padding + border. Left = breadcrumb (mono 11px uppercase muted, "/" separators) + h1 title (72px, `letter-spacing: -0.03em`, `line-height: 0.95`; last word wrapped in `.italic` with accent color) + tagline (mono 12px) + live-count badge. Right = "Precio de venta" label (mono 10px muted uppercase) + price (32px mono, currency 14px muted) + "o desde $X/mes" (mono 10px muted).
- **Detail main:** grid `1.6fr 1fr` gap 40px.
  - **Left column:** `<Viewer360>` + `<ColorPicker>`.
  - **Right column (`.detail-side`):** two stacked `.side-block` panels (`padding: 24px`, 1px border). Each has an h3 with mono uppercase label + accent index. Specs block lists 9 spec-rows (`.k` mono 11px muted uppercase / `.v` mono 12px weight 500), then a `HistoryStrip`. Actions block has a 2×N grid: primary spans full width ("Test drive" — black bg, hover fills accent), plus two secondary ("Chat en vivo", "Hacer oferta").
- **Location block:** grid `1fr 1fr`, min-height 340px, 1px border. Left half = info (dealer name 28px, address mono 12px preserving line breaks, 4-item metadata grid). Right half = stylized SVG map with real Polanco/CDMX street grid, gold route dashed line, gold pin at destination, white pin at origin, "12 MIN" ETA badge, compass, scale bar.

**Viewer360 component (variant="rotate", default):**
- Container: aspect-ratio 16/10, 1px border, `cursor: grab` (`grabbing` when dragging).
- Top-left mode selector: 3 pills (360° / Galería / Interior), mono 10px uppercase.
- Real photos of the vehicle are layered with `position: absolute` inset 0. Rotation state 0-359 selects `frameIdx = floor((rotation/360) * frameCount) % frameCount`. Only one frame has `.active` (opacity 1); others opacity 0 with 120ms transition. Each frame transforms with `scale(0.94 + 0.06*|cos(rotY)|) scaleX(±1)` (flipped when rotation is 90°-270°).
- Color tint overlay: `mix-blend-mode: multiply`, opacity 0.22, filled with selected color hex (hidden in interior mode).
- Radial vignette overlay: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.15))`.
- Hover-only hint: "Arrastra para rotar ↔" (mono 10px, centered, 1px border, 400ms fade).
- HUD (bottom): left = "En vivo · 360°" badge with pulsing accent dot on black background (mono 10px uppercase). Right = "Rotación" label + 120×2px progress bar (fills black) + degree readout mono padded to 3 digits.
- Drag physics: `startRef = { x: pointerX, rot: currentRot }`; on move, `rot = (startRef.rot + (delta / rect.width) * 360) % 360` (wrap negative to positive).

**Viewer360 variant="gallery":** grid `3fr 1fr` with main image on left + column of thumbs on right. Selected thumb has 2px accent border; unselected thumbs `filter: brightness(0.85)`. Main image top-left mono badge shows "01 / 04 · Perfil".

**Viewer360 variant="split":** grid `1fr 1fr` with exterior on left (1px right border) and second image on right; both get a mono "Exterior"/"Interior" label at bottom-left with `text-shadow`.

**ColorPicker:** 20px padding, 1px border. Head has "Color exterior" mono uppercase label + current color name (mono 12px). Swatches row: 36×36px circles with 1px border, `transform: scale(1.1)` on hover. Active swatch has `::after` ring `inset: -5px; 1px solid ink; border-radius: 50%`.

**HistoryStrip (Carfax-style):** `grid-template-columns: repeat(4, 1fr)`, dashed borders top+bottom. Each item = centered 28px circle border (success green) + mono value (11px) + mono key (9px muted uppercase). For used vehicles: Dueños=1 / Servicio=Al día / Sin siniestros=Verificado / Certificación=150 pts. For new: Garantía=4 años / Servicio incluido=60,000 km / Asistencia=24/7 / Origen=Directo fábrica.

**Live count:** inline-flex badge `padding: 6px 12px`, `border: 1px solid var(--line-2)`, mono 10px uppercase. Pulsing red dot before number. Value increments/decrements by ±1 every 4s via `setInterval`.

### 3. Calendar Modal

**Purpose:** Book a test drive with 45-minute duration.

**Layout:** Overlay `rgba(10,10,10,0.5)` + `backdrop-filter: blur(8px)`. Modal `max-width: 720px`, animates in 400ms (opacity 0→1, translateY 20→0).
- **Modal head:** 28px 32px padding, 1px bottom border. h2 title 24px weight 500 + sub mono 11px uppercase.
- **Cal head:** flex space-between. Left = month title (20px, weight 500) + mono `MM / YYYY`. Right = 2 nav buttons (32×32, 1px border, chevrons `‹` `›`).
- **Day labels row:** 7-col grid gap 4px. Each label mono 10px uppercase muted, centered.
- **Cal grid:** 7 columns, aspect-ratio 1 cells with 1px border-2. States: `.disabled` (color var(--line), no pointer), `.today` (4×4px accent dot top-right corner), `.selected` (fills black), hover `border-color: var(--ink)`. Each cell shows day number 16px + "N slots" mono 8px.
- **Slots:** on date select, shows time-slots grid (`repeat(4, 1fr)` gap 8px). Each slot button `padding: 12px`, mono 12px, states normal / `.selected` (fills black) / `.taken` (opacity 0.35, line-through). Time list: 09:30, 10:15, 11:00, 12:00, 13:30, 14:15, 15:00, 16:30. 2 slots per date are deterministically "taken" based on `date.getDate() % 8` and `(date.getDate() * 3) % 8`.
- **Actions row:** flex space-between with summary "Cita para <date> · <time>" (highlighted portion in ink color) + Cancel ghost / Confirm primary buttons.

### 4. Chat Panel

**Purpose:** Live chat with a sales advisor about a specific vehicle.

**Layout:** `position: fixed; right: 0; top: 0; bottom: 0; width: 400px`. Slides in from right with 400ms translateX 100%→0. Left border 1px + left shadow `-20px 0 60px rgba(10,10,10,0.08)`.

**Head:** 20px 24px padding, 1px bottom border. Left = 40×40 avatar (linear-gradient accent→accent-deep, mono 13px initials "CM", 10×10px green status dot bottom-right with 2px bg border) + name "Camila Mendoza — Asesor" (14px weight 500) + role mono 10px muted uppercase "● En línea ahora".

**Messages:** flex-1 scroll, 24px padding, 14px gap.
- **Context chip:** 12px 14px padding, `bg-alt` background, mono 10px muted. Contains 40×30 thumb + vehicle info.
- **Message bubbles:** max-width 80%, `padding: 10px 14px`, font 13px, entry animation 300ms (opacity + translateY 6px). `.agent` = `bg-alt` background, aligned start. `.user` = `ink` background white text, aligned end. Each has mono 9px timestamp at bottom.
- **Typing indicator:** 3 dots animate with `bounce` keyframes (staggered 0.15s delays), same `bg-alt` bubble.

**Quick replies:** 4 chips before input (mono 10px uppercase, 1px border). Clicking sends the label as a user message.

**Input row:** 16px 24px padding, 1px top border. Text input (borderless, 14px, `outline: none`) + 36×36 send button (black bg, hover fills accent).

**Bubble variant:** 60×60 circular FAB bottom-right, black bg, chat icon SVG, notification red dot top-right.

### 5. Offer Modal

**Purpose:** Submit a purchase offer with payment terms.

**Layout:** `max-width: 720px`. Same modal chrome as calendar.

**Price display (centered, top):**
- Label "Tu oferta" mono 10px `letter-spacing: 0.15em` uppercase muted.
- Big price: 64px, `letter-spacing: -0.03em`. Currency "$" is 24px muted. `.amount` color transitions 200ms: black default, `accent-deep` when below asking, `success` green when at/above.
- Diff line mono 11px: shows `-$X (Y.Y%) por debajo del pedido · Precio pedido $XXX` (color `--danger` for below, `--success` for above).

**Slider variant:**
- Track 2px `--line`, filled portion black.
- Asking marker: 2px × 14px accent vertical bar with "ASKING" mono 9px label above (accent color).
- Thumb: 24×24 circle, white bg with 2px black border, cursor grab.
- Min = `round(asking * 0.7)`, max = `round(asking * 1.1)`.
- Below track: min/max values mono 10px muted.

**Form variant:**
- Big number input (14px mono, 1px border, focus border-color ink).
- 3 quick-fill buttons showing "90% · $X" / "95% · $X" / "100% · $X" (ghost small).

**Auction variant:**
- Row of active bids listing (bidder ID / amount / relative time). "Más alta" callout mono 11px accent.
- Number input below.

**Terms grid:** 3 rows `grid-template-columns: 1fr 2fr`:
- Forma de pago (select: Contado / Financiado / Leasing).
- Trade-in (select: No / Sí, tengo un vehículo).
- Mensaje al vendedor (textarea, min-height 60px).

**Actions:** Descartar (ghost) + Enviar oferta (primary, arrow).

### 6. Compare Modal

**Purpose:** Side-by-side comparison of up to 3 vehicles.

**Layout:** `max-width: 1200px`, `width: 96%`.

**Slot picker:** 3-col grid gap 12px. Empty slot = 1px dashed border, gray "+ Añadir vehículo" placeholder. Filled slot = solid border, contains thumbnail (aspect-ratio 4/3) + name 14px + price mono 11px muted + `×` remove button top-right.

**Available list:** shown when < 3 slots filled. `repeat(4, 1fr)` grid gap 8px of picker buttons. Each has 40×30 thumb + name + price. Selected/full items are `disabled` with opacity 0.3.

**Compare table:** shown when ≥ 2 vehicles.
- Header row (`bg-alt` background): `grid-template-columns: 140px repeat(3, 1fr)`. Each vehicle cell has display name (16px weight 500) + sub "YEAR · Nuevo/Certificado" (mono 10px muted).
- Body rows: key on left (mono 10px muted uppercase, right-bordered) + values (mono 12px). Cells marked `.best` render in accent color, weight 500. Best-marking logic: highest power / lowest 0-100 time / highest top speed / lowest price.
- Rows: Motor, Potencia, Par motor, 0-100, Vel. máx., Transmisión, Tracción, Año, Kilometraje, Precio, Concesionario.

**Trigger:** floating `.compare-fab` bottom-left when `compareIds.length > 0`. Black bg, mono uppercase label + accent pill with count.

## Interactions & Behavior

- **Navigation:** Home ↔ Detail via card click / breadcrumb. No hard routing — single-page conditional render.
- **Persistence (all in `localStorage`):** `authentiq_lang`, `authentiq_screen`, `authentiq_vehicle` (id), `authentiq_mode` (buyer/dealer), `authentiq_compare` (JSON array of ids).
- **Dealer mode:** toggles `body.b2b` class which swaps to a dark palette (`--bg #0d0c0a`, `--ink #f2eee7`, `--line #2a2620`) via CSS variables.
- **Language toggle:** flips a React context; every string is looked up via `t(key)` from the ES/EN dictionary.
- **Notification toast:** appears bottom-center for 3s on successful booking / offer submission. Black bg, mono 12px, `animation: modalIn 300ms`.
- **Viewer drag:** captures pointer at mousedown, tracks delta over viewer width, maps to 360° rotation. Uses `mousemove/mouseup` on `window` (not the element) so drags outside the viewer still register.
- **Color picker:** updates the tint overlay on the 360° viewer in real time.
- **Live view count:** simulated with `setInterval(4000)` adding a random `±1`. In production, wire to a websocket / polling endpoint.

**Timings/easing (from CSS custom property `--ease: cubic-bezier(.22,.61,.36,1)`):**
- Card hover: 400ms translate + 700ms image scale
- Modal in: 400ms opacity + translateY
- Button hover fills: 250ms
- Message enter: 300ms
- Chat panel slide: 400ms translateX
- Hero background drift: 30s infinite alternate
- Hero vehicle float: 6s infinite alternate

## State Management

Top-level `App` component owns:
- `screen: "home" | "detail"`
- `vehicle: Vehicle` (currently selected)
- `mode: "buyer" | "dealer"`
- `modal: null | "calendar" | "offer" | "compare"`
- `chatOpen: boolean`
- `notification: string | null`
- `compareIds: string[]`
- `tweaks: { viewerVariant, chatVariant, offerVariant }`

`LangProvider` (React context) provides `{ lang, setLang, t }` to the tree.

For a real implementation:
- Move vehicle catalog to a REST/GraphQL endpoint (`GET /vehicles`, `GET /vehicles/:id`).
- Chat should use websockets (Socket.IO / Ably / Pusher) with real advisor identity and typing indicators.
- Test drive booking should hit a scheduling backend that enforces slot availability atomically.
- Offer submission should create a lead record and trigger dealer notification (email/SMS).
- Auth: buyer accounts + dealer accounts + role gating for the Dealer mode.
- Consider React Router / Next.js App Router for real navigation (currently single-page).

## Design Tokens

**Colors (light / default):**
```css
--bg:        #faf8f5;   /* base warm off-white */
--bg-alt:    #f2eee7;   /* subtle raised surface */
--ink:       #0a0a0a;   /* near-black primary */
--ink-2:     #1a1917;   /* dark surface */
--ink-soft:  #3d3a35;   /* body text */
--muted:     #6b6660;   /* secondary text */
--line:      #d9d3c8;   /* primary borders */
--line-2:    #ebe6dc;   /* subtle borders */
--accent:    #c8a24b;   /* muted champagne — brand */
--accent-deep: #a4832e;
--danger:    #b04a3a;
--success:   #4b7a5c;
```

**Colors (dark / dealer mode override):**
```css
--bg:        #0d0c0a;
--bg-alt:    #17150f;
--ink:       #f2eee7;
--ink-2:     #ebe6dc;
--ink-soft:  #c8c3ba;
--muted:     #8a857c;
--line:      #2a2620;
--line-2:    #1e1c17;
```

**Type stack:**
- Display: `"Inter Tight", "Helvetica Neue", sans-serif` (Google Fonts: Inter Tight — weights 300, 400, 500, 600, 700 + italic 400)
- Mono: `"IBM Plex Mono", ui-monospace, monospace` (Google Fonts: IBM Plex Mono — weights 400, 500)
- Font-feature-settings: `"ss01", "cv11"` on Inter Tight; `"zero"` on IBM Plex Mono
- Base body: 15px / line-height 1.4

**Type scale (as used):**
- Hero title: `clamp(72px, 12vw, 180px)` weight 500 tracking -0.04em
- Section h2: 36–44px weight 400–500 tracking -0.02em
- Detail title: 72px weight 400 tracking -0.03em
- Card title: 20px weight 500 tracking -0.01em
- Body: 13–15px
- Mono labels: 10–12px, `letter-spacing: 0.05–0.15em`, uppercase

**Spacing scale (as used, no formal step):** 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 60, 80, 100 px.

**Border radius:** almost always **0px** (editorial flat style). Exceptions: 50% for circular avatars/swatches/dots, 999px for pill toggles, 20px for compare count badge.

**Shadows:**
- Card float: `0 10px 40px rgba(10,10,10,0.2)` (chat FAB, compare FAB)
- Chat panel: `-20px 0 60px rgba(10,10,10,0.08)`
- Hero vehicle drop-shadow: `0 30px 60px rgba(10,10,10,0.25)`
- Text-shadow on image labels: `0 1px 8px rgba(0,0,0,0.6)`

**Animations to preserve:**
- `heroDrift` — 30s ease-in-out infinite alternate, scale 1.02→1.08 on hero background
- `heroFloat` — 6s ease-in-out infinite alternate, translateY ±4px on hero vehicle
- `pulse` — 1.8s infinite, opacity 1→0.4 + scale 1→1.4 on live-dot indicators
- `bounce` — 1.4s infinite, staggered translateY on typing dots
- `msgIn` — 300ms ease, opacity + translateY 6px on chat messages
- `slideIn` — 400ms ease, translateX 100%→0 on chat panel
- `modalIn` — 400ms ease, opacity + translateY 20px on modals
- `fadeIn` — 400ms ease, opacity + translateY 6px on screen changes

## Assets

**Vehicle photography** (all in `assets/`):
- `porsche-911-gt3.jpg` — Porsche 911 GT3 RS studio white/green
- `porsche-911-gt3-alt.jpg` — GT3 RS studio grey/red (alt rotation frame)
- `porsche-911-st.jpg` — 911 S/T dynamic on-bridge shot
- `porsche-911-three-quarter.jpg` — 911 detailing three-quarter
- `porsche-interior.jpg` — 911 interior/cockpit
- `cayenne-turbo-gt.jpg`, `cayenne-turbo-gt-2.jpg` — Cayenne Turbo GT
- `taycan-turbo-s.jpg`, `taycan-turbo-s-2.jpg`, `taycan-turbo-s-alamy.jpg` — Taycan Turbo S
- `bmw-m4.jpg`, `bmw-m4-2.jpg` — BMW M4 Competition
- `amg-gt.jpg`, `amg-gt-2.jpg` — Mercedes-AMG GT
- `audi-etron-gt.jpg`, `audi-etron-gt-2.jpg` — Audi RS e-tron GT
- `macan-gts.jpg` — Porsche Macan GTS
- `panamera.jpg`, `panamera-2.jpg` — Porsche Panamera
- `hero-highway.jpg` — hero background loop

**Reviewer avatars:**
- `reviewer-1.jpg`, `reviewer-2.jpg`, `reviewer-3.jpg`

All images sourced via license-filtered image search (CC/PD-licensed). For production, **replace with your own or dealer-provided studio photography** — ideally a 24-36 frame turntable sequence per vehicle for a true 360° effect. Reviewer avatars should be replaced with real customer photos (with consent) or dealer-branded silhouettes.

**No custom icon library used** — arrows/chevrons/×/checkmarks are text glyphs or minimal SVG. If your codebase already has Heroicons / Lucide / etc., use them consistently.

**Map SVG:** hand-drawn stylized street grid (see `detail.jsx → RealisticMap`). For production, use Mapbox GL (Retro or custom dark style), Google Maps Static, or MapLibre with an OSM style — pin the dealer at real lat/lng from the vehicle's `location` object.

## Files

Design references included in this handoff:

| File | Purpose |
|---|---|
| `AUTHENTIQ.html` | Main app shell — imports all scripts, sets up React root + LangProvider + Tweaks defaults |
| `styles.css` | Complete design system (design tokens, all components) |
| `i18n.jsx` | Bilingual dictionary + `LangProvider` context + `useT` hook |
| `data.jsx` | Vehicle catalog (8 models) + reviews array + silhouette SVG fallback |
| `nav-home.jsx` | Top nav + Home screen (hero, catalog grid, reviews) |
| `viewer.jsx` | Viewer360 (3 variants: rotate / gallery / split) + ColorPicker |
| `detail.jsx` | VehicleDetail screen + LocationMap + RealisticMap SVG + HistoryStrip |
| `calendar.jsx` | Calendar modal for test drives |
| `chat-offer.jsx` | ChatPanel + ChatBubble + OfferModal (3 variants: slider / form / auction) |
| `compare.jsx` | CompareModal side-by-side comparator |
| `tweaks_panel.jsx` | Starter component for the Tweaks side panel (skip in production) |

### Notes for implementation

1. The React setup in this repo is **Babel-in-browser** for prototyping only. Migrate to a real bundler (Vite / Next / Remix).
2. Components share globals via `Object.assign(window, {...})` at the bottom of each file. Replace with ES module imports.
3. There's a `useTweaks(defaults)` hook and `<TweaksPanel>` used to switch component variants for demo purposes. **Do not ship the Tweaks UI to production** — decide per-variant during handoff conversations with the product team, then bake the winning variant.
4. All copy is in `i18n.jsx`. Move to your i18n library of choice (`next-intl`, `react-intl`, `i18next`). Keys are already namespaced (`nav.*`, `hero.*`, `catalog.*`, `detail.*`, `cal.*`, `chat.*`, `offer.*`, `tweaks.*`, `location.*`).
5. The 360° viewer is **fake** (rotates through 2–4 stills). A real implementation should either (a) load a 24-36 image sequence per vehicle from a CDN and swap based on drag delta, or (b) use `@react-three/fiber` with a GLB per model.
6. Currency is hardcoded to USD. Add locale-aware currency formatting via `Intl.NumberFormat`.
7. Dates in the calendar are computed against `new Date()`. Wire to a real availability API before shipping.
