[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/lkk667/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/lkk667/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

# Solmar City

An original open-world crime game built for the [Make GTA 6 bounty](https://make.fun/bounty/gta6-01) on make.fun. A golden-hour coastal city to explore on foot and by car: steal cars, outrun the Solmar PD, run five story missions, and build your cash — all in the browser, from static files, with no network request.

## The game

- **The city** — a road-grid city of pastel towers, parks, car parks, a beach and ocean, with landmarks of its own: Solmar Tower, Cafe Luna (neon storefront), the Hideout garage, Solmar Harbor and Solmar General hospital.
- **On foot and by car** — third-person over-shoulder mouse-orbit camera, walk/run, arcade driving with a handbrake, enter/exit any parked car.
- **Wanted level** — heat from 0 to 100 becomes 0 to 5 stars. Stealing a car puts you straight on 2 stars; black-and-white cruisers chase, ram and flash big glowing light bars, and getting cornered on foot means BUSTED. Lie low and the heat cools off.
- **Five story missions** — a delivery, a car-theft getaway, losing the cops, five drops to collect, and a harbor finale, with cash rewards, a bright gold beacon marking the target, free roam and replay after the finale.
- **Combat** — a pistol with magazine and reserve ammo, reload, punch, muzzle flash bound to the gun barrel, tracers, impact particles, camera shake, and health/ammo/cash pickups.
- **HUD and sound** — wanted stars on a backing panel, cash, health and ammo with icons, objective with distance, speed in km/h while driving, a live minimap with flashing police dots, toasts, and fully synthesized WebAudio (engine, siren, gunshots, jingle, crashes, horn).
- **Save** — autosaves to localStorage; Continue from the menu picks up where you left off.

## How to play

Serve `game/` with any static server (for example `node serve.ts` from this repo, or `python3 -m http.server` inside `game/`) and open `index.html` in desktop Chrome.

- **On foot:** WASD move · Shift run · click to lock mouse · move mouse to look · left-click shoot · F punch · R reload · 1 pistol / 2 fists
- **Driving:** WASD drive · Space handbrake · E get in / out of a car
- **M** toggles sound.

## Layout

- `game/index.html` — the page, HUD and menus
- `game/js/state.js` — shared state, constants, wanted heat
- `game/js/city.js` — the city, landmarks, collision, blob shadows
- `game/js/player.js` — on-foot character and over-shoulder camera
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
