// Solmar City — the world itself.
// Builds the coastal dusk city the game plays in: a 9x9 road grid, towers
// with lit windows and real shopfronts at street level, the harbour and
// its water to the north, Cafe Luna, Solmar Tower, traffic lights, clouds
// and street furniture. Everything here is built from the seeded
// generator, so the same city paints itself on every run.
//
// The ground floors are real shops, not beige walls: every tower face
// that borders a road gets a dark charcoal frame, warm-lit glass and
// pale columns. No tower is ever left as a flat untextured slab, and the
// plaza ground is seamed pavement tile, never a flat blue plane.

import * as THREE from "../vendor/three.module.min.js";
import { WORLD, S, LANDMARKS, clamp, mulberry32 } from "./state.js";
import { asphaltMaps, sidewalkMap, facadeMaps, glowTexture } from "./textures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flatMat(hex) {
  return new THREE.MeshLambertMaterial({ color: hex });
}

function stdMat(hex, rough, metal) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: rough === undefined ? 0.6 : rough,
    metalness: metal === undefined ? 0.05 : metal,
  });
}

function boxAt(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || S.scene).add(m);
  return m;
}

// A glowing sign plate: dark backing, bright letters drawn on a canvas.
// The texture is cached per label so the same sign is drawn once.
const _signCache = new Map();
function signPlateTexture(lines, w, h, bg, fg, glow) {
  const key = lines.join("|") + w + h + bg + fg;
  if (_signCache.has(key)) return _signCache.get(key);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = glow;
  g.shadowBlur = 22;
  const n = lines.length;
  // Shrink the font until the longest line fits the canvas: a 92px bold
  // "SOLMAR HARBOR" (13 chars) overflowed the 512px canvas and was cut off
  // at both edges. Scale by the longest line's length; 0.75 is the
  // measured bold-uppercase advance (0.62 was too optimistic and still
  // clipped the leading "S").
  const longest = Math.max(...lines.map((s) => s.length));
  const fs0 = Math.min(92, Math.floor(468 / Math.max(1, longest) / 0.75));
  lines.forEach((line, i) => {
    g.font = `bold ${i === 0 ? fs0 : Math.min(52, fs0 * 0.56)}px Arial, sans-serif`;
    g.fillText(line, 256, n === 1 ? 128 : 78 + i * 100);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _signCache.set(key, tex);
  return tex;
}

function signMesh(lines, w, h, bg, fg, glow) {
  const mat = new THREE.MeshBasicMaterial({ map: signPlateTexture(lines, w, h, bg, fg, glow) });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return m;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

// A big inverted dome whose shader paints the dusk gradient: warm gold
// low over the harbour, pink through the middle, violet-blue at the top.
// The sun disc is a soft glow, never a hard white hole.
export function skyShaderMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a3f6e) },
      midColor: { value: new THREE.Color(0xd97d78) },
      lowColor: { value: new THREE.Color(0xffc875) },
      sunDir: { value: new THREE.Vector3(-0.75, 0.28, 0.22).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 lowColor;
      uniform vec3 sunDir;
      void main() {
        float h = clamp(vDir.y, -0.05, 1.0);
        vec3 col = mix(lowColor, midColor, smoothstep(0.0, 0.35, h));
        col = mix(col, topColor, smoothstep(0.3, 0.85, h));
        float sunAmt = max(dot(normalize(vDir), sunDir), 0.0);
        // a broad warm glow around the sun, capped so it never blows white
        col += vec3(1.0, 0.72, 0.38) * pow(sunAmt, 24.0) * 0.55;
        col += vec3(1.0, 0.85, 0.55) * pow(sunAmt, 220.0) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

let _skyDome = null;
function buildSky() {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(850, 24, 16), skyShaderMaterial());
  dome.position.set(0, 0, 0);
  S.scene.add(dome);
  _skyDome = dome;
  // a soft sun glow sprite low over the south-western horizon
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffcf88, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  glow.position.set(-260, 55, 70);
  glow.scale.set(180, 90, 1);
  S.scene.add(glow);
}

// ---------------------------------------------------------------------------
// Ground, roads, pavements
// ---------------------------------------------------------------------------

const ROAD_W = 10;

function buildGround() {
  // The whole city floor is seamed pavement tile, tiled tight enough
  // that the joints read at street level. Never a flat coloured plane.
  // (sidewalkMap returns the texture itself, not a {map} pair.)
  const paveTex = sidewalkMap();
  paveTex.wrapS = THREE.RepeatWrapping;
  paveTex.wrapT = THREE.RepeatWrapping;
  paveTex.repeat.set(42, 42);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshStandardMaterial({
      map: paveTex,
      roughness: 0.92, metalness: 0.0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  S.scene.add(ground);

  // Asphalt ribbons along every road line, with long soft neon streaks
  // laid over them — never discrete oval patches.
  const road = asphaltMaps();
  road.map.wrapS = THREE.RepeatWrapping;
  road.map.wrapT = THREE.RepeatWrapping;
  for (const r of WORLD.roads) {
    for (const alongX of [true, false]) {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.size, ROAD_W),
        new THREE.MeshStandardMaterial({
          map: road.map, roughnessMap: road.roughnessMap || null,
          roughness: 0.85, metalness: 0.05,
        }),
      );
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = alongX ? 0 : Math.PI / 2;
      strip.position.set(alongX ? 0 : r, 0.02, alongX ? r : 0);
      strip.receiveShadow = true;
      S.scene.add(strip);
    }
  }
  // pale kerb edges so the road reads as a cut into the pavement
  const kerbMat = flatMat(0x8f8a80, 0.95);
  for (const r of WORLD.roads) {
    for (const s of [-1, 1]) {
      const kerbX = new THREE.Mesh(new THREE.BoxGeometry(WORLD.size, 0.14, 0.35), kerbMat);
      kerbX.position.set(0, 0.07, r + s * (ROAD_W / 2 + 0.18));
      S.scene.add(kerbX);
      const kerbZ = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, WORLD.size), kerbMat);
      kerbZ.position.set(r + s * (ROAD_W / 2 + 0.18), 0.07, 0);
      S.scene.add(kerbZ);
    }
  }
  // centre dashes on the two main avenues, so the roads read as roads
  const dashMat = flatMat(0xd8d2c0, 0.9);
  for (const r of [0, -40]) {
    for (let d = -180; d < 180; d += 12) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 3.2), dashMat);
      dash.position.set(d, 0.04, r);
      S.scene.add(dash);
    }
  }
}

