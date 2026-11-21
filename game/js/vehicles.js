// Solmar City — cars: factory, arcade driving, stealing, parking.
//
// Every car is one solid side-profile extrusion: a single closed
// outline that runs low hood, sloped windshield, gently arched roof,
// sloped rear glass and short trunk, so the cabin is part of the
// body instead of a black slab glued on top. The outline dips up
// around both wheels, so each five-spoke wheel sits in a real arch
// and shows in full. Glass is separate dark high-gloss panels fitted
// to the slopes, split by body-colour pillars. The group itself is
// the physics body (position, heading, colliders); a visual subgroup
// inside it carries the bodywork, so the body can lean and dive
// without ever moving the collision box. The public surface is small
// on purpose: makeCar builds one, spawnParkedCar parks one,
// nearestCar finds one, enterCar / exitCar move the player in and
// out, updateDriving runs the car every frame while the player sits
// in it.

import * as THREE from "../vendor/three.module.min.js";
import { S, WORLD, addHeat, dist2, clamp } from "./state.js";
import { resolveCollisions, attachBlob } from "./city.js";
import { glowTexture, plateTexture } from "./textures.js";

// ---------------------------------------------------------------- tuning

const TOP_SPEED = WORLD.playerTopSpeed; // 34 m/s, 122 km/h
const FORWARD_PUSH = 17; // how hard W accelerates, m/s^2
const BRAKE_PULL = 30; // how hard S brakes, m/s^2
const REVERSE_TOP = 9; // backing up never goes fast
const COAST_DRAG = 5; // rolling drag with no pedal, m/s^2
const STEER_RATE = 1.9; // base turn rate, rad/s, eased off at speed
const WHEEL_SPIN = 2.4; // wheel rotation per metre rolled
const WHEEL_R = 0.36; // tyre radius
const WHEEL_X = 1.35; // wheelbase half-length: wheels at +-1.35 m
const ARCH_R = 0.44; // wheel-arch radius in the side outline

// Street paints: warm dusk colours, rolled at random for traffic.
const STREET_PAINTS = [
  0xd8b83a, 0x3a7ad8, 0xd84a4a, 0x4ad87a, 0xe8e8e8, 0x222226,
  0x7ad8d8, 0xd87ab8, 0x4a3a7a, 0xc8a03a, 0x2a9a8a, 0xb8bcc2,
];

let plateCounter = 4170;
function nextPlate() {
  plateCounter += 1;
  return "SLM-" + plateCounter;
}

// A deterministic kind for a parked car at (x, z): mostly sedans, a
// taxi by the plaza, a truck by the harbour, a sports car now and then.
function variantFor(x, z) {
  const roll = Math.abs(Math.floor(x * 7 + z * 13)) % 10;
  if (roll === 0) return "taxi";
  if (roll === 1) return "truck";
  if (roll === 2) return "sports";
  return "sedan";
}

// ---------------------------------------------------------------- materials

function paintMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.35, roughness: 0.32,
    clearcoat: 1.0, clearcoatRoughness: 0.08,
  });
}

function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x0e1420, metalness: 0.9, roughness: 0.06,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.4,
  });
}

function darkTrim() {
  return new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.4 });
}

function rubberMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.92, metalness: 0.05 });
}

function rimMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.28, metalness: 0.85 });
}

// ---------------------------------------------------------------- wheels

// One five-spoke wheel, axle along local X so a rotation.x spin rolls
// it. Tyre, silver rim, five half-spokes and a hub, all centred on the
// wheel centre.
function buildWheel() {
  const wheel = new THREE.Group();
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 20);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, rubberMaterial());
  tyre.castShadow = true;
  wheel.add(tyre);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMaterial());
  wheel.add(rim);
  // Five spokes: half-bars from the hub out to the rim, one per side.
  const spokeGeo = new THREE.BoxGeometry(0.05, 0.22, 0.07);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k += 1) {
      const a = (k / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, rimMaterial());
      spoke.position.set(side * 0.12, Math.cos(a) * 0.11, Math.sin(a) * 0.11);
      spoke.rotation.x = a;
      wheel.add(spoke);
    }
  }
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.29, 10);
  hubGeo.rotateZ(Math.PI / 2);
  wheel.add(new THREE.Mesh(hubGeo, darkTrim()));
  return wheel;
}

// ---------------------------------------------------------------- profiles

