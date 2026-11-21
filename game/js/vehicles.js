// Solmar City — cars: factory, arcade driving, stealing, parking.
//
// Every drivable car is built here: the low wide-body sports coupes,
// the beach convertibles, the yellow taxis, the delivery vans and the
// black-and-white police cruisers. The group itself is the physics
// body (position, heading, colliders); a visual subgroup inside it
// carries the bodywork, so the body can lean and dive without ever
// moving the collision box. The public surface is small on purpose:
// makeCar builds one, spawnParkedCar parks one, nearestCar finds one,
// enterCar / exitCar move the player in and out, updateDriving runs
// the car every frame while the player sits in it.

import * as THREE from "../vendor/three.module.min.js";
import { S, WORLD, addHeat, dist2, clamp } from "./state.js";
import { resolveCollisions, attachBlob } from "./city.js";
import { glowTexture, plateTexture, wheelTexture } from "./textures.js";

// ---------------------------------------------------------------- tuning

const TOP_SPEED = WORLD.playerTopSpeed; // 34 m/s, 122 km/h
const FORWARD_PUSH = 17; // how hard W accelerates, m/s^2
const BRAKE_PULL = 30; // how hard S brakes, m/s^2
const REVERSE_TOP = 9; // backing up never goes fast
const COAST_DRAG = 5; // rolling drag with no pedal, m/s^2
const STEER_RATE = 1.9; // base turn rate, rad/s, eased off at speed
const WHEEL_SPIN = 2.4; // wheel rotation per metre rolled

// Paints the city wears. A parked car with no colour rolls one of these.
const STREET_PAINTS = [
  0xd8b83a, 0x3a7ad8, 0xd84a4a, 0x4ad87a, 0xe8e8e8, 0x222226,
  0xd87ab8, 0x7ad8d8, 0xe8c832, 0xb8bcc2, 0x8a4ad8, 0x2a9a8a,
];

let plateCounter = 4170;
function nextPlate() {
  plateCounter += 1;
  return "SLM-" + String(plateCounter % 10000).padStart(4, "0");
}

// Pick a parked-car variant from where it stands, so the same spot
// always shows the same car and two runs stage identically.
function variantFor(x, z) {
  const pick = Math.abs(Math.floor(x * 7 + z * 13)) % 4;
  return ["sedan", "sports", "muscle", "convertible"][pick];
}

// ---------------------------------------------------------------- small parts

// One road wheel: a dark tyre, a five-spoke rim drawn on a disc, and a
// hint of a brake caliper behind it. The tyre geometry is baked with
// its axle on local X, so spinning it is one rotation.x increment.
function buildWheel() {
  const group = new THREE.Group();
  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(
    tyreGeo,
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.92, metalness: 0.05 })
  );
  tyre.castShadow = true;
  group.add(tyre);
  const rimMat = new THREE.MeshBasicMaterial({ map: wheelTexture() });
  const rimGeo = new THREE.CircleGeometry(0.34, 18);
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.x = side * 0.135;
    rim.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(rim);
  }
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.2, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xc22a2a, roughness: 0.5, metalness: 0.4 })
  );
  caliper.position.set(0, 0.05, -0.2);
  group.add(caliper);
  return group;
}

// A licence plate on a thin backing, readable from behind the car.
function buildPlate() {
  const plate = new THREE.Group();
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.2, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.3 })
  );
  plate.add(backing);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 0.16),
    new THREE.MeshBasicMaterial({ map: plateTexture(nextPlate()) })
  );
  face.position.z = 0.025;
  plate.add(face);
  return plate;
}

// The full-width scarlet LED bar across the tail. The material is kept
// on userData so the driving loop can double its glow under braking.
function buildTailBar(width) {
  const barMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.9,
    roughness: 0.3, metalness: 0.2,
  });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.09, 0.06), barMat);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xff2a2a, transparent: true,
    opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glows = [];
  for (const side of [-1, 1]) {
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(0.9, 0.45, 1);
    glow.position.set(side * width * 0.48, 0, -0.12); // behind the rear face, visible
    bar.add(glow);
    glows.push(glow);
  }
  return { bar, barMat, glows };
}

