# TraffIQ Web V2 Design System

## Product intent
TraffIQ is a road-intelligence and journey-safety product for East Africa. It helps a road user understand what is happening ahead, choose and follow a destination, share a live journey, report road conditions quickly, and contribute useful movement data back to the network. The experience must feel useful while moving, understandable at a glance, and credible enough for institutions and transport partners.

This design system governs both web surfaces:

- `traffiq.tukutuku.org`: public product, trust, download/open-app, partner and API landing surface.
- `traffiqweb.tukutuku.org`: operational web app for search, route preview, journeys, live traffic, reporting, saved places and journey sharing.

The two surfaces use one visual language but different information density. Public pages explain. The web app acts.

## Experience principles

1. **Map first, destination first.** In the operational app the map is the canvas, but the first obvious action is always destination search.
2. **One primary action at a time.** Before a journey: choose destination. After route preview: start journey. During a journey: stay informed. Reporting is always available but never competes with the primary journey action.
3. **Fast enough for a moving user.** Critical controls have 44px minimum targets, short labels, strong contrast and minimal text entry.
4. **Human place language.** Prefer named roads, landmarks, neighbourhoods and destinations over raw coordinates.
5. **Confidence, not noise.** Distinguish live, recent, estimated, community-reported and offline/cached information.
6. **Resilient by design.** Losing data or location must not destroy an active journey. Show clear states: `GPS on`, `location paused`, `offline`, `syncing`, `synced`.
7. **No surprise journey starts.** A journey requires an explicit user confirmation after destination and travel mode are set.
8. **Completion is complete.** Ending a journey immediately shows the full summary without requiring a hidden sheet pull.
9. **Regional reality.** Design for low bandwidth, intermittent data, Android-first usage, boda/matatu/bus travel, landmark-led navigation and shared devices.
10. **Accessible by default.** WCAG AA contrast, reduced-motion support, keyboard navigation on web, visible focus states, non-colour status cues.

## Visual language

### Brand
TraffIQ should feel like a modern mobility utility, not a generic SaaS dashboard. Retain the recognisable deep-purple and electric-lime brand, but use them more deliberately.

### Colour roles

- `road-950` `#10071F` — deepest brand background and night-map framing.
- `road-900` `#171022` — app chrome / primary dark surface.
- `road-800` `#21162F` — elevated surfaces.
- `road-700` `#30203F` — hover / selected dark surfaces.
- `signal-500` `#84E539` — primary action, live/safe signal and brand accent.
- `signal-400` `#A4F064` — hover/highlight.
- `signal-100` `#EAF9DA` — light accent surface.
- `sky-500` `#4F9DFF` — route/position and informational state.
- `amber-500` `#F6B73C` — caution/congestion.
- `red-500` `#F0525F` — accidents, danger and destructive actions.
- `surface-light` `#F7F8FA` — public light surface.
- `ink-950` `#16131B` — primary light-mode text.
- `ink-600` `#6C6573` — secondary text.

Do not use lime as decorative text everywhere. Reserve it for action, live status, selected state and key product emphasis.

### Typography

Use `Roboto Flex` on web to align with Android Material 3. Headings are compact, confident and sentence-case. Body copy stays short.

- Display: 56–72px desktop / 40–48px mobile, weight 720–780.
- H1 app/landing: 40–56px desktop / 32–40px mobile.
- H2: 28–40px.
- Body: 15–18px.
- Labels: 12–14px, medium/semibold.
- Data: tabular numerals where supported.

### Icons

Use **official Material Symbols Rounded**. Do not introduce emoji, Font Awesome, random icon packs or decorative Unicode symbols for production UI. Icons must have text labels when meaning could be ambiguous.

### Shape

Material 3 influenced but not stock Material:

- Primary controls: 16–20px radius.
- Cards/panels: 20–28px radius.
- Pills/chips: full radius.
- Modal/sheet: 28px top radius on mobile, 24–28px all corners on desktop.
- Borders: 1px, subtle; avoid heavy shadows.

### Elevation

Use translucent map overlays with restrained blur. Public pages use solid, calm surfaces. Avoid excessive glassmorphism. A map control should remain legible above satellite/light/dark tiles.

## Public landing information architecture

