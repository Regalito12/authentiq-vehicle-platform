# AUTHENTIQ Web — UI Kit

A high-fidelity, click-thru recreation of the AUTHENTIQ web platform: the consumer-facing responsive marketplace for premium and pre-owned vehicles.

## What's covered

- `index.html` — mounts the app; loads the design tokens + all component files
- `Nav.jsx` — fixed 64px top nav with mode toggle & language switch
- `Home.jsx` — hero + catalog grid + reviews section (the main above-fold view)
- `Card.jsx` — vehicle catalog card
- `ReviewCard.jsx` — customer review card
- `Detail.jsx` — vehicle detail page with gallery + color picker + specs + actions
- `Buttons.jsx` — `<Btn>` (primary / ghost / small variants with growing arrow)
- `data.js` — abbreviated vehicle catalog (uses real photos from `/assets`)

## How to view

Open `index.html` — everything is inlined React via Babel. Design tokens come from `/colors_and_type.css` at the project root. All fonts load from Google Fonts.

## Fidelity notes

The kit is a **cosmetic recreation**, not the production prototype. Interactions are lightweight (click a card → go to detail, click Back → return home). The 360° viewer, chat panel, offer modal and comparison modal from the source prototype are not re-implemented here — they're documented in `source/HANDOFF.md` and their JSX lives in `source/`.

## What this UI kit deliberately omits

- Calendar modal
- Live chat slide-out
- Offer submission modal
- Side-by-side comparison
- Dealer B2B mode toggle
- Language switching (labels are Spanish)

Add these back by copying the corresponding JSX file from `source/` and wiring it into `Home.jsx` / `Detail.jsx`.
