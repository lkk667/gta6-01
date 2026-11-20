// Solmar City — cars: the factory, arcade driving, enter / exit / steal.
//
// The bodywork is one smooth extrusion, not a stack of boxes: a single
// flowing side profile — sloped nose, arched wheel cutouts, rising tail
// — pushed out with a rounded bevel, so the flanks catch the dusk light
// in one sweep. The glasshouse is a second, narrower extrusion in dark
// glass. Police cruisers keep their two-tone paint, light bar and door
// stripes; taxis keep the checker band and roof sign; trucks keep their
// tall cab and cargo box. Driving, collision and steal behaviour are
// unchanged — only the bodywork is new.

import * as THREE from "../vendor/three.module.min.js"; // 3D engine
import { S, WORLD, addHeat, dist2, clamp } from "./state.js"; // shared world
import { resolveCollisions, attachBlob } from "./city.js"; // city helpers
import { glowTexture, plateTexture } from "./textures.js"; // canvas textures

// Plate codes, handed out in turn so every car reads as a different vehicle.
const PLATE_CODES = ["SLM-580", "SLM-752", "SLM-314", "SLM-906", "SLM-127", "SLM-483", "SLM-659", "SLM-208", "SLM-741", "SLM-935", "SLM-062", "SLM-518"];
let plateCursor = 0;
function issuePlate() {
  const code = PLATE_CODES[plateCursor % PLATE_CODES.length];
  plateCursor += 1;
  return code;
}

// One mesh from a box of the given size and material.
function boxPart(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }

function assembleWheel() {
  const tireMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14),
    new THREE.MeshLambertMaterial({ color: 0x14161a })
  );
  tireMesh.rotation.z = Math.PI / 2;
  tireMesh.castShadow = true;
  // A hub disc on the outside face, so the wheel is not a black hole.
  const hubMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.27, 12),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.7, roughness: 0.3 })
  );
  hubMesh.rotation.z = Math.PI / 2;
  tireMesh.add(hubMesh);
  return tireMesh;
}

function assemblePlate(code) {
  const plateTex = plateTexture(code);
  const plateMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.11),
    new THREE.MeshBasicMaterial({ map: plateTex })
  );
  return plateMesh;
}

// The TAXI roof-sign texture, drawn once and shared by every taxi: a
// white plate with dark TAXI lettering.
let sharedTaxiTex = null;
function taxiRoofTexture() {
  if (sharedTaxiTex) { return sharedTaxiTex; }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 48;
  const brush = canvas.getContext("2d");
  brush.fillStyle = "#f2f2f2";
  brush.fillRect(0, 0, 128, 48);
  brush.fillStyle = "#1c1e22";
  brush.font = "bold 30px Arial, sans-serif";
  brush.textAlign = "center";
  brush.textBaseline = "middle";
  brush.fillText("TAXI", 64, 25);
  sharedTaxiTex = new THREE.CanvasTexture(canvas);
  return sharedTaxiTex;
}

// The sedan body as one smooth extrusion. The outline is drawn in the
// shape's XY plane — X is the car's length, Y is its height — and then
// pushed out along Z (the car's width) with a bevel that rounds the
// edges. It starts at the rear bumper, runs along the bottom past the
// rear wheel arch, up the sloped nose, back along the beltline past the
// front wheel arch, and down the tail. The wheel arches are real
// semicircular cutouts (absarc), so the wheels sit inside the body.
function sedanShellGeometry() {
  const outline = new THREE.Shape();
  // The bottom edge: from the rear bumper (x=-2.05) to the front bumper
  // (x=2.08), with a semicircular arch cut out above each axle.
  outline.moveTo(-2.05, 0.3);
  outline.lineTo(-1.85, 0.3);
  // Rear wheel arch: a half-circle of radius 0.5 centred at x=-1.35.
  outline.absarc(-1.35, 0.3, 0.5, Math.PI, 0, true);
  outline.lineTo(0.85, 0.3);
  // Front wheel arch: a half-circle of radius 0.5 centred at x=1.35.
  outline.absarc(1.35, 0.3, 0.5, Math.PI, 0, true);
  outline.lineTo(2.08, 0.3);
  // The nose: a short rise to the hood line.
  outline.lineTo(2.08, 0.82);
  // The hood: a gentle slope up to the beltline at the windshield base.
  outline.lineTo(0.55, 1.02);
  // The beltline: nearly level back to the tail.
  outline.lineTo(-1.75, 1.12);
  // The tail: down to the rear bumper.
  outline.lineTo(-2.05, 0.9);
  outline.closePath();
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.07,
    bevelSegments: 3,
    curveSegments: 10,
  });
  // Centre the extrusion across the width, then turn it so the shape's
  // X axis (the car's length) runs along the car's +Z (its forward
  // axis). The shape's +X is the nose; rotating -90 degrees about Y
  // maps +X onto +Z, so the nose ends up pointing forward.
  geo.translate(0, 0, -0.86);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// The glasshouse: a second, narrower extrusion in dark glass — sloped
