// Solmar City — cars: the factory, arcade driving, enter / exit / steal.
//
// The bodywork is one smooth extrusion now, not a stack of boxes. The
// side profile is drawn as a single flowing outline — sloped nose,
// arched wheel cutouts, rising tail — and pushed out with a rounded
// bevel, so the flanks catch the dusk light in one continuous sweep
// instead of a hard box edge. The glasshouse is a second, narrower
// extrusion in dark glass: a sloped windshield, a curved roof, a sloped
// rear window, so the cabin reads as glass and steel and the sunset
// environment reflects in it. Police cruisers keep their two-tone
// paint, light bar and door stripes; taxis keep the checker band and
// roof sign; trucks keep their tall cab and cargo box (a delivery
// truck is a box, and it should look like one). Driving, collision
// and steal behaviour are unchanged — only the bodywork is new.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, addHeat, dist2, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';
import { glowTexture, wheelTexture, plateTexture } from './textures.js';

// A small pool of plate codes, handed out in turn so every car reads
// as a different vehicle.
const PLATES = ['SLM-580', 'SLM-752', 'SLM-314', 'SLM-906', 'SLM-127', 'SLM-483', 'SLM-659', 'SLM-208', 'SLM-741', 'SLM-935', 'SLM-062', 'SLM-518'];
let plateIdx = 0;
function nextPlate() {
  const code = PLATES[plateIdx % PLATES.length];
  plateIdx += 1;
  return code;
}

function buildWheel() {
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14),
    new THREE.MeshLambertMaterial({ color: 0x14161a })
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  // A hub disc on the outside face, so the wheel is not a black hole.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.27, 12),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.7, roughness: 0.3 })
  );
  hub.rotation.z = Math.PI / 2;
  tyre.add(hub);
  return tyre;
}

function buildPlate(code) {
  const tex = plateTexture(code);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.11),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  return plate;
}

// The TAXI roof-sign texture, drawn once and shared by every taxi: a
// white plate with dark TAXI lettering.
let taxiTex = null;
function taxiSignTexture() {
  if (taxiTex) return taxiTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const pen = canvas.getContext('2d');
  pen.fillStyle = '#f2f2f2';
  pen.fillRect(0, 0, 128, 48);
  pen.fillStyle = '#1c1e22';
  pen.font = 'bold 30px Arial, sans-serif';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillText('TAXI', 64, 25);
  taxiTex = new THREE.CanvasTexture(canvas);
  return taxiTex;
}

