// Game.js — wires every system together and drives the main loop.
window.TFPS = window.TFPS || {};

TFPS.Game = class Game {
  constructor() {
    this.canvas = document.getElementById('app-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

    this.clock = new THREE.Clock();
    this.bus = new TFPS.Utils.EventBus();
    this.audio = new TFPS.AudioEngine();
    this.input = new TFPS.InputManager(this.renderer.domElement);

    this.mapStatic = TFPS.MapBuilder.build(this.scene);
    this.abilities = new TFPS.AbilityManager(this.scene, this.audio, this.mapStatic.colliderBoxes, this.bus);

    const adj = TFPS.Utils.buildGraph(TFPS.MapData.WAYPOINTS, TFPS.MapData.EDGES);
    this.graph = { adj, waypoints: TFPS.MapData.WAYPOINTS };

    this.player = new TFPS.Player(this.camera, this.scene, this.mapStatic.colliderBoxes, this.mapStatic.staticMeshes, this.audio, this.bus);

    this.attackerBots = [];
    for (let i = 0; i < 4; i++) {
      this.attackerBots.push(new TFPS.Bot('A' + (i + 1), 'attacker', this.scene, this.mapStatic.colliderBoxes, this.mapStatic.staticMeshes, this.audio, this.bus, this.graph));
    }
    this.defenderBots = [];
    for (let i = 0; i < 5; i++) {
      this.defenderBots.push(new TFPS.Bot('D' + (i + 1), 'defender', this.scene, this.mapStatic.colliderBoxes, this.mapStatic.staticMeshes, this.audio, this.bus, this.graph));
    }

    this.roundManager = new TFPS.RoundManager({
      player: this.player, attackerBots: this.attackerBots, defenderBots: this.defenderBots,
      audio: this.audio, bus: this.bus, abilities: this.abilities,
    });
    this.assetLoader = new TFPS.AssetLoader(this.scene);
    this.assetLoader.loadBundle();

    this.hud = new TFPS.HUD({ player: this.player, bus: this.bus, audio: this.audio });
    this.selectedMode = 'standard';
    this._bindModeSelector();
    this.roundManager.setMode(this.selectedMode);

    this.effects = [];
    this.spectateTarget = null;
    this._lastDamageShown = 0;
    this.spottedMap = new Map();

    this._wireGlobalInput();
    this.bus.on('shotFired', d => this._spawnShotEffect(d));
    this.bus.on('playerDied', () => this._pickSpectateTarget());
    this.bus.on('buyPhaseStart', () => { this.spectateTarget = null; });
    this.bus.on('matchEnd', () => { document.exitPointerLock(); });

    window.addEventListener('resize', () => this._onResize());

    this.roundManager.start();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _bindModeSelector() {
    const buttons = document.querySelectorAll('.mode-btn');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.mode;
        this.setMode(nextMode);
      });
    });
  }

  setMode(modeName) {
    this.selectedMode = modeName;
    this.roundManager.setMode(modeName);
    document.querySelectorAll('.mode-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === modeName);
    });
    this.hud.showPhaseBanner(`MODE: ${this.roundManager.modeMeta.label.toUpperCase()}`, 1200);
    this.roundManager.start();
  }

  _wireGlobalInput() {
    const hint = document.getElementById('crosshair-lock-hint');
    hint.addEventListener('click', () => {
      this.audio.unlock();
      this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) hint.classList.add('hidden');
      else if (!this.hud.buyMenuOpen && !this.roundManager.matchOver) hint.classList.remove('hidden');
    });
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _pickSpectateTarget() {
    this.spectateTarget = this.attackerBots.find(b => b.isAlive) || null;
  }

  _updateSpectateCamera() {
    if (!this.spectateTarget || !this.spectateTarget.isAlive) this._pickSpectateTarget();
    if (this.spectateTarget) {
      const t = this.spectateTarget;
      this.camera.position.copy(t.getEyePosition());
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = Math.atan2(-t.facingDir.x, -t.facingDir.z);
      this.camera.rotation.x = 0;
    }
  }

  _spawnShotEffect(d) {
    const now = performance.now();
    const geo = new THREE.BufferGeometry().setFromPoints([d.origin, d.end]);
    const mat = new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ mesh: line, expiresAt: now + 55 });

    const flashGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(d.origin);
    this.scene.add(flash);
    this.effects.push({ mesh: flash, expiresAt: now + 40 });
  }

  _pruneEffects(now) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (now >= this.effects[i].expiresAt) {
        this.scene.remove(this.effects[i].mesh);
        this.effects.splice(i, 1);
      }
    }
  }

  _updateSpotted(now) {
    const REVEAL_RANGE = 30;
    const watchers = [this.player, ...this.attackerBots].filter(e => e.isAlive);
    for (const d of this.defenderBots) {
      if (!d.isAlive) { this.spottedMap.delete(d.id); continue; }
      let spotted = false;
      for (const w of watchers) {
        const eye = w.getEyePosition ? w.getEyePosition() : null;
        if (!eye) continue;
        if (eye.distanceTo(d.position) > REVEAL_RANGE) continue;
        if (TFPS.Utils.hasLineOfSight(eye, d.getEyePosition(), this.mapStatic.staticMeshes, this.abilities.smokeVolumes)) {
          spotted = true; break;
        }
      }
      if (spotted) this.spottedMap.set(d.id, { x: d.position.x, z: d.position.z, expiresAt: now + 2000 });
    }
    const out = [];
    for (const [id, v] of this.spottedMap) {
      if (v.expiresAt < now) this.spottedMap.delete(id); else out.push(v);
    }
    return out;
  }

  _handlePlantDefuse(dt, now) {
    const p = this.player;
    p.interactPrompt = null;
    if (this.roundManager.phase !== 'action' || !p.isAlive || this.hud.buyMenuOpen) {
      p.interacting = false; p.interactProgress = 0;
      return;
    }
    const sites = TFPS.MapData.SITES;
    const inA = TFPS.Utils.dist2D(p.position.x, p.position.z, sites.A.cx, sites.A.cz) <= sites.A.radius;
    const inB = TFPS.Utils.dist2D(p.position.x, p.position.z, sites.B.cx, sites.B.cz) <= sites.B.radius;

    if (!this.roundManager.spikeState.planted && (inA || inB)) {
      p.interactPrompt = 'HOLD F TO PLANT SPIKE';
      if (this.input.isDown('KeyF')) {
        p.interacting = true; p.interactKind = 'plant';
        const prevTick = Math.floor(p.interactProgress * 8);
        p.interactProgress += dt / 4.0;
        if (Math.floor(p.interactProgress * 8) !== prevTick) this.audio.playPlantTick();
        if (p.interactProgress >= 1) {
          const site = inA ? sites.A : sites.B;
          this.roundManager.plantSpike({ x: site.cx, z: site.cz }, inA ? 'A' : 'B');
          p.interacting = false; p.interactProgress = 0;
        }
      } else {
        p.interacting = false; p.interactProgress = 0;
      }
      return;
    }
    p.interacting = false; p.interactProgress = 0;
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();

    const playerCtx = {
      abilities: this.abilities,
      blockerMeshes: this.mapStatic.staticMeshes,
      enemyHitboxMeshes: this.defenderBots.filter(b => b.isAlive).flatMap(b => b.hitboxMeshes),
    };
    this.player.update(dt, this.input, now, playerCtx);
    if (!this.player.isAlive) this._updateSpectateCamera();

    if (this.player.lastDamage && this.player.lastDamage.time > this._lastDamageShown) {
      this._lastDamageShown = this.player.lastDamage.time;
      this.hud.showDamageIndicator(this.player.lastDamage.angle);
    }

    const atkCtx = { enemies: this.defenderBots, blockerMeshes: this.mapStatic.staticMeshes, smokeVolumes: this.abilities.smokeVolumes, roundManager: this.roundManager };
    for (const b of this.attackerBots) b.update(dt, now, atkCtx);
    const defCtx = { enemies: this.roundManager.attackers, blockerMeshes: this.mapStatic.staticMeshes, smokeVolumes: this.abilities.smokeVolumes, roundManager: this.roundManager };
    for (const b of this.defenderBots) b.update(dt, now, defCtx);

    this.abilities.update(dt, [...this.roundManager.attackers, ...this.defenderBots]);

    this._handlePlantDefuse(dt, now);

    if (this.input.justPressed('KeyB') && this.roundManager.phase === 'buy' && this.player.isAlive) {
      this.hud.toggleBuyMenu();
      if (this.hud.buyMenuOpen) document.exitPointerLock();
      else this.canvas.requestPointerLock();
    }

    this.roundManager.update(dt, now);
    this.mapStatic.update(now * 0.001);
    this._pruneEffects(now);
    const spotted = this._updateSpotted(now);

    this.hud.update(dt, now, { roundManager: this.roundManager, attackerBots: this.attackerBots, spottedEnemies: spotted });

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
};
