// Abilities.js — Flash and Smoke thrown gadgets. AbilityManager owns all live
// projectiles/volumes and is ticked once per frame from Game.
window.TFPS = window.TFPS || {};

TFPS.AbilityManager = class AbilityManager {
  constructor(scene, audio, colliderBoxes, eventBus) {
    this.scene = scene;
    this.audio = audio;
    this.colliders = colliderBoxes;
    this.bus = eventBus;
    this.projectiles = []; // in-flight flash/smoke grenades
    this.smokeVolumes = []; // active smoke spheres {center, radius, expiresAt, mesh}
    this.flashes = []; // pending flash pop events this frame (consumed by Game)
  }

  throwFlash(origin, direction, ownerTeam) { this._throw(origin, direction, ownerTeam, 'flash'); }
  throwSmoke(origin, direction, ownerTeam) { this._throw(origin, direction, ownerTeam, 'smoke'); }

  _throw(origin, direction, ownerTeam, kind) {
    const geo = kind === 'flash'
      ? new THREE.SphereGeometry(0.14, 8, 8)
      : new THREE.SphereGeometry(0.16, 8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: kind === 'flash' ? 0xfff2c0 : 0xb9b9b9,
      emissive: kind === 'flash' ? 0xffe58a : 0x000000,
      emissiveIntensity: kind === 'flash' ? 0.6 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.projectiles.push({
      kind, mesh, ownerTeam,
      vel: direction.clone().multiplyScalar(19).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: kind === 'flash' ? 1.1 : 1.4,
      bounces: 0,
    });
  }

  update(dt, allEntities) {
    // --- Projectile flight ---
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 22 * dt;
      const next = p.mesh.position.clone().addScaledVector(p.vel, dt);
      // Cheap ground/wall bounce: if we'd go below floor, reflect and damp.
      if (next.y < 0.15) {
        next.y = 0.15;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.6; p.vel.z *= 0.6;
        p.bounces++;
      }
      // Simple wall bounce using collider boxes (reflect the offending axis).
      for (const box of this.colliders) {
        const probe = new THREE.Box3(
          new THREE.Vector3(next.x - 0.15, next.y - 0.15, next.z - 0.15),
          new THREE.Vector3(next.x + 0.15, next.y + 0.15, next.z + 0.15)
        );
        if (box.intersectsBox(probe)) {
          p.vel.x *= -0.4; p.vel.z *= -0.4;
          next.copy(p.mesh.position);
          p.bounces++;
          break;
        }
      }
      p.mesh.position.copy(next);
      p.fuse -= dt;
      if (p.fuse <= 0 || p.bounces > 6) {
        this._detonate(p, allEntities);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // --- Smoke volume lifecycle (fade in / hold / fade out) ---
    for (let i = this.smokeVolumes.length - 1; i >= 0; i--) {
      const s = this.smokeVolumes[i];
      const remaining = s.expiresAt - performance.now();
      const totalLife = s.totalLife;
      const age = totalLife - remaining;
      let opacity;
      if (age < 800) opacity = TFPS.Utils.clamp(age / 800, 0, 1) * 0.92;
      else if (remaining < 1000) opacity = TFPS.Utils.clamp(remaining / 1000, 0, 1) * 0.92;
      else opacity = 0.92;
      s.mesh.material.opacity = opacity;
      if (remaining <= 0) {
        this.scene.remove(s.mesh);
        this.smokeVolumes.splice(i, 1);
      }
    }
  }

  _detonate(p, allEntities) {
    if (p.kind === 'flash') {
      this.audio.playFlashPop();
      this.bus.emit('flashPop', { position: p.mesh.position.clone() });
      const flashPos = p.mesh.position.clone();
      for (const ent of allEntities) {
        if (!ent.isAlive) continue;
        const toFlash = flashPos.clone().sub(ent.getEyePosition());
        const dist = toFlash.length();
        if (dist > 26) continue;
        toFlash.normalize();
        const los = TFPS.Utils.hasLineOfSight(ent.getEyePosition(), flashPos, ent.blockerMeshesRef, this.smokeVolumes);
        if (!los) continue;
        const forward = ent.getForwardVector();
        const dot = forward.dot(toFlash);
        if (dot < 0.15) continue; // not looking anywhere near it
        const strength = TFPS.Utils.clamp((dot - 0.15) / 0.85, 0, 1) * TFPS.Utils.clamp(1 - dist / 26, 0.2, 1);
        ent.applyBlind(1.2 + strength * 2.3);
      }
    } else {
      this.audio.playSmokeHiss();
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(4.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xdcdcdc, transparent: true, opacity: 0.0, depthWrite: false })
      );
      mesh.position.copy(p.mesh.position);
      mesh.position.y = 2.0;
      this.scene.add(mesh);
      this.smokeVolumes.push({
        center: mesh.position.clone(), radius: 4.2, mesh,
        expiresAt: performance.now() + 15000, totalLife: 15000,
      });
    }
  }

  reset() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const s of this.smokeVolumes) this.scene.remove(s.mesh);
    this.projectiles = [];
    this.smokeVolumes = [];
  }
};
