[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/lkk667/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/lkk667/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

# Solmar City

A home-grown open-world crime game made for the [Make GTA 6 bounty](https://make.fun/bounty/gta6-01) on make.fun. It is a golden-hour city on the coast that you can wander on foot or by car: lift a ride, shake the Solmar PD, work through five story jobs, and grow your cash — all in a desktop browser, served from plain static files, with nothing fetched from the network.

## What is in the game

- **The city** — a grid of pastel towers, parks, car parks, a beach and the sea, with places that belong to it alone: Solmar Tower, the neon Cafe Luna, the Hideout garage, Solmar Harbor and Solmar General hospital.
- **Golden-hour mood** — a low warm sun throwing long real shadows, a dusk gradient sky, windows glowing, traffic lights, shopfronts and rooftop clutter; taxis, trucks and two-tone police cruisers whose light bars spill colour onto the road.
- **On foot and behind the wheel** — a third-person over-shoulder camera that orbits with the mouse, walking and running, arcade driving with a handbrake, and the freedom to get into any parked car you find.
- **Wanted level** — heat from 0 to 100 reads as 0 to 5 stars. Taking a car puts you straight on 2 stars; black-and-white cruisers chase, ram and flash their light bars, and getting cornered on foot means BUSTED. Stay out of sight and the heat fades.
- **Five story jobs** — a delivery, a getaway in a stolen car, losing the cops, five drops to pick up, and a finale at the harbor, with cash rewards, a bright gold beacon over the target, free roam and replay once the finale is done.
- **Combat** — a pistol with a magazine and spare ammo, reloading, punching, a muzzle flash fixed to the gun barrel, tracers, impact particles, camera shake, and health, ammo and cash pickups.
- **HUD and sound** — wanted stars on a backing panel, cash, health and ammo with icons, the objective with its distance, speed in km/h while driving, a live minimap with flashing police dots, toasts, and sound made entirely with WebAudio (engine, siren, gunshots, jingle, crashes, horn).
- **Save** — autosaves into localStorage; Continue on the menu picks up where you stopped.

## How to play

Serve `game/` from any static server (for example `node serve.ts` from this repo, or `python3 -m http.server` inside `game/`) and open `index.html` in desktop Chrome.

- **On foot:** WASD to move · Shift to run · click to lock the mouse · move the mouse to look · left-click to shoot · F to punch · R to reload · 1 pistol / 2 fists
- **Driving:** WASD to drive · Space for the handbrake · E to get in / out of a car
- **M** toggles sound.

## Layout

- `game/index.html` — the page, HUD and menus
- `game/js/state.js` — shared state, constants, wanted heat
- `game/js/city.js` — the city, landmarks, collision, blob shadows
- `game/js/player.js` — the on-foot character and over-shoulder camera
- `game/js/vehicles.js` — cars, driving, enter/exit/steal
- `game/js/traffic.js` — traffic cars and pedestrians who dodge cars
- `game/js/police.js` — wanted level, cruisers, BUSTED, officer figure
- `game/js/missions.js` — the five story missions
- `game/js/combat.js` — pistol, punch, pickups
- `game/js/hud.js` — HUD and live minimap
- `game/js/audio.js` — synthesized WebAudio sound
- `game/js/save.js` — localStorage autosave
- `game/js/input.js` — keyboard, mouse, pointer lock
- `game/js/main.js` — bootstrap, game loop, menus, staging
- `game/vendor/three.module.min.js` — Three.js 0.170.0, vendored
- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to the output directory and writes `dossier.json`

## License

MIT — see `LICENSE`.