// The side outline of a three-box sedan: low hood, sloped windshield,
// a gently arched roof, sloped rear glass, short trunk. The bottom
// edge runs at y=0.30 and dips up around both wheels, so the arches
// are open at the bottom like real wheel wells. Front is +X.
function sedanProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.02, 0.30);
  s.lineTo(-2.16, 0.55);
  s.quadraticCurveTo(-2.16, 0.82, -1.92, 0.88);
  s.lineTo(-1.55, 0.94);
  s.lineTo(-0.85, 1.22); // straight rear glass: a flat panel sits flush
  s.quadraticCurveTo(-0.30, 1.34, 0.20, 1.33);
  s.lineTo(1.05, 1.10); // straight windshield: a flat panel sits flush
  s.quadraticCurveTo(1.35, 0.94, 1.62, 0.92);
  s.lineTo(2.02, 0.90);
  s.quadraticCurveTo(2.18, 0.86, 2.18, 0.66);
  s.lineTo(2.10, 0.34);
  s.lineTo(1.92, 0.30);
  s.lineTo(1.79, 0.30);
  s.absarc(WHEEL_X, 0.30, ARCH_R, 0, Math.PI, false);
  s.lineTo(-0.91, 0.30);
  s.absarc(-WHEEL_X, 0.30, ARCH_R, 0, Math.PI, false);
  s.lineTo(-2.02, 0.30);
  return s;
}

// A lower, sleeker fastback: long sloping rear glass all the way to
// the tail, lower roof, longer hood.
function sportsProfile() {
  const s = new THREE.Shape();
  s.moveTo(-1.98, 0.28);
  s.lineTo(-2.12, 0.50);
  s.quadraticCurveTo(-2.12, 0.72, -1.90, 0.78);
  s.lineTo(-0.80, 1.16); // straight fastback glass: one flat panel
  s.quadraticCurveTo(-0.20, 1.26, 0.25, 1.25);
  s.lineTo(1.10, 1.02); // straight windshield: a flat panel sits flush
  s.quadraticCurveTo(1.40, 0.88, 1.66, 0.86);
  s.lineTo(2.05, 0.84);
  s.quadraticCurveTo(2.20, 0.80, 2.20, 0.62);
  s.lineTo(2.12, 0.32);
  s.lineTo(1.92, 0.28);
  s.lineTo(1.79, 0.28);
  s.absarc(WHEEL_X, 0.28, ARCH_R, 0, Math.PI, false);
  s.lineTo(-0.91, 0.28);
  s.absarc(-WHEEL_X, 0.28, ARCH_R, 0, Math.PI, false);
  s.lineTo(-1.98, 0.28);
  return s;
}

// A delivery truck in one stepped silhouette: tall cargo box at the
// rear, a lower cab up front, same wheelbase and arches.
function truckProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.62, 0.35);
  s.lineTo(-2.62, 2.00);
  s.lineTo(-0.95, 2.00);
  s.lineTo(-0.95, 1.82);
  s.lineTo(0.55, 1.82);
  s.lineTo(1.05, 1.15); // straight cab windshield: one flat panel
  s.lineTo(2.30, 1.08);
  s.quadraticCurveTo(2.62, 1.02, 2.62, 0.70);
  s.lineTo(2.55, 0.35);
  s.lineTo(1.79, 0.35);
  s.absarc(WHEEL_X, 0.35, ARCH_R, 0, Math.PI, false);
  s.lineTo(-0.91, 0.35);
  s.absarc(-WHEEL_X, 0.35, ARCH_R, 0, Math.PI, false);
  s.lineTo(-2.62, 0.35);
  return s;
}

// Extrude a side profile into a solid body: the shape's X becomes the
// car's forward axis (+Z), the extrusion becomes the width, bevels
// round the edges off. Returns a centred geometry.
function extrudeProfile(shape, width) {
  const depth = width - 0.1;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05,
    bevelSegments: 3, curveSegments: 12,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  return geo;
}

// A thin glass panel laid on a slope: a box rotated about X so its
// front edge drops, sized to the slope it covers.
function slopeGlass(length, width, angle, x, y, z) {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, length), glassMaterial());
  panel.rotation.x = angle;
  panel.position.set(x, y, z);
  return panel;
}

// ---------------------------------------------------------------- the factory