// windshield, curved roof, sloped rear window. It sits on the beltline,
// narrower than the body, so the cabin reads as glass, not a painted box.
function cabinGlassGeometry() {
  const outline = new THREE.Shape();
  outline.moveTo(-1.45, 0.0);
  // The rear window: a slope up from the tail to the roof.
  outline.lineTo(-0.95, 0.32);
  // The roof: a gentle curve (quadratic) peaking at 0.47.
  outline.quadraticCurveTo(0, 0.47, 0.95, 0.32);
  // The windshield: a slope down to the hood.
  outline.lineTo(1.45, 0.0);
  outline.closePath();
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth: 1.55,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geo.translate(0, 0, -0.775);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// The car factory. Length runs along Z, width along X, forward is +Z:
// heading 0 drives toward +Z, the nose and headlights are at +Z, the
// tail and taillights at -Z. The wheels sit at x = +/-0.95 on axles at
// z = +/-(len/2 - 0.8). A paint colour of 0 means "pick a random one".
export function makeCar(color, police, kind)
{
  const rig = new THREE.Group();
  const bodyLen = kind === "truck" ? 5.6 : 4.6;
  const paintChoices = [0xd8b83a, 0x2a7ab8, 0xe84a4a, 0x4ad87a, 0xd8d8d8, 0x8a6a4a, 0x3a3d42];
  const coat = color === 0 || color === undefined
    ? paintChoices[Math.floor(Math.random() * paintChoices.length)]
    : color;
  const coatMat = new THREE.MeshPhysicalMaterial({
    color: coat, metalness: 0.35, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2,
  });
  const paneMat = new THREE.MeshPhysicalMaterial({
    color: 0x101418, metalness: 0.9, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });

  if (kind === "truck") {
    // A delivery truck is a box, and it should look like one: a tall
    // cab up front, a big cargo box behind it.
    const cabMesh = boxPart(1.9, 1.5, 1.6, coatMat);
    cabMesh.position.set(0, 0.95, 1.9);
    cabMesh.castShadow = true;
    rig.add(cabMesh);
    const cargoMesh = boxPart(2.0, 2.2, 3.4, new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
    cargoMesh.position.set(0, 1.3, -0.9);
    cargoMesh.castShadow = true;
    rig.add(cargoMesh);
    // The windshield: a dark glass slab on the cab's front face.
    const shieldMesh = boxPart(1.7, 0.6, 0.05, paneMat);
    shieldMesh.position.set(0, 1.3, 2.72);
    rig.add(shieldMesh);
  } else {
    // The sedan body: one smooth extrusion, plus the glasshouse on top.
    const shellMesh = new THREE.Mesh(sedanShellGeometry(), coatMat);
    shellMesh.castShadow = true;
    rig.add(shellMesh);
    const cabinMesh = new THREE.Mesh(cabinGlassGeometry(), paneMat);
    cabinMesh.position.y = 1.08;
    cabinMesh.castShadow = true;
    rig.add(cabinMesh);
    // A dark glass band low on the body, so the flanks have a second
    // glass line under the beltline.
    const bandMesh = boxPart(1.5, 0.28, 0.08, paneMat);
    bandMesh.position.set(0, 0.78, bodyLen / 2 - 0.4);
    rig.add(bandMesh);
  }

  // The wheels: four, on axles at z = +/-(len/2 - 0.8), x = +/-0.95.
  // They spin with the car's speed (the driving code rotates them).
  const wheelSet = [];
  for (const axleX of [-0.95, 0.95]) {
    for (const axleZ of [bodyLen / 2 - 0.8, -(bodyLen / 2 - 0.8)]) {
      const wheelMesh = assembleWheel();
      wheelMesh.position.set(axleX, 0.34, axleZ);
      rig.add(wheelMesh);
      wheelSet.push(wheelMesh);
    }
  }
  // Bumpers: a slim dark bar at each end, pushed slightly proud of the
  // body so they read as separate parts.
  for (const bumperZ of [bodyLen / 2 + 0.08, -(bodyLen / 2 + 0.08)]) {
    const bumperMesh = boxPart(1.8, 0.22, 0.12, trimMat);
    bumperMesh.position.set(0, 0.35, bumperZ);
    rig.add(bumperMesh);
  }
  // The plates: front and rear, pushed proud of the bumpers.
  const nosePlate = assemblePlate(issuePlate());
  nosePlate.position.set(0, 0.42, bodyLen / 2 + 0.15);
  rig.add(nosePlate);
  const tailPlate = assemblePlate(issuePlate());
  tailPlate.position.set(0, 0.42, -(bodyLen / 2 + 0.15));
  tailPlate.rotation.y = Math.PI;
  rig.add(tailPlate);

  // Headlights: two bright discs at the nose, plus a soft glow sprite
  // and a pool of light on the road ahead, so the car reads as lit at
  // dusk. Taillights: two red discs at the tail.
  const haloTex = glowTexture();
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0xffe9a0, transparent: true, depthWrite: false, opacity: 0.9 });
  for (const lampX of [-0.6, 0.6]) {
    const lampMesh = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), lampMat);
    lampMesh.position.set(lampX, 0.72, bodyLen / 2 + 0.05);
    rig.add(lampMesh);
    const haloSprite = new THREE.Sprite(haloMat);
    haloSprite.scale.set(1.2, 1.2, 1);
    haloSprite.position.set(lampX, 0.72, bodyLen / 2 + 0.1);
    rig.add(haloSprite);
    // A pool of light on the road ahead of each headlight.
    const poolMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshBasicMaterial({ map: haloTex, color: 0xffe9a0, transparent: true, depthWrite: false, opacity: 0.14 })
    );
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.position.set(lampX, 0.03, bodyLen / 2 + 1.4);
    rig.add(poolMesh);
  }
  const tailLampMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const lampX of [-0.6, 0.6]) {
    const lampMesh = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), tailLampMat);
    lampMesh.position.set(lampX, 0.75, -(bodyLen / 2 + 0.05));
    lampMesh.rotation.y = Math.PI;
    rig.add(lampMesh);
  }

  // Police cruisers: two-tone paint (white doors on a dark body), a
  // light bar on the roof that flashes red/blue, door stripes, and
  // "POLICE" on the side. The light-bar parts are stored in userData so
  // the police module can flash them.
  if (police) {
    // A white door panel on each side.
    for (const flank of [-1, 1]) {
      const doorMesh = boxPart(0.04, 0.5, 1.4, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      doorMesh.position.set(flank * 0.98, 0.75, 0.1);
      rig.add(doorMesh);
      const stripeMesh = boxPart(0.05, 0.12, 1.4, new THREE.MeshLambertMaterial({ color: 0x1c2a4a }));
      stripeMesh.position.set(flank * 0.99, 0.55, 0.1);
      rig.add(stripeMesh);
    }
    // The light bar: a dark base, a red lens on the driver's side, a
    // blue lens on the other, glow halos above each, and red/blue pools
    // on the road under the car.
    const barMesh = boxPart(1.1, 0.1, 0.3, trimMat);
    barMesh.position.set(0, 1.58, 0);
    rig.add(barMesh);
    const redLensMesh = boxPart(0.5, 0.14, 0.28, new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    redLensMesh.position.set(-0.28, 1.62, 0);
    rig.add(redLensMesh);
    const blueLensMesh = boxPart(0.5, 0.14, 0.28, new THREE.MeshBasicMaterial({ color: 0x2a6aff }));
    blueLensMesh.position.set(0.28, 1.62, 0);
    rig.add(blueLensMesh);
    const redHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xff2a2a, transparent: true, depthWrite: false, opacity: 0.9 }));
    redHalo.scale.set(1.6, 1.6, 1);
    redHalo.position.set(-0.28, 1.66, 0);
    rig.add(redHalo);
    const blueHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x2a6aff, transparent: true, depthWrite: false, opacity: 0.9 }));
    blueHalo.scale.set(1.6, 1.6, 1);
    blueHalo.position.set(0.28, 1.66, 0);
    rig.add(blueHalo);
    const redPool = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: haloTex, color: 0xff2a2a, transparent: true, depthWrite: false, opacity: 0.3 })
    );
    redPool.rotation.x = -Math.PI / 2;
    redPool.position.set(0, 0.04, 0);
    rig.add(redPool);
    const bluePool = redPool.clone();
    bluePool.material = new THREE.MeshBasicMaterial({ map: haloTex, color: 0x2a6aff, transparent: true, depthWrite: false, opacity: 0.3 });
    rig.add(bluePool);
    rig.userData.redLens = redLensMesh;
    rig.userData.blueLens = blueLensMesh;
    rig.userData.redGlow = redHalo;
    rig.userData.blueGlow = blueHalo;
    rig.userData.redGround = redPool;
    rig.userData.blueGround = bluePool;
  }

  // Taxis: a black-and-white checker band along each side and a roof
  // sign that reads TAXI.
  if (kind === "taxi") {
    for (const flank of [-1, 1]) {
      for (let ci = 0; ci < 6; ci += 1) {
        const checkMesh = boxPart(0.04, 0.22, 0.3, new THREE.MeshLambertMaterial({ color: ci % 2 === 0 ? 0x14161a : 0xf2f2f2 }));
        checkMesh.position.set(flank * 0.98, 0.85, -0.9 + ci * 0.36);
        rig.add(checkMesh);
      }
    }
    // The roof sign: a small white box with TAXI painted on both faces.
    const roofTex = taxiRoofTexture();
    const roofMat = new THREE.MeshBasicMaterial({ map: roofTex });
    for (const flank of [-1, 1]) {
      const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), roofMat);
      faceMesh.position.set(flank * 0.16, 1.62, 0);
      faceMesh.rotation.y = flank > 0 ? Math.PI / 2 : -Math.PI / 2;
      rig.add(faceMesh);
    }
    const signMesh = boxPart(0.3, 0.26, 0.7, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    signMesh.position.set(0, 1.62, 0);
    rig.add(signMesh);
  }

  rig.userData.wheels = wheelSet;
  rig.userData.len = bodyLen;
  rig.userData.kind = kind;
  rig.userData.police = Boolean(police);
  return rig;
}