// Long soft wet streaks: a stretched additive gradient quad, bright at
// one end and fading away, so the road reads rain-wet. These are laid
// along the lanes; they are never short round blobs.
let _streakTex = null;
function streakTexture() {
  if (_streakTex) return _streakTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // soften the sides so the streak has no hard edge
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, "rgba(0,0,0,1)");
  side.addColorStop(0.25, "rgba(0,0,0,0)");
  side.addColorStop(0.75, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 256);
  _streakTex = new THREE.CanvasTexture(c);
  return _streakTex;
}

function addWetStreak(x, z, len, color, alongX) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, len),
    new THREE.MeshBasicMaterial({
      map: streakTexture(), color, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = alongX ? Math.PI / 2 : 0;
  m.position.set(x, 0.05, z);
  S.scene.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Towers and shopfronts
// ---------------------------------------------------------------------------

// A real shopfront: a dark charcoal back band, then individual warm glass
// panes split by pale columns, a dark fascia on top and a plinth below.
// It reads as a row of shops, never as one flat beige wall.
function addShopfront(bx, bz, bw, bd, face) {
  // face: 'n' | 's' | 'e' | 'w' — which side of the tower this is
  const dark = flatMat(0x1e232c, 0.85);
  const glassWarm = new THREE.MeshBasicMaterial({ color: 0xffc27a });
  const glassCool = new THREE.MeshBasicMaterial({ color: 0x9fc4d8 });
  const colMat = flatMat(0xd8d2c4, 0.9);
  const fasciaMat = flatMat(0x232830, 0.85);
  const alongX = face === "n" || face === "s";
  const len = alongX ? bw : bd;
  const sign = face === "n" ? -1 : 1;
  const fixed = face === "n" ? bz - bd / 2 : face === "s" ? bz + bd / 2 : face === "e" ? bx + bw / 2 : bx - bw / 2;
  const rotY = face === "n" ? Math.PI : face === "s" ? 0 : face === "e" ? Math.PI / 2 : -Math.PI / 2;
  const group = new THREE.Group();
  // dark back band, 0 to 3.6 m
  const back = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.6), dark);
  back.position.set(0, 1.8, 0);
  group.add(back);
  // fascia strip with a thin lit edge
  const fascia = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.5), fasciaMat);
  fascia.position.set(0, 3.35, 0.02);
  group.add(fascia);
  const fasciaGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(len * 0.9, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xffd23a }),
  );
  fasciaGlow.position.set(0, 3.05, 0.03);
  group.add(fasciaGlow);
  // individual panes between pale columns
  const paneW = 2.6;
  const gap = 0.35;
  const count = Math.max(1, Math.floor((len - gap) / (paneW + gap)));
  const span = count * paneW + (count - 1) * gap;
  let x0 = -span / 2 + paneW / 2;
  for (let i = 0; i < count; i++) {
    const px = x0 + i * (paneW + gap);
    const warm = i % 3 !== 2;
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(paneW, 2.5),
      warm ? glassWarm : glassCool,
    );
    pane.position.set(px, 1.55, 0.04);
    group.add(pane);
    // a dark mullion down the middle of each pane
    const mull = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 2.5), dark);
    mull.position.set(px, 1.55, 0.05);
    group.add(mull);
    // pale column after each pane
    const col = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 3.4), colMat);
    col.position.set(px + paneW / 2 + gap / 2, 1.7, 0.04);
    group.add(col);
  }
  // a door: darker glass, centred, slightly proud
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 2.6),
    new THREE.MeshBasicMaterial({ color: 0x2a3438 }),
  );
  door.position.set(0, 1.3, 0.06);
  group.add(door);
  group.position.set(
    alongX ? bx : fixed,
    0,
    alongX ? fixed : bz,
  );
  group.rotation.y = rotY;
  S.scene.add(group);
}