// One headlamp: a warm-white lens, a halo sprite, and a faint cone of
// light lying on the road ahead so the beam reads at dusk.
function buildHeadlamp(sideX) {
  const lamp = new THREE.Group();
  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.12, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x2a2a22, emissive: 0xfff2c8, emissiveIntensity: 1.6,
      roughness: 0.25, metalness: 0.1,
    })
  );
  lamp.add(lens);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffe8a8, transparent: true,
    opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(1.1, 0.7, 1);
  halo.position.z = 0.08;
  lamp.add(halo);
  const coneGeo = new THREE.ConeGeometry(0.85, 5.5, 10, 1, true);
  coneGeo.rotateX(-Math.PI / 2); // wide base forward, tip at the lamp
  const cone = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffe8a8, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  cone.position.set(0, -0.15, 2.6);
  cone.rotation.x = 0.07; // far end dips toward the road
  lamp.add(cone);
  lamp.position.x = sideX;
  return lamp;
}

// A taxi roof sign: amber box, white face, TAXI in dark letters.
function buildTaxiSign() {
  const sign = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xe8c832, roughness: 0.4, metalness: 0.2 })
  );
  sign.add(box);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 48;
  const pen = canvas.getContext("2d");
  pen.fillStyle = "#f2f2f2";
  pen.fillRect(0, 0, 128, 48);
  pen.fillStyle = "#1c1e22";
  pen.font = "bold 30px Arial, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText("TAXI", 64, 26);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) })
  );
  face.position.z = 0.16;
  sign.add(face);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.16;
  sign.add(back);
  return sign;
}

// A black-and-white checker band for the taxi's waist.
function checkerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const pen = canvas.getContext("2d");
  for (let i = 0; i < 16; i++) {
    pen.fillStyle = i % 2 ? "#14161a" : "#f2f2f2";
    pen.fillRect(i * 8, 0, 8, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

// ---------------------------------------------------------------- bodywork

// The side profile of a low wide-body car, front at +x. The roofline
// runs low and long, the nose drops to a black lip, the tail kicks up
// just enough to carry the LED bar. Extruded across the width with a
// fine rounded bevel so no edge reads as a hard box corner.
function bodyProfile(kind) {
  const outline = new THREE.Shape();
  if (kind === "truck") {
    outline.moveTo(-2.6, 0.1);
    outline.lineTo(-2.6, 2.1);
    outline.lineTo(1.2, 2.1);
    outline.lineTo(1.6, 1.5);
    outline.lineTo(2.4, 1.1);
    outline.lineTo(2.7, 0.4);
    outline.lineTo(2.7, 0.1);
    outline.lineTo(-2.6, 0.1);
    return outline;
  }
  const low = kind === "sports" || kind === "convertible";
  const roofY = low ? 0.66 : 0.78;
  const noseY = 0.3;
  outline.moveTo(-2.2, 0.12);
  outline.quadraticCurveTo(-2.24, 0.5, -1.9, 0.58);
  outline.quadraticCurveTo(-1.3, roofY, -0.5, roofY);
  outline.quadraticCurveTo(0.4, roofY - 0.04, 1.1, 0.52);
  outline.quadraticCurveTo(1.8, 0.42, 2.12, noseY);
  outline.quadraticCurveTo(2.22, 0.2, 2.18, 0.12);
  outline.lineTo(-2.2, 0.12);
  return outline;
}

// Extrude a profile into a centred slab, front pointing at +z (the
// direction a heading of 0 drives in). Returns the geometry.
function slabGeometry(kind, width) {
  const geo = new THREE.ExtrudeGeometry(bodyProfile(kind), {
    depth: width, bevelEnabled: true, bevelThickness: 0.09,
    bevelSize: 0.09, bevelSegments: 5, steps: 1,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// Pearl metallic clearcoat paint: saturated colour, low roughness, a
// hard clear top layer so the sunset sky reflects in the panels.
function paintMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.55, roughness: 0.28,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.25,
  });
}

function glassMaterial() {
  // Dark blue glass that catches the sky instead of reading as a black
  // box: enough metalness to mirror the sunset, enough roughness to
  // keep a soft highlight, and a strong environment reflection.
  return new THREE.MeshPhysicalMaterial({
    color: 0x24344a, metalness: 0.7, roughness: 0.12, envMapIntensity: 1.8,
  });
}

// The glasshouse: a dark glass canopy over the cabin, plus a slanted
// windshield and a rear glass, so the cabin reads as glass instead of
// body-coloured metal. `roofY` is the profile roof height; the shell
// sits `lift` above the ground, so every height here adds the lift.
function buildGlasshouse(body, length, width, roofY, lift) {
  const glass = glassMaterial();
  // The canopy runs ALONG the car (length on z, width on x): a low
  // glass bubble over the cabin, set slightly rearward of centre.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, 0.3, length), glass);
  canopy.position.set(0, lift + roofY + 0.08, -0.25);
  canopy.castShadow = true;
  body.add(canopy);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 0.5), glass);
  shield.position.set(0, lift + roofY - 0.05, 0.62);
  shield.rotation.x = -0.5;
  body.add(shield);
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 0.42), glass);
  rear.position.set(0, lift + roofY - 0.02, -1.15);
  rear.rotation.x = 0.42;
  body.add(rear);
}