// Parked cars: a car placed at (x, z) facing `heading`, registered in
// S.cars (the drivable cars list) so the player can steal it. The
// record carries the driving state the car needs: speed, steering,
// whether it is a police car, whether it is parked, and who drives it.
export function spawnParkedCar(x, z, heading, color, kind)
{
  const carMesh = makeCar(color, false, kind);
  carMesh.position.set(x, 0, z);
  carMesh.rotation.y = heading;
  S.scene.add(carMesh);
  attachBlob(carMesh, 4.6, 0.03);
  const parkedRec = { mesh: carMesh, heading, speed: 0, steer: 0, police: false, parked: true, driver: null, kind: carMesh.userData.kind };
  S.cars.push(parkedRec);
  return parkedRec;
}

// The nearest drivable car within maxDist of (x, z), or null. Cars
// that already have a driver are not stealable, so they are skipped.
export function nearestCar(x, z, maxDist)
{
  let closestCar = null;
  let closestD = maxDist;
  for (const option of S.cars) {
    if (option.driver) { continue; }
    const gap = dist2(x, z, option.mesh.position.x, option.mesh.position.z);
    if (gap < closestD) {
      closestD = gap;
      closestCar = option;
    }
  }
  return closestCar;
}

// Get in: the player disappears into the car and the car becomes the
// player's vehicle. Stealing a parked car for the first time puts the
// player straight on 2 stars (heat 34) with a siren burst.
export function enterCar(ride)
{
  const hero = S.player;
  ride.driver = "player";
  ride.parked = false;
  S.onFoot = false;
  S.currentCar = ride;
  hero.group.visible = false;
  hero.speed = 0;
  if (ride.stolen !== true) {
    ride.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
    if (S.audio) { S.audio.sirenBurst(); }
  }
}

