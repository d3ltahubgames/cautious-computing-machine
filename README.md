# Bastion Quarter — Tactical FPS

A complete, playable, round-based 5v5 tactical shooter (Valorant-inspired) built with
plain JavaScript and Three.js. No build step, no bundler, no dependencies to install —
open one HTML file and play.

## Running it

**Option A — just double-click:**
Open `index.html` directly in Chrome, Edge, or Firefox. Everything (including
Three.js) loads from a CDN, and every sound effect is generated at runtime with the
Web Audio API, so there are no other assets to fetch.

**Option B — VS Code Live Server (recommended):**
1. Open this folder in VS Code.
2. Install the "Live Server" extension (if you don't have it).
3. Right-click `index.html` → "Open with Live Server".

Either works. Live Server just avoids any browser-specific quirks with
`file://` pages; nothing in this project actually requires a server.

You need an internet connection on first load (to fetch Three.js from
`cdnjs.cloudflare.com`); after that, everything else runs locally in the browser.

## Controls

| Key / Input | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `Shift` (hold) | Walk (slower, quieter, tighter accuracy) |
| `Ctrl` (hold) | Crouch |
| `Space` | Jump |
| Left Click | Fire |
| Right Click (hold) | ADS / scope (zooms on the sniper) |
| `R` | Reload |
| `1` `2` `3` `4` | Switch weapon (Pistol / SMG / Rifle / Sniper) |
| `Q` | Throw Flash |
| `E` | Throw Smoke |
| `F` (hold) | Plant the spike (while standing on a site, before it's planted) |
| `B` | Open/close the buy menu (buy phase only) |
| `Esc` | Release the mouse |

Click anywhere on the page once to lock your mouse and deploy.

## How a match works

- You play as an **Attacker**, alongside 4 AI teammates, against 5 AI-controlled
  Defenders. First team to **5 rounds** wins.
- Each round: a 20-second **buy phase** (spend credits, no combat), then a
  100-second **action phase**.
- Attackers win a round by planting the spike and letting it detonate (45s fuse),
  or by eliminating all defenders.
- Defenders win by defusing the spike, eliminating all attackers before the spike
  is planted, or running out the clock.
- Credits carry over between rounds: +200 per kill, a win bonus, an escalating
  loss bonus, and a small bonus for planting even on a lost round. Bots buy
  gear for themselves with the same economy.

## What's implemented

- Full first-person controller: WASD/mouse-look with pointer lock, walk/crouch/jump,
  wall-slide collision against the whole map.
- 4 weapons (Pistol, SMG, Rifle, Sniper) with distinct damage, fire rate, magazine
  size, spread/recoil bloom, reload times, and prices. Headshots do bonus damage
  via real hitbox raycasting (a small head sphere vs. a larger body cylinder).
- Muzzle flashes, bullet tracers, hit markers, ammo counter, directional damage
  indicators.
- 100 HP + purchasable Light/Heavy shields.
- Two throwable abilities: **Flash** (blinds anyone looking toward it, teammates
  included, just like the real thing) and **Smoke** (a 15s vision-blocking cloud
  that bots' sightlines genuinely can't see through).
- 9 AI bots with a real state machine: they path across the map using a
  waypoint graph, take lanes (A / Mid / B), peek and pause at chokepoints, spot
  and engage with human-like (not perfect) aim, fall back when low on HP,
  auto-buy gear, plant, and rotate + defuse when the spike goes down on the
  other site.
- One full two-site map ("Bastion Quarter") — mid, two flanking link corridors,
  a back rotation corridor, and crates/walls everywhere for cover — built
  procedurally out of styled geometry (warm plaster walls, teal/coral site
  accents).
- Every sound (gunshots per weapon, footsteps, hit/kill confirms, reloads, the
  accelerating spike beep, flash/smoke) is synthesized live with the Web Audio
  API — nothing is loaded from disk.
- Buy menu, minimap (with a live-spotted indicator for defenders your team can
  currently see), kill feed, plant/defuse progress bar, round timer/score, and
  a win/lose screen with a one-click restart.

## Project layout

```
index.html                 Entry point + HUD markup
css/style.css               HUD visual style
js/core/                    Math/collision/pathfinding utils, input, procedural audio
js/world/                   Map data + the code that builds it into a Three.js scene
js/weapons/                 Weapon stats + the shared hitscan/raycast system
js/entities/                Player, Bot (AI), and the Flash/Smoke ability system
js/systems/                 Economy, round/phase state machine, HUD
js/Game.js                  Wires everything together and runs the main loop
js/main.js                  Boots the game on page load
```

Note: this build uses hand-built, styled low-poly models composed directly in
Three.js (not the assets from the shared Google Drive folder) — that let every
model, hitbox, and animation be guaranteed to load and work with zero external
dependencies. If you'd like, drop `.glb` files into a `models/` folder and I can
wire up `GLTFLoader` to swap in real meshes for the player viewmodel and bots.
