# Last Oath

The sky tore open and the city fell. Raiders rule its streets, and the last
survivors hide in the ruins. Now and then, something comes down from the light
to finish them. One knight still keeps an oath.

A 3D action game in a hand-drawn, sketchbook style. Plain HTML, CSS and
JavaScript with Three.js from a CDN. No build step.

Play it online: <https://last-oath-seven.vercel.app>

## Playing it on your own computer

Browsers won't run JavaScript modules from a file you double-click, so start the
little web server that comes with it:

```
node serve.mjs
```

Then open <http://localhost:5173>.

| Control | Does |
| --- | --- |
| `W` `A` `S` `D` | Walk (hold `Shift` to run) |
| Mouse | Look |
| Left click | Slash. Click again mid-swing to chain up to three |
| Hold left click | Charge a heavy slam, release to strike |
| Right click | Raise your shield. Raise it just as a blow lands to **parry** |
| `Space` | Roll. You can't be hurt mid-roll |
| `Q` (or middle click) | Lock on |
| `M` | Mute |
| `Esc` | Pause |

## The city

A grid of ruined streets around an old cathedral. Burnt cars, fallen lamp posts,
a skyscraper lying across the road, craters where angels purged whole blocks, and
a giant sword stuck in the ground where the first angel fell.

**Survivors** hide in camps (tarps round a fire) or wander the streets. They run
from raiders and angels. Kill the raider hunting one and you've **saved** them;
they'll thank you and patch up your wounds.

**Raiders** hold camps behind junk barricades, and roam the streets in gangs
hunting survivors. When they spot you they come for you instead, and if enough of
a gang dies the rest lose their nerve and run.

| Raider | What to know |
| --- | --- |
| **Thug** | Machete. Fast and fragile. A hit to the head does double damage. |
| **Crossbowman** | Keeps his distance. Parry a bolt and it flies back at him. |
| **Brute** | Huge, slow, sledgehammer, steel helmet that bounces your sword off. His **back** is unarmoured: roll behind him. |

## Angels

Angels are **rare**. Every few minutes the sky opens: the tear in the sky blazes,
a horn sounds, and one angel comes down in a pillar of light. Everyone runs. It
will kill anyone it catches, and two or three of its blows will kill you.

Your sword does very different things depending on **what part** it hits:

- **Glowing hearts and cores**: triple damage (CRACK!).
- **Halos**: snap off and stun the angel (SNAP!).
- **Wings, masks, rings**: armour. Your sword bounces off (CLANG).
- **Robes and bodies**: ordinary damage.

| Angel | What it does | How to beat it |
| --- | --- | --- |
| **Herald** | Lunges with a spear (three times in a row once it's hurt). Gold `!` = you can parry it. | Heart on its chest. Hit it too much and it folds its wings over the heart: parry it, or smash the guard with a heavy slam. |
| **Choir** | Floats out of reach and fires a beam of light. | Roll aside, or parry to throw the beam back. After firing it sinks down exhausted and turns slowly: its heart is on its **back**. Snap its halo and it can never fire again. |
| **Ophan** | A wheel of eyes. Rams you, and sends out shockwave rings. Red `!!` = you can't block it. | The rings are armour. Hit the eyes as they swing past. Break all of them and its core drops, bare. |

Land the killing blow and you get the **execution**: the world freezes in impact
frames, you leap and drive your sword through its heart in slow motion, its
wings tear away, and it bursts into a pillar of light. Your wounds close.

## How the code is laid out

| File | What's in it |
| --- | --- |
| `index.html` | The page, the HUD and menus, all the CSS |
| `src/main.js` | Starting up, input, the game loop, hitstop and slow-motion |
| `src/sketch.js` | The hand-drawn look: hatching, painted-on windows, the sky |
| `src/post.js` | The ink lines, impact frames, speed lines, cinema bars |
| `src/shapes.js` | Smooth shapes: lathes, capsules, blades, feathers, wings |
| `src/world.js` | The city: streets, buildings, camps, landmarks, collision |
| `src/knight.js` | You: the model, poses, sword combos, shield, roll, cape |
| `src/combat.js` | What your sword hits, and lock-on |
| `src/humans.js` | Survivors and raiders, and who spawns where |
| `src/angels.js` | The three angels, their weak points, and when they come |
| `src/cinematic.js` | The angel execution, shot by shot |
| `src/fx.js` | Particles, stains, CRACK! words, sword trail, debris |
| `src/camera.js` | The over-the-shoulder camera |
| `src/hud.js` | Bars, the angel's health bar, banners, hints, lock-on |
| `src/audio.js` | Every sound, made in code |
| `serve.mjs` | The little local web server |

Tuning numbers sit at the top of each file: attack damage and timing in
`knight.js` (`ATTACKS`), raider stats in `humans.js` (`KINDS`), angel health and
damage in `angels.js` (`TYPES` and `HIT`), and so on.

## Testing shortcuts

Add these to the end of the address, then reload:

- `#angel` makes a Herald come down after a few seconds. `#angel=choir` and `#angel=ophan` for the others.
- `#peace` means no angels at all.
- `window.GAME` in the browser console is the whole game.
