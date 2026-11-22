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
- You play a medieval knight with a sword and shield, in FIRST PERSON (you see your own arms, sword and shield; the body is hidden except during the angel execution cutscene).
- You mostly meet civilians and raiders. Angels (divine exterminators sent to wipe out the human race) are RARE and EXTREMELY dangerous.
- Killing an angel triggers a big cinematic execution: impact frames, slow motion, a cool kill.
- Realistic, high-detail art (not blocky). It started as a sketched style and was changed to realistic.
- A very large map.
- Emphasis on impacts and weak points.

## How those ideas are built
- **Realistic look**: `materials.js` (lit "PBR" materials; brick, concrete, tarmac, rust, puddles and windows are made by shaders, no image files; a hazy sky; a low sun with real shadows) and `post.js` (ambient occlusion, bloom, film tone mapping, impact frames). Holy light (gold) glows and blooms.
- **Big map**: `world.js` plans a 25 x 25 block city and streams it: only blocks near you are built in full, far ones are plain boxes. Each block is built from its own seed so it always comes out the same.
- **Speed**: the game starts on Low on laptop graphics and lowers its resolution by itself if frames are slow (`adaptResolution` in `main.js`).
- **Detail**: characters are built from smooth, curved shapes in `shapes.js` (spline lathes, tapered limbs, bent plates, a lofted sword blade, feathered wings), never boxes. `finish()` smooths shading while keeping real corners sharp.
- **First person**: `camera.js` puts the camera at eye height. `knight.js` hides everything but the arms, sword and shield (`setFirstPerson`) and has its own first-person resting poses (`fpPoses`); attack poses are shared with the cutscene body so hit detection is unchanged.
- **Impacts**: hitstop, camera shake, impact frames, speed lines, sparks, blood and glowing ichor, stains that stay on the ground. Mostly `fx.js` and `post.js`.
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
