// =====================================================
// materials.js - the realistic look
//
// Everything is lit like the real world ("PBR": physically based rendering):
//   - colour (albedo): what colour the stuff itself is
//   - roughness: 0 is a mirror, 1 is chalk
//   - metalness: 0 for stone, cloth and skin, 1 for bare metal
// Light comes from the sun (with real shadows) and from the sky, which is
// turned into an "environment map" so shiny things reflect it.
//
// There are no picture files. Bricks, windows, cracked tarmac, rust and
// puddles are all worked out by little shader programs as each pixel is drawn
// (see CITY_SURFACE and GROUND_SURFACE below), so they stay sharp up close.
// =====================================================
import * as THREE from 'three';

export const GOLD_HEX = 0xf0b43c;   // holy light
export const INK_HEX = 0x14110e;    // soot black

// ---------- tuning: the light and the air ----------
export const SUN_DIR = new THREE.Vector3(-0.62, 0.36, -0.7).normalize();   // a low afternoon sun
const SUN_COLOR = 0xffd2a0;
const SUN_POWER = 3.4;
const ENV_POWER = 0.85;             // how much light comes from the sky itself
export const FOG_DENSITY = 0.0042;  // thicker = the city fades into dust sooner
// colours in "linear" light values (not the usual 0-255 hex)
const HAZE = [0.46, 0.39, 0.31];    // the dusty brown air at the horizon
const ZENITH = [0.17, 0.2, 0.25];   // straight up