// The sedan body as one smooth extrusion. The outline is drawn in the
// shape's XY plane — X is the car's length, Y is its height — and then
// pushed out along Z (the car's width) with a bevel that rounds the
// edges. The outline starts at the rear bumper, runs along the bottom
// past the rear wheel arch, up the sloped nose, back along the beltline
// past the front wheel arch, and down the tail. The wheel arches are
// real semicircular cutouts (absarc), so the wheels sit inside the
// body instead of poking through a box.
function sedanBodyGeo() {
  const s = new THREE.Shape();
  // The bottom edge: from the rear bumper (x=-2.05) to the front bumper
  // (x=2.08), with a semicircular arch cut out above each axle.
  s.moveTo(-2.05, 0.3);
  s.lineTo(-1.85, 0.3);
  // Rear wheel arch: a half-circle of radius 0.5 centred at x=-1.35.
  s.absarc(-1.35, 0.3, 0.5, Math.PI, 0, true);
  s.lineTo(0.85, 0.3);
  // Front wheel arch: a half-circle of radius 0.5 centred at x=1.35.
  s.absarc(1.35, 0.3, 0.5, Math.PI, 0, true);
  s.lineTo(2.08, 0.3);
  // The nose: a short rise to the hood line.
  s.lineTo(2.08, 0.82);
  // The hood: a gentle slope up to the beltline at the windshield base.
  s.lineTo(0.55, 1.02);
  // The beltline: nearly level back to the tail.
  s.lineTo(-1.75, 1.12);
  // The tail: down to the rear bumper.
  s.lineTo(-2.05, 0.9);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
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

// The glasshouse: a second, narrower extrusion in dark glass — a
// sloped windshield, a curved roof, a sloped rear window. It sits on
// the beltline and is narrower than the body, so the cabin reads as a
// separate glass volume instead of a painted box.
function glasshouseGeo() {
  const s = new THREE.Shape();
  s.moveTo(-1.45, 0.0);
  // The rear window: a slope up from the tail to the roof.
  s.lineTo(-0.95, 0.32);
  // The roof: a gentle curve (quadratic) peaking at 0.47.
  s.quadraticCurveTo(0, 0.47, 0.95, 0.32);
  // The windshield: a slope down to the hood.
  s.lineTo(1.45, 0.0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
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
export function makeCar(color, police, kind) {
  const car = new THREE.Group();
  const len = kind === 'truck' ? 5.6 : 4.6;
  const palette = [0xd8b83a, 0x2a7ab8, 0xe84a4a, 0x4ad87a, 0xd8d8d8, 0x8a6a4a, 0x3a3d42];
  const paint = color === 0 || color === undefined
    ? palette[Math.floor(Math.random() * palette.length)]
    : color;
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paint, metalness: 0.35, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x101418, metalness: 0.9, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });

  if (kind === 'truck') {
    // A delivery truck is a box, and it should look like one: a tall
    // cab up front, a big cargo box behind it.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 1.6), paintMat);
    cab.position.set(0, 0.95, 1.9);
    cab.castShadow = true;
    car.add(cab);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 3.4), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
    cargo.position.set(0, 1.3, -0.9);
    cargo.castShadow = true;
    car.add(cargo);
    // The windshield: a dark glass slab on the cab's front face.
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 0.05), glassMat);
    shield.position.set(0, 1.3, 2.72);
    car.add(shield);
  } else {
    // The sedan body: one smooth extrusion, plus the glasshouse on top.
    const body = new THREE.Mesh(sedanBodyGeo(), paintMat);
    body.castShadow = true;
    car.add(body);
    const cabin = new THREE.Mesh(glasshouseGeo(), glassMat);
    cabin.position.y = 1.08;
    cabin.castShadow = true;
    car.add(cabin);
    // A dark glass band low on the body, so the flanks have a second
    // glass line under the beltline.
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.08), glassMat);
    band.position.set(0, 0.78, len / 2 - 0.4);
    car.add(band);
  }

  // The wheels: four, on axles at z = +/-(len/2 - 0.8), x = +/-0.95.
  // They spin with the car's speed (the driving code rotates them).
  const wheels = [];
  for (const wx of [-0.95, 0.95]) {
    for (const wz of [len / 2 - 0.8, -(len / 2 - 0.8)]) {
      const wheel = buildWheel();
      wheel.position.set(wx, 0.34, wz);
      car.add(wheel);
      wheels.push(wheel);
    }
  }
  // Bumpers: a slim dark bar at each end, pushed slightly proud of the
  // body so they read as separate parts.
  for (const bz of [len / 2 + 0.08, -(len / 2 + 0.08)]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.12), darkMat);
    bumper.position.set(0, 0.35, bz);
    car.add(bumper);
  }
  // The plates: front and rear, pushed proud of the bumpers.
  const frontPlate = buildPlate(nextPlate());
  frontPlate.position.set(0, 0.42, len / 2 + 0.15);
  car.add(frontPlate);
  const rearPlate = buildPlate(nextPlate());
  rearPlate.position.set(0, 0.42, -(len / 2 + 0.15));
  rearPlate.rotation.y = Math.PI;
  car.add(rearPlate);

  // Headlights: two bright discs at the nose, plus a soft glow sprite
  // and a pool of light on the road ahead, so the car reads as lit at
  // dusk. Taillights: two red discs at the tail.
  const glowTex = glowTexture();
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  const headGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9a0, transparent: true, depthWrite: false, opacity: 0.9 });
  for (const hx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), headMat);
    lamp.position.set(hx, 0.72, len / 2 + 0.05);
    car.add(lamp);
    const halo = new THREE.Sprite(headGlowMat);
    halo.scale.set(1.2, 1.2, 1);
    halo.position.set(hx, 0.72, len / 2 + 0.1);
    car.add(halo);
    // A pool of light on the road ahead of each headlight.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffe9a0, transparent: true, depthWrite: false, opacity: 0.14 })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(hx, 0.03, len / 2 + 1.4);
    car.add(pool);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const tx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), tailMat);
    lamp.position.set(tx, 0.75, -(len / 2 + 0.05));
    lamp.rotation.y = Math.PI;
    car.add(lamp);
  }

  // Police cruisers: two-tone paint (white doors on a dark body), a
  // light bar on the roof that flashes red/blue, door stripes, and
  // "POLICE" on the side. The light-bar parts are stored in userData so
  // the police module can flash them.
  if (police) {
    // A white door panel on each side.
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.4), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      door.position.set(side * 0.98, 0.75, 0.1);
      car.add(door);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.4), new THREE.MeshLambertMaterial({ color: 0x1c2a4a }));
      stripe.position.set(side * 0.99, 0.55, 0.1);
      car.add(stripe);
    }
    // The light bar: a dark base, a red lens on the driver's side, a
    // blue lens on the other, glow halos above each, and red/blue pools
    // on the road under the car.
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.3), darkMat);
    barBase.position.set(0, 1.58, 0);
    car.add(barBase);
    const redLens = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.28), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    redLens.position.set(-0.28, 1.62, 0);
    car.add(redLens);
    const blueLens = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.28), new THREE.MeshBasicMaterial({ color: 0x2a6aff }));
    blueLens.position.set(0.28, 1.62, 0);
    car.add(blueLens);
    const redGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a2a, transparent: true, depthWrite: false, opacity: 0.9 }));
    redGlow.scale.set(1.6, 1.6, 1);
    redGlow.position.set(-0.28, 1.66, 0);
    car.add(redGlow);
    const blueGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x2a6aff, transparent: true, depthWrite: false, opacity: 0.9 }));
    blueGlow.scale.set(1.6, 1.6, 1);
    blueGlow.position.set(0.28, 1.66, 0);
    car.add(blueGlow);
    const redGround = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff2a2a, transparent: true, depthWrite: false, opacity: 0.3 })
    );
    redGround.rotation.x = -Math.PI / 2;
    redGround.position.set(0, 0.04, 0);
    car.add(redGround);
    const blueGround = redGround.clone();
    blueGround.material = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x2a6aff, transparent: true, depthWrite: false, opacity: 0.3 });
    car.add(blueGround);
    car.userData.redLens = redLens;
    car.userData.blueLens = blueLens;
    car.userData.redGlow = redGlow;
    car.userData.blueGlow = blueGlow;
    car.userData.redGround = redGround;
    car.userData.blueGround = blueGround;
  }

  // Taxis: a black-and-white checker band along each side and a roof
  // sign that reads TAXI.
  if (kind === 'taxi') {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i += 1) {
        const square = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.22, 0.3),
          new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0x14161a : 0xf2f2f2 })
        );
        square.position.set(side * 0.98, 0.85, -0.9 + i * 0.36);
        car.add(square);
      }
    }
    // The roof sign: a small white box with TAXI painted on both faces.
    const signTex = taxiSignTexture();
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), signMat);
      face.position.set(side * 0.16, 1.62, 0);
      face.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      car.add(face);
    }
    const signTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.7), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    signTop.position.set(0, 1.62, 0);
    car.add(signTop);
  }

  car.userData.wheels = wheels;
  car.userData.len = len;
  car.userData.kind = kind;
  car.userData.police = Boolean(police);
  return car;
}

