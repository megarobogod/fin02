# Last Oath

A 3D browser game for a parent and their son to build together and learn from.

## Ground rules
- Plain HTML, CSS and JavaScript. Three.js comes from a CDN (see the import map in `index.html`, which also maps `three/addons/`). No build step, no installing packages, so it deploys to Vercel as a static site.
- Keep the code simple and well commented so a teenager can read and change it. Tuning numbers go at the top of each file.
- Controls are keyboard and mouse.
- Build in small steps: get one thing working before adding the next.
- Test in the browser after every change. `node serve.mjs` runs it locally at http://localhost:5173.
- Deploy with `vercel deploy last-oath --prod` (Vercel project `last-oath` on the megarobogod account).

## Game design (from the son's prompts)
- Post-apocalyptic open world in 3D, set in a run-down city.
- You play a medieval knight with a sword and shield.
- You mostly meet civilians and raiders. Angels (divine exterminators sent to wipe out the human race) are RARE and EXTREMELY dangerous.
- Killing an angel triggers a big cinematic execution: impact frames, slow motion, a cool kill.
- Sketched art style, high detail (not blocky).
- Emphasis on impacts and weak points.

## How those ideas are built
- **Sketched look**: `sketch.js` (paper + pencil hatching shader, windows painted on building walls) and `post.js` (ink outlines drawn from the depth image, boiling lines, impact frames). Holy light (gold) is the only bright colour.
- **Detail**: characters are built from smooth shapes in `shapes.js` (lathes, capsules, bevelled plates, feathered wings), not boxes.
- **Impacts**: hitstop, camera shake, impact frames, speed lines, comic sound words, stains that stay on the ground. Mostly `fx.js` and `post.js`.
- **Weak points**: every enemy is a set of "parts" (`combat.js`). Heads, hearts, cores and eyes take big damage; helmets, wings, masks and rings are armour that bounces the sword.
- **Rare angels**: `angels.js` schedules a "visitation" every few minutes (first after ~2.5–4 min). One angel at a time.
- **Execution**: `cinematic.js` takes over the camera and the knight when an angel's health hits zero.
- **People**: `humans.js` spawns camp members when you get within ~110m and removes them past ~150m, plus roaming gangs and wanderers on the street grid.

## Ideas for next
- Survivors who follow you to safety, or a hideout to bring them to.
- More raider types (a raider boss with a car-door shield?), and raiders that use the rooftops.
- A fourth angel (a giant Throne) and more execution variations per angel type.
- Day/night, rain, and indoor ruins you can walk into.
- A map, and a story that ends somewhere.
