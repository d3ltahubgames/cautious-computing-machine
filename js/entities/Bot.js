// Bot.js — the AI-controlled combatants, both friendly and enemy. One class
// drives all nine of them; only `teamId`/`role` and per-bot skill numbers differ.
window.TFPS = window.TFPS || {};

const BOT_EYE = 1.62;
const BOT_RUN_SPEED = 6.35;
const BOT_SIGHT_RANGE = 42;
const BOT_FOV_DOT = 0.5; // ~60 degrees half-angle
const BOT_FIRE_CONE_DEG = 11;
const BOT_LOSE_TARGET_SEC = 1.4;

function yawFromDir(dir) { return Math.atan2(-dir.x, -dir.z); }

TFPS.Bot = class Bot {
  constructor(id, teamId, scene, colliderBoxes, blockerMeshes, audio, bus, graph) {
    this.id = id;
    this.teamId = teamId; // 'attacker' | 'defender'
    this.isBot = true;
    this.scene = scene;
    this.colliders = colliderBoxes;
    this.blockerMeshesRef = blockerMeshes;
    this.audio = audio;
    this.bus = bus;
    this.graph = graph; // {adj, waypoints}

    this.position = new THREE.Vector3();
    this.facingDir = new THREE.Vector3(0, 0, -1);
    this.aimDir = new THREE.Vector3(0, 0, -1);

    this.maxHealth = 100;
    this.health = 100;
    this.shield = 0;
    this.credits = 800;
    this.kills = 0; this.deaths = 0;
    this.isAlive = true;
    this.blindUntil = 0;

    this.weapons = { pistol: new TFPS.WeaponInstance('pistol') };
    this.currentWeaponId = 'pistol';
    this.abilityCharges = { flash: 0, smoke: 0 };

    // Skill variance so bots don't feel identical.
    this.aimJitterRad = THREE.MathUtils.degToRad(TFPS.Utils.randRange(3, 7.5));
    this.turnSpeed = TFPS.Utils.randRange(3.2, 5.4);
    this.reactionMs = TFPS.Utils.randRange(160, 420);
    this._jitterOffset = new THREE.Vector3();
    this._jitterAt = 0;

    this.state = 'idle';
    this.path = [];
    this.objective = null; // {kind:'site', site:'A'|'B'} etc.
    this.target = null;
    this.targetLastSeen = 0;
    this.engageStartedAt = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.holdOffset = TFPS.Utils.randRange(-2.4, 2.4);
    this.chokeWaitUntil = 0;
    this._chokePausing = false;
    this._chokePauseDone = false;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = TFPS.Utils.randRange(0.4, 0.9);
    this.retreatUntil = 0;

    this._buildMesh();
  }

  _buildMesh() {
    const accent = this.teamId === 'attacker' ? 0x3aa0ff : 0xff5a3c;
    const suit = 0x2b2e33;
    const group = new THREE.Group();

    const legs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.26, 0.95, 10),
      new THREE.MeshStandardMaterial({ color: suit, roughness: 0.8 })
    );
    legs.position.y = 0.5;
    legs.castShadow = true;

    const vest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.3, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 })
    );
    vest.position.y = 1.18;
    vest.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8b48c, roughness: 0.9 })
    );
    head.position.y = BOT_EYE;
    head.castShadow = true;

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.1, 0.14),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.3, metalness: 0.5 })
    );
    visor.position.set(0, BOT_EYE + 0.16, -0.12);

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.14, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5 })
    );
    gun.position.set(0.22, 1.05, -0.25);
    this.gunMesh = gun;

    group.add(legs, vest, head, visor, gun);
    this.scene.add(group);
    this.mesh = group;

    // Invisible hitboxes, geometrically separate from the visual mesh so the
    // raycaster and the renderer never disagree about where "head" is.
    const invisible = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false });
    const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 8), invisible);
    headHit.userData.hitbox = { part: 'head', owner: this };
    const bodyHit = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.34, 1.4, 8), invisible.clone());
    bodyHit.userData.hitbox = { part: 'body', owner: this };
    this.headMesh = headHit; this.bodyMesh = bodyHit;
    this.scene.add(headHit, bodyHit);
  }

  get hitboxMeshes() { return [this.headMesh, this.bodyMesh]; }

  getEyePosition() { return new THREE.Vector3(this.position.x, this.position.y + BOT_EYE, this.position.z); }
  getForwardVector() { return this.facingDir.clone(); }
  applyBlind(seconds) { this.blindUntil = Math.max(this.blindUntil, performance.now() + seconds * 1000); }
  isBlind(now) { return now < this.blindUntil; }

  currentWeapon() { return this.weapons[this.currentWeaponId]; }

  // ---- Economy (simple priority ladder; bots spend everything sensibly) ----
  autoBuy() {
    const own = id => !!this.weapons[id];
    if (this.credits >= TFPS.WeaponData.rifle.price && !own('rifle')) {
      this.credits -= TFPS.WeaponData.rifle.price;
      this.weapons.rifle = new TFPS.WeaponInstance('rifle');
      this.currentWeaponId = 'rifle';
    } else if (this.credits >= TFPS.WeaponData.smg.price && !own('smg') && !own('rifle')) {
      this.credits -= TFPS.WeaponData.smg.price;
      this.weapons.smg = new TFPS.WeaponInstance('smg');
      this.currentWeaponId = 'smg';
    } else if (own('rifle')) this.currentWeaponId = 'rifle';
    else if (own('smg')) this.currentWeaponId = 'smg';

    if (Math.random() < 0.18 && this.credits >= TFPS.WeaponData.sniper.price + 1000 && !own('sniper')) {
      this.credits -= TFPS.WeaponData.sniper.price;
      this.weapons.sniper = new TFPS.WeaponInstance('sniper');
      this.currentWeaponId = 'sniper';
    }

    if (this.credits >= TFPS.WeaponData.SHIELD_HEAVY.price) {
      this.credits -= TFPS.WeaponData.SHIELD_HEAVY.price;
      this.shield = TFPS.WeaponData.SHIELD_HEAVY.amount;
    } else if (this.credits >= TFPS.WeaponData.SHIELD_LIGHT.price) {
      this.credits -= TFPS.WeaponData.SHIELD_LIGHT.price;
      this.shield = TFPS.WeaponData.SHIELD_LIGHT.amount;
    }

    while (this.credits >= TFPS.WeaponData.ABILITY_PRICE &&
      (this.abilityCharges.flash + this.abilityCharges.smoke) < TFPS.WeaponData.ABILITY_MAX_CHARGES * 2) {
      const kind = this.abilityCharges.flash <= this.abilityCharges.smoke ? 'flash' : 'smoke';
      if (this.abilityCharges[kind] >= TFPS.WeaponData.ABILITY_MAX_CHARGES) break;
      this.credits -= TFPS.WeaponData.ABILITY_PRICE;
      this.abilityCharges[kind]++;
    }
  }

  // ---- Round lifecycle ----
  resetForNewRound(spawnPoint, objective) {
    this.isAlive = true;
    this.health = this.maxHealth;
    this.position.set(spawnPoint.x, 0, spawnPoint.z);
    this.state = 'moveToObjective';
    this.objective = objective;
    this.path = this._planPathTo(objective.node);
    this.target = null;
    this._holdMidSince = null;
    this._chokePausing = false;
    this._chokePauseDone = false;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.blindUntil = 0;
    this.shield = 0; // must be rebought each round, same as the player
    for (const id in this.weapons) this.weapons[id].refill();
    this.abilityCharges = { flash: 0, smoke: 0 };
    this.reviveVisual();
  }

  _planPathTo(nodeId) {
    const start = TFPS.Utils.nearestNode(this.graph.waypoints, this.position.x, this.position.z);
    const nodes = TFPS.Utils.findPath(this.graph.adj, this.graph.waypoints, start, nodeId);
    return nodes.slice(1); // drop our own current node
  }

  takeDamage(amount, isHeadshot, sourceWorldPos, now) {
    if (!this.isAlive) return;
    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed; remaining -= absorbed;
    }
    this.health -= remaining;
    if (this.state === 'defusing') this.defuseProgress = Math.max(0, this.defuseProgress - 0.35);
    if (this.health <= 0) { this.health = 0; this.die(); }
  }

  die() {
    this.isAlive = false;
    this.deaths++;
    this.mesh.visible = false;
    this.headMesh.visible = false; this.bodyMesh.visible = false;
  }

  reviveVisual() {
    this.mesh.visible = true;
    this.headMesh.visible = true; this.bodyMesh.visible = true;
  }

  // ---- Perception ----
  _canSee(other, ctx, now) {
    if (!other.isAlive) return false;
    const eye = this.getEyePosition();
    const otherEye = other.getEyePosition();
    const d = eye.distanceTo(otherEye);
    if (d > BOT_SIGHT_RANGE) return false;
    const toOther = new THREE.Vector3().subVectors(otherEye, eye).normalize();
    if (this.facingDir.dot(toOther) < BOT_FOV_DOT && this.state !== 'engage') return false;
    return TFPS.Utils.hasLineOfSight(eye, otherEye, ctx.blockerMeshes, ctx.smokeVolumes);
  }

  _findVisibleTarget(ctx, now) {
    if (this.target && this.target.isAlive && this._canSee(this.target, ctx, now)) {
      this.targetLastSeen = now;
      return this.target;
    }
    let best = null, bestD = Infinity;
    for (const e of ctx.enemies) {
      if (!this._canSee(e, ctx, now)) continue;
      const d = this.position.distanceTo(e.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---- Main tick ----
  update(dt, now, ctx) {
    if (!this.isAlive) return;
    if (ctx.roundManager.phase !== 'action') { this._syncMesh(); return; } // hold at spawn during buy phase
    this.currentWeapon().update(now);

    const blinded = this.isBlind(now);
    const seen = blinded ? null : this._findVisibleTarget(ctx, now);

    if (seen) {
      if (this.state !== 'engage') { this.engageStartedAt = now; }
      this.target = seen;
      this.targetLastSeen = now;
      this.state = 'engage';
    } else if (this.state === 'engage' && now - this.targetLastSeen > BOT_LOSE_TARGET_SEC * 1000) {
      this.target = null;
      this.state = this.objective && this.objective.kind === 'planted-guard' ? 'holdPosition' : 'moveToObjective';
      if (this.path.length === 0 && this.objective) this.path = this._planPathTo(this.objective.node);
    }

    switch (this.state) {
      case 'engage': this._tickEngage(dt, now, ctx); break;
      case 'moveToObjective': this._tickMoveToObjective(dt, now, ctx); break;
      case 'holdPosition': this._tickHold(dt, now, ctx); break;
      case 'planting': this._tickPlant(dt, now, ctx); break;
      case 'defusing': this._tickDefuse(dt, now, ctx); break;
      case 'rotating': this._tickMoveToObjective(dt, now, ctx); break;
      default: this._tickHold(dt, now, ctx); break;
    }

    this._syncMesh();
  }

  _tickEngage(dt, now, ctx) {
    const target = this.target;
    if (!target) { this.state = 'moveToObjective'; return; }
    const eye = this.getEyePosition();
    const toTarget = new THREE.Vector3().subVectors(target.getEyePosition(), eye).normalize();

    if (now > this._jitterAt) {
      this._jitterAt = now + TFPS.Utils.randRange(140, 320);
      const j = this.aimJitterRad;
      this._jitterOffset.set(TFPS.Utils.randRange(-j, j), TFPS.Utils.randRange(-j, j), 0);
    }
    const desired = toTarget.clone();
    desired.x += this._jitterOffset.x; desired.y += this._jitterOffset.y;
    desired.normalize();
    this.aimDir.lerp(desired, TFPS.Utils.clamp(this.turnSpeed * dt, 0, 1)).normalize();
    this.facingDir.copy(this.aimDir);

    // Strafe side-to-side for dodge/peek feel.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = TFPS.Utils.randRange(0.35, 0.85); }
    const right = new THREE.Vector3(-this.aimDir.z, 0, this.aimDir.x);
    const lowHp = this.health < this.maxHealth * 0.3;
    const stepSpeed = BOT_RUN_SPEED * (lowHp ? 0.9 : 0.55);
    let moveX = right.x * this.strafeDir * stepSpeed * dt;
    let moveZ = right.z * this.strafeDir * stepSpeed * dt;
    if (lowHp) {
      // Fall back away from the target while still trading shots.
      moveX += -this.aimDir.x * stepSpeed * dt;
      moveZ += -this.aimDir.z * stepSpeed * dt;
    }
    TFPS.Utils.moveWithCollision(this.position, moveX, moveZ, this.colliders, 0.4);

    const angle = Math.acos(TFPS.Utils.clamp(this.aimDir.dot(toTarget), -1, 1));
    const weapon = this.currentWeapon();
    const def = weapon.def;
    const ready = now - this.engageStartedAt > this.reactionMs;
    if (weapon.ammoInMag <= 0 && !weapon.reloading && weapon.startReload(now)) this.audio.playReload();
    if (ready && weapon.canFire(now) && angle < THREE.MathUtils.degToRad(BOT_FIRE_CONE_DEG)) {
      this._fireWeapon(weapon, def, now, ctx);
    }
  }

  _fireWeapon(weapon, def, now, ctx) {
    weapon.registerShot(now);
    const origin = this.getEyePosition();
    const spread = weapon.currentSpreadRadius({ moving: true, crouching: false, ads: false });
    const dir = TFPS.WeaponSystem.jitteredDirection(this.aimDir, spread * 0.6);
    const targetHitboxes = ctx.enemies.filter(e => e.isAlive).flatMap(e => e.hitboxMeshes);
    const result = TFPS.WeaponSystem.fireHitscan(origin, dir, def.range, ctx.blockerMeshes, targetHitboxes);
    this.audio.playGunshot(def.id);
    this.bus.emit('shotFired', { shooter: this, origin, end: result.end, color: def.tracerColor, isPlayer: false });
    if (result.hit && result.isEntity && result.target && result.target.isAlive) {
      const dmg = TFPS.WeaponSystem.damageFor(def, result.part);
      const wasAlive = result.target.isAlive;
      result.target.takeDamage(dmg, result.part === 'head', origin, now);
      if (wasAlive && !result.target.isAlive) {
        this.kills++;
        this.credits = Math.min(9000, this.credits + 200);
        this.bus.emit('killFeed', { killer: this, victim: result.target, headshot: result.part === 'head' });
      }
    }
  }

  _tickMoveToObjective(dt, now, ctx) {
    this._followPath(dt, now);
    if (this.path.length === 0) {
      this._arrivedAtObjective(now, ctx);
    }
  }

  _tickHold(dt, now, ctx) {
    // Idle scan: periodically pick a new small look-offset and ease toward it,
    // so a holding bot reads as "watching an angle" rather than a statue.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir *= -1;
      this.strafeTimer = TFPS.Utils.randRange(1.2, 2.4);
      this._holdTargetYaw = yawFromDir(this.facingDir) + this.strafeDir * TFPS.Utils.randRange(0.2, 0.55);
    }
    if (this._holdTargetYaw === undefined) this._holdTargetYaw = yawFromDir(this.facingDir);
    const curYaw = yawFromDir(this.facingDir);
    const newYaw = TFPS.Utils.lerp(curYaw, this._holdTargetYaw, TFPS.Utils.clamp(dt * 1.5, 0, 1));
    this.facingDir.set(-Math.sin(newYaw), 0, -Math.cos(newYaw));
    this.aimDir.copy(this.facingDir);
  }

  _followPath(dt, now) {
    if (this.path.length === 0) return;
    const nextNode = this.path[0];
    const toNode = new THREE.Vector3(nextNode.x - this.position.x, 0, nextNode.z - this.position.z);
    const dist = toNode.length();
    if (dist < 1.1) {
      if (nextNode.choke && !this._chokePauseDone) {
        // Brief "check the angle" pause at chokepoints — triggers exactly once per node.
        if (!this._chokePausing) {
          this._chokePausing = true;
          this.chokeWaitUntil = now + TFPS.Utils.randRange(300, 750);
        }
        if (now < this.chokeWaitUntil) return;
        this._chokePauseDone = true;
      }
      this.path.shift();
      this._chokePausing = false;
      this._chokePauseDone = false;
      return;
    }
    toNode.normalize();
    this.facingDir.lerp(toNode, TFPS.Utils.clamp(dt * 6, 0, 1)).normalize();
    this.aimDir.copy(this.facingDir);
    const step = BOT_RUN_SPEED * dt;
    TFPS.Utils.moveWithCollision(this.position, toNode.x * step, toNode.z * step, this.colliders, 0.4);
  }

  _arrivedAtObjective(now, ctx) {
    const obj = this.objective;
    if (!obj) { this.state = 'holdPosition'; return; }
    if (obj.kind === 'plant') {
      if (!ctx.roundManager.spikeState.planted) { this.state = 'planting'; this.plantProgress = 0; }
      else { this.objective = { kind: 'planted-guard' }; this.state = 'holdPosition'; }
    } else if (obj.kind === 'defend' || obj.kind === 'rotate') {
      this.state = 'holdPosition';
    } else if (obj.kind === 'holdMid') {
      this.state = 'holdPosition';
      this._holdMidSince = now; // start the "commit to a site" countdown only once we've actually arrived
    } else if (obj.kind === 'defuse') {
      if (ctx.roundManager.spikeState.planted) { this.state = 'defusing'; this.defuseProgress = 0; }
      else { this.state = 'holdPosition'; }
    } else {
      this.state = 'holdPosition';
    }
  }

  _tickPlant(dt, now, ctx) {
    const site = ctx.roundManager.spikeState.site || this.objective.site;
    const s = TFPS.MapData.SITES[site];
    if (TFPS.Utils.dist2D(this.position.x, this.position.z, s.cx, s.cz) > s.radius) {
      this.path = this._planPathTo(this.objective.node); this.state = 'moveToObjective'; return;
    }
    this.plantProgress += dt / 4.0;
    if (Math.floor(this.plantProgress * 8) !== Math.floor((this.plantProgress - dt / 4.0) * 8)) this.audio.playPlantTick();
    if (this.plantProgress >= 1) {
      ctx.roundManager.plantSpike({ x: s.cx, z: s.cz }, site);
      this.objective = { kind: 'planted-guard' };
      this.state = 'holdPosition';
    }
  }

  _tickDefuse(dt, now, ctx) {
    if (!ctx.roundManager.spikeState.planted) { this.state = 'holdPosition'; return; }
    const sp = ctx.roundManager.spikeState.position;
    if (TFPS.Utils.dist2D(this.position.x, this.position.z, sp.x, sp.z) > 3.2) {
      this.state = 'moveToObjective';
      this.objective = { kind: 'defuse', node: TFPS.Utils.nearestNode(this.graph.waypoints, sp.x, sp.z) };
      this.path = this._planPathTo(this.objective.node);
      return;
    }
    this.defuseProgress += dt / 7.0;
    if (this.defuseProgress >= 1) ctx.roundManager.defuseSpike();
  }

  setObjective(objective) {
    this.objective = objective;
    this.state = 'moveToObjective';
    this.path = this._planPathTo(objective.node);
  }

  _syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = yawFromDir(this.facingDir);
    this.headMesh.position.set(this.position.x, this.position.y + BOT_EYE, this.position.z);
    this.bodyMesh.position.set(this.position.x, this.position.y + 1.0, this.position.z);
  }
};