// Parked cars: a car placed at (x, z) facing `heading`, registered in
// S.cars (the drivable cars list) so the player can steal it. The
// record carries the driving state the car needs: speed, steering,
// whether it is a police car, whether it is parked, and who drives it.
export function spawnParkedCar(x, z, heading, color, kind) {
  const mesh = makeCar(color, false, kind);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.6, 0.03);
  const parkedCar = { mesh, heading, speed: 0, steer: 0, police: false, parked: true, driver: null, kind: mesh.userData.kind };
  S.cars.push(parkedCar);
  return parkedCar;
}

// The nearest drivable car within maxDist of (x, z), or null. Cars
// that already have a driver are not stealable, so they are skipped.
export function nearestCar(x, z, maxDist) {
  let closest = null;
  let bestD = maxDist;
  for (const candidate of S.cars) {
    if (candidate.driver) continue;
    const d = dist2(x, z, candidate.mesh.position.x, candidate.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      closest = candidate;
    }
  }
  return closest;
}

// Get in: the player disappears into the car and the car becomes the
// player's vehicle. Stealing a parked car for the first time puts the
// player straight on 2 stars (heat 34) with a siren burst.
export function enterCar(car) {
  const player = S.player;
  car.driver = 'player';
  car.parked = false;
  S.onFoot = false;
  S.currentCar = car;
  player.group.visible = false;
  player.speed = 0;
  if (car.stolen !== true) {
    car.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
    if (S.audio) S.audio.sirenBurst();
  }
}