// ---------- a tileable noise picture, made once at start-up ----------
// Four layers of blotchy noise in the red, green, blue and alpha channels,
// from big soft blotches (red) to fine grit (alpha). Shaders sample it to
// make dirt, stains, cracks and grain.
function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (n, seed) => {
    const a = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; }
    return a;
  };
  // smooth "value noise" that wraps round at the edges, so it tiles
  const layer = (cells, seed) => {
    const L = lattice(cells, seed);
    return (x, y) => {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const u = fx - ix, v = fy - iy;
      const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const g = (i, j) => L[((j % cells) * cells) + (i % cells)];
      const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
      return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
    };
  };
  const fbm = (cellsList, seed) => {
    const ls = cellsList.map((c, i) => layer(c, seed + i * 101));
    return (x, y) => {
      let v = 0, amp = 0.5, tot = 0;
      for (const l of ls) { v += l(x, y) * amp; tot += amp; amp *= 0.5; }
      return v / tot;
    };
  };
  const chans = [fbm([4, 8, 16, 32], 11), fbm([8, 16, 32, 64], 23), fbm([16, 32, 64, 128], 37), fbm([64, 128, 256], 51)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    for (let c = 0; c < 4; c++) {
      // stretch the contrast a little: fbm bunches up around the middle
      const v = (chans[c](x, y) - 0.5) * 1.7 + 0.5;
      data[i + c] = Math.max(0, Math.min(255, v * 255));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------- shader helpers shared by every surface ----------
const COMMON = /* glsl */`
uniform sampler2D tNoise;
uniform float uTime;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 noise4(vec2 p) { return texture2D(tNoise, p); }
// 1.0 on the grid lines of a pattern (mortar, joints), with soft edges so it doesn't flicker
float gridLines(vec2 uv, vec2 size, float width) {
  vec2 f = fract(uv / size);
  vec2 d = min(f, 1.0 - f) * size;
  float aa = max(fwidth(uv.x) + fwidth(uv.y), 0.002);
  return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, min(d.x, d.y));
}
// Bumps without a bump picture: tilt the surface normal by how fast the
// height H changes from one pixel to the next.
vec3 bumpNormal(vec3 pos, vec3 n, float H, float faceDir) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 dH = vec2(dFdx(H), dFdy(H));
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

// Per-piece surface types (set by world.js, one number per piece)
export const SURF = { GENERIC: 0, BRICK: 1, CONCRETE: 2, PLASTER: 3, STONE: 4, METAL: 5, WOOD: 6, ASH: 7, PAINT: 8, CLOTH: 9, RUST: 10 };

// The vertex half: pass the world position and normal on to the pixel half
const SURFACE_VERT = /* glsl */`
#include <fog_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vWP = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * wn);
  vSurf = surf;
  vWin = win;
}`;
const SURFACE_VERT_HEAD = /* glsl */`
attribute float surf;
attribute float win;
varying vec3 vWP;
varying vec3 vWN;
varying float vSurf;
varying float vWin;
`;

// ---------- the city: walls, windows, metal, wood ----------
// Works out sAlb (colour), sRough, sMetal, sH (height for bumps, metres) and sEmit (glow).
const CITY_SURFACE = /* glsl */`
vec3 n = normalize(vWN);
vec3 an = abs(n);
// "box mapping": lay the pattern flat on whichever way the face points
vec2 uv; float along;
if (an.y > an.x && an.y > an.z) { uv = vWP.xz; along = 0.0; }
else if (an.x > an.z) { uv = vec2(vWP.z, vWP.y); along = 1.0; }
else { uv = vec2(vWP.x, vWP.y); along = 1.0; }
float dist = length(vViewPosition);
float near = 1.0 - smoothstep(30.0, 70.0, dist);      // fine detail fades with distance
vec4 big = noise4(uv * 0.031);
vec4 mid = noise4(uv * 0.17);
vec4 fine = noise4(uv * 1.3);
int surf = int(vSurf + 0.5);
vec3 base = diffuseColor.rgb;
sAlb = base * (0.86 + 0.28 * mid.g);
sRough = 0.9; sMetal = 0.0; sH = 0.0; sEmit = vec3(0.0);

if (surf == 1 || surf == 3) {
  // bricks (and the bricks showing where plaster has fallen off)
  vec2 b = vec2(uv.x, uv.y);
  vec2 bs = vec2(0.24, 0.085);
  float row = floor(b.y / bs.y);
  b.x += mod(row, 2.0) * bs.x * 0.5;
  vec2 id = floor(b / bs);
  float mortar = gridLines(b, bs, 0.012) * near;
  float r = hash12(id);
  vec3 brick = base * (0.75 + 0.45 * r) * (0.9 + 0.2 * fine.a);
  vec3 bAlb = mix(brick, vec3(0.32, 0.3, 0.27), mortar);
  float bH = -0.006 * mortar + 0.002 * fine.a;
  if (surf == 1) { sAlb = mix(base * (0.85 + 0.3 * mid.g), bAlb, near); sH = bH; sRough = 0.92; }
  else {
    // plaster: smooth, stained, with patches broken away down to the brick
    float peel = smoothstep(0.66, 0.7, big.b * 0.6 + mid.r * 0.5);
    sAlb = base * (0.82 + 0.3 * mid.g);
    sH = 0.003 * fine.r;
    sRough = 0.85;
    vec3 under = vec3(0.3, 0.13, 0.08) * (0.75 + 0.45 * hash12(id));
    under = mix(under, vec3(0.3, 0.29, 0.26), mortar);
    sAlb = mix(sAlb, under, peel);
    sH = mix(sH, -0.015 + bH, peel);
  }
} else if (surf == 2) {
  // concrete: blotchy, pitted, with lines where the moulds joined
  sAlb = base * (0.78 + 0.34 * mid.r) * (0.92 + 0.16 * fine.a);
  float seam = along * gridLines(vec2(uv.x * 0.0 + 0.5, uv.y), vec2(1.0, 1.5), 0.02) * near;
  float pits = smoothstep(0.78, 0.86, fine.b) * near;
  sAlb *= 1.0 - 0.25 * seam - 0.3 * pits;
  sH = -0.004 * seam - 0.004 * pits + 0.002 * fine.a;
  sRough = 0.94;
} else if (surf == 4) {
  // cut stone blocks (walls), big square slabs (floors)
  vec2 bs = along > 0.5 ? vec2(0.9, 0.45) : vec2(0.75, 0.75);
  vec2 b = uv;
  if (along > 0.5) b.x += mod(floor(b.y / bs.y), 2.0) * bs.x * 0.5;
  vec2 id = floor(b / bs);
  float joint = gridLines(b, bs, 0.02) * near;
  sAlb = base * (0.82 + 0.3 * hash12(id)) * (0.88 + 0.24 * mid.g);
  sAlb = mix(sAlb, sAlb * 0.55, joint);
  sH = -0.01 * joint + 0.003 * fine.r;
  sRough = 0.82;
} else if (surf == 5 || surf == 10 || surf == 8) {
  // painted metal: rust eats through the paint, bare metal where it's scraped
  float rustAmt = surf == 10 ? 0.85 : surf == 8 ? 0.28 : 0.45;
  float rust = smoothstep(1.0 - rustAmt, 1.08 - rustAmt, mid.b * 0.7 + fine.r * 0.3);
  vec3 rustCol = vec3(0.13, 0.065, 0.035) * (0.7 + 0.6 * fine.g);
  sAlb = mix(base * (0.9 + 0.2 * fine.a), rustCol, rust);
  sRough = mix(surf == 8 ? 0.42 : 0.55, 0.92, rust);
  sMetal = mix(surf == 8 ? 0.15 : 0.5, 0.1, rust);
  sH = 0.0015 * rust * fine.b;
} else if (surf == 6) {
  // wood: long grain
  vec4 grain = noise4(vec2(uv.x * 3.0, uv.y * 0.12));
  sAlb = base * (0.7 + 0.5 * grain.a) * (0.85 + 0.3 * mid.r);
  sH = 0.002 * grain.a;
  sRough = 0.85;
} else if (surf == 7) {
  // charred stuff, tyres
  sAlb = base * (0.7 + 0.4 * fine.r);
  sRough = 0.95;
} else if (surf == 9) {
  // cloth: a fine weave
  float weave = sin(uv.x * 900.0) * sin(uv.y * 900.0) * near;
  sAlb = base * (0.85 + 0.25 * mid.g) * (1.0 + 0.06 * weave);
  sRough = 0.97;
}

// ---- windows, painted onto building walls ----
if (vWin > 0.5 && an.y < 0.4) {
  vec2 t = normalize(vec2(-n.z, n.x));
  float u = dot(vWP.xz, t) + 0.37;
  float v = vWP.y + 0.6;
  float seed = fract(vWin) * 97.0;
  vec2 cell = vec2(floor(u / 3.0), floor(v / 3.3));
  vec2 f = vec2(fract(u / 3.0), fract(v / 3.3));
  float rnd = hash12(cell + seed);
  float rnd2 = hash12(cell * 1.7 + seed + 3.1);
  float aa = (fwidth(u) + fwidth(v)) * 0.4 + 0.004;
  // soft-edged rectangle: 1 inside, 0 outside
  #define RECT(x0, x1, y0, y1) (smoothstep(x0 - aa, x0 + aa, f.x) * (1.0 - smoothstep(x1 - aa, x1 + aa, f.x)) * smoothstep(y0 - aa, y0 + aa, f.y) * (1.0 - smoothstep(y1 - aa, y1 + aa, f.y)))
  if (cell.y < 1.0) {
    // ground floor: wide shopfronts. Open and dark, shuttered, or bricked up.
    float hole = RECT(0.06, 0.94, 0.04, 0.78);
    if (rnd < 0.45) {
      sAlb = mix(sAlb, vec3(0.012), hole); sRough = mix(sRough, 1.0, hole); sH = mix(sH, -0.25, hole);
    } else if (rnd < 0.75) {
      float rib = 0.5 + 0.5 * sin(f.y * 3.3 * 6.2832 * 8.0);
      vec3 shut = vec3(0.24, 0.25, 0.26) * (0.75 + 0.3 * rib);
      float rust = smoothstep(0.5, 0.7, mid.b + (1.0 - f.y) * 0.3);
      shut = mix(shut, vec3(0.17, 0.07, 0.03), rust);
      sAlb = mix(sAlb, shut, hole); sRough = mix(sRough, 0.6, hole); sMetal = mix(sMetal, 0.5 * (1.0 - rust), hole);
      sH = mix(sH, -0.05 + 0.008 * rib, hole);
    }
    // the sign board above the shop
    float board = RECT(0.04, 0.96, 0.82, 0.95);
    sAlb = mix(sAlb, vec3(0.08, 0.07, 0.06) * (0.7 + 0.6 * rnd2), board * 0.85);
    sH = mix(sH, 0.03, board);
  } else {
    float win = RECT(0.26, 0.74, 0.3, 0.84);
    float frame = RECT(0.23, 0.77, 0.27, 0.87) - win;
    float sill = RECT(0.21, 0.79, 0.22, 0.27);
    vec3 wAlb; float wRough, wH; vec3 wEmit = vec3(0.0);
    if (rnd < 0.2) {
      // glass still in: dark, and as shiny as a mirror, so it reflects the sky
      wAlb = vec3(0.015, 0.017, 0.02); wRough = 0.04 + 0.2 * step(0.6, fine.b); wH = -0.12;
    } else if (rnd > 0.9) {
      // boarded up with planks
      float plank = fract(f.y * 7.0 + rnd2);
      wAlb = vec3(0.2, 0.14, 0.09) * (0.7 + 0.5 * hash12(vec2(floor(f.y * 7.0 + rnd2), seed)));
      wAlb *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.08, plank));
      wRough = 0.85; wH = -0.03 + 0.004 * plank;
    } else {
      // smashed: a dark room behind. A few have a fire burning inside.
      wAlb = vec3(0.01); wRough = 1.0; wH = -0.3;
      if (rnd > 0.885) {
        float flick = 0.7 + 0.3 * sin(uTime * 9.0 + rnd2 * 30.0) * sin(uTime * 5.3 + rnd * 20.0);
        wEmit = vec3(1.0, 0.36, 0.09) * 2.2 * flick * (0.4 + 0.6 * (1.0 - f.y));
      }
    }
    sAlb = mix(sAlb, wAlb, win);
    sRough = mix(sRough, wRough, win);
    sMetal = mix(sMetal, 0.0, win);
    sH = mix(sH, wH, win);
    sEmit += wEmit * win;
    // frame and sill
    sAlb = mix(sAlb, vec3(0.13, 0.12, 0.11), frame * 0.9);
    sH = mix(sH, -0.02, frame);
    sAlb = mix(sAlb, sAlb * 1.35 + 0.03, sill);
    sH = mix(sH, 0.05, sill);
    // soot above windows that burned
    if (rnd > 0.55 && rnd < 0.9 && f.x > 0.2 && f.x < 0.8 && f.y > 0.84) sAlb *= 0.35 + 0.65 * smoothstep(0.84, 1.0, f.y + mid.a * 0.1);
  }
  // a moulded ledge at every floor
  float ledge = 1.0 - smoothstep(0.0, 0.03 + aa, abs(f.y - 0.015));
  sH += 0.03 * ledge;
  sAlb *= 1.0 + 0.15 * ledge;
}