// Build one car. `color` is a hex paint (undefined rolls a street
// paint), `police` makes a cruiser, `kind` picks the body. Returns the
// group; everything the other systems need hangs off userData:
// wheels (spin), body (the visual subgroup that leans), tailMat +
// tailGlows (brake brightening), flames + smoke + skids (speed
// effects), and on a cruiser the light-bar parts the police loop
// flashes (redLens/blueLens/redGlow/blueGlow and the red/blue ground
// pools).
export function makeCar(color, police, kind) {
  const model = police ? "police" : (kind || "sedan");
  const paint = police ? 0xe8e8e8 : (color === undefined ? STREET_PAINTS[Math.floor(Math.random() * STREET_PAINTS.length)] : color);
  const car = new THREE.Group();
  const shell = new THREE.Group(); // the visual subgroup: leans, dives, lifts
  car.add(shell);
  const data = { wheels: [], body: shell, kind: model, police: !!police };
  car.userData = data;

  const wide = model === "truck" ? 2.2 : 2.0;
  const long = model === "truck" ? 5.4 : 4.4;
  const sporty = model === "sports";
  const skin = paintMaterial(paint);
  const profile = model === "truck" ? truckProfile() : sporty ? sportsProfile() : sedanProfile();
  const body = new THREE.Mesh(extrudeProfile(profile, wide), skin);
  body.castShadow = true;
  shell.add(body);

  // Dark wheel-well liners behind each arch, so you can never see
  // through the car from one arch to the other.
  const linerGeo = new THREE.CircleGeometry(ARCH_R + 0.01, 16);
  const linerMat = new THREE.MeshBasicMaterial({ color: 0x0a0c0e, side: THREE.DoubleSide });
  for (const wz of [WHEEL_X, -WHEEL_X]) {
    for (const side of [-1, 1]) {
      const liner = new THREE.Mesh(linerGeo, linerMat);
      liner.rotation.y = Math.PI / 2;
      liner.position.set(side * (wide / 2 - 0.22), WHEEL_R, wz);
      shell.add(liner);
    }
  }

  // Wheels: full five-spoke rims in the arches, axles across the car.
  for (const wz of [WHEEL_X, -WHEEL_X]) {
    for (const side of [-1, 1]) {
      const wheel = buildWheel();
      wheel.position.set(side * (wide / 2 - 0.06), WHEEL_R, wz);
      shell.add(wheel);
      data.wheels.push(wheel);
    }
  }

  // Glass fitted to the slopes: windshield, rear glass, and a side
  // pane on each flank split by body-colour A/B/C pillars. The roof
  // is body paint — no black slab on top any more.
  const glass = glassMaterial();
  if (model === "truck") {
    // Steep cab windshield, and band windows along the cab sides.
    shell.add(slopeGlass(0.72, 1.6, 0.93, 0, 1.50, 0.82));
    addSideGlass(shell, glass, skin, -0.75, 0.45, 1.68, 1.68, 1.02, wide);
    // Ribs down the cargo box sides, and a roll-up door at the rear.
    const ribMat = darkTrim();
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k += 1) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.1), ribMat);
        rib.position.set(side * (wide / 2 + 0.01), 1.25, -1.3 - k * 0.4);
        shell.add(rib);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.3 }));
    door.position.set(0, 1.15, -long / 2 - 0.02);
    shell.add(door);
    // Horizontal slats on the roll-up door, so the rear reads as a
    // shutter, not a flat dark slab.
    for (let k = 0; k < 4; k += 1) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.02), ribMat);
      slat.position.set(0, 0.6 + k * 0.35, -long / 2 - 0.05);
      shell.add(slat);
    }
  } else {
    const roofY = sporty ? 1.25 : 1.33;
    if (sporty) {
      // Fastback: one long shallow rear glass, short windshield.
      shell.add(slopeGlass(0.80, 1.66, 0.264, 0, 1.16, 0.68));
      shell.add(slopeGlass(1.10, 1.66, -0.332, 0, 1.00, -1.35));
      addSideGlass(shell, glass, skin, -0.80, 0.85, 1.13, 1.08, 0.95, wide);
    } else {
      // Windshield: straight slope from the roof front down to the hood.
      shell.add(slopeGlass(0.84, 1.66, 0.264, 0, 1.235, 0.63));
      // Rear glass: straight slope from the roof rear down to the trunk.
      shell.add(slopeGlass(0.71, 1.66, -0.38, 0, 1.10, -1.21));
      // Side glass: a trapezoid following the roof line, pillars over it.
      addSideGlass(shell, glass, skin, -0.85, 0.90, 1.20, 1.13, 0.98, wide);
    }
  }

  // Full-width scarlet LED tail bar across the rear, with glow sprites
  // at each end that double in brightness under braking.
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x7a0a0a, emissive: 0xff1a1a, emissiveIntensity: 1.2,
    roughness: 0.3, metalness: 0.2,
  });
  data.tailMat = tailMat;
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.06), tailMat);
  tailBar.position.set(0, model === "truck" ? 1.05 : 0.82, -long / 2 - 0.01);
  shell.add(tailBar);
  data.tailGlows = [];
  for (const side of [-1, 1]) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(0.7, 0.7, 1);
    glow.position.set(side * 0.8, model === "truck" ? 1.05 : 0.82, -long / 2 - 0.08);
    shell.add(glow);
    data.tailGlows.push(glow);
  }

  // Warm-white LED headlight strips with a soft glow each.
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.07, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xf2f2e8, emissive: 0xfff2c8, emissiveIntensity: 1.6 })
    );
    lamp.position.set(side * 0.6, model === "truck" ? 1.0 : 0.78, long / 2 + 0.01);
    shell.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff2c8, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(0.55, 0.55, 1);
    halo.position.set(side * 0.6, model === "truck" ? 1.0 : 0.78, long / 2 + 0.1);
    shell.add(halo);
  }

  // Front and rear plates.
  const plate = nextPlate();
  const rearPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.16),
    new THREE.MeshBasicMaterial({ map: plateTexture(plate) })
  );
  rearPlate.position.set(0, model === "truck" ? 0.72 : 0.52, -long / 2 - 0.045);
  rearPlate.rotation.y = Math.PI;
  shell.add(rearPlate);
  const frontPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.16),
    new THREE.MeshBasicMaterial({ map: plateTexture(plate) })
  );
  frontPlate.position.set(0, model === "truck" ? 0.72 : 0.45, long / 2 + 0.045);
  shell.add(frontPlate);

  // Bumpers: a dark lip under the nose and the tail.
  const lipMat = darkTrim();
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.1), lipMat);
  nose.position.set(0, 0.32, long / 2 + 0.02);
  shell.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.1), lipMat);
  tail.position.set(0, 0.32, -long / 2 - 0.02);
  shell.add(tail);

  if (model === "taxi") {
    // Checker band along each flank, and a slim lit roof sign — a low
    // bar, not a block.
    const bandCanvas = document.createElement("canvas");
    bandCanvas.width = 256;
    bandCanvas.height = 32;
    const bp = bandCanvas.getContext("2d");
    for (let k = 0; k < 16; k += 1) {
      bp.fillStyle = k % 2 ? "#14161a" : "#f2f2f2";
      bp.fillRect(k * 16, 0, 16, 32);
    }
    const bandTex = new THREE.CanvasTexture(bandCanvas);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.16, 3.2),
        new THREE.MeshBasicMaterial({ map: bandTex })
      );
      band.position.set(side * (wide / 2 + 0.01), 0.72, 0);
      shell.add(band);
    }
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 256;
    signCanvas.height = 48;
    const sp = signCanvas.getContext("2d");
    sp.fillStyle = "#1c1410";
    sp.fillRect(0, 0, 256, 48);
    sp.fillStyle = "#ffd27a";
    sp.font = "bold 32px Arial, sans-serif";
    sp.textAlign = "center";
    sp.textBaseline = "middle";
    sp.fillText("TAXI", 128, 26);
    const signTex = new THREE.CanvasTexture(signCanvas);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x1c1410, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9 })
    );
    sign.position.set(0, 1.38, 0.1);
    shell.add(sign);
  }

  if (model === "police") {
    // Two-tone: black hood and roof panels over the white body, a door
    // stripe, and the light bar the police loop flashes.
    const black = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.3 });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 0.85), black);
    hood.rotation.x = 0.06;
    hood.position.set(0, 0.93, 1.78);
    shell.add(hood);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.03, 1.5), black);
    roof.position.set(0, 1.345, 0.05);
    shell.add(roof);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 3.6), black);
      stripe.position.set(side * (wide / 2 + 0.01), 0.68, 0);
      shell.add(stripe);
    }
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.34), black);
    barBase.position.set(0, 1.42, 0.1);
    shell.add(barBase);
    const redLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 1.4 })
    );
    redLens.position.set(-0.28, 1.5, 0.1);
    shell.add(redLens);
    const blueLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a6aff, emissive: 0x2a6aff, emissiveIntensity: 1.4 })
    );
    blueLens.position.set(0.28, 1.5, 0.1);
    shell.add(blueLens);
    const redGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    redGlow.scale.set(1.1, 1.1, 1);
    redGlow.position.set(-0.28, 1.55, 0.1);
    shell.add(redGlow);
    const blueGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0x2a6aff, transparent: true, opacity: 0.15,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    blueGlow.scale.set(1.1, 1.1, 1);
    blueGlow.position.set(0.28, 1.55, 0.1);
    shell.add(blueGlow);
    // Red/blue pools on the road under the cruiser, flashing with the bar.
    const poolGeo = new THREE.CircleGeometry(1.6, 16);
    const redGround = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
      color: 0xff2a2a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    redGround.rotation.x = -Math.PI / 2;
    redGround.position.set(-1.1, 0.04, 0.1);
    shell.add(redGround);
    const blueGround = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
      color: 0x2a6aff, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    blueGround.rotation.x = -Math.PI / 2;
    blueGround.position.set(1.1, 0.04, 0.1);
    shell.add(blueGround);
    data.redLens = redLens;
    data.blueLens = blueLens;
    data.redGlow = redGlow;
    data.blueGlow = blueGlow;
    data.redGround = redGround;
    data.blueGround = blueGround;
  }

  // Twin exhausts: dark pipe mouths, each with a thin translucent
  // flame (blue outer, orange core) that only shows at speed.
  data.flames = [];
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10),
      darkTrim()
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.35, 0.35, -long / 2 - 0.05);
    shell.add(pipe);
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.55, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x3a8aff, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(side * 0.35, 0.35, -long / 2 - 0.32);
    outer.visible = false;
    shell.add(outer);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.4, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff8a2a, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(side * 0.35, 0.35, -long / 2 - 0.24);
    inner.visible = false;
    shell.add(inner);
    data.flames.push(outer, inner);
  }
  data.skidClock = 0;
  return car;
}