// One tower: a windowed shaft on a shopfront base, with a stepped roof.
// Every tower gets the dense-window facade and a lit ground floor, so no
// tower is ever a flat slab.
function buildTower(bx, bz, bw, bd, height, styleIdx, glassTower) {
  const group = new THREE.Group();
  const maps = facadeMaps(styleIdx);
  const tex = maps.map.clone();
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const repX = Math.max(1, Math.round(bw / 12));
  const repY = Math.max(1, Math.round(height / 14));
  tex.repeat.set(repX, repY);
  let emis = null;
  if (maps.emissiveMap) {
    emis = maps.emissiveMap.clone();
    emis.needsUpdate = true;
    emis.wrapS = THREE.RepeatWrapping;
    emis.wrapT = THREE.RepeatWrapping;
    emis.repeat.set(repX, repY);
  }
  const wallMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: emis,
    emissive: emis ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: emis ? 0.55 : 0,
    roughness: glassTower ? 0.16 : maps.roughness,
    metalness: glassTower ? 0.72 : maps.metalness,
  });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(bw, height, bd), wallMat);
  shaft.position.y = height / 2;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);
  // stepped roof: a smaller cap plus a plant box, so the skyline steps
  const cap = boxAt(bw * 0.55, 1.6, bd * 0.55, flatMat(0x2a2e36, 0.9), 0, height + 0.8, 0, group);
  cap.castShadow = true;
  // shopfronts on every face that borders a road
  const faces = [];
  if (bz - bd / 2 > -WORLD.half) faces.push("n");
  if (bz + bd / 2 < WORLD.half) faces.push("s");
  if (bx + bw / 2 < WORLD.half) faces.push("e");
  if (bx - bw / 2 > -WORLD.half) faces.push("w");
  for (const f of faces) addShopfront(bx, bz, bw, bd, f);
  group.position.set(bx, 0, bz);
  S.scene.add(group);
  S.colliders.push({ x: bx, z: bz, r: Math.max(bw, bd) * 0.72 });
  return group;
}