// Get out: the player reappears beside the car, on foot again, and the
// car stops (its driver is cleared and its speed is zeroed).
export function exitCar()
{
  const ride = S.currentCar;
  if (!ride) { return; }
  const hero = S.player;
  ride.driver = null;
  ride.speed = 0;
  S.currentCar = null;
  S.onFoot = true;
  hero.group.visible = true;
  const side = ride.heading + Math.PI / 2;
  hero.pos.x = ride.mesh.position.x + Math.sin(side) * 2.2;
  hero.pos.z = ride.mesh.position.z + Math.cos(side) * 2.2;
  hero.group.position.set(hero.pos.x, 0, hero.pos.z);
  hero.heading = ride.heading;
}

// Arcade driving: W/S accelerate and brake/reverse, A/D steer, Space
// is the handbrake. Steering is smoothed (the car eases into a turn)
// and reverses when reversing, like a real car. Speed is clamped to
// the player's top speed (34 m/s, 122 km/h). The car eases off for
// other cars ahead and shoves pedestrians aside (they dodge first —
// see traffic.js). The camera follows in a low chase view.
export function updateDriving(dt)
{
  const ride = S.currentCar;
  if (!ride) { return; }
  const pad = S.keys;
  const accelInput = (pad.KeyW || pad.ArrowUp) ? 1 : 0;
  const reverseInput = (pad.KeyS || pad.ArrowDown) ? 1 : 0;
  const leftInput = (pad.KeyA || pad.ArrowLeft) ? 1 : 0;
  const rightInput = (pad.KeyD || pad.ArrowRight) ? 1 : 0;
  const brakeHeld = Boolean(pad.Space);
  const throttle = (accelInput - reverseInput) * (brakeHeld ? 0.3 : 1);
  ride.speed += throttle * 16 * dt;
  if (!accelInput && !reverseInput) { ride.speed *= Math.max(0, 1 - dt * 1.4); }
  if (brakeHeld) { ride.speed *= Math.max(0, 1 - dt * 3.2); }
  ride.speed = clamp(ride.speed, -10, WORLD.playerTopSpeed);
  // Steering eases toward its goal instead of snapping, and it bites
  // less at high speed. The heading change reverses when reversing.
  const steerTarget = (leftInput - rightInput) * 0.55 * Math.min(1, Math.abs(ride.speed) / 8);
  ride.steer += (steerTarget - ride.steer) * Math.min(1, dt * 6);
  ride.heading += ride.steer * dt * (ride.speed >= 0 ? 1 : -1) * Math.sign(ride.speed || 1);
  const destX = ride.mesh.position.x + Math.sin(ride.heading) * ride.speed * dt;
  const destZ = ride.mesh.position.z + Math.cos(ride.heading) * ride.speed * dt;
  const dest = { x: destX, z: destZ };
  resolveCollisions(dest, 1.9);
  // Ease off for other cars ahead (a formation-pacing cruiser holds
  // its slot and never counts as a block).
  for (const nearby of [...S.cars, ...S.trafficCars, ...S.cruisers]) {
    if (nearby === ride || nearby.mesh === ride.mesh) { continue; }
    if (nearby.pace) { continue; }
    const ox = nearby.mesh ? nearby.mesh.position.x : nearby.position.x;
    const oz = nearby.mesh ? nearby.mesh.position.z : nearby.position.z;
    const gap = dist2(dest.x, dest.z, ox, oz);
    if (gap < 4.5) {
      const shove = (4.5 - gap) * 0.5;
      const dx = dest.x - ox;
      const dz = dest.z - oz;
      const len = Math.hypot(dx, dz) || 1;
      dest.x += (dx / len) * shove;
      dest.z += (dz / len) * shove;
      ride.speed *= 0.92;
    }
  }
  // Pedestrians get shoved aside by the car (they dodge first — see
  // traffic.js). A hit stumbles them and slows the car a little.
  for (const walker of S.peds) {
    const gap = dist2(dest.x, dest.z, walker.mesh.position.x, walker.mesh.position.z);
    if (gap < 2.4) {
      const dx = walker.mesh.position.x - dest.x;
      const dz = walker.mesh.position.z - dest.z;
      const len = Math.hypot(dx, dz) || 1;
      walker.mesh.position.x += (dx / len) * 1.2;
      walker.mesh.position.z += (dz / len) * 1.2;
      walker.fleeTimer = Math.max(walker.fleeTimer, 1.2);
      walker.stumble = 0.5;
      ride.speed *= 0.94;
    }
  }
  ride.mesh.position.x = dest.x;
  ride.mesh.position.z = dest.z;
  ride.mesh.rotation.y = ride.heading;
  // The wheels spin with the speed — the whole wheel group turns, hub
  // included.
  for (const wheel of ride.mesh.userData.wheels) { wheel.rotation.x += ride.speed * dt * 2.4; }
  // The player rides along: keep the on-foot body at the car so the
  // camera and the HUD track it.
  const hero = S.player;
  hero.pos.x = dest.x;
  hero.pos.z = dest.z;
  hero.heading = ride.heading;
  S.speedKmh = Math.abs(ride.speed) * 3.6;
  if (S.audio) { S.audio.engine(Math.abs(ride.speed) / WORLD.playerTopSpeed, Boolean(ride)); }
  if (Math.abs(ride.speed) > 4) { addHeat(0); } // a no-op guard: driving alone adds no heat
  trailCamera(dt, ride);
}