// Side glass: one trapezoid pane per flank, its top edge following the
// roof line (a different height at the front and the rear), split by
// three body-colour pillars (A, B, C) whose tops meet the same line.
function addSideGlass(shell, glass, skin, zRear, zFront, yTopRear, yTopFront, yBottom, wide) {
  const shape = new THREE.Shape();
  shape.moveTo(zRear, yBottom);
  shape.lineTo(zFront, yBottom);
  shape.lineTo(zFront - 0.12, yTopFront);
  shape.lineTo(zRear + 0.12, yTopRear);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const pane = new THREE.Mesh(geo, glass);
    // The extrusion runs toward -X, so the near side sits 0.02 proud.
    pane.position.x = side * (wide / 2 + 0.015) + (side < 0 ? 0.02 : 0);
    shell.add(pane);
    // Pillars over the glass: A at the windshield, B mid-cabin, C at the rear.
    for (const pz of [zFront - 0.15, (zFront + zRear) / 2, zRear + 0.15]) {
      const t = (pz - zRear) / (zFront - zRear);
      const yTop = yTopRear + t * (yTopFront - yTopRear);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.03, yTop - yBottom + 0.06, 0.09), skin);
      pillar.position.set(side * (wide / 2 + 0.02), (yTop + yBottom) / 2, pz);
      shell.add(pillar);
    }
  }
}

