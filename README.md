# Solmar City — an open-world crime game

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/lkk667/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/lkk667/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An entry for the [Make GTA 6 bounty](https://make.fun/bounty/gta6-01): a complete
open-world crime game that plays offline in a desktop browser from static files.
No build step, no network requests — serve `game/` with any static server and
open `game/index.html`.

## The game

**Solmar City** is a sun-soaked fictional coastal city. Mara Vega owes the
Ferraro crew $4,000, and the city always collects. Work five story missions —
from a first delivery at Cafe Luna to the Harbor Score — to buy your freedom,
then keep roaming.

Everything is original: the city, the characters, the vehicles, the names and
the story. Nothing is taken from Rockstar Games or any other commercial game.

## What's in the world

- **A city to explore** — a road grid of pastel towers, parks, car parks, a
  beach and an ocean, with palm-lined sidewalks and the Solmar Tower landmark.
- **On foot and by car** — third-person walking and running with mouse-orbit
  camera, plus arcade driving. Walk up to any parked or traffic car and press
  **E** to steal it.
- **Traffic and pedestrians** — cars drive the grid and turn at intersections;
  pedestrians stroll the sidewalks and scatter when shots are fired.
- **Wanted level (0–5 stars)** — crimes raise the heat; Solmar PD cruisers
  chase and ram you. Get caught on foot or cornered in a car and you're
  **BUSTED**. Lose the cops to cool off.
- **Missions and story** — 5 missions with HUD objectives and a gold marker:
  timed delivery, car theft getaway, losing the cops, collecting five drops,
  and the harbor finale. Cash rewards and a mission counter track progress.
- **Combat** — punch (F) and a pistol with limited ammo (click to shoot, R to
  reload). Health, ammo and cash pickups respawn around the city.
- **HUD with minimap** — wanted stars, cash, health, ammo, mission objective
  with distance, speed while driving, and a live canvas minimap (traffic,
  police, pedestrians, mission marker).
- **Start screen, pause, save** — progress autosaves to localStorage; continue
  a saved game from the start screen.
- **Sound** — all effects and the engine/siren are synthesised with Web Audio;
  no audio files.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Mouse (drag) | Orbit camera |
| Shift | Run |
| Space | Handbrake |
| E | Steal / exit car |
| Click | Shoot pistol |
| F | Punch |
| R | Reload |
| Esc / P | Pause |
| M | Mute |

## Run it

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

Or any static server pointed at `game/`.

## Structure

- `game/index.html` — page, HUD DOM, import map for three.js
- `game/js/main.js` — bootstrap, game loop, menus, staging hooks
- `game/js/state.js` — shared game state and helpers
- `game/js/city.js` — the city: streets, buildings, beach, landmarks, collision
- `game/js/player.js` — on-foot character and third-person camera
- `game/js/vehicles.js` — car factory, driving physics, stealing
- `game/js/traffic.js` — traffic cars and pedestrians
- `game/js/police.js` — wanted level, police chases, busted
- `game/js/missions.js` — the five story missions and the gold marker
- `game/js/combat.js` — pistol, punching, pickups
- `game/js/hud.js` — HUD and minimap
- `game/js/audio.js` — synthesised Web Audio sound
- `game/js/input.js` — keyboard and mouse
- `game/js/save.js` — localStorage save/load
- `game/vendor/three.module.min.js` — vendored three.js 0.170.0

## License

MIT — see `LICENSE`.