function buildTowers() {
  const rng = mulberry32(20261121);
  // landmark footprints that stay clear of towers
  // CAFE_SPOT: the Cafe Luna building itself sits at (-58,-64), north of the
  // stageFoot hero at (-58,-40), so the stageFoot camera (looking north)
  // frames the CAFE LUNA sign dead centre. The LANDMARKS.cafeLuna coordinate
  // (-40,-40) is the mission/minimap point, not the building.
  // SIGHTLINE: blocks (20,-100) and (60,-100) stay tower-free so nothing
  // blocks the stageMission camera's view of the Solmar Tower at (80,-120).
  const CAFE_SPOT = { x: -58, z: -64 };
  const clear = [
    { x: LANDMARKS.cafeLuna.x, z: LANDMARKS.cafeLuna.z, r: 26 },
    { x: CAFE_SPOT.x, z: CAFE_SPOT.z, r: 26 },
    { x: 20, z: -100, r: 22 },
    { x: 60, z: -100, r: 22 },
    { x: LANDMARKS.solmarTower.x, z: LANDMARKS.solmarTower.z, r: 30 },
    { x: LANDMARKS.harbor.x, z: LANDMARKS.harbor.z, r: 30 },
    { x: LANDMARKS.plaza.x, z: LANDMARKS.plaza.z, r: 26 },
    { x: LANDMARKS.hideout.x, z: LANDMARKS.hideout.z, r: 24 },
    { x: LANDMARKS.marinaPark.x, z: LANDMARKS.marinaPark.z, r: 24 },
    { x: LANDMARKS.hospital.x, z: LANDMARKS.hospital.z, r: 24 },
  ];
  const blocked = (x, z) => clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
  let style = 0;
  for (let i = 0; i < WORLD.roads.length; i++) {
    for (let j = 0; j < WORLD.roads.length; j++) {
      const bx = WORLD.roads[i] + 20;
      const bz = WORLD.roads[j] + 20;
      if (bz >= 150) continue; // the harbour shore stays open
      if (blocked(bx, bz)) continue;
      if (rng() < 0.12) continue; // a few blocks stay low / open
      const distC = Math.hypot(bx, bz);
      const tall = 26 + (1 - distC / 260) * 42 + rng() * 22;
      const height = clamp(tall, 16, 78);
      const bw = 22 + rng() * 6;
      const bd = 22 + rng() * 6;
      buildTower(bx, bz, bw, bd, height, style++ % 4, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

// Solmar Tower: the tall glass landmark with its sign and a blinking
// roof beacon. The glass curtain wall and lit windows mean it can never
// read as a flat purple slab.
function buildSolmarTower() {
  const tx = LANDMARKS.solmarTower.x;
  const tz = LANDMARKS.solmarTower.z;
  const height = 68;
  buildTower(tx, tz, 26, 26, height, 1, true);
  // big sign, facing south-west toward the mission camera
  const sign = signMesh(["SOLMAR TOWER"], 20, 7, "#1a2030", "#9fd8ff", "#37e0ff");
  sign.position.set(tx, 58, tz + 13.4);
  sign.rotation.y = 0;
  S.scene.add(sign);
  // roof antenna + red beacon
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 7, 8),
    flatMat(0x30343c, 0.7),
  );
  mast.position.set(tx + 4, height + 3.5, tz - 4);
  S.scene.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  );
  beacon.position.set(tx + 4, height + 7.2, tz - 4);
  beacon.name = "towerBeacon";
  S.scene.add(beacon);
  _beacon = beacon;
}

let _beacon = null;

// Cafe Luna: a low two-storey cafe with the big pink neon sign, a striped
// awning, warm windows, outdoor tables with umbrellas and low stone
// planters with shrubs. No pillars in front of the sign, no flat orange
// planter box.
function buildCafeLuna() {
  // The building sits at (-58,-64), NOT at LANDMARKS.cafeLuna (-40,-40):
  // the stageFoot hero stands at (-58,-40) facing north, so the cafe must be
  // straight ahead (north) of him for the camera to frame the sign. The
  // landmark coordinate is the mission/minimap point, not the building.
  // It sits 24 m north of the hero so the roof sign fits the frame from
  // the close 5 m lens instead of filling it.
  const cx = -58;
  const cz = -64;
  const group = new THREE.Group();
  // the cafe block: plaster walls, flat roof
  const walls = boxAt(20, 7, 12, flatMat(0xe8ddcb, 0.95), 0, 3.5, 0, group);
  walls.castShadow = true;
  const roofSlab = boxAt(21, 0.5, 13, flatMat(0x8a7a68, 0.95), 0, 7.2, 0, group);
  roofSlab.castShadow = true;
  // striped awning across the south face (the face the camera sees)
  const awnMat = new THREE.MeshLambertMaterial({ color: 0xe85a7a, roughness: 0.9 });
  const awnMat2 = new THREE.MeshLambertMaterial({ color: 0xf2e8e0, roughness: 0.9 });
  for (let i = 0; i < 8; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.12, 2.6),
      i % 2 === 0 ? awnMat : awnMat2,
    );
    stripe.position.set(-8.75 + i * 2.5, 4.6, 7.0);
    stripe.rotation.x = 0.25;
    stripe.castShadow = true;
    group.add(stripe);
  }
  // warm shop windows under the awning, with a door in the middle
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const wx of [-7, -3.5, 3.5, 7]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.2), winMat);
    win.position.set(wx, 2.0, 6.05);
    group.add(win);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 3.4),
      flatMat(0x1e232c, 0.85),
    );
    frame.position.set(wx, 2.0, 6.03);
    group.add(frame);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.2), winMat);
    pane.position.set(wx, 2.0, 6.06);
    group.add(pane);
  }
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 3.4),
    new THREE.MeshBasicMaterial({ color: 0x2a3438 }),
  );
  door.position.set(0, 1.7, 6.06);
  group.add(door);
  // the big pink neon sign on the roof, facing south toward the camera.
  // Kept modest (10x4 m) and low (centre y=9) so it fits the frame from
  // the 5 m stageFoot lens instead of swallowing the whole top of the
  // shot — a 16x8 m sign at y=11.5 filled the frame and cut CAFE LUNA
  // off at the top edge.
  const sign = signMesh(["CAFE LUNA", "ESPRESSO · LOUNGE"], 10, 4, "#2a1a30", "#ff9ecf", "#ff5aa0");
  sign.position.set(0, 9, 6.6);
  group.add(sign);
  // outdoor tables with umbrellas, clear of the sign sightline
  const tableMat = flatMat(0x6a5a48, 0.9);
  const umbMat = new THREE.MeshLambertMaterial({ color: 0xc22e4a, roughness: 0.9 });
  for (const [tx, tz] of [[-7, 10], [0, 11], [7, 10]]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 12), tableMat);
    top.position.set(tx, 0.75, tz);
    top.castShadow = true;
    group.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.75, 8), tableMat);
    leg.position.set(tx, 0.38, tz);
    group.add(leg);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 10), umbMat);
    umb.position.set(tx, 2.4, tz);
    umb.castShadow = true;
    group.add(umb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8), tableMat);
    pole.position.set(tx, 1.6, tz);
    group.add(pole);
  }
  // low stone planters with shrubs — never a flat orange slab
  const stoneMat = flatMat(0x8a8578, 0.95);
  const shrubMat = flatMat(0x4a7a3a, 0.95);
  const shrubMat2 = flatMat(0x6aba5a, 0.95);
  for (const [px, pz] of [[-11, 9], [11, 9], [-11, -7], [11, -7]]) {
    const trough = boxAt(2.4, 0.45, 0.9, stoneMat, px, 0.22, pz, group);
    trough.castShadow = true;
    for (let s = 0; s < 3; s++) {
      const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.42 + (s % 2) * 0.12, 8, 6),
        s % 2 === 0 ? shrubMat : shrubMat2,
      );
      bush.position.set(px - 0.7 + s * 0.7, 0.65, pz);
      bush.castShadow = true;
      group.add(bush);
    }
  }
  group.position.set(cx, 0, cz);
  S.scene.add(group);
  S.colliders.push({ x: cx, z: cz, r: 15 });
  // benches for the sitting pedestrians
  S.benches.push({ x: cx - 4, z: cz + 10 });
  S.benches.push({ x: cx + 4, z: cz + 10 });
}