// ---------------------------------------------------------------- parking

// Park one car: build it, set it down, register the ride so the
// player can steal it later.
export function spawnParkedCar(x, z, heading, color, kind) {
  const mesh = makeCar(color, false, kind || variantFor(x, z));
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.8, 0.03);
  const ride = { mesh, heading, speed: 0, stolen: false };
  S.cars.push(ride);
  return ride;
}

// The nearest parked ride within maxDist of (x, z), or null.
export function nearestCar(x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ride of S.cars) {
    const d = dist2(x, z, ride.mesh.position.x, ride.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      best = ride;
    }
  }
  return best;
}

// Get in: the player leaves the pavement, the car is theirs now, and
// stealing a fresh car puts them straight on 2 stars. The figure is
// hidden while driving — it stands where the player got in, and from
// the low chase camera it would read as a person standing on the road
// behind the car.
export function enterCar(ride) {
  if (!ride.stolen) {
    ride.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
  }
  S.currentCar = ride;
  S.onFoot = false;
  S.speedKmh = 0;
  if (S.player) S.player.group.visible = false;
}

// Get out: drop the player beside the car, back on foot.
export function exitCar() {
  const ride = S.currentCar;
  if (!ride) return;
  const px = ride.mesh.position.x + Math.cos(ride.heading) * 2.2;
  const pz = ride.mesh.position.z - Math.sin(ride.heading) * 2.2;
  if (S.player) {
    S.player.pos.set(px, 0, pz);
    S.player.group.position.set(px, 0, pz);
    S.player.group.visible = true;
  }
  S.currentCar = null;
  S.onFoot = true;
  S.speedKmh = 0;
}