// ---- weathering on everything ----
// big damp stains and soot
sAlb *= 0.7 + 0.45 * big.r;
// streaks running down walls
if (an.y < 0.5) sAlb *= 0.82 + 0.18 * noise4(vec2(uv.x * 2.0, uv.y * 0.04)).g;
// dirt splashed up from the ground, and the corner where wall meets ground is darker
float low = clamp(vWP.y + 0.3, 0.0, 3.0);
sAlb *= mix(0.55, 1.0, smoothstep(0.0, 1.6, low));
// grey ash settled on anything facing up
float ash = smoothstep(0.55, 0.95, n.y) * smoothstep(0.35, 0.75, mid.r);
sAlb = mix(sAlb, vec3(0.2, 0.19, 0.18), ash * 0.6);
sRough = mix(sRough, 1.0, ash * 0.6);
`;

// ---------- the ground: tarmac, pavements, dirt ----------
const GROUND_SURFACE = /* glsl */`
vec2 uv = vWP.xz;
float dist = length(vViewPosition);
float near = 1.0 - smoothstep(25.0, 70.0, dist);
vec4 big = noise4(uv * 0.021);
vec4 mid = noise4(uv * 0.13);
vec4 fine = noise4(uv * 1.1);
vec4 grit = noise4(uv * 4.7);
vec2 l = mod(uv + PERIOD * 0.5, PERIOD) - PERIOD * 0.5;   // position inside this block's square
float ax = abs(l.x), az = abs(l.y);
float HB = BLOCK * 0.5;
bool outside = max(abs(uv.x), abs(uv.y)) > CITY_EDGE;
sRough = 1.0; sMetal = 0.0; sH = 0.0; sEmit = vec3(0.0);
if (outside) {
  // the rubble fields round the city
  sAlb = vec3(0.16, 0.145, 0.13) * (0.7 + 0.5 * mid.g) * (0.8 + 0.4 * grit.a);
  sH = 0.03 * fine.a + 0.01 * grit.r;
} else if (ax > HB || az > HB) {
  // ---- tarmac ----
  sAlb = vec3(0.085, 0.083, 0.08) * (0.75 + 0.5 * grit.a) * (0.8 + 0.4 * mid.g);
  // lighter where tyres wore it smooth, darker oil stains down the middle of each lane
  sAlb *= 0.85 + 0.3 * big.b;
  // patched repairs, a little different in colour
  float repair = smoothstep(0.62, 0.64, big.g);
  sAlb *= mix(1.0, 0.75, repair);
  sH = 0.0015 * grit.a;
  sRough = 0.88;
  // road markings: dashed centre line and zebra crossings, worn away in places
  float wear = 0.35 + 0.65 * smoothstep(0.25, 0.5, fine.g + grit.b * 0.15);
  float paint = 0.0;
  float aa = fwidth(uv.x) + fwidth(uv.y) + 0.01;
  if (az > HB && ax <= HB) {
    float across = PERIOD * 0.5 - az;
    paint = (1.0 - smoothstep(0.08, 0.08 + aa, across)) * step(fract(uv.x / 6.0), 0.42);
    if (ax > HB - 4.0 && ax < HB - 1.0) paint = max(paint, step(0.5, fract(uv.y / 1.1)) * step(across, STREET * 0.5 - 1.5));
  } else if (ax > HB && az <= HB) {
    float across = PERIOD * 0.5 - ax;
    paint = (1.0 - smoothstep(0.08, 0.08 + aa, across)) * step(fract(uv.y / 6.0), 0.42);
    if (az > HB - 4.0 && az < HB - 1.0) paint = max(paint, step(0.5, fract(uv.x / 1.1)) * step(across, STREET * 0.5 - 1.5));
  }
  paint *= wear;
  sAlb = mix(sAlb, vec3(0.5, 0.47, 0.4), paint);
  sRough = mix(sRough, 0.7, paint);
  // cracks: thin dark lines where the noise crosses its middle
  float c = abs(mid.b - 0.5);
  float crack = (1.0 - smoothstep(0.0, 0.012 + aa * 0.02, c)) * smoothstep(0.45, 0.6, big.a) * near;
  sAlb *= 1.0 - 0.7 * crack;
  sH -= 0.01 * crack;
} else if (max(ax, az) > HB - 3.0) {
  // ---- pavement slabs ----
  float joint = gridLines(uv, vec2(1.2, 1.2), 0.03) * near;
  vec2 id = floor(uv / 1.2);
  sAlb = vec3(0.21, 0.2, 0.185) * (0.8 + 0.35 * hash12(id)) * (0.85 + 0.25 * mid.g) * (0.9 + 0.2 * grit.a);
  // dead weeds and moss in the joints
  sAlb = mix(sAlb, vec3(0.06, 0.07, 0.035), joint * smoothstep(0.4, 0.7, fine.r));
  sAlb = mix(sAlb, sAlb * 0.5, joint);
  sH = -0.012 * joint + 0.002 * grit.a;
  // a few slabs sunk or tilted
  sH += (hash12(id + 7.0) > 0.92 ? 0.012 : 0.0) * near;
  sRough = 0.86;
} else {
  // ---- open ground inside blocks: dirt, gravel, dead grass ----
  sAlb = vec3(0.1, 0.092, 0.08) * (0.75 + 0.45 * mid.g) * (0.88 + 0.24 * grit.a);
  float grass = smoothstep(0.5, 0.7, big.b * 0.7 + fine.r * 0.4);
  sAlb = mix(sAlb, vec3(0.11, 0.105, 0.06) * (0.8 + 0.4 * grit.r), grass * 0.8);
  sH = 0.012 * fine.a + 0.006 * grit.r;
}
// craters and scorch marks come from the vertex colour
sAlb *= diffuseColor.rgb;
// puddles: still water is dark and mirror smooth
float wet = smoothstep(0.72, 0.76, big.r + mid.a * 0.06) * (outside ? 0.0 : 1.0);
sAlb *= 1.0 - 0.45 * wet;
sRough = mix(sRough, 0.03, wet);
sH *= 1.0 - wet;
`;

// ---------- the sky ----------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;     // always on the far plane
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSun;
uniform vec3 uRift;
uniform float uRiftGlow;
uniform vec3 uHaze;
uniform vec3 uZenith;
uniform float uClouds;
varying vec3 vDir;
${COMMON}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float az = atan(d.z, d.x);
  vec3 col = mix(uHaze, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  // below the horizon: the haze carries on (the fog hides the ground there)
  col = mix(col, uHaze * 0.85, smoothstep(0.0, -0.2, h));

  // the sun, smothered by dust
  float s = max(dot(d, uSun), 0.0);
  vec3 sunCol = vec3(1.0, 0.7, 0.42);
  col += sunCol * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 1.2) ;
  col += vec3(1.0, 0.85, 0.65) * smoothstep(0.9994, 0.9997, s) * 25.0;

  // a heavy layer of cloud and smoke
  if (h > -0.05) {
    vec2 p = d.xz / (max(h, 0.0) + 0.09);
    vec4 c1 = noise4(p * 0.035 + vec2(uTime * 0.0015, 0.0));
    vec4 c2 = noise4(p * 0.11 - vec2(uTime * 0.003, uTime * 0.001));
    float dens = smoothstep(0.3, 0.68, c1.r * 0.7 + c2.g * 0.4) * uClouds;
    dens *= smoothstep(-0.02, 0.12, h);
    // lit from the sun side, dark underneath
    float lit = 0.45 + 0.55 * pow(s, 3.0);
    vec3 cloudCol = mix(vec3(0.07, 0.065, 0.065), vec3(0.75, 0.5, 0.3), lit * (0.4 + 0.6 * c2.b));
    col = mix(col, cloudCol, dens * 0.9);
  }

  // smoke columns rising from fires far away
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a0 = fi * 1.31 + 0.6;
    float du = mod(az - a0 + 3.14159, 6.28318) - 3.14159;
    float hh = clamp(h, 0.0, 1.0);
    float w = 0.015 + hh * 0.35;
    float wob = (noise4(vec2(hh * 3.0 - uTime * 0.01, fi * 0.37)).r - 0.5) * 0.25 * hh;
    float plume = (1.0 - smoothstep(0.0, w, abs(du + wob + hh * 0.3))) * smoothstep(-0.01, 0.02, h) * (1.0 - smoothstep(0.25, 0.55, h));
    plume *= 0.55 + 0.45 * noise4(vec2(du * 6.0, hh * 4.0 - uTime * 0.02)).g;
    col = mix(col, vec3(0.06, 0.055, 0.05), plume * 0.85);
  }

  // the Rift: the tear in the sky the angels pour out of
  float raz = atan(uRift.z, uRift.x);
  float du = mod(az - raz + 3.14159, 6.28318) - 3.14159;
  float dv = h - uRift.y;
  float len = 0.34;
  float shapeV = clamp(1.0 - (dv * dv) / (len * len), 0.0, 1.0);
  float jag = (noise4(vec2(dv * 4.0, 0.3)).a - 0.5) * 0.04;
  float w = 0.05 * shapeV * (1.0 + uRiftGlow * 1.5);
  float x = abs(du + jag);
  float core = 1.0 - smoothstep(w * 0.4, w, x);
  float glow = exp(-x * (9.0 - uRiftGlow * 5.0)) * shapeV;
  col += vec3(1.0, 0.62, 0.2) * glow * (0.5 + uRiftGlow * 2.0);
  col = mix(col, vec3(4.0, 3.4, 2.4) * (1.0 + uRiftGlow * 2.0), core);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Make every mesh in obj cast and catch shadows (but not see-through glows). */
export function castShadows(obj) {
  obj.traverse((o) => {
    if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; }
  });
  return obj;
}

export class Materials {
  constructor(renderer) {
    this.renderer = renderer;
    this.noise = makeNoiseTexture();
    this.noise.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // values every material shares (change one, they all change)
    this.shared = {
      tNoise: { value: this.noise },
      uTime: { value: 0 },
      uRiftGlow: { value: 0 },
    };
    this.cache = new Map();
    this.glows = new Map();
  }

  update(dt) { this.shared.uTime.value += dt; }

  fogColor() { return new THREE.Color().setRGB(HAZE[0], HAZE[1], HAZE[2], THREE.LinearSRGBColorSpace); }

  // ------------------------------------------------ people, angels, the knight
  /**
   * A material for a character's part.
   *   opts.metal  0..1   (armour and blades are metal)
   *   opts.rough  0..1   (0.3 polished, 0.95 cloth)
   *   opts.coat   true   a glossy clear coat on top (porcelain, lacquer)
   *   opts.flash  {value} shared number that makes it flash white when hit
   */
  fill(tint, opts = {}) {
    const key = opts.flash ? null : `${tint}|${opts.metal}|${opts.rough}|${opts.coat}|${!!opts.vertexColors}|${opts.side}`;
    if (key && this.cache.has(key)) return this.cache.get(key);
    const params = {
      color: tint,
      roughness: opts.rough ?? (opts.metal ? 0.4 : 0.8),
      metalness: opts.metal ?? 0,
      vertexColors: !!opts.vertexColors,
      side: opts.side ?? THREE.FrontSide,
      envMapIntensity: ENV_POWER,
    };
    const mat = opts.coat
      ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 1, clearcoatRoughness: 0.25 })
      : new THREE.MeshStandardMaterial(params);
    const flash = opts.flash || { value: 0 };
    const shared = this.shared;
    // Add a little wear (no two spots quite the same) and the hit flash.
    // Polished things (steel, porcelain, marble) get hardly any; cloth and leather get plenty.
    const polish = opts.metal ? 0.12 : opts.coat ? 0.1 : (opts.rough ?? 0.8) < 0.7 ? 0.45 : 1.0;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tNoise = shared.tNoise;
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uFlash = flash;
      shader.vertexShader = 'varying vec3 vOP;\nvarying vec3 vON;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
      shader.fragmentShader = 'varying vec3 vOP;\nvarying vec3 vON;\nuniform float uFlash;\n' + COMMON + shader.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
          vec3 an = abs(vON);
          vec2 wuv = an.y > max(an.x, an.z) ? vOP.xz : (an.x > an.z ? vOP.zy : vOP.xy);
          vec4 wear = noise4(wuv * 1.7);
          diffuseColor.rgb *= 1.0 + (wear.g - 0.5) * 0.35 * ${polish.toFixed(2)};`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (wear.b - 0.5) * 0.3 * ${polish.toFixed(2)}, 0.05, 1.0);`)
        // tiny wrinkles and grain: bumps worked out from the same noise
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, ((wear.g - 0.5) * 0.004 + (noise4(wuv * 7.0).g - 0.5) * 0.006) * ${polish.toFixed(2)}, faceDirection);`)
        .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, vec3(1.8, 1.7, 1.55), uFlash * 0.75);\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => 'wear' + polish.toFixed(2);
    if (key) this.cache.set(key, mat);
    return mat;
  }

  /** Glowing light (holy gold). Bright colours glow brighter than white so they bloom. */
  glow(hex, power = 2.5) {
    const key = hex + '|' + power;
    if (!this.glows.has(key)) {
      const m = new THREE.MeshBasicMaterial({ color: hex });
      const c = m.color;
      if (c.r + c.g + c.b > 0.3) c.multiplyScalar(power);
      this.glows.set(key, m);
    }
    return this.glows.get(key);
  }

  /** A mesh for a character part (it casts a shadow). */
  part(geo, tint, opts = {}) {
    const m = new THREE.Mesh(geo, opts.material || this.fill(tint, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // ------------------------------------------------ the city
  /** Hook our surface code into three.js's standard lit material. */
  surfaceMaterial(name, code, defines = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: ENV_POWER });
    const shared = this.shared;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tNoise = shared.tNoise;
      shader.uniforms.uTime = shared.uTime;
      shader.defines = { ...shader.defines, ...defines };
      shader.vertexShader = SURFACE_VERT_HEAD + shader.vertexShader.replace('#include <fog_vertex>', SURFACE_VERT);
      shader.fragmentShader = 'varying vec3 vWP;\nvarying vec3 vWN;\nvarying float vSurf;\nvarying float vWin;\n' + COMMON + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 sAlb; float sRough; float sMetal; float sH; vec3 sEmit;
          { ${code} }
          diffuseColor.rgb = sAlb;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, sH, faceDirection);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sEmit;');
    };
    mat.customProgramCacheKey = () => name;
    return mat;
  }

  /** Walls, roofs, cars, rubble: everything in the city that doesn't move. */
  city() {
    if (!this._city) this._city = this.surfaceMaterial('city', CITY_SURFACE);
    return this._city;
  }

  /** The far-away stand-in buildings (one box each, coloured per box). */
  farCity() {
    if (!this._far) {
      this._far = this.surfaceMaterial('far', CITY_SURFACE);
      this._far.vertexColors = false;
    }
    return this._far;
  }

  /** The ground. Needs the city grid sizes to know where the streets are. */
  ground(grid) {
    if (!this._ground) {
      const f = (n) => n.toFixed(2);
      this._ground = this.surfaceMaterial('ground', GROUND_SURFACE, {
        PERIOD: f(grid.period), BLOCK: f(grid.block), STREET: f(grid.street), CITY_EDGE: f(grid.edge),
      });
    }
    return this._ground;
  }

  // ------------------------------------------------ sky and light
  makeSky(riftDir) {
    const s = this.shared;
    const lin = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    return new THREE.ShaderMaterial({
      uniforms: {
        tNoise: s.tNoise, uTime: s.uTime, uRiftGlow: s.uRiftGlow,
        uSun: { value: SUN_DIR.clone() }, uRift: { value: riftDir.clone().normalize() },
        uHaze: { value: lin(HAZE) }, uZenith: { value: lin(ZENITH) }, uClouds: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }

  /** The sun: a light with a shadow camera that follows you around. */
  makeSun(quality) {
    const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_POWER);
    sun.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const r = 55;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 420 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    return sun;
  }

  /**
   * Turn the sky into an environment map, so shiny things reflect it and
   * shaded places pick up its colour.
   */
  makeEnvironment(skyMat) {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const scene = new THREE.Scene();
    const m = skyMat.clone();
    m.uniforms = THREE.UniformsUtils.clone(skyMat.uniforms);
    m.uniforms.tNoise.value = this.noise;
    m.uniforms.uClouds.value = 0.6;
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), m));
    // a dark ground in the reflections, so things below are lit less than above
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.05, 0.045, 0.04, THREE.LinearSRGBColorSpace) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);
    const tex = pm.fromScene(scene, 0, 0.1, 500).texture;
    pm.dispose();
    return tex;
  }
}
