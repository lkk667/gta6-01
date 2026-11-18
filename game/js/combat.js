// Solmar City — combat and pickups.
// The pistol fires a ray from the camera through the crosshair: it can drop
// pedestrians, damage traffic and police cars, and it always draws heat.
// Fists work at arm's length. Health, ammo and cash pickups sit around the
// city and respawn, so a fight never leaves the player permanently stuck.

import * as THREE from 'three';
import { state, addWanted, setToast, distance2D } from './state.js';
import { knockPedDown, scarePedestrians } from './traffic.js';
import { playGunshot, playPunch, playPickup, playCash } from './audio.js';

export function createCombat(scene, camera) {
  return {
    scene,
    camera,
    raycaster: new THREE.Raycaster(),
    tracer: null,
    tracerTimer: 0,
    muzzleLight: null,
  };
}

export function firePistol(combat, peds, trafficCars, policeCars) {
  const p = state.player;
  if (state.mode !== 'playing') return;
  if (state.magazine <= 0) {
    if (state.ammo > 0) {
      reloadPistol();
      setToast('Reloading…', 1.5);
    } else {
      setToast('Out of ammo — find an ammo box (yellow).', 2.5);
    }
    return;
  }
  state.magazine -= 1;
  p.shooting = 0.12;
  state.shotsFired += 1;
  addWanted(12);
  playGunshot();

  combat.raycaster.setFromCamera(new THREE.Vector2(0, 0), combat.camera);
  combat.raycaster.far = 120;

  // Test pedestrians first (they are small targets the ray must find).
  let hitSomething = false;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const toPed = new THREE.Vector3(ped.x - combat.camera.position.x, 1.2 - combat.camera.position.y, ped.z - combat.camera.position.z);
    const dist = toPed.length();
    toPed.normalize();
    const angle = toPed.angleTo(combat.raycaster.ray.direction);
    if (angle < 0.045 && dist < 90) {
      knockPedDown(ped);
      state.pedestriansHit += 1;
      addWanted(15);
      hitSomething = true;
      break;
    }
  }

  // Then cars: a hit smokes the car and, for traffic, sends the driver fleeing.
  if (!hitSomething) {
    const allCars = [...trafficCars, ...policeCars];
    for (const car of allCars) {
      const toCar = new THREE.Vector3(car.x - combat.camera.position.x, 0.8 - combat.camera.position.y, car.z - combat.camera.position.z);
      const dist = toCar.length();
      toCar.normalize();
      const angle = toCar.angleTo(combat.raycaster.ray.direction);
      if (angle < 0.06 && dist < 100) {
        car.health -= 34;
        car.smokeTimer = 2;
        addWanted(10);
        if (car.kind === 'traffic') {
          car.kind = 'parked';
          car.driver = false;
          car.speed = 0;
          setToast('Driver bailed out — the car is yours.', 2.5);
        }
        hitSomething = true;
        break;
      }
    }
  }

  scarePedestrians(peds, { x: p.x, z: p.z });
  showTracer(combat, hitSomething);
}

export function reloadPistol() {
  const need = state.magazineSize - state.magazine;
  const take = Math.min(need, state.ammo);
  state.magazine += take;
  state.ammo -= take;
}

function showTracer(combat, hit) {
  const start = new THREE.Vector3();
  combat.camera.getWorldPosition(start);
  const end = start.clone().add(combat.raycaster.ray.direction.clone().multiplyScalar(hit ? 40 : 90));
  const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
  if (combat.tracer) {
    combat.scene.remove(combat.tracer);
    combat.tracer.geometry.dispose();
  }
  combat.tracer = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: hit ? 0xffd24a : 0xffffff, transparent: true, opacity: 0.9 }),
  );
  combat.scene.add(combat.tracer);
  combat.tracerTimer = 0.08;
}

export function updateCombat(combat, dt) {
  if (combat.tracerTimer > 0) {
    combat.tracerTimer -= dt;
    if (combat.tracerTimer <= 0 && combat.tracer) {
      combat.scene.remove(combat.tracer);
      combat.tracer.geometry.dispose();
      combat.tracer = null;
    }
  }
  if (state.player.shooting > 0) state.player.shooting -= dt;
  if (state.player.punching > 0) state.player.punching -= dt;
}

export function tryPunch(peds) {
  const p = state.player;
  if (state.mode !== 'playing' || !p.onFoot || p.punching > 0) return;
  p.punching = 0.35;
  playPunch();
  const reach = 2.2;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = distance2D(ped.x, ped.z, p.x, p.z);
    if (d < reach) {
      knockPedDown(ped);
      state.pedestriansHit += 1;
      addWanted(18);
      setToast('You laid them out. People saw that.', 2.5);
      return;
    }
  }
}

// --- Pickups ----------------------------------------------------------------

export function makePickupMesh(kind) {
  const group = new THREE.Group();
  let color = 0x3fae6a;
  if (kind === 'ammo') color = 0xe8c84a;
  if (kind === 'cash') color = 0x2e8f5a;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshLambertMaterial({ color }),
  );
  box.position.y = 0.9;
  box.castShadow = true;
  group.add(box);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  glow.position.y = 0.9;
  group.add(glow);
  group.userData.kind = kind;
  return group;
}

export function spawnPickups(scene, spots) {
  const pickups = [];
  for (const spot of spots) {
    const mesh = makePickupMesh(spot.kind);
    mesh.position.set(spot.x, 0, spot.z);
    scene.add(mesh);
    pickups.push({ mesh, kind: spot.kind, x: spot.x, z: spot.z, taken: false, respawnTimer: 0 });
  }
  return pickups;
}

export function updatePickups(pickups, dt) {
  const p = state.player;
  for (const pickup of pickups) {
    if (pickup.taken) {
      pickup.respawnTimer -= dt;
      if (pickup.respawnTimer <= 0) {
        pickup.taken = false;
        pickup.mesh.visible = true;
      }
      continue;
    }
    // Spin and bob so pickups read at a glance.
    pickup.mesh.rotation.y += dt * 1.5;
    pickup.mesh.children[0].position.y = 0.9 + Math.sin(state.time * 2 + pickup.x) * 0.12;
    const d = distance2D(pickup.x, pickup.z, p.x, p.z);
    const inCar = !!p.inCar;
    const reach = inCar ? 3.2 : 1.8;
    if (d < reach) {
      pickup.taken = true;
      pickup.respawnTimer = 25;
      pickup.mesh.visible = false;
      if (pickup.kind === 'health') {
        state.health = Math.min(state.maxHealth, state.health + 35);
        setToast('Health +35', 2);
        playPickup();
      } else if (pickup.kind === 'ammo') {
        state.ammo += 24;
        setToast('Ammo +24', 2);
        playPickup();
      } else if (pickup.kind === 'cash') {
        state.cash += 50;
        setToast('Found $50 on the street.', 2);
        playCash();
      }
    }
  }
}