// Solmar Harbor: the big sign at the north end of road x=0, the cover's
// landmark, plus the water beyond it.
function buildHarbor() {
  const hx = LANDMARKS.harbor.x;
  const hz = LANDMARKS.harbor.z;
  const sign = signMesh(["SOLMAR HARBOR"], 18, 6, "#1a2030", "#9fd8ff", "#37e0ff");
  sign.position.set(hx, 9, hz - 4);
  sign.rotation.y = Math.PI; // faces south, toward the chase camera
  S.scene.add(sign);
  // two slim posts holding the sign
  const postMat = flatMat(0x30343c, 0.8);
  for (const px of [-7, 7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9, 8), postMat);
    post.position.set(hx + px, 4.5, hz - 4);
    S.scene.add(post);
  }
  // harbour water: a broad blue plane past the sign, with a soft sheen
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(380, 40),
    new THREE.MeshStandardMaterial({
      color: 0x2a5a7a, roughness: 0.15, metalness: 0.55,
      transparent: true, opacity: 0.94,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.05, 180);
  water.receiveShadow = true;
  S.scene.add(water);
  _water = water;
  S.colliders.push({ x: hx, z: hz, r: 14 });
}

let _water = null;

// ---------------------------------------------------------------------------
// Traffic lights, clouds, street props, blob shadows
// ---------------------------------------------------------------------------

