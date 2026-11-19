// Solmar City — cars: factory, arcade driving, enter/exit/steal (v4 polish).
// Police cruisers are black-and-white with a big light bar and flashing
// glow halos, so they read as police at distance instead of black traffic.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, addHeat, clamp, dist2 } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const CAR_COLORS = [0xd8b83a, 0x3a7ad8, 0xd84a4a, 0x4ad87a, 0xe8e8e8, 0x222226, 0xd87ab8, 0x7ad8d8];

function glowSprite(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color);
  grad.addColorStop(0.5, color.replace('1)', '0.45)'));
  grad.addColorStop(1, color.replace('1)', '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.6, 3.6, 1);
  return sp;
}

function groundGlowMesh(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color);
  grad.addColorStop(0.5, color.replace('1)', '0.4)'));
  grad.addColorStop(1, color.replace('1)', '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 4.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.5 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

let taxiSignTex = null;
function getTaxiSignTex() {
  if (taxiSignTex) return taxiSignTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#1c1e22';
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 64, 25);
  taxiSignTex = new THREE.CanvasTexture(c);
  return taxiSignTex;
}

export function makeCar(color, police, kind) {
  const group = new THREE.Group();
  const k = police ? 'police' : (kind || 'sedan');
  // An undefined paint colour means "pick a random one" (traffic cars).
  const paint = color === undefined ? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] : color;
  const isTruck = k === 'truck';
  const isTaxi = k === 'taxi';
  // Distinct proportions per model: sedan 4.3 m, taxi sedan + roof sign,
  // truck 5.4 m with a tall cab and a cargo box, police sedan two-tone.
  const bodyLen = isTruck ? 5.4 : 4.3;
  const bodyMat = new THREE.MeshLambertMaterial({
    color: police ? 0xf2f2f2 : isTaxi ? 0xe8c832 : paint,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(isTruck ? 2.0 : 1.9, isTruck ? 0.7 : 0.62, bodyLen), bodyMat);
  body.position.y = isTruck ? 0.68 : 0.62;
  body.castShadow = true;
  group.add(body);
  // Glasshouse: dark-tinted cabin + separate glass panes so cars stop
  // reading as flat boxes — windshield, side windows, rear window.
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x101c28 });
  const glassEdge = new THREE.MeshBasicMaterial({ color: 0x3a5a78 });
  let cabin, cabinZ;
  if (isTruck) {
    cabinZ = 1.55;
    cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 1.5), new THREE.MeshLambertMaterial({ color: 0x2a4a6a }));
    cabin.position.set(0, 1.5, cabinZ);
    cabin.castShadow = true;
    group.add(cabin);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.25, 2.7), new THREE.MeshLambertMaterial({ color: 0xb8bcc2 }));
    cargo.position.set(0, 1.55, -1.1);
    cargo.castShadow = true;
    group.add(cargo);
    // Cargo ribs.
    for (const rz of [-2.1, -1.1, -0.1]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.97, 1.27, 0.08), new THREE.MeshLambertMaterial({ color: 0x8a8e94 }));
      rib.position.set(0, 1.55, rz);
      group.add(rib);
    }
  } else {
    cabinZ = -0.25;
    // Police cabin is WHITE with dark glass: from behind, a white cabin +
    // black roof + light bar reads as a police car; a black cabin (v4's
    // first run) made the whole cruiser read as a black traffic car.
    cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.55, 2.2),
      new THREE.MeshLambertMaterial({ color: police ? 0xf2f2f2 : 0x223344 })
    );
    cabin.position.set(0, 1.18, cabinZ);
    cabin.castShadow = true;
    group.add(cabin);
  }
  const winZ = cabinZ + (isTruck ? 0.78 : 1.12);
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(isTruck ? 1.7 : 1.5, isTruck ? 0.6 : 0.5), glassMat);
  windshield.position.set(0, isTruck ? 1.55 : 1.22, winZ);
  windshield.rotation.x = -0.28;
  group.add(windshield);
  const winEdge = new THREE.Mesh(new THREE.PlaneGeometry(isTruck ? 1.7 : 1.5, 0.05), glassEdge);
  winEdge.position.set(0, isTruck ? 1.88 : 1.46, winZ + 0.08);
  winEdge.rotation.x = -0.28;
  group.add(winEdge);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(isTruck ? 1.2 : 1.9, 0.42), glassMat);
    side.position.set(s * (isTruck ? 0.96 : 0.86), isTruck ? 1.55 : 1.2, cabinZ);
    side.rotation.y = s * Math.PI / 2;
    group.add(side);
  }
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(isTruck ? 1.7 : 1.5, 0.45), glassMat);
  rear.position.set(0, isTruck ? 1.55 : 1.2, cabinZ - (isTruck ? 0.78 : 1.12));
  rear.rotation.y = Math.PI;
  group.add(rear);

  if (police) {
    // Black hood + roof on a white body, black door stripes, big light bar.
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.1, 1.0), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    hood.position.set(0, 0.94, 1.62);
    group.add(hood);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.08, 2.0), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    roof.position.set(0, 1.48, -0.25);
    group.add(roof);
    for (const s of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 2.1), new THREE.MeshLambertMaterial({ color: 0x14161a }));
      stripe.position.set(s * 0.96, 0.72, -0.2);
      group.add(stripe);
    }
    // BIG light bar: wide red/blue blocks with glow halos.
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.56, -0.25);
    group.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.24, 0.46), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.set(-0.44, 1.74, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.24, 0.46), new THREE.MeshBasicMaterial({ color: 0x2a6aff }));
    blue.position.set(0.44, 1.74, -0.25);
    group.add(blue);
    const redGlow = glowSprite('rgba(255,42,42,1)');
    redGlow.position.set(-0.44, 1.78, -0.25);
    group.add(redGlow);
    const blueGlow = glowSprite('rgba(42,106,255,1)');
    blueGlow.position.set(0.44, 1.78, -0.25);
    group.add(blueGlow);
    // Red/blue light spilling onto the road under the cruiser.
    const redGround = groundGlowMesh('rgba(255,42,42,1)');
    redGround.position.set(-0.44, 0.04, -0.25);
    group.add(redGround);
    const blueGround = groundGlowMesh('rgba(42,106,255,1)');
    blueGround.position.set(0.44, 0.04, -0.25);
    group.add(blueGround);
    group.userData.redGlow = redGlow;
    group.userData.blueGlow = blueGlow;
    group.userData.redLens = red;
    group.userData.blueLens = blue;
    group.userData.redGround = redGround;
    group.userData.blueGround = blueGround;
  }

  if (isTaxi) {
    // Checker band along the doors + a lit TAXI roof sign.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const sq = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.22, 0.3),
          new THREE.MeshLambertMaterial({ color: i % 2 ? 0x1c1e22 : 0xf2f2f2 })
        );
        sq.position.set(s * 0.96, 0.78, -1.2 + i * 0.48);
        group.add(sq);
      }
    }
    const roofSign = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.4),
      new THREE.MeshBasicMaterial({ map: getTaxiSignTex() })
    );
    roofSign.position.set(0, 1.62, -0.25);
    group.add(roofSign);
  }

  // Wheels with pale hubs so they read against dark asphalt.
  const wheelR = isTruck ? 0.44 : 0.36;
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xb8bcc2 });
  const wheels = [];
  const wzF = bodyLen / 2 - 0.8, wzR = -(bodyLen / 2 - 0.8);
  for (const [wx, wz] of [[-0.95, wzF], [0.95, wzF], [-0.95, wzR], [0.95, wzR]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 10), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wheelR, wz);
    group.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, wheelR, wz);
    group.add(rim);
    wheels.push(w);
  }
  // Bumpers + plates front and rear.
  const bumpMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
  const plateMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (const s of [1, -1]) {
    const bz = s * (bodyLen / 2 + 0.02);
    const bump = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.18, 0.22), bumpMat);
    bump.position.set(0, 0.42, bz);
    group.add(bump);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.15, 0.04), plateMat);
    plate.position.set(0, 0.52, s * (bodyLen / 2 + 0.14));
    group.add(plate);
  }
  // Headlights (warm glow at dusk) + glowing taillights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
    h.position.set(s * 0.62, 0.66, bodyLen / 2 + 0.01);
    group.add(h);
    const hg = glowSprite('rgba(255,242,184,1)');
    hg.scale.set(1.5, 1.5, 1);
    hg.position.set(s * 0.62, 0.66, bodyLen / 2 + 0.25);
    group.add(hg);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
    t.position.set(s * 0.62, 0.66, -bodyLen / 2 - 0.01);
    group.add(t);
    const tg = glowSprite('rgba(255,58,58,1)');
    tg.scale.set(1.1, 1.1, 1);
    tg.position.set(s * 0.62, 0.66, -bodyLen / 2 - 0.25);
    group.add(tg);
  }
  group.userData.wheels = wheels;
  group.userData.police = !!police;
  group.userData.kind = k;
  return group;
}