function trailCamera(dt, ride)
{
  const camera = S.camera;
  // A low chase view, nine and a half metres behind the car and just
  // above roof height: the road rushes past and the dusk light reads in
  // the frame. The camera aims a little above the car's centre (y 2.4,
  // not 1.4) so tall things ahead — the SOLMAR HARBOR sign at the end
  // of the road — sit inside the frame instead of being cut off at the
  // top edge.
  const followGap = 9.5; // the follow distance: far enough that the car reads
  // as a car in a street, not a wall filling the lower frame
  const rideHeight = 2.6;
  const aimX = ride.mesh.position.x - Math.sin(ride.heading) * followGap;
  const aimZ = ride.mesh.position.z - Math.cos(ride.heading) * followGap;
  const aimY = rideHeight;
  // A hard follow (dt*25): effectively instant in slow headless frames,
  // so the camera never lags a whole street behind a 122 km/h car, and
  // it stays smooth at 60 fps on a real machine.
  const ease = Math.min(1, dt * 25);
  camera.position.x += (aimX - camera.position.x) * ease;
  camera.position.y += (aimY - camera.position.y) * ease;
  camera.position.z += (aimZ - camera.position.z) * ease;
  camera.lookAt(ride.mesh.position.x, 2.4, ride.mesh.position.z);
  // Speed feel: the field of view opens a little as the car
  // accelerates, 55 at rest to 67 at top speed. Eased, so it never jumps.
  const speedShare = Math.min(1, Math.abs(ride.speed) / WORLD.playerTopSpeed);
  const wantFov = 55 + speedShare * 12;
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}