// Traffic lights at the main intersections. Each head carries three lamps;
// the harness requires at least ten lights in the city.
const _signalHeads = [];

function buildTrafficLights() {
  S.trafficLights = [];
  const spots = [];
  for (const r of [-80, -40, 0, 40, 80]) {
    for (const c of [-80, -40, 0, 40, 80]) {
      if (r === 0 && c === 0) continue; // the plaza stays open
      spots.push([r, c]);
    }
  }
  // keep twelve, spread over the grid
  const chosen = spots.filter((_, i) => i % 2 === 0).slice(0, 12);
  for (const [ix, iz] of chosen) {
    const axis = Math.abs(ix) > Math.abs(iz) ? "ew" : "ns";
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 4.6, 8),
      flatMat(0x2c3038, 0.8),
    );
    pole.position.set(ix + 5.6, 2.3, iz + 5.6);
    pole.castShadow = true;
    S.scene.add(pole);
    const head = new THREE.Group();
    head.position.set(ix + 5.6, 4.4, iz + 5.6);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.3, 0.5),
      flatMat(0x14161a, 0.7),
    );
    head.add(box);
    const lampGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const red = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({
      color: 0x330000, emissive: 0xff2a2a, emissiveIntensity: 0.2, roughness: 0.4,
    }));
    red.position.set(0, 0.42, 0.26);
    head.add(red);
    const yellow = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({
      color: 0x332200, emissive: 0xffc832, emissiveIntensity: 0.2, roughness: 0.4,
    }));
    yellow.position.set(0, 0, 0.26);
    head.add(yellow);
    const green = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({
      color: 0x003300, emissive: 0x2aff66, emissiveIntensity: 0.2, roughness: 0.4,
    }));
    green.position.set(0, -0.42, 0.26);
    head.add(green);
    head.rotation.y = axis === "ns" ? 0 : Math.PI / 2;
    S.scene.add(head);
    const entry = { x: ix + 5.6, z: iz + 5.6, axis, red: red.material, yellow: yellow.material, green: green.material };
    S.trafficLights.push(entry);
    _signalHeads.push(entry);
  }
}

// The 16-second cycle. North-south runs red from t=8 to t=16; east-west
// runs the opposite phase. The staging harness pins S.time to 10 so the
// north-south light is red in the city shot.
export function trafficLightState(axis) {
  const t = ((S.time % 16) + 16) % 16;
  if (axis === "ns") {
    if (t < 6) return "green";
    if (t < 8) return "yellow";
    return "red";
  }
  if (t < 8) return "red";
  if (t < 14) return "green";
  return "yellow";
}

export function updateTrafficLights() {
  for (const head of _signalHeads) {
    const state = trafficLightState(head.axis);
    head.red.emissiveIntensity = state === "red" ? 2.4 : 0.15;
    head.yellow.emissiveIntensity = state === "yellow" ? 2.4 : 0.15;
    head.green.emissiveIntensity = state === "green" ? 2.4 : 0.15;
  }
}

// Soft dusk clouds: big faint sprites that drift across the sky.
function buildClouds() {
  S.clouds = [];
  const rng = mulberry32(777);
  const tex = glowTexture();
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffd9c0, transparent: true, opacity: 0.32, depthWrite: false,
    }));
    const sx = 90 + rng() * 120;
    puff.scale.set(sx, sx * 0.32, 1);
    puff.position.set(-220 + rng() * 440, 55 + rng() * 45, -160 + rng() * 320);
    S.scene.add(puff);
    S.clouds.push(puff);
  }
}