// Black front lip + grille, so the nose has a face instead of a blank
// slab of paint.
function buildNose(body, frontZ, width) {
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.86, 0.14, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.4 })
  );
  lip.position.set(0, 0.32, frontZ + 0.06);
  body.add(lip);
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.5, 0.1, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.4, metalness: 0.6 })
  );
  grille.position.set(0, 0.48, frontZ + 0.08);
  body.add(grille);
}

// ---------------------------------------------------------------- the factory

// Build one car. `color` is a hex paint (undefined rolls a street
// paint), `police` makes a cruiser, `kind` picks the body. Returns the
// group; everything the other systems need hangs off userData:
// wheels (spin), body (the visual subgroup that leans), tailMat +
// tailGlows (brake brightening), and on a cruiser the light-bar parts
// the police loop flashes (redLens/blueLens/redGlow/blueGlow and the
// red/blue ground pools).
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
  const lift = model === "truck" ? 0.55 : 0.3;
  const skin = paintMaterial(paint);
  const slab = new THREE.Mesh(slabGeometry(model, wide), skin);
  slab.position.y = lift;
  slab.castShadow = true;
  shell.add(slab);

  if (model === "truck") {
    // Delivery van: tall cab up front, ribbed cargo box behind.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 2.0), glassMaterial());
    cab.position.set(0, 2.35, 1.55);
    shell.add(cab);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.5, 3.4),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.35 })
    );
    box.position.set(0, 1.35, -0.9);
    box.castShadow = true;
    shell.add(box);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(2.32, 0.08, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.5, metalness: 0.4 })
      );
      rib.position.set(0, 0.9 + i * 0.35, 0.82);
      shell.add(rib);
    }
  } else if (model === "convertible") {
    // Open top: no canopy, just a windshield and two seat humps.
    const shield = new THREE.Mesh(new THREE.PlaneGeometry(wide * 0.8, 0.42), glassMaterial());
    shield.position.set(0, 0.92, 0.75);
    shield.rotation.x = -0.45;
    shell.add(shield);
    for (const side of [-1, 1]) {
      const hump = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7 })
      );
      hump.scale.set(1, 0.6, 1.2);
      hump.position.set(side * 0.45, 1.02, -0.35); // seat backs over the body line
      shell.add(hump);
    }
  } else {
    buildGlasshouse(shell, 1.7, wide, model === "sports" ? 0.66 : 0.78, lift);
  }

  // Black nose, headlamps with light cones, LED tail bar, plates.
  buildNose(shell, long / 2, wide);
  for (const side of [-1, 1]) {
    const lamp = buildHeadlamp(side * wide * 0.36);
    lamp.position.set(0, 0.62, long / 2 + 0.08);
    shell.add(lamp);
  }
  const tail = buildTailBar(wide * 0.88);
  tail.bar.position.set(0, 0.62, -long / 2 - 0.08);
  shell.add(tail.bar);
  data.tailMat = tail.barMat;
  data.tailGlows = tail.glows;
  const plateBack = buildPlate();
  plateBack.position.set(0, 0.42, -long / 2 - 0.1);
  plateBack.rotation.y = Math.PI;
  shell.add(plateBack);
  const plateFront = buildPlate();
  plateFront.position.set(0, 0.42, long / 2 + 0.1);
  shell.add(plateFront);

  // Wheels: wide track, tucked under the low body.
  const track = wide / 2 - 0.12;
  const axle = long / 2 - 0.95;
  for (const [wx, wz] of [[-track, axle], [track, axle], [-track, -axle], [track, -axle]]) {
    const wheel = buildWheel();
    wheel.position.set(wx, 0.36, wz);
    shell.add(wheel);
    data.wheels.push(wheel);
  }

  if (model === "taxi") {
    // Yellow cab: checker waistband, lit roof sign.
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(long * 0.9, 0.22),
      new THREE.MeshBasicMaterial({ map: checkerTexture() })
    );
    band.position.set(-wide / 2 - 0.06, 0.62, 0);
    band.rotation.y = -Math.PI / 2;
    shell.add(band);
    const bandR = band.clone();
    bandR.position.x = wide / 2 + 0.06;
    bandR.rotation.y = Math.PI / 2;
    shell.add(bandR);
    const sign = buildTaxiSign();
    sign.position.set(0, lift + 0.9, -0.2);
    shell.add(sign);
  }

  if (model === "muscle") {
    // A hood scoop and a rear spoiler, so the muscle car reads at a glance.
    const scoop = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.12, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 })
    );
    scoop.position.set(0, 0.78, 1.3);
    shell.add(scoop);
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(wide * 0.9, 0.06, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 })
    );
    spoiler.position.set(0, 0.92, -long / 2 + 0.15);
    shell.add(spoiler);
  }

  if (police) {
    // Black-and-white two-tone: black hood, roof and trunk over the
    // white body, door stripes, and the red/blue light bar.
    const black = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.5 });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.8, 0.05, 1.1), black);
    hood.position.set(0, lift + 0.5, 1.55);
    shell.add(hood);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.8, 0.05, 1.3), black);
    roof.position.set(0, lift + 0.82, -0.25);
    shell.add(roof);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.16, 2.4),
        new THREE.MeshBasicMaterial({ color: 0x14161a })
      );
      stripe.position.set(side * (wide / 2 + 0.02), 0.62, 0);
      shell.add(stripe);
    }
    // The light bar: red and blue lenses, halo sprites, and a patch of
    // coloured light on the road on each side that flashes with them.
    const barBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.09, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.5 })
    );
    barBase.position.set(0, lift + 0.9, -0.25);
    shell.add(barBase);
    const lensGeo = new THREE.BoxGeometry(0.38, 0.12, 0.3);
    const redLens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({ color: 0x5a1414, emissive: 0xff2a2a, emissiveIntensity: 0.7 }));
    redLens.position.set(-0.21, lift + 0.96, -0.25);
    shell.add(redLens);
    const blueLens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({ color: 0x142a5a, emissive: 0x2a6aff, emissiveIntensity: 0.7 }));
    blueLens.position.set(0.21, lift + 0.96, -0.25);
    shell.add(blueLens);
    const mkHalo = (color) => {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.set(1.6, 1.6, 1);
      return halo;
    };
    const redGlow = mkHalo(0xff2a2a);
    redGlow.position.set(-0.21, lift + 0.96, -0.25);
    shell.add(redGlow);
    const blueGlow = mkHalo(0x2a6aff);
    blueGlow.position.set(0.21, lift + 0.96, -0.25);
    shell.add(blueGlow);
    const mkGround = (color, sideX) => {
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 3.8),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.08,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(sideX, 0.035, 0);
      shell.add(patch);
      return patch;
    };
    data.redLens = redLens;
    data.blueLens = blueLens;
    data.redGlow = redGlow;
    data.blueGlow = blueGlow;
    data.redGround = mkGround(0xff2a2a, -1.9);
    data.blueGround = mkGround(0x2a6aff, 1.9);
  }

  // Twin exhausts at the tail, and the backfire flames that live on them
  // (kept invisible until the driving loop lights them past 85 km/h).
  const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.8 });
  const flameMats = [];
  data.flames = [];
  for (const side of [-1, 1]) {
    const pipeGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.3, 8);
    pipeGeo.rotateX(Math.PI / 2);
    const pipe = new THREE.Mesh(pipeGeo, exhaustMat);
    pipe.position.set(side * 0.55, 0.32, -long / 2 - 0.1);
    shell.add(pipe);
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.75, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff7a2a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(side * 0.55, 0.32, -long / 2 - 0.5);
    shell.add(outer);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.5, 8),
      new THREE.MeshBasicMaterial({
        color: 0x9ad8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(side * 0.55, 0.32, -long / 2 - 0.42);
    shell.add(inner);
    data.flames.push({ outer, inner });
    flameMats.push(outer.material, inner.material);
  }
  data.flameMats = flameMats;
  data.smoke = null; // smoke pool, built lazily on first hard run
  data.skids = null; // skid-mark pool, built lazily on first drift
  data.skidClock = 0;
  return car;
}

