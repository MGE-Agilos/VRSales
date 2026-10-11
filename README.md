# Qlik in VR

A WebXR room (Meta Quest 3, but also PC and phone) where you stand **inside** your Qlik Cloud data. The Qlik associative
engine does all the work: every selection, made with a trigger pull on a value, a bar, a tower or a point, ripples through
the whole room. State colours follow Qlik Sense: green = selected, white = possible, light grey = alternative,
grey = excluded.

**Try it: https://mge-agilos.github.io/VRSales/**. No account needed.

## The room (you stand in the middle)

| Where | What | Why in VR |
|---|---|---|
| Front, top | Selection bar (back / forward / clear all, one chip per field) and KPIs | KPIs "roll" to their new value after each selection |
| Front | **Bar city**: dimension 1 × dimension 2 on a table (e.g. Category × Year) | Walk around it, lean over it; tabs on the table switch the column dimension |
| Left | Filter panes in an arc | Scroll with the stick |
| Right | **Globe**: every city is a tower (height = revenue, colour = margin %) | Grab it with the grip and spin it |
| Behind | **3D cloud**: every customer placed by 3 measures (X, Y, Z) | Walk into it; drop lines and floor shadows help read depth |
| All around | **Ring of time**: one tower per month, in a circle around you | Time surrounds you; each period keeps its place |

## Controls

- **Trigger**: select (click again to deselect). Pinching with hand tracking works too.
- **Stick** while pointing at a filter pane: scroll. At the globe or the cloud: rotate it.
- **Grip** on the globe or the cloud: grab it and spin it.
- Left stick: walk. Right stick: turn 30°.
- **B** back, **A** forward, **Y** clear all, **X** return to the centre.
- On PC: drag to look around, WASD to move (E/C up and down), click to select, mouse wheel to scroll, ⌫ to go back.
- On a phone: drag to look around, on-screen joystick to move, tap to select, drag a filter pane to scroll it,
  *Gyroscope* to look around by moving the phone.
- The buttons at the bottom of the screen jump to each visualisation (Centre, Bar city, Filters, Globe, Cloud, Overview).

## Online: https://mge-agilos.github.io/VRSales/

The room is published to GitHub Pages on every push to `main` (`.github/workflows/pages.yml`, build `vite.pages.config.js`).

- **Public copy (default, `?app=snapshot`), no account needed.** The data of the *Sales Analysis* app is exported to
  `assets/sales-snapshot.json` (2,329 order lines: category, product, country, city, customer, sales rep, supplier,
  shipper, month, sales, costs, quantities). A local associative engine (`src/demo.js`) recalculates it in the browser
  with the same figures as Qlik (revenue 1,578,642, 953 orders). Each visitor keeps their own selections. To refresh the
  copy, run `node dataviz/tools/export-snapshot.mjs` (uses the API key in `.env.local`), then commit and push.
- **Live data, for accounts on the tenant.** *Live data: sign in to Qlik Cloud* uses OAuth (single-page app + PKCE,
  `src/qlik-oauth.js`). A static page has no server, hence no proxy and no API key: each visitor signs in with their own
  Qlik Cloud account, gets their own engine session and selections, and only sees the apps they have access to.
- **Offline demo** (`?app=demo`): generated bike-sales data.

The OAuth client "Qlik en VR (GitHub Pages VRSales)" is registered on the tenant (Administration → OAuth). It only accepts
https://mge-agilos.github.io/VRSales/ and https://localhost:5173/dataviz/: if the site moves, add the new address there.

## Together: headset, PC and phones in the same room (local server)

Run the Vite dev server of the parent project on a PC, and open `https://<PC-IP>:5173/dataviz/` on every device on the
same Wi-Fi. Accept the certificate warning on each device.

- **Live shared selections.** All devices go through the same API key, hence the same Qlik engine session: a selection
  made anywhere (headset, PC, phone, even Qlik Sense open on the app) recalculates the room everywhere.
- **Presence.** Each person appears as a coloured head with their name, device and a ray towards what they point at.
  Their actions show up as notifications ("Maxime → Germany (Country)"), on screen and in front of your eyes in the
  headset. Set your name in the panel.
- **Follow.** In the *In the room* list, *Follow* shows what someone else sees, for example the person wearing the headset.

Presence goes through the Vite server (`presence-server.js`: POST `/presence`, SSE stream `/presence/stream`), with no
dependencies. It is not available on GitHub Pages. With local data (`?app=snapshot` or `?app=demo`), each device computes
its own data: presence works, but selections are not shared.

The local server is meant for the local network only: the `/qlik/` proxy acts with the API key. Exposing it to the
Internet (tunnel, port forwarding) would give anyone access to that account's Qlik apps. For remote participants, use a
VPN (e.g. Tailscale) or add authentication first.

## Connecting to Qlik Cloud (local server)

The Vite server acts as a **proxy**: the headset talks to `https://<PC>:5173/qlik/…`, and the PC adds the API key and
forwards to the tenant (REST and engine WebSocket). The key never leaves the PC.

`../.env.local` (at the root of the parent project, ignored by git; template in `.env.example`):

```
QLIK_TENANT=beyond-data-group-training.de.qlikcloud.com
QLIK_API_KEY=…
QLIK_APP_ID=771eef89-203b-47ab-a617-d5f9df6dccad
```

- `?app=<id>` opens another app (the drop-down lists the tenant's apps).
- The engine session belongs to the key's user: selections made in VR also show up in Qlik Sense open on the same app,
  and vice versa.

## Configuring what is shown

[`src/config.js`](src/config.js) holds a preset per app, built on its master items (`{ lib: '<id>' }`), fields
(`{ field: 'City' }`) or expressions (`{ expr: 'Sum(Sales)' }`). An app without a preset is configured automatically from
its fields: low-cardinality fields become filters, `Sum()` of numeric fields become measures, Latitude/Longitude fields
feed the globe, and a month field feeds the ring.

## Files

| File | Role |
|---|---|
| `src/main.js` | Scene, room layout, controllers, mouse and touch, refresh after each selection |
| `src/qlik.js` | Minimal JSON-RPC client for the QIX engine: ListObject, HyperCube, selections, Back/Forward/ClearAll |
| `src/qlik-oauth.js` | Qlik Cloud sign-in for the hosted page (OAuth SPA + PKCE, engine token exchange) |
| `src/demo.js` | Local associative engine: public copy of Sales Analysis and demo data |
| `src/config.js` | Per-app presets and automatic configuration |
| `src/viz.js` | Bar city, ring of time, globe, 3D cloud |
| `src/ui.js` | Filter panes, selection bar, KPIs, tooltip, notifications |
| `src/panel.js` | Canvas-drawn panels with clickable regions, 3D labels |
| `src/screen.js` | Navigation without a headset: viewpoints, touch joystick, keyboard, gyroscope, follow someone |
| `src/presence.js` | Other participants' avatars, publishing your own pose, notifications |
| `qlik-proxy.js` | Vite plugin (local server): `/qlik/…` proxy to the tenant with the key, and `/qlik-status` |
| `presence-server.js` | Vite plugin (local server): presence relay (POST + SSE stream) |
| `tools/export-snapshot.mjs` | Exports the public copy of Sales Analysis |
| `assets/land-110m.json` | Land outlines (world-atlas, Natural Earth) for the globe |

The promo video tooling (`video/`) stays local and is not published.