export function spawnParkedCar(x, z, heading, color, kind) {
  const mesh = makeCar(color === undefined ? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] : color, false, kind);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.6, 0.03);
  const car = { mesh, heading, speed: 0, steer: 0, police: false, parked: true, driver: null, kind: mesh.userData.kind };
  S.cars.push(car);
  return car;
}

export function nearestCar(x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const c of S.cars) {
    if (c.driver) continue;
    const d = dist2(x, z, c.mesh.position.x, c.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function enterCar(car) {
  const p = S.player;
  car.driver = 'player';
  car.parked = false;
  S.onFoot = false;
  S.currentCar = car;
  p.group.visible = false;
  p.speed = 0;
  if (car.stolen !== true) {
    car.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
    if (S.audio) S.audio.sirenBurst();
  }
}

export function exitCar() {
  const car = S.currentCar;
  if (!car) return;
  const p = S.player;
  car.driver = null;
  car.speed = 0;
  S.currentCar = null;
  S.onFoot = true;
  p.group.visible = true;
  const a = car.heading + Math.PI / 2;
  p.pos.x = car.mesh.position.x + Math.sin(a) * 2.2;
  p.pos.z = car.mesh.position.z + Math.cos(a) * 2.2;
  p.group.position.set(p.pos.x, 0, p.pos.z);
  p.heading = car.heading;
}

export function updateDriving(dt) {
  const car = S.currentCar;
  if (!car) return;
  const k = S.keys;
  const fwd = (k.KeyW || k.ArrowUp) ? 1 : 0;
  const back = (k.KeyS || k.ArrowDown) ? 1 : 0;
  const left = (k.KeyA || k.ArrowLeft) ? 1 : 0;
  const right = (k.KeyD || k.ArrowRight) ? 1 : 0;
  const brake = !!k.Space;
  const accel = (fwd - back) * (brake ? 0.3 : 1);
  car.speed += accel * 16 * dt;
  if (!fwd && !back) car.speed *= Math.max(0, 1 - dt * 1.4);
  if (brake) car.speed *= Math.max(0, 1 - dt * 3.2);
  car.speed = clamp(car.speed, -10, WORLD.playerTopSpeed);
  const steerTarget = (left - right) * 0.55 * Math.min(1, Math.abs(car.speed) / 8);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 6);
  car.heading += car.steer * dt * (car.speed >= 0 ? 1 : -1) * Math.sign(car.speed || 1);
  const nx = car.mesh.position.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.mesh.position.z + Math.cos(car.heading) * car.speed * dt;
  const pos = { x: nx, z: nz };
  resolveCollisions(pos, 1.9);
  // Slow for other cars ahead (formation-pacing cruisers never block).
  for (const other of [...S.cars, ...S.trafficCars, ...S.cruisers]) {
    if (other === car || other.mesh === car.mesh) continue;
    if (other.pace) continue; // a pacing cruiser holds formation, not a block
    const ox = other.mesh ? other.mesh.position.x : other.position.x;
    const oz = other.mesh ? other.mesh.position.z : other.position.z;
    const d = dist2(pos.x, pos.z, ox, oz);
    if (d < 4.5) {
      const push = (4.5 - d) * 0.5;
      const dx = pos.x - ox, dz = pos.z - oz;
      const l = Math.hypot(dx, dz) || 1;
      pos.x += (dx / l) * push;
      pos.z += (dz / l) * push;
      car.speed *= 0.92;
    }
  }
  // Pedestrians get shoved aside by the car (they dodge first — see traffic.js).
  for (const ped of S.peds) {
    const d = dist2(pos.x, pos.z, ped.mesh.position.x, ped.mesh.position.z);
    if (d < 2.4) {
      const dx = ped.mesh.position.x - pos.x;
      const dz = ped.mesh.position.z - pos.z;
      const l = Math.hypot(dx, dz) || 1;
      ped.mesh.position.x += (dx / l) * 1.2;
      ped.mesh.position.z += (dz / l) * 1.2;
      ped.fleeTimer = Math.max(ped.fleeTimer, 1.2);
      ped.stumble = 0.5;
      car.speed *= 0.94;
    }
  }
  car.mesh.position.x = pos.x;
  car.mesh.position.z = pos.z;
  car.mesh.rotation.y = car.heading;
  // Wheel spin.
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.4;
  // Player rides along: keep the on-foot body at the car for the camera.
  const p = S.player;
  p.pos.x = pos.x;
  p.pos.z = pos.z;
  p.heading = car.heading;
  S.speedKmh = Math.abs(car.speed) * 3.6;
  if (S.audio) S.audio.engine(Math.abs(car.speed) / WORLD.playerTopSpeed, !!car);
  if (Math.abs(car.speed) > 4) addHeat(0); // no-op guard: driving alone adds no heat
  updateChaseCamera(dt, car);
}

function updateChaseCamera(dt, car) {
  const cam = S.camera;
  // Low and close to the ground: the road rushes past and the chase feels
  // fast, and the low sun + long shadows read in the frame.
  const back = 8;
  const up = 2.6;
  const tx = car.mesh.position.x - Math.sin(car.heading) * back;
  const tz = car.mesh.position.z - Math.cos(car.heading) * back;
  const ty = up;
  // Strong follow (dt*25): effectively instant in slow headless frames, so
  // the camera never lags a whole street behind a 122 km/h car, and still
  // smooth at 60 fps on a real machine.
  const k = Math.min(1, dt * 25);
  cam.position.x += (tx - cam.position.x) * k;
  cam.position.y += (ty - cam.position.y) * k;
  cam.position.z += (tz - cam.position.z) * k;
  cam.lookAt(car.mesh.position.x, 1.4, car.mesh.position.z);
}