// ---------------------------------------------------------------- parking

// Park one car and register it as a ride the player can steal.
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

// ---------------------------------------------------------------- getting in and out

export function enterCar(ride) {
  if (!ride) return;
  if (!ride.stolen) {
    ride.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
  }
  S.currentCar = ride;
  S.onFoot = false;
  S.player.group.visible = false;
  S.camYaw = ride.heading;
  ride.speed = ride.speed || 0;
  if (S.camera) {
    S.camera.fov = 54;
    S.camera.updateProjectionMatrix();
  }
}

export function exitCar() {
  const ride = S.currentCar;
  if (!ride) return;
  const sideX = Math.cos(ride.heading);
  const sideZ = -Math.sin(ride.heading);
  S.player.pos.set(
    ride.mesh.position.x + sideX * 2.2,
    0,
    ride.mesh.position.z + sideZ * 2.2
  );
  S.player.heading = ride.heading;
  S.player.group.position.copy(S.player.pos);
  S.player.group.visible = true;
  S.currentCar = null;
  S.onFoot = true;
  S.speedKmh = 0;
  if (S.camera) {
    S.camera.fov = 62;
    S.camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- the drive loop

// A smoke pool: soft white sprites that rise, spread and fade.
function ensureSmokePool(car) {
  if (car.userData.smoke) return car.userData.smoke;
  const pool = { puffs: [], next: 0 };
  for (let i = 0; i < 20; i++) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xd8d8d8, transparent: true,
      opacity: 0, depthWrite: false,
    }));
    puff.scale.set(0.6, 0.6, 1);
    S.scene.add(puff);
    pool.puffs.push({ sprite: puff, age: 99 });
  }
  car.userData.smoke = pool;
  return pool;
}

