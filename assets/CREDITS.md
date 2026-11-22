# Character models

- `Soldier.glb` (the armoured raiders) and `Michelle.glb` (the survivors) are free
  rigged characters from the three.js examples (`examples/models/gltf`,
  https://github.com/mrdoob/three.js), made with Adobe Mixamo.
  Check the Mixamo terms (https://www.mixamo.com) if you ever sell the game.

## Using your own character

`src/people.js` accepts any rigged `.glb` whose bones use Mixamo or Ready Player Me
names (`Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftArm`,
`LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot` and the right-hand
versions, with or without a `mixamorig` prefix), standing in a T-pose.
Put the file in this folder, add a line to `MODELS` in `src/people.js`
(set `flip: true` if the character faces backwards), and use its name in
`src/humans.js` where `new Skin(...)` is called.
