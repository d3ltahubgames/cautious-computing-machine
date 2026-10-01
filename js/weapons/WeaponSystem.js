// WeaponSystem.js — per-weapon ammo/reload/heat state, and the single hitscan
// function used by BOTH the player and every bot so combat feels consistent.
window.TFPS = window.TFPS || {};

TFPS.WeaponInstance = class WeaponInstance {
  constructor(defId) {
    this.def = TFPS.WeaponData[defId];
    this.ammoInMag = this.def.magSize;
    this.ammoReserve = this.def.reserveMax;
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.lastFireAt = -99999;
    this.heat = 0; // 0..1, drives spread
  }

  refill() {
    this.ammoInMag = this.def.magSize;
    this.ammoReserve = this.def.reserveMax;
    this.reloading = false;
    this.heat = 0;
  }

  canFire(now) {
    if (this.reloading) return false;
    if (this.ammoInMag <= 0) return false;
    return (now - this.lastFireAt) >= this.def.fireRateMs;
  }

  startReload(now) {
    if (this.reloading) return false;
    if (this.ammoInMag >= this.def.magSize) return false;
    if (this.ammoReserve <= 0) return false;
    this.reloading = true;
    this.reloadEndsAt = now + this.def.reloadMs;
    return true;
  }

  update(now) {
    if (this.reloading && now >= this.reloadEndsAt) {
      const need = this.def.magSize - this.ammoInMag;
      const take = Math.min(need, this.ammoReserve);
      this.ammoInMag += take;
      this.ammoReserve -= take;
      this.reloading = false;
    }
    // Heat (spread bloom) decays continuously.
    this.heat = Math.max(0, this.heat - this.def.spreadRecoverPerSec * (1 / 60));
  }

  registerShot(now) {
    this.ammoInMag -= 1;
    this.lastFireAt = now;
    this.heat = Math.min(1, this.heat + this.def.spreadPerShot / this.def.spreadMax);
  }

  currentSpreadRadius(opts) {
    const d = this.def;
    let s = d.spreadBase + this.heat * (d.spreadMax - d.spreadBase);
    if (opts.moving) s *= d.moveSpreadMult;
    if (opts.crouching) s *= d.crouchSpreadMult;
    if (opts.ads) s *= d.adsSpreadMult;
    return s;
  }
};

TFPS.WeaponSystem = {
  _raycaster: new THREE.Raycaster(),

  // Fires one shot along `direction` (already jittered by the caller) from
  // `origin`, testing against static blockers first (walls/crates always win
  // the closest-hit check) then enemy hitbox meshes. Returns a result object
  // describing what — if anything — was hit, and where, so the caller can
  // spawn a tracer/impact effect.
  fireHitscan(origin, direction, maxRange, blockerMeshes, hitboxMeshes) {
    const rc = this._raycaster;
    rc.set(origin, direction);
    rc.near = 0.05;
    rc.far = maxRange;
    const all = blockerMeshes.concat(hitboxMeshes);
    const hits = rc.intersectObjects(all, false);
    if (hits.length === 0) {
      return { hit: false, end: origin.clone().add(direction.clone().multiplyScalar(maxRange)) };
    }
    const first = hits[0];
    const hitbox = first.object.userData && first.object.userData.hitbox;
    return {
      hit: true,
      point: first.point.clone(),
      distance: first.distance,
      isEntity: !!hitbox,
      part: hitbox ? hitbox.part : null,
      target: hitbox ? hitbox.owner : null,
      end: first.point.clone(),
    };
  },

  // Random direction within a cone of half-angle `spreadRadius` (radians)
  // around `forward`.
  jitteredDirection(forward, spreadRadius) {
    if (spreadRadius <= 0.0001) return forward.clone();
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spreadRadius;
    // Build an orthonormal basis around `forward`.
    const up = Math.abs(forward.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();
    const offset = right.multiplyScalar(Math.cos(theta) * r).add(trueUp.multiplyScalar(Math.sin(theta) * r));
    return forward.clone().add(offset).normalize();
  },

  damageFor(def, part) {
    return part === 'head' ? def.damageHead : def.damageBody;
  },
};
