# Flippin' Waffles 🧇🦆

A cozy, cute **3D browser game**: you are a white duck in an apron and a helicopter
beanie (with a lollipop) who runs a waffle delivery business in **Yosemitea National Park**.

Cook each order by hand — drag the flour and sugar into the bowl, stir the whisk in
circles, tip the batter onto the iron, flip it on the beat, drop the toppings where you
like them — then load the box onto your scooter and race the valley Mario-Kart style:
drift-boosting, hopping fences, grinding rails, launching off bouncy mushrooms, riding a
banked wooden flume, cutting through a hollow sequoia, and quacking at the bears who
want your waffles.

Everything is modelled and lit smoothly and roundly; the **pixel look is a filter** —
the scene renders to a low-resolution buffer that gets bloomed, colour-quantised and
scaled back up with nearest-neighbour sampling.

No build step and nothing to install: open `index.html`, or serve the folder
(`npm start`). Three.js ships in the repo.

![title](docs/title.png)

| The kitchen | On the road |
|---|---|
| ![kitchen](docs/kitchen.png) | ![ride](docs/ride.png) |

## How to play

**The loop:** cook the order → deliver it → ride home → next order. Three orders a day.
Progress saves in your browser. Cozy mode: there are no fail states, only smaller tips.

### Kitchen — drag and drop
| Action | How |
|---|---|
| Add flour / sugar / egg / milk | **drag** the ingredient into the bowl (match the ticket) |
| Stir | **drag the whisk in circles** inside the bowl, let go in the green zone |
| Pour | **drag the bowl** over the waffle iron and it tips itself |
| Flip the iron | **tap the iron** (or Space) when the meter is in the **golden zone** |
| Open the iron | tap it again in the golden zone — early is pale, late is burnt |
| Toppings | **drag** them onto the waffle; they land where you drop them (drag one from the tray again to remove it) |
| Box it | **drag the waffle** into the delivery box |

### Scooter
| Action | Keys |
|---|---|
| Drive / brake / reverse | W / S or ↑ / ↓ |
| Steer | A / D or ← / → |
| Hop | Space — clears fences |
| Drift | hold Space while steering as you land, release for a mini / super / **ULTRA** turbo |
| Trick in the air | Shift (or E) — lean for spins and flips; land it for a boost |
| Grind a rail | hop onto a rail, a bridge railing or a fallen log; Space to hop off |
| Quack (scares bears) | H |
| Rescue when stuck | R |
| Pause / mute | Esc / M |

### Out in the park
- **Boost pads** on the paved loop, **bouncy mushrooms** that fling you skyward.
- **The flume** — a long banked wooden chute off the Glacier Point ridge. Gravity pulls
  you to the middle; carve the walls to keep your speed.
- **A hollow sequoia tunnel** and dirt shortcuts that are slower underfoot but shorter.
- **A canyon gap** on the river shortcut: hit the boost pad, clear the jump, fly the ring.
- **Air rings** for a boost, **syrup tokens** for coins, both worth style points that
  become tips at the end of a run.
- **Bears** roam the meadows with their cubs and will chase you when you carry waffles.
  Honk to scare them off, or they take one.
- A **radar minimap** shows the roads, your destination, nearby bears and tokens.

## Tech
- Vanilla JavaScript + [Three.js](https://threejs.org) r158 (vendored in `vendor/`).
- **Round models, pixel filter.** Characters and props are built from spheres, capsules,
  tori and rounded boxes, merged per material family so a whole character is 1–3 draw
  calls. The scene is lit with a sun, a sky/ground hemisphere, a fill light and a
  procedurally generated IBL probe, tone-mapped with ACES, then pushed through a
  bright-pass bloom and a quantise + vignette pass at ~240 lines of vertical resolution.
- **Springy animation.** A small spring solver drives squash-and-stretch, suspension
  travel, lean and every UI pop, so nothing moves on a plain linear lerp.
- **Procedural world.** A heightfield valley with a river, granite rims, Half Dome and El
  Capitan, waterfalls, roads rasterised into the terrain, bridges, a banked chute,
  ramps, rails, campsites and ~1350 instanced trees.
- **Procedural audio** (WebAudio): engine, quacks, sizzle, drift sparks, two chiptune loops.

```
index.html        page + HUD markup
src/style.css     HUD styling
src/util.js       math, RNG, noise, input
src/pixel.js      renderer, lighting rig, the pixel post-process filter, particles
src/models.js     rounded model library (duck, scooter, bears, trees, buildings, waffles…)
src/world.js      terrain / roads / props / colliders / traversal features
src/kart.js       scooter physics, springs, drift, tricks, rails, camera
src/bears.js      bear AI
src/kitchen.js    drag-and-drop cooking
src/orders.js     recipes, customers, scoring
src/hud.js        DOM overlay + minimap
src/audio.js      procedural sound & music
src/main.js       game states & loop
tools/build.js    bundles everything into dist/flippin-waffles.html (single file)
```

`node tools/build.js` produces one self-contained HTML file you can send to anyone.