// Get out: the player reappears beside the car, on foot again, and the
// car stops (its driver is cleared and its speed is zeroed).
export function exitCar() {
  const car = S.currentCar;
  if (!car) return;
  const player = S.player;
  car.driver = null;
  car.speed = 0;
  S.currentCar = null;
  S.onFoot = true;
  player.group.visible = true;
  const side = car.heading + Math.PI / 2;
  player.pos.x = car.mesh.position.x + Math.sin(side) * 2.2;
  player.pos.z = car.mesh.position.z + Math.cos(side) * 2.2;
  player.group.position.set(player.pos.x, 0, player.pos.z);
  player.heading = car.heading;
}

// Arcade driving: W/S accelerate and brake/reverse, A/D steer, Space
// is the handbrake. Steering is smoothed (the car eases into a turn)
// and reverses when reversing, like a real car. Speed is clamped to
// the player's top speed (34 m/s, 122 km/h). The car eases off for
// other cars ahead and shoves pedestrians aside (they dodge first —
// see traffic.js). The camera follows in a low chase view.
export function updateDriving(dt) {
  const driven = S.currentCar;
  if (!driven) return;
  const keys = S.keys;
  const forward = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  const reverse = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
  const turnL = (keys.KeyA || keys.ArrowLeft) ? 1 : 0;
  const turnR = (keys.KeyD || keys.ArrowRight) ? 1 : 0;
  const handbrake = Boolean(keys.Space);
  const throttle = (forward - reverse) * (handbrake ? 0.3 : 1);
  driven.speed += throttle * 16 * dt;
  if (!forward && !reverse) driven.speed *= Math.max(0, 1 - dt * 1.4);
  if (handbrake) driven.speed *= Math.max(0, 1 - dt * 3.2);
  driven.speed = clamp(driven.speed, -10, WORLD.playerTopSpeed);
  // Steering eases toward its goal instead of snapping, and it bites
  // less at high speed. The heading change reverses when reversing.
  const steerGoal = (turnL - turnR) * 0.55 * Math.min(1, Math.abs(driven.speed) / 8);
  driven.steer += (steerGoal - driven.steer) * Math.min(1, dt * 6);
  driven.heading += driven.steer * dt * (driven.speed >= 0 ? 1 : -1) * Math.sign(driven.speed || 1);
  const nextX = driven.mesh.position.x + Math.sin(driven.heading) * driven.speed * dt;
  const nextZ = driven.mesh.position.z + Math.cos(driven.heading) * driven.speed * dt;
  const at = { x: nextX, z: nextZ };
  resolveCollisions(at, 1.9);
  // Ease off for other cars ahead (a formation-pacing cruiser holds
  // its slot and never counts as a block).
  for (const other of [...S.cars, ...S.trafficCars, ...S.cruisers]) {
    if (other === driven || other.mesh === driven.mesh) continue;
    if (other.pace) continue;
    const ox = other.mesh ? other.mesh.position.x : other.position.x;
    const oz = other.mesh ? other.mesh.position.z : other.position.z;
    const gap = dist2(at.x, at.z, ox, oz);
    if (gap < 4.5) {
      const shove = (4.5 - gap) * 0.5;
      const dx = at.x - ox;
      const dz = at.z - oz;
      const len = Math.hypot(dx, dz) || 1;
      at.x += (dx / len) * shove;
      at.z += (dz / len) * shove;
      driven.speed *= 0.92;
    }
  }
  // Pedestrians get shoved aside by the car (they dodge first — see
  // traffic.js). A hit stumbles them and slows the car a little.
  for (const ped of S.peds) {
    const gap = dist2(at.x, at.z, ped.mesh.position.x, ped.mesh.position.z);
    if (gap < 2.4) {
      const dx = ped.mesh.position.x - at.x;
      const dz = ped.mesh.position.z - at.z;
      const len = Math.hypot(dx, dz) || 1;
      ped.mesh.position.x += (dx / len) * 1.2;
      ped.mesh.position.z += (dz / len) * 1.2;
      ped.fleeTimer = Math.max(ped.fleeTimer, 1.2);
      ped.stumble = 0.5;
      driven.speed *= 0.94;
    }
  }
  driven.mesh.position.x = at.x;
  driven.mesh.position.z = at.z;
  driven.mesh.rotation.y = driven.heading;
  // The wheels spin with the speed — the whole wheel group turns, hub
  // included.
  for (const wheel of driven.mesh.userData.wheels) wheel.rotation.x += driven.speed * dt * 2.4;
  // The player rides along: keep the on-foot body at the car so the
  // camera and the HUD track it.
  const player = S.player;
  player.pos.x = at.x;
  player.pos.z = at.z;
  player.heading = driven.heading;
  S.speedKmh = Math.abs(driven.speed) * 3.6;
  if (S.audio) S.audio.engine(Math.abs(driven.speed) / WORLD.playerTopSpeed, Boolean(driven));
  if (Math.abs(driven.speed) > 4) addHeat(0); // a no-op guard: driving alone adds no heat
  updateChaseCamera(dt, driven);
}