// ---------------------------------------------------------------- effects

// A pool of faint white smoke sprites that drift up off the rear
// wheels when the car launches or slides.
function ensureSmokePool(car) {
  if (car.userData.smoke) return car.userData.smoke;
  const pool = [];
  for (let i = 0; i < 10; i += 1) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xe8e8e8, transparent: true, opacity: 0,
      depthWrite: false,
    }));
    puff.scale.set(0.9, 0.9, 1);
    puff.userData.life = 0;
    puff.visible = false;
    S.scene.add(puff);
    pool.push(puff);
  }
  car.userData.smoke = pool;
  return pool;
}

// A pool of dark skid-mark planes laid flat on the road where the rear
// wheels slide. They fade out over a few seconds.
function ensureSkidPool(car) {
  if (car.userData.skids) return car.userData.skids;
  const pool = [];
  for (let i = 0; i < 24; i += 1) {
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 1.3),
      new THREE.MeshBasicMaterial({ color: 0x0c0c10, transparent: true, opacity: 0, depthWrite: false })
    );
    mark.rotation.x = -Math.PI / 2;
    mark.userData.life = 0;
    mark.visible = false;
    S.scene.add(mark);
    pool.push(mark);
  }
  car.userData.skids = pool;
  return pool;
}

function laySkid(car, x, z, heading, pool) {
  const mark = pool.find((m) => m.userData.life <= 0) || pool[0];
  mark.position.set(x, 0.03, z);
  mark.rotation.z = -heading;
  mark.material.opacity = 0.55;
  mark.userData.life = 4;
  mark.visible = true;
}

function puffSmoke(car, x, z, pool) {
  const puff = pool.find((p) => p.userData.life <= 0) || pool[0];
  puff.position.set(x, 0.5, z);
  puff.material.opacity = 0.16;
  puff.userData.life = 1.1;
  puff.visible = true;
}

// ---------------------------------------------------------------- driving