1. Global nav: Product, How it works, For organisations, Developers, Open TraffIQ Web.
2. Hero: clear promise — know what is happening on the road before and during a trip.
3. Live-product preview: destination search, route card, current traffic/incident states, report CTA.
4. Four user outcomes: plan, move, report, share.
5. Journey flow: Search destination → preview route → choose travel mode → start → live journey → summary.
6. Road intelligence: crowdsourced + network/reference data, with source freshness language.
7. Organisation use cases: transport operators, programmes, road-safety teams, researchers/partners.
8. Developer/API block: first-party TraffIQ API and integration statement.
9. Trust/privacy block: user control, data minimisation, location only when needed/authorised.
10. Final CTA to `traffiqweb.tukutuku.org`.

## Operational web app information architecture

### Desktop

- Left rail (72px): TraffIQ mark, map/home, journeys, reports, saved places, profile.
- Search / destination command bar at top-left over map.
- Context panel (360–400px) below search for results, route preview or active journey.
- Map remains visible at all times.
- Right-side small utilities only for layers/theme/location.
- Persistent report action at lower-right.

### Mobile

- Full-screen map.
- Top floating destination search.
- Bottom contextual sheet in three explicit states: `peek`, `half`, `full`.
- During an active journey, the sheet defaults to `peek` with ETA/distance/status and a large `End journey` action available without a manual drag.
- Reporting opens a dedicated quick-action sheet; it never blocks dismissal.

## Core flows

### Destination and route
1. Current location resolves.
2. User taps search.
3. Show nearby/recent/saved destinations before typing.
4. Autocomplete biases to current location.
5. Selecting destination immediately requests a road route, not a straight line.
6. Route preview shows destination, ETA, distance, known reports and route confidence/source.
7. User chooses mode if current/preferred mode is not already suitable.
8. User explicitly taps `Start journey`.

### Active journey
- Prominent ETA, remaining distance and current road/place.
- Compact connection status: `Live`, `GPS weak`, `Offline – recording`, `Syncing`, `Synced`.
- Show only route-relevant alerts by default.
- Do not auto-start because GPS moves.
- If data drops, keep recording locally and communicate this in one calm status line.

### Reporting
- Primary categories: Traffic, Accident, Hazard, Roadwork, Closure, Police checkpoint.
- One tap selects category; optional photo/note follows.
- Existing nearby report card has `Still there`, `Cleared`, and explicit dismiss (`X` / swipe) actions.
- Never trap the user in the nearby-report prompt.

### End journey
Immediately render the complete journey result: origin, destination, distance, duration, route, alerts encountered, reports contributed, sync state and share controls. No hidden content requiring a sheet pull.

## Components

### Destination command bar
- 52–56px height.
- Material `search` + current location affordance.
- Placeholder: `Where are you going?`
- Results carry name, secondary place context and distance where available.

### Route card
- Destination name first.
- ETA is the largest metric.
- Distance and travel mode secondary.
- Known route alerts shown as compact chips.
- Primary `Start journey` button spans available width on mobile.

### Status chip
Status always includes icon + label, e.g. `cloud_done Synced`, `location_off Location paused`.

### Report button
High visibility but secondary to journey action. Use `report` symbol. In an active journey, it remains reachable by thumb.

### Incident marker
Use icon + category colour + freshness. Avoid emoji markers.

## Motion

150–220ms for control transitions; 260–360ms for sheets/panels. Respect `prefers-reduced-motion`. Live pulses must be subtle and not continuous on large areas.

## Content tone

Short, concrete and situational. Prefer `Location paused. Your journey is still saved on this device.` over technical GPS/network language. Prefer `No reports on this route yet` over `0 incidents`.

## Stitch generation instruction

When this DESIGN.md is imported into Google Stitch, generate a coherent responsive system rather than disconnected mockups. Create and connect these screens/states: public landing, sign-in/create account, destination search, search results, route preview, travel-mode selector, active journey, quick report, nearby-report verification, offline/location-paused state, end-journey summary, journey history, saved places, shared-journey viewer, profile/settings and desktop variants. Preserve the TraffIQ mark and brand; use Material Symbols Rounded and the colour roles above. Do not invent backend features that are not represented in the TraffIQ product.