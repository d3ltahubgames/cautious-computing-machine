// HUD.js — all on-screen UI. Pure DOM; the 3D canvas never has to know it exists.
window.TFPS = window.TFPS || {};

TFPS.HUD = class HUD {
  constructor(cfg) {
    this.player = cfg.player;
    this.bus = cfg.bus;
    this.audio = cfg.audio;

    this.el = {
      health: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      shield: document.getElementById('shield-fill'),
      shieldText: document.getElementById('shield-text'),
      credits: document.getElementById('credits-text'),
      weaponName: document.getElementById('weapon-name'),
      ammoMag: document.getElementById('ammo-mag'),
      ammoReserve: document.getElementById('ammo-reserve'),
      reloadTag: document.getElementById('reload-tag'),
      timer: document.getElementById('phase-timer'),
      phaseLabel: document.getElementById('phase-label'),
      scoreAtk: document.getElementById('score-attacker'),
      scoreDef: document.getElementById('score-defender'),
      killfeed: document.getElementById('killfeed'),
      crosshair: document.getElementById('crosshair'),
      chTop: document.getElementById('ch-top'),
      chBottom: document.getElementById('ch-bottom'),
      chLeft: document.getElementById('ch-left'),
      chRight: document.getElementById('ch-right'),
      hitmarker: document.getElementById('hitmarker'),
      minimap: document.getElementById('minimap-canvas'),
      buyMenu: document.getElementById('buy-menu'),
      buyCredits: document.getElementById('buy-credits'),
      interactWrap: document.getElementById('interact-wrap'),
      interactLabel: document.getElementById('interact-label'),
      interactFill: document.getElementById('interact-fill'),
      damageLayer: document.getElementById('damage-indicators'),
      flashOverlay: document.getElementById('flash-overlay'),
      phaseBanner: document.getElementById('phase-banner'),
      spectateBanner: document.getElementById('spectate-banner'),
      matchEnd: document.getElementById('match-end-screen'),
      matchEndTitle: document.getElementById('match-end-title'),
      matchEndScore: document.getElementById('match-end-score'),
      restartBtn: document.getElementById('restart-btn'),
      abilityFlash: document.getElementById('ability-flash-count'),
      abilitySmoke: document.getElementById('ability-smoke-count'),
    };

    this.mmCtx = this.el.minimap.getContext('2d');
    this.buyMenuOpen = false;
    this._hitmarkerTimeout = null;
    this._bannerTimeout = null;

    this._buildBuyMenu();
    this.el.restartBtn.addEventListener('click', () => window.location.reload());

    this.bus.on('killFeed', ({ killer, victim, headshot }) => this.addKillFeed(killer, victim, headshot));
    this.bus.on('hitConfirmed', ({ isHeadshot, isKill }) => this.flashHitmarker(isKill ? 'kill' : isHeadshot ? 'headshot' : 'hit'));
    this.bus.on('roundEnd', (data) => this._onRoundEnd(data));
    this.bus.on('spikePlanted', () => this.showPhaseBanner('SPIKE PLANTED', 1800));
    this.bus.on('spikeDefused', () => this.showPhaseBanner('SPIKE DEFUSED', 2200));
    this.bus.on('spikeDetonated', () => this.showPhaseBanner('SPIKE DETONATED', 2200));
    this.bus.on('buyPhaseStart', ({ round }) => this.showPhaseBanner(`ROUND ${round} — BUY PHASE`, 1800));
    this.bus.on('actionPhaseStart', () => this.showPhaseBanner('GO', 900));
    this.bus.on('matchEnd', ({ winner, score }) => this.showMatchEnd(winner === 'attacker', score));
  }

  _buildBuyMenu() {
    const list = document.getElementById('buy-weapon-list');
    list.innerHTML = '';
    for (const id of TFPS.WeaponData.order) {
      const def = TFPS.WeaponData[id];
      const row = document.createElement('button');
      row.className = 'buy-row';
      row.dataset.weapon = id;
      row.innerHTML = `<span class="buy-row-name">${def.name}</span><span class="buy-row-price">${def.price === 0 ? 'FREE' : '$' + def.price}</span>`;
      row.addEventListener('click', () => { this.player.buyWeapon(id); this._refreshBuyMenu(); });
      list.appendChild(row);
    }
    document.getElementById('buy-shield-light').addEventListener('click', () => { this.player.buyShield('light'); this._refreshBuyMenu(); });
    document.getElementById('buy-shield-heavy').addEventListener('click', () => { this.player.buyShield('heavy'); this._refreshBuyMenu(); });
    document.getElementById('buy-ability-flash').addEventListener('click', () => { this.player.buyAbility('flash'); this._refreshBuyMenu(); });
    document.getElementById('buy-ability-smoke').addEventListener('click', () => { this.player.buyAbility('smoke'); this._refreshBuyMenu(); });
  }

  _refreshBuyMenu() {
    this.el.buyCredits.textContent = `$${this.player.credits}`;
    const list = document.getElementById('buy-weapon-list');
    for (const row of list.children) {
      const id = row.dataset.weapon;
      const def = TFPS.WeaponData[id];
      const owned = this.player.ownsWeapon(id);
      row.classList.toggle('owned', owned);
      row.classList.toggle('disabled', !owned && this.player.credits < def.price);
    }
    const heavyBtn = document.getElementById('buy-shield-heavy');
    const lightBtn = document.getElementById('buy-shield-light');
    lightBtn.classList.toggle('disabled', this.player.credits < TFPS.WeaponData.SHIELD_LIGHT.price);
    heavyBtn.classList.toggle('disabled', this.player.credits < TFPS.WeaponData.SHIELD_HEAVY.price);
    lightBtn.classList.toggle('owned', this.player.shield === TFPS.WeaponData.SHIELD_LIGHT.amount);
    heavyBtn.classList.toggle('owned', this.player.shield === TFPS.WeaponData.SHIELD_HEAVY.amount);

    const flashBtn = document.getElementById('buy-ability-flash');
    const smokeBtn = document.getElementById('buy-ability-smoke');
    flashBtn.querySelector('.buy-row-price').textContent = `${this.player.abilityCharges.flash}/${TFPS.WeaponData.ABILITY_MAX_CHARGES} · $${TFPS.WeaponData.ABILITY_PRICE}`;
    smokeBtn.querySelector('.buy-row-price').textContent = `${this.player.abilityCharges.smoke}/${TFPS.WeaponData.ABILITY_MAX_CHARGES} · $${TFPS.WeaponData.ABILITY_PRICE}`;
    flashBtn.classList.toggle('disabled', this.player.credits < TFPS.WeaponData.ABILITY_PRICE || this.player.abilityCharges.flash >= TFPS.WeaponData.ABILITY_MAX_CHARGES);
    smokeBtn.classList.toggle('disabled', this.player.credits < TFPS.WeaponData.ABILITY_PRICE || this.player.abilityCharges.smoke >= TFPS.WeaponData.ABILITY_MAX_CHARGES);
  }

  openBuyMenu() { this.buyMenuOpen = true; this.el.buyMenu.classList.add('open'); this._refreshBuyMenu(); }
  closeBuyMenu() { this.buyMenuOpen = false; this.el.buyMenu.classList.remove('open'); }
  toggleBuyMenu() { this.buyMenuOpen ? this.closeBuyMenu() : this.openBuyMenu(); }

  addKillFeed(killer, victim, headshot) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const kName = killer.isBot ? `BOT-${killer.id}` : 'YOU';
    const vName = victim.isBot ? `BOT-${victim.id}` : 'YOU';
    const kTeamClass = killer.teamId === 'attacker' ? 'kf-atk' : 'kf-def';
    const vTeamClass = victim.teamId === 'attacker' ? 'kf-atk' : 'kf-def';
    row.innerHTML = `<span class="${kTeamClass}">${kName}</span><span class="kf-icon">${headshot ? '◈' : '✕'}</span><span class="${vTeamClass}">${vName}</span>`;
    this.el.killfeed.appendChild(row);
    if (this.el.killfeed.children.length > 6) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
    setTimeout(() => { row.classList.add('fade'); setTimeout(() => row.remove(), 600); }, 4200);
  }

  flashHitmarker(kind) {
    const el = this.el.hitmarker;
    el.className = 'hitmarker show ' + kind;
    clearTimeout(this._hitmarkerTimeout);
    this._hitmarkerTimeout = setTimeout(() => { el.className = 'hitmarker'; }, 260);
  }

  showDamageIndicator(angle) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad) translateY(-46vmin)`;
    this.el.damageLayer.appendChild(arc);
    requestAnimationFrame(() => arc.classList.add('show'));
    setTimeout(() => { arc.classList.remove('show'); setTimeout(() => arc.remove(), 400); }, 900);
  }

  showPhaseBanner(text, durationMs) {
    this.el.phaseBanner.textContent = text;
    this.el.phaseBanner.classList.add('show');
    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => this.el.phaseBanner.classList.remove('show'), durationMs);
  }

  _onRoundEnd({ winningTeam, reason }) {
    const reasonText = {
      elimination: 'ELIMINATED',
      timeout: 'TIME EXPIRED',
      defuse: 'SPIKE DEFUSED',
      detonation: 'SPIKE DETONATED',
    }[reason] || '';
    const who = winningTeam === 'attacker' ? 'ATTACKERS WIN' : 'DEFENDERS WIN';
    this.showPhaseBanner(`${who} — ${reasonText}`, 3600);
  }

  showMatchEnd(didWin, score) {
    this.el.matchEnd.classList.add('show');
    this.el.matchEndTitle.textContent = didWin ? 'VICTORY' : 'DEFEAT';
    this.el.matchEndTitle.className = didWin ? 'win' : 'lose';
    this.el.matchEndScore.textContent = `${score.attacker} — ${score.defender}`;
  }

  formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  update(dt, now, ctx) {
    const p = this.player;
    const rm = ctx.roundManager;

    // Health / shield
    const hpPct = TFPS.Utils.clamp(p.health / p.maxHealth, 0, 1) * 100;
    this.el.health.style.width = hpPct + '%';
    this.el.healthText.textContent = Math.ceil(p.health);
    const shieldMax = 50;
    this.el.shield.style.width = TFPS.Utils.clamp(p.shield / shieldMax, 0, 1) * 100 + '%';
    this.el.shieldText.textContent = p.shield;
    this.el.credits.textContent = '$' + p.credits;

    // Ammo
    const w = p.currentWeapon();
    this.el.weaponName.textContent = w.def.name;
    this.el.ammoMag.textContent = w.ammoInMag;
    this.el.ammoReserve.textContent = w.ammoReserve;
    this.el.reloadTag.style.display = w.reloading ? 'block' : 'none';
    this.el.abilityFlash.textContent = p.abilityCharges.flash;
    this.el.abilitySmoke.textContent = p.abilityCharges.smoke;

    // Timer / phase / score
    let timeLeft, phaseText;
    if (rm.phase === 'buy') { timeLeft = rm.phaseTimeRemaining(); phaseText = 'BUY PHASE'; }
    else if (rm.phase === 'action' && rm.spikeState.planted) { timeLeft = rm.spikeTimeRemaining(); phaseText = 'SPIKE ARMED'; }
    else if (rm.phase === 'action') { timeLeft = rm.phaseTimeRemaining(); phaseText = 'IN PROGRESS'; }
    else { timeLeft = 0; phaseText = 'ROUND OVER'; }
    this.el.timer.textContent = this.formatTime(timeLeft);
    this.el.timer.classList.toggle('urgent', rm.phase === 'action' && rm.spikeState.planted);
    this.el.phaseLabel.textContent = phaseText;
    this.el.scoreAtk.textContent = rm.roundScore.attacker;
    this.el.scoreDef.textContent = rm.roundScore.defender;

    // Crosshair spread
    const px = TFPS.Utils.clamp(p.uiSpread * 620, 5, 46);
    this.el.chTop.style.transform = `translate(-50%,-50%) translateY(${-px}px)`;
    this.el.chBottom.style.transform = `translate(-50%,-50%) translateY(${px}px)`;
    this.el.chLeft.style.transform = `translate(-50%,-50%) translateX(${-px}px)`;
    this.el.chRight.style.transform = `translate(-50%,-50%) translateX(${px}px)`;
    this.el.crosshair.style.display = (p.isAlive && !this.buyMenuOpen) ? 'block' : 'none';

    // Blind / flash overlay
    const blindMs = p.blindUntil - now;
    this.el.flashOverlay.style.opacity = blindMs > 0 ? Math.min(1, blindMs / 900) : 0;

    // Interact bar (plant/defuse)
    if (p.interacting) {
      this.el.interactWrap.style.display = 'block';
      this.el.interactLabel.textContent = p.interactKind === 'defuse' ? 'DEFUSING SPIKE' : 'PLANTING SPIKE';
      this.el.interactFill.style.width = TFPS.Utils.clamp(p.interactProgress, 0, 1) * 100 + '%';
    } else if (p.interactPrompt) {
      this.el.interactWrap.style.display = 'block';
      this.el.interactLabel.textContent = p.interactPrompt;
      this.el.interactFill.style.width = '0%';
    } else {
      this.el.interactWrap.style.display = 'none';
    }

    // Spectate banner
    this.el.spectateBanner.style.display = p.isAlive ? 'none' : 'block';

    this._drawMinimap(ctx);
  }

  _drawMinimap(ctx) {
    const c = this.mmCtx;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const scale = 1.55, ox = W / 2, oy = H / 2;
    const toMap = (x, z) => [ox + x * scale, oy - z * scale];

    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(15,18,15,0.55)';
    c.fillRect(0, 0, W, H);

    for (const key in TFPS.MapData.SITES) {
      const s = TFPS.MapData.SITES[key];
      const [mx, my] = toMap(s.cx, s.cz);
      c.beginPath();
      c.arc(mx, my, s.radius * scale, 0, Math.PI * 2);
      c.fillStyle = key === 'A' ? 'rgba(47,184,172,0.25)' : 'rgba(224,97,95,0.25)';
      c.fill();
      c.fillStyle = '#f4ead9';
      c.font = 'bold 11px monospace';
      c.textAlign = 'center';
      c.fillText(key, mx, my + 4);
    }

    if (ctx.roundManager.spikeState.planted) {
      const [mx, my] = toMap(ctx.roundManager.spikeState.position.x, ctx.roundManager.spikeState.position.z);
      c.fillStyle = '#ff3b30';
      c.beginPath(); c.arc(mx, my, 4, 0, Math.PI * 2); c.fill();
    }

    for (const b of ctx.attackerBots) {
      if (!b.isAlive) continue;
      const [mx, my] = toMap(b.position.x, b.position.z);
      c.fillStyle = '#3aa0ff';
      c.beginPath(); c.arc(mx, my, 3, 0, Math.PI * 2); c.fill();
    }

    for (const s of ctx.spottedEnemies) {
      const [mx, my] = toMap(s.x, s.z);
      c.fillStyle = '#ff5a3c';
      c.beginPath(); c.arc(mx, my, 3, 0, Math.PI * 2); c.fill();
    }

    const p = this.player;
    const [px, py] = toMap(p.position.x, p.position.z);
    c.save();
    c.translate(px, py);
    c.rotate(p.yaw);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }
};