export function updateDriving(dt) {
  const ride = S.currentCar;
  if (!ride) return;
  const mesh = ride.mesh;
  const keys = S.keys;
  const throttle = !!(keys.KeyW || keys.ArrowUp);
  const braking = !!(keys.KeyS || keys.ArrowDown);
  const handbrake = !!keys.Space;
  const steerIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  const kmh = Math.abs(ride.speed) * 3.6;

  // Arcade longitudinal model: throttle, brake, reverse, coast drag,
  // handbrake. Speeds are locked: 34 forward, 9 back, never faster.
  if (throttle) {
    ride.speed += FORWARD_PUSH * dt;
  } else if (braking) {
    if (ride.speed > 0.5) ride.speed -= BRAKE_PULL * dt;
    else ride.speed -= FORWARD_PUSH * 0.5 * dt;
  } else {
    const drag = COAST_DRAG * dt;
    ride.speed -= Math.sign(ride.speed) * Math.min(Math.abs(ride.speed), drag);
  }
  if (handbrake) ride.speed -= Math.sign(ride.speed) * Math.min(Math.abs(ride.speed), 22 * dt);
  ride.speed = clamp(ride.speed, -REVERSE_TOP, TOP_SPEED);

  // Steering eases off as speed rises; the handbrake sharpens it.
  const pace = clamp(Math.abs(ride.speed) / TOP_SPEED, 0, 1);
  const turnAuthority = STEER_RATE * (1 - pace * 0.55) * (handbrake ? 1.5 : 1);
  if (Math.abs(ride.speed) > 0.2) {
    ride.heading += steerIn * turnAuthority * dt * Math.sign(ride.speed);
  }
  mesh.position.x += Math.sin(ride.heading) * ride.speed * dt;
  mesh.position.z += Math.cos(ride.heading) * ride.speed * dt;
  resolveCollisions(mesh.position, 1.9);
  mesh.rotation.y = ride.heading;
  S.speedKmh = kmh;

  // Wheels roll with the road.
  for (const wheel of mesh.userData.wheels) {
    wheel.rotation.x += ride.speed * dt * WHEEL_SPIN;
  }

  // Body roll and pitch: the visual shell leans out of a turn by up to
  // about four degrees, dips its nose under braking and lifts it on
  // launch. The collision box never moves — this is all visual.
  const shell = mesh.userData.body;
  const targetRoll = -steerIn * pace * 0.07;
  const targetPitch = braking && ride.speed > 1 ? -0.035 : throttle && ride.speed < 12 ? 0.03 : 0;
  shell.rotation.z += (targetRoll - shell.rotation.z) * Math.min(1, dt * 6);
  shell.rotation.x += (targetPitch - shell.rotation.x) * Math.min(1, dt * 6);

  // Brake lights flare while the pedal is down.
  const tailMat = mesh.userData.tailMat;
  if (tailMat) {
    tailMat.emissiveIntensity += ((braking ? 2.6 : 1.2) - tailMat.emissiveIntensity) * Math.min(1, dt * 10);
  }
  for (const glow of mesh.userData.tailGlows || []) {
    glow.material.opacity += ((braking ? 0.95 : 0.5) - glow.material.opacity) * Math.min(1, dt * 10);
  }

  // Exhaust flames and tyre smoke past 85 km/h under power, or while
  // sliding sideways: thin translucent cones, never solid paper.
  const sliding = handbrake && Math.abs(ride.speed) > 8;
  const flaming = (throttle && kmh > 85) || (sliding && kmh > 40);
  for (const flame of mesh.userData.flames || []) {
    flame.visible = flaming;
    if (flaming) {
      const f = 0.85 + Math.random() * 0.35;
      flame.scale.set(f, f, 0.8 + Math.random() * 0.5);
    }
  }

  // Smoke puffs off the rear wheels on a hard launch or a slide.
  const smoke = ensureSmokePool(mesh);
  if ((throttle && kmh < 40 && kmh > 5) || sliding) {
    const bx = Math.cos(ride.heading);
    const bz = -Math.sin(ride.heading);
    for (const side of [-1, 1]) {
      puffSmoke(mesh,
        mesh.position.x + bx * side * 0.85 - Math.sin(ride.heading) * 1.35,
        mesh.position.z + bz * side * 0.85 - Math.cos(ride.heading) * 1.35,
        smoke);
    }
  }
  for (const puff of smoke) {
    if (puff.userData.life > 0) {
      puff.userData.life -= dt;
      puff.position.y += dt * 1.1;
      puff.material.opacity = Math.max(0, puff.userData.life * 0.14);
      puff.scale.multiplyScalar(1 + dt * 0.9);
      if (puff.userData.life <= 0) puff.visible = false;
    }
  }

  // Skid marks while sliding or braking hard at speed.
  const skids = ensureSkidPool(mesh);
  const skidding = sliding || (braking && kmh > 60);
  if (skidding) {
    const bx = Math.cos(ride.heading);
    const bz = -Math.sin(ride.heading);
    mesh.userData.skidClock += dt;
    if (mesh.userData.skidClock > 0.05) {
      mesh.userData.skidClock = 0;
      for (const side of [-1, 1]) {
        laySkid(mesh,
          mesh.position.x + bx * side * 0.85 - Math.sin(ride.heading) * 1.35,
          mesh.position.z + bz * side * 0.85 - Math.cos(ride.heading) * 1.35,
          ride.heading, skids);
      }
    }
  }
  for (const mark of skids) {
    if (mark.userData.life > 0) {
      mark.userData.life -= dt;
      mark.material.opacity = Math.max(0, mark.userData.life * 0.14);
      if (mark.userData.life <= 0) mark.visible = false;
    }
  }
}
