// Player.js — the human-controlled first-person entity.
window.TFPS = window.TFPS || {};

const RUN_SPEED = 7.2, WALK_SPEED = 3.6, CROUCH_SPEED = 3.0;
const GRAVITY = 24, JUMP_SPEED = 7.2;
const EYE_STAND = 1.68, EYE_CROUCH = 1.05;
const MOUSE_SENS = 0.0022;

TFPS.Player = class Player {
  constructor(camera, scene, colliderBoxes, blockerMeshes, audio, bus) {
    this.camera = camera;
    this.scene = scene;
    this.colliders = colliderBoxes;
    this.blockerMeshesRef = blockerMeshes;
    this.audio = audio;
    this.bus = bus;
    this.teamId = 'attacker';
    this.isBot = false;

    this.position = new THREE.Vector3(0, 0, -40);
    this.yaw = 0; this.pitch = 0;
    this.velocityY = 0; this.grounded = true;
    this.isCrouching = false; this.isWalking = false; this.isScoped = false;
    this.bobPhase = 0;
    this.footstepTimer = 0;

    this.maxHealth = 100;
    this.health = 100;
    this.shield = 0;
    this.credits = 800;
    this.kills = 0; this.deaths = 0;
    this.isAlive = true;
    this.blindUntil = 0;
    this.lastDamage = null; // {angle, time}

    this.weapons = { pistol: new TFPS.WeaponInstance('pistol') };
    this.currentWeaponId = 'pistol';
    this.abilityCharges = { flash: 0, smoke: 0 };

    this.interacting = false;
    this.interactProgress = 0; // 0..1 exposed to RoundManager/HUD

    this.uiSpread = 0.01;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.moveVelocity = new THREE.Vector3();

    this._buildHitbox();
    this._buildViewModel();
    this._baseFov = camera.fov;
  }

  _buildHitbox() {
    this.body = new THREE.Group();
    const invisible = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), invisible);
    head.position.set(0, EYE_STAND, 0);
    head.userData.hitbox = { part: 'head', owner: this };
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.15, 8), invisible.clone());
    torso.position.set(0, EYE_STAND - 0.75, 0);
    torso.userData.hitbox = { part: 'body', owner: this };
    this.body.add(head, torso);
    this.headMesh = head; this.bodyMesh = torso;
    this.scene.add(this.body);
  }

  get hitboxMeshes() { return [this.headMesh, this.bodyMesh]; }

  _buildViewModel() {
    this.viewModel = new THREE.Group();
    this.viewModel.position.set(0.32, -0.28, -0.55);
    this.camera.add(this.viewModel);
    this._gunMeshes = {};
    const specs = {
      pistol: { body: [0.09, 0.16, 0.35], barrel: [0.05, 0.05, 0.22], color: 0x2c2f33 },
      smg: { body: [0.1, 0.17, 0.55], barrel: [0.05, 0.05, 0.3], color: 0x35383d },
      rifle: { body: [0.1, 0.16, 0.72], barrel: [0.045, 0.045, 0.4], color: 0x3c4a35 },
      sniper: { body: [0.1, 0.15, 0.95], barrel: [0.045, 0.045, 0.55], color: 0x2a2e2b },
    };
    for (const id in specs) {
      const s = specs[id];
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.55, metalness: 0.4 });
      const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(...s.body), bodyMat);
      const barrelMesh = new THREE.Mesh(new THREE.CylinderGeometry(...s.barrel, 8), bodyMat);
      barrelMesh.rotation.x = Math.PI / 2;
      barrelMesh.position.set(0, 0.02, -s.body[2] / 2 - s.barrel[2] / 2 + 0.02);
      const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.09),
        new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.7 }));
      gripMesh.position.set(0, -0.16, s.body[2] * 0.18);
      g.add(bodyMesh, barrelMesh, gripMesh);
      g.visible = false;
      this._gunMeshes[id] = g;
      this.viewModel.add(g);
    }
    this._gunMeshes.pistol.visible = true;
    this._kick = 0;
  }

  currentWeapon() { return this.weapons[this.currentWeaponId]; }

  ownsWeapon(id) { return !!this.weapons[id]; }

  buyWeapon(id) {
    const def = TFPS.WeaponData[id];
    if (!def || this.credits < def.price) return false;
    this.credits -= def.price;
    this.weapons[id] = new TFPS.WeaponInstance(id);
    this.currentWeaponId = id;
    this._switchViewModel(id);
    this.audio.playBuySound();
    return true;
  }

  buyShield(kind) {
    const spec = kind === 'heavy' ? TFPS.WeaponData.SHIELD_HEAVY : TFPS.WeaponData.SHIELD_LIGHT;
    if (this.credits < spec.price) return false;
    this.credits -= spec.price;
    this.shield = spec.amount;
    this.audio.playBuySound();
    return true;
  }

  buyAbility(kind) {
    const price = TFPS.WeaponData.ABILITY_PRICE;
    if (this.credits < price) return false;
    if (this.abilityCharges[kind] >= TFPS.WeaponData.ABILITY_MAX_CHARGES) return false;
    this.credits -= price;
    this.abilityCharges[kind]++;
    this.audio.playBuySound();
    return true;
  }

  _switchViewModel(id) {
    for (const k in this._gunMeshes) this._gunMeshes[k].visible = (k === id);
  }

  switchWeapon(id) {
    if (!this.weapons[id]) return;
    if (this.currentWeapon().reloading) return;
    this.currentWeaponId = id;
    this._switchViewModel(id);
  }

  getEyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + (this.isCrouching ? EYE_CROUCH : EYE_STAND), this.position.z);
  }
  getForwardVector() {
    const v = new THREE.Vector3();
    this.camera.getWorldDirection(v);
    return v;
  }

  applyBlind(seconds) {
    this.blindUntil = Math.max(this.blindUntil, performance.now() + seconds * 1000);
  }
  isBlind(now) { return now < this.blindUntil; }

  takeDamage(amount, isHeadshot, sourceWorldPos, now) {
    if (!this.isAlive) return;
    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }
    this.health -= remaining;
    this.audio.playDamageGrunt();
    // Bearing of the damage source relative to where the player is looking,
    // measured as a clockwise angle from "straight ahead" (0 = ahead, matching
    // the CSS rotate() clockwise convention the HUD arc uses: 0=top, +90=right).
    const toSource = new THREE.Vector3().subVectors(sourceWorldPos, this.getEyePosition());
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const relAngle = Math.atan2(toSource.dot(right), toSource.dot(forward));
    this.lastDamage = { angle: relAngle, time: now };
    if (this.health <= 0) {
      this.health = 0;
      this.die();
      this.bus.emit('playerDied', { isHeadshot });
    }
  }

  die() {
    this.isAlive = false;
    this.deaths++;
  }

  resetForNewRound(spawnPoint, keepEconomy) {
    this.isAlive = true;
    this.health = this.maxHealth;
    this.position.set(spawnPoint.x, 0, spawnPoint.z);
    this.velocityY = 0; this.grounded = true;
    this.yaw = 0; this.pitch = 0;
    this.blindUntil = 0;
    this.interacting = false; this.interactProgress = 0;
    for (const id in this.weapons) this.weapons[id].refill();
    this.abilityCharges = { flash: 0, smoke: 0 };
    // Shield does not carry over — must be rebought each round, like ammo.
    this.shield = 0;
  }

  // ---- Per-frame update ----
  update(dt, input, now, ctx) {
    if (!this.isAlive) { this._syncCamera(); return; }

    if (this.isBlind(now)) {
      // Blinded: can still hear/move a little but not aim usefully.
    } else {
      const md = input.consumeMouseDelta();
      this.yaw -= md.x * MOUSE_SENS;
      this.pitch -= md.y * MOUSE_SENS;
      this.pitch = TFPS.Utils.clamp(this.pitch, -1.5, 1.5);
    }

    this.isCrouching = input.isDown('ControlLeft') || input.isDown('ControlRight');
    this.isWalking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const weaponDef = this.currentWeapon().def;
    this.isScoped = input.mouseRight && !this.interacting;

    // --- Movement ---
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let mz = 0, mx = 0;
    if (!this.interacting) {
      if (input.isDown('KeyW')) mz += 1;
      if (input.isDown('KeyS')) mz -= 1;
      if (input.isDown('KeyD')) mx += 1;
      if (input.isDown('KeyA')) mx -= 1;
    }
    let speed = this.isCrouching ? CROUCH_SPEED : (this.isWalking ? WALK_SPEED : RUN_SPEED);
    speed *= weaponDef.moveSpeedMult || 1;
    if (this.isScoped && weaponDef.scoped) speed *= weaponDef.scopedMoveMult;
    else if (this.isScoped) speed *= 0.9;

    const move = new THREE.Vector3();
    if (mz !== 0 || mx !== 0) {
      move.addScaledVector(forward, mz).addScaledVector(right, mx).normalize();
    }
    const accel = this.grounded ? 10.5 : 4.5;
    const current = this.moveVelocity.clone();
    const desired = move.multiplyScalar(speed);
    this.moveVelocity.lerp(desired, TFPS.Utils.clamp(accel * dt, 0, 1));
    if (move.lengthSq() < 0.0001) this.moveVelocity.multiplyScalar(Math.max(0, 1 - dt * 8));

    const moving = this.moveVelocity.lengthSq() > 0.00001;
    TFPS.Utils.moveWithCollision(this.position, this.moveVelocity.x * dt, this.moveVelocity.z * dt, this.colliders, 0.38);

    // Jump / gravity
    if (input.isDown('Space') && this.grounded && !this.interacting) {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.velocityY -= GRAVITY * dt;
      this.position.y += this.velocityY * dt;
      if (this.position.y <= 0) { this.position.y = 0; this.velocityY = 0; this.grounded = true; }
    }

    // Footsteps
    if (moving && this.grounded) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.audio.playFootstep(true);
        this.footstepTimer = TFPS.Utils.lerp(0.52, 0.3, TFPS.Utils.clamp(speed / RUN_SPEED, 0, 1));
      }
      this.bobPhase += dt * speed * 1.6;
    } else {
      this.bobPhase *= 0.9;
    }

    this.recoilPitch = TFPS.Utils.lerp(this.recoilPitch, 0, TFPS.Utils.clamp(dt * 10, 0, 1));
    this.recoilYaw = TFPS.Utils.lerp(this.recoilYaw, 0, TFPS.Utils.clamp(dt * 8, 0, 1));

    this._syncCamera();
    this._updateViewModelAnim(dt, moving);

    // --- Weapon FOV / scope ---
    let targetFov = this._baseFov;
    if (this.isScoped && weaponDef.scoped) targetFov = weaponDef.scopedFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = TFPS.Utils.lerp(this.camera.fov, targetFov, TFPS.Utils.clamp(dt * 10, 0, 1));
      this.camera.updateProjectionMatrix();
    }

    // --- Weapon logic ---
    const weapon = this.currentWeapon();
    weapon.update(now);
    this.uiSpread = weapon.currentSpreadRadius({ moving, crouching: this.isCrouching, ads: this.isScoped });

    if (!this.isBlind(now) && !this.interacting) {
      const wantsFire = weaponDef.isAuto ? input.mouseLeft : input.mouseLeftJustPressed;
      if (wantsFire && weapon.canFire(now)) this._fire(weapon, weaponDef, now, ctx);

      if (input.justPressed('KeyR') && weapon.startReload(now)) this.audio.playReload();

      for (let i = 0; i < TFPS.WeaponData.order.length; i++) {
        if (input.justPressed('Digit' + (i + 1)) && this.weapons[TFPS.WeaponData.order[i]]) {
          this.switchWeapon(TFPS.WeaponData.order[i]);
        }
      }

      if (input.justPressed('KeyQ') && this.abilityCharges.flash > 0) {
        this.abilityCharges.flash--;
        ctx.abilities.throwFlash(this.getEyePosition(), this.getForwardVector(), this.teamId);
      }
      if (input.justPressed('KeyE') && this.abilityCharges.smoke > 0) {
        this.abilityCharges.smoke--;
        ctx.abilities.throwSmoke(this.getEyePosition(), this.getForwardVector(), this.teamId);
      }
    }

    // Sync hitbox body group to position
    this.body.position.set(this.position.x, this.position.y, this.position.z);
    this.body.scale.y = this.isCrouching ? 0.78 : 1;
  }

  _fire(weapon, weaponDef, now, ctx) {
    weapon.registerShot(now);
    const origin = this.getEyePosition();
    const forward = this.getForwardVector();
    const spread = this.uiSpread;
    const dir = TFPS.WeaponSystem.jitteredDirection(forward, spread);
    const result = TFPS.WeaponSystem.fireHitscan(
      origin, dir, weaponDef.range, ctx.blockerMeshes, ctx.enemyHitboxMeshes || []
    );
    this.audio.playGunshot(weaponDef.id);
    this._kick = 1;
    const recoilStrength = 0.045 + (spread * 24);
    this.recoilPitch += recoilStrength;
    this.recoilYaw += (Math.random() - 0.5) * 0.025;
    this.pitch = TFPS.Utils.clamp(this.pitch + recoilStrength * 0.65, -1.5, 1.5);
    this.bus.emit('shotFired', {
      shooter: this, origin, end: result.end, color: weaponDef.tracerColor, isPlayer: true,
    });
    if (result.hit && result.isEntity && result.target && result.target.isAlive) {
      const dmg = TFPS.WeaponSystem.damageFor(weaponDef, result.part);
      const wasAlive = result.target.isAlive;
      result.target.takeDamage(dmg, result.part === 'head', origin, now);
      const killed = wasAlive && !result.target.isAlive;
      this.bus.emit('hitConfirmed', { isHeadshot: result.part === 'head', isKill: killed });
      if (killed) {
        this.kills++;
        this.bus.emit('killFeed', { killer: this, victim: result.target, headshot: result.part === 'head' });
        this.credits = Math.min(9000, this.credits + 200);
      }
    }
  }

  _syncCamera() {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.recoilYaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    const eye = this.isCrouching ? EYE_CROUCH : EYE_STAND;
    this.camera.position.set(this.position.x, this.position.y + eye, this.position.z);
  }

  _updateViewModelAnim(dt, moving) {
    this._kick = TFPS.Utils.lerp(this._kick, 0, TFPS.Utils.clamp(dt * 12, 0, 1));
    const bobY = moving ? Math.sin(this.bobPhase) * 0.02 : 0;
    const bobX = moving ? Math.cos(this.bobPhase * 0.5) * 0.015 : 0;
    this.viewModel.position.set(0.32 + bobX, -0.28 + bobY - this._kick * 0.05, -0.55 + this._kick * 0.08);
    this.viewModel.rotation.x = -this._kick * 0.18;
  }
};