// Skid marks: dark translucent strips laid on the asphalt, oldest first.
function ensureSkidPool(car) {
  if (car.userData.skids) return car.userData.skids;
  const pool = { marks: [], next: 0 };
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0a0a0c, transparent: true, opacity: 0.55, depthWrite: false,
  });
  for (let i = 0; i < 48; i++) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.5), mat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, -10, 0);
    mark.visible = false;
    S.scene.add(mark);
    pool.marks.push(mark);
  }
  car.userData.skids = pool;
  return pool;
}

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

  // Lengthwise: accelerate, brake, reverse, coast, handbrake.
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

  // Steering: sharper slow, lazier fast, reversed in reverse.
  const pace = clamp(Math.abs(ride.speed) / TOP_SPEED, 0, 1);
  const turnAuthority = STEER_RATE * (1 - pace * 0.55) * (handbrake ? 1.5 : 1);
  if (Math.abs(ride.speed) > 0.2) {
    ride.heading += steerIn * turnAuthority * dt * Math.sign(ride.speed);
  }
  mesh.position.x += Math.sin(ride.heading) * ride.speed * dt;
  mesh.position.z += Math.cos(ride.heading) * ride.speed * dt;
  resolveCollisions(mesh.position, 1.9);
  mesh.rotation.y = ride.heading;

  // The player rides with the car: police, missions and the camera all
  // read the player position, so keep it glued to the car.
  S.player.pos.set(mesh.position.x, 0, mesh.position.z);
  S.speedKmh = kmh;

  // Wheels roll with the road.
  for (const wheel of mesh.userData.wheels) {
    wheel.rotation.x += ride.speed * dt * WHEEL_SPIN;
  }

  // The visual body leans, dives and lifts — the collision box never moves.
  const shell = mesh.userData.body;
  const leanTarget = -steerIn * pace * 0.07;
  // Positive rotation.x pitches the nose down, so braking dips positive
  // and a launch lifts negative.
  const diveTarget = braking && ride.speed > 4 ? 0.035 : throttle && ride.speed < 12 ? -0.025 : 0;
  shell.rotation.z += (leanTarget - shell.rotation.z) * Math.min(1, dt * 8);
  shell.rotation.x += (diveTarget - shell.rotation.x) * Math.min(1, dt * 8);

  // Brake lights: the LED bar doubles its glow under braking.
  const tailMat = mesh.userData.tailMat;
  const brakingNow = braking || handbrake;
  if (tailMat) {
    tailMat.emissiveIntensity += ((brakingNow ? 2.2 : 0.9) - tailMat.emissiveIntensity) * Math.min(1, dt * 10);
    for (const glow of mesh.userData.tailGlows || []) {
      glow.material.opacity += ((brakingNow ? 0.95 : 0.5) - glow.material.opacity) * Math.min(1, dt * 10);
    }
  }

  // Past 85 km/h, hard throttle or a handbrake drift lights the twin
  // exhausts blue-orange, boils white smoke off the rear tyres, and
  // paints two dark strips on the wet asphalt behind the car.
  const drifting = handbrake && Math.abs(ride.speed) > 8 && steerIn !== 0;
  const hardCorner = Math.abs(steerIn) > 0 && pace > 0.7;
  const hotRun = kmh > 85 && (throttle || drifting);
  const flames = mesh.userData.flames || [];
  for (const flame of flames) {
    const lit = hotRun && Math.random() < 0.75;
    flame.outer.material.opacity = lit ? 0.55 + Math.random() * 0.4 : 0;
    flame.inner.material.opacity = lit ? 0.7 + Math.random() * 0.3 : 0;
    const stretch = lit ? 0.8 + Math.random() * 0.5 : 1;
    flame.outer.scale.set(1, 1, stretch);
  }
  if (hotRun || hardCorner) {
    const pool = ensureSmokePool(mesh);
    for (let i = 0; i < 2; i++) {
      const puff = pool.puffs[pool.next];
      pool.next = (pool.next + 1) % pool.puffs.length;
      const rearX = mesh.position.x - Math.sin(ride.heading) * 1.9 + (Math.random() - 0.5) * 1.4;
      const rearZ = mesh.position.z - Math.cos(ride.heading) * 1.9 + (Math.random() - 0.5) * 1.4;
      puff.sprite.position.set(rearX, 0.5, rearZ);
      puff.age = 0;
    }
    if (drifting || hardCorner) {
      const skids = ensureSkidPool(mesh);
      mesh.userData.skidClock += dt;
      if (mesh.userData.skidClock > 0.05) {
        mesh.userData.skidClock = 0;
        for (const side of [-1, 1]) {
          const mark = skids.marks[skids.next];
          skids.next = (skids.next + 1) % skids.marks.length;
          const wx = mesh.position.x - Math.sin(ride.heading) * 1.45 + Math.cos(ride.heading) * side * 0.85;
          const wz = mesh.position.z - Math.cos(ride.heading) * 1.45 - Math.sin(ride.heading) * side * 0.85;
          mark.position.set(wx, 0.035, wz);
          mark.rotation.z = -ride.heading;
          mark.visible = true;
        }
      }
    }
  }
  // Age the smoke puffs: rise, spread, fade out.
  const smoke = mesh.userData.smoke;
  if (smoke) {
    for (const puff of smoke.puffs) {
      if (puff.age > 0.9) {
        puff.sprite.material.opacity = 0;
        continue;
      }
      puff.age += dt;
      puff.sprite.position.y += dt * 1.4;
      const size = 1 + puff.age * 3.2;
      puff.sprite.scale.set(size, size, 1);
      puff.sprite.material.opacity = 0.22 * (1 - puff.age / 0.9);
    }
  }

  // The chase camera: low and close behind the car, FOV stretching with
  // speed so 122 km/h feels fast. Eased, never snapped, so the frame
  // never jumps — the staged cover relies on this settling, not on the
  // one snap updateCamera does at staging time.
  const cam = S.camera;
  if (cam) {
    const fx = Math.sin(ride.heading);
    const fz = Math.cos(ride.heading);
    const wantX = mesh.position.x - fx * 5.8 + 1.8 * Math.cos(ride.heading);
    const wantZ = mesh.position.z - fz * 5.8 - 1.8 * Math.sin(ride.heading);
    const wantY = 2.0;
    const ease = Math.min(1, dt * 10);
    cam.position.x += (wantX - cam.position.x) * ease;
    cam.position.y += (wantY - cam.position.y) * ease;
    cam.position.z += (wantZ - cam.position.z) * ease;
    cam.lookAt(mesh.position.x + fx * 8, 1.1, mesh.position.z + fz * 8);
    const wantFov = 54 + pace * 12;
    if (Math.abs(cam.fov - wantFov) > 0.05) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }
}