function updateChaseCamera(dt, car) {
  const camera = S.camera;
  // A low chase view, nine and a half metres behind the car and just
  // above roof height: the road rushes past and the dusk light reads in
  // the frame. The camera aims a little above the car's centre (y 2.4,
  // not 1.4) so tall things ahead — the SOLMAR HARBOR sign at the end
  // of the road — sit inside the frame instead of being cut off at the
  // top edge.
  const back = 9.5; // the follow distance: far enough that the car reads
  // as a car in a street, not a wall filling the lower frame
  const rideH = 2.6;
  const goalX = car.mesh.position.x - Math.sin(car.heading) * back;
  const goalZ = car.mesh.position.z - Math.cos(car.heading) * back;
  const goalY = rideH;
  // A hard follow (dt*25): effectively instant in slow headless frames,
  // so the camera never lags a whole street behind a 122 km/h car, and
  // it stays smooth at 60 fps on a real machine.
  const follow = Math.min(1, dt * 25);
  camera.position.x += (goalX - camera.position.x) * follow;
  camera.position.y += (goalY - camera.position.y) * follow;
  camera.position.z += (goalZ - camera.position.z) * follow;
  camera.lookAt(car.mesh.position.x, 2.4, car.mesh.position.z);
  // Speed feel: the field of view opens a little as the car
  // accelerates, 55 at rest to 67 at top speed. Eased, so it never jumps.
  const speedRatio = Math.min(1, Math.abs(car.speed) / WORLD.playerTopSpeed);
  const targetFov = 55 + speedRatio * 12;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}