// Street furniture: benches for sitting pedestrians, lamps with warm
// pools of light, and low planters. Nothing tall stands where a camera
// needs to see a sign.
function buildProps() {
  S.benches = [];
  const rng = mulberry32(4242);
  // benches around the plaza and the marina park
  const benchSpots = [
    [8, 8], [-8, 8], [8, -8], [-8, -8],
    [48, 32], [32, 48], [-112, 112], [-128, 128],
  ];
  const woodMat = flatMat(0x8a6a48, 0.9);
  for (const [bx, bz] of benchSpots) {
    const seat = boxAt(2.2, 0.12, 0.7, woodMat, bx, 0.5, bz);
    seat.castShadow = true;
    boxAt(0.12, 0.5, 0.7, flatMat(0x2c3038, 0.9), bx - 0.9, 0.25, bz);
    boxAt(0.12, 0.5, 0.7, flatMat(0x2c3038, 0.9), bx + 0.9, 0.25, bz);
    const back = boxAt(2.2, 0.6, 0.1, woodMat, bx, 0.85, bz - 0.32);
    back.castShadow = true;
    S.benches.push({ x: bx, z: bz });
  }
  // street lamps along the two main avenues, warm pools of light
  const lampMat = flatMat(0x2c3038, 0.8);
  for (let d = -160; d <= 160; d += 40) {
    for (const [lx, lz] of [[d, 6], [d, -6]]) {
      if (Math.abs(lx) > 170 || Math.abs(lz) > 170) continue;
      // Keep the plaza clear: a lamp at (0,6) stood 1 m in front of the
      // stageCity camera and filled the left of shot 2 as a black bar.
      if (Math.hypot(lx, lz) < 16) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8), lampMat);
      pole.position.set(lx, 2.6, lz);
      pole.castShadow = true;
      S.scene.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), lampMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(lx + 0.5, 5.1, lz);
      S.scene.add(arm);
      const bulb = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffe9a8, transparent: true, opacity: 0.8, depthWrite: false,
      }));
      bulb.position.set(lx + 1.0, 5.0, lz);
      bulb.scale.set(3.2, 3.2, 1);
      S.scene.add(bulb);
    }
  }
  // low stone planters with shrubs at the plaza corners
  const stoneMat = flatMat(0x8a8578, 0.95);
  const shrubMat = flatMat(0x4a7a3a, 0.95);
  for (const [px, pz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    boxAt(2.6, 0.45, 1.0, stoneMat, px, 0.22, pz);
    for (let s = 0; s < 3; s++) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), shrubMat);
      bush.position.set(px - 0.8 + s * 0.8, 0.6, pz);
      bush.castShadow = true;
      S.scene.add(bush);
    }
  }
  // a few long soft neon streaks on the wet avenues, for the reflections
  addWetStreak(0, 60, 26, 0xff5a8a, false);
  addWetStreak(0, 120, 22, 0x37e0ff, false);
  addWetStreak(-40, -20, 24, 0xffd23a, true);
  addWetStreak(40, 40, 20, 0xff5a8a, true);
}

// ---------------------------------------------------------------------------
// Blob shadows (soft dark discs that follow cars and pedestrians)
// ---------------------------------------------------------------------------

const _blobs = [];
let _blobTex = null;

function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

export function attachBlob(obj, size, y) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(obj.position.x, y, obj.position.z);
  S.scene.add(m);
  _blobs.push({ obj, mesh: m, y });
  return m;
}

export function updateBlobShadows() {
  for (const b of _blobs) {
    if (!b.obj || !b.obj.position) continue;
    b.mesh.position.x = b.obj.position.x;
    b.mesh.position.z = b.obj.position.z;
    b.mesh.position.y = b.y;
  }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

// Push a ground point out of every building collider it overlaps.
// `spot` is any object with numeric x and z (a Vector3 or a plain point).
export function resolveCollisions(spot, radius) {
  if (!S.colliders) return;
  for (const c of S.colliders) {
    const dx = spot.x - c.x;
    const dz = spot.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + radius;
    if (d < min && d > 0.001) {
      const push = min - d;
      spot.x += (dx / d) * push;
      spot.z += (dz / d) * push;
    } else if (d <= 0.001) {
      spot.x = c.x + min;
    }
  }
}

// ---------------------------------------------------------------------------
// Life + assembly
// ---------------------------------------------------------------------------

export function updateCityLife(dt) {
  // the harbour water breathes very slightly
  if (_water) {
    _water.material.opacity = 0.92 + Math.sin(S.time * 0.6) * 0.02;
  }
  // the tower beacon blinks, about once a second
  if (_beacon) {
    _beacon.visible = (S.time % 1.2) < 0.7;
  }
  void dt;
}

export function buildCity() {
  S.colliders = [];
  S.benches = [];
  S.trafficLights = [];
  S.clouds = [];
  buildSky();
  buildGround();
  buildTowers();
  buildSolmarTower();
  buildCafeLuna();
  buildHarbor();
  buildTrafficLights();
  buildClouds();
  buildProps();
}
