// RoundManager.js — owns match/round phase timing, the spike, scoring, and
// per-round setup (spawns + objective assignment) for every entity.
window.TFPS = window.TFPS || {};

TFPS.RoundManager = class RoundManager {
  constructor(cfg) {
    this.player = cfg.player;
    this.attackerBots = cfg.attackerBots;
    this.defenderBots = cfg.defenderBots;
    this.attackers = [this.player, ...this.attackerBots];
    this.audio = cfg.audio;
    this.bus = cfg.bus;
    this.abilities = cfg.abilities;

    this.modeSettings = {
      standard: { label: 'Standard', BUY_MS: 20000, ACTION_MS: 100000, SPIKE_FUSE_MS: 45000, ROUND_END_PAUSE_MS: 4200, ROUNDS_TO_WIN: 5 },
      spikeRush: { label: 'Spike Rush', BUY_MS: 15000, ACTION_MS: 70000, SPIKE_FUSE_MS: 25000, ROUND_END_PAUSE_MS: 2200, ROUNDS_TO_WIN: 4 },
      deathmatch: { label: 'Deathmatch', BUY_MS: 12000, ACTION_MS: 90000, SPIKE_FUSE_MS: 35000, ROUND_END_PAUSE_MS: 1800, ROUNDS_TO_WIN: 7 },
      practice: { label: 'Practice', BUY_MS: 26000, ACTION_MS: 150000, SPIKE_FUSE_MS: 50000, ROUND_END_PAUSE_MS: 1000, ROUNDS_TO_WIN: 3 },
    };
    this.mode = 'standard';
    this.modeMeta = this.modeSettings.standard;
    this.BUY_MS = this.modeMeta.BUY_MS;
    this.ACTION_MS = this.modeMeta.ACTION_MS;
    this.SPIKE_FUSE_MS = this.modeMeta.SPIKE_FUSE_MS;
    this.ROUND_END_PAUSE_MS = this.modeMeta.ROUND_END_PAUSE_MS;
    this.ROUNDS_TO_WIN = this.modeMeta.ROUNDS_TO_WIN;

    this.phase = 'buy';
    this.phaseEndsAt = 0;
    this.currentRound = 1;
    this.roundScore = { attacker: 0, defender: 0 };
    this.lossStreak = { attacker: 0, defender: 0 };
    this.matchOver = false;
    this.matchWinner = null;

    this.spikeState = { planted: false, position: null, site: null, plantedAt: 0 };
    this.spikeWasPlantedThisRound = false;
  }

  setMode(modeName) {
    const profile = this.modeSettings[modeName] || this.modeSettings.standard;
    this.mode = modeName;
    this.modeMeta = profile;
    this.BUY_MS = profile.BUY_MS;
    this.ACTION_MS = profile.ACTION_MS;
    this.SPIKE_FUSE_MS = profile.SPIKE_FUSE_MS;
    this.ROUND_END_PAUSE_MS = profile.ROUND_END_PAUSE_MS;
    this.ROUNDS_TO_WIN = profile.ROUNDS_TO_WIN;

    if (this.phase === 'buy') {
      this.phaseEndsAt = performance.now() + this.BUY_MS;
    } else if (this.phase === 'action') {
      this.phaseEndsAt = performance.now() + this.ACTION_MS;
    }
  }

  start() {
    this.currentRound = 1;
    this.roundScore = { attacker: 0, defender: 0 };
    this.lossStreak = { attacker: 0, defender: 0 };
    this.matchOver = false;
    this._startBuyPhase(performance.now());
  }

  phaseTimeRemaining() { return Math.max(0, (this.phaseEndsAt - performance.now()) / 1000); }
  spikeTimeRemaining() {
    if (!this.spikeState.planted) return 0;
    return Math.max(0, this.SPIKE_FUSE_MS - (performance.now() - this.spikeState.plantedAt)) / 1000;
  }

  _countAlive(list) { return list.filter(e => e.isAlive).length; }

  update(dt, now) {
    if (this.phase === 'buy') {
      if (now >= this.phaseEndsAt) this._startActionPhase(now);
      return;
    }
    if (this.phase === 'action') {
      const attackerAlive = this._countAlive(this.attackers);
      const defenderAlive = this._countAlive(this.defenderBots);
      if (defenderAlive === 0) { this._endRound('attacker', 'elimination'); return; }
      if (attackerAlive === 0 && !this.spikeState.planted) { this._endRound('defender', 'elimination'); return; }

      if (this.spikeState.planted) {
        if (now - this.spikeState.plantedAt >= this.SPIKE_FUSE_MS) { this._detonate(); return; }
      } else if (now >= this.phaseEndsAt) {
        this._endRound('defender', 'timeout'); return;
      }

      // Bots holding mid eventually commit to a site.
      for (const b of this.attackerBots) {
        if (b.isAlive && b.objective && b.objective.kind === 'holdMid' &&
          b._holdMidSince && now - b._holdMidSince > 6000 && b.state === 'holdPosition') {
          const site = Math.random() < 0.5 ? 'A' : 'B';
          b._holdMidSince = null;
          b.setObjective({ kind: 'plant', node: site === 'A' ? 'aSiteCenter' : 'bSiteCenter', site });
        }
      }
      return;
    }
    if (this.phase === 'roundEnd') {
      if (now >= this.phaseEndsAt) {
        if (this.matchOver) { this.phase = 'matchEnd'; this.bus.emit('matchEnd', { winner: this.matchWinner, score: { ...this.roundScore } }); }
        else { this.currentRound++; this._startBuyPhase(now); }
      }
    }
  }

  plantSpike(pos, site) {
    if (this.spikeState.planted) return;
    this.spikeState = { planted: true, position: pos, site, plantedAt: performance.now() };
    this.spikeWasPlantedThisRound = true;
    this.audio.startSpikeBeep(() => this.spikeTimeRemaining(), this.SPIKE_FUSE_MS / 1000);
    this.bus.emit('spikePlanted', { position: pos, site });
    const centerNode = site === 'A' ? 'aSiteCenter' : 'bSiteCenter';
    for (const b of this.defenderBots) if (b.isAlive) b.setObjective({ kind: 'defuse', node: centerNode, site });
    for (const b of this.attackerBots) if (b.isAlive) b.setObjective({ kind: 'planted-guard', node: centerNode, site });
  }

  defuseSpike() {
    if (!this.spikeState.planted) return;
    this.audio.stopSpikeBeep();
    this.audio.stopDefuseLoop();
    this.bus.emit('spikeDefused', {});
    this._endRound('defender', 'defuse');
  }

  _detonate() {
    this.audio.stopSpikeBeep();
    this.bus.emit('spikeDetonated', {});
    this._endRound('attacker', 'detonation');
  }

  _endRound(winningTeam, reason) {
    if (this.matchOver || this.phase === 'roundEnd') return;
    this.roundScore[winningTeam]++;
    const losingTeam = winningTeam === 'attacker' ? 'defender' : 'attacker';
    this.lossStreak[losingTeam] = (this.lossStreak[losingTeam] || 0) + 1;
    this.lossStreak[winningTeam] = 0;
    const winners = winningTeam === 'attacker' ? this.attackers : this.defenderBots;
    const losers = losingTeam === 'attacker' ? this.attackers : this.defenderBots;
    TFPS.Economy.grantRoundEnd(winners, losers, this.lossStreak[losingTeam], this.spikeWasPlantedThisRound, losingTeam === 'attacker');
    this.audio.playRoundEndSting(winningTeam === 'attacker');
    this.phase = 'roundEnd';
    this.phaseEndsAt = performance.now() + this.ROUND_END_PAUSE_MS;
    if (this.roundScore[winningTeam] >= this.ROUNDS_TO_WIN) {
      this.matchOver = true;
      this.matchWinner = winningTeam;
    }
    this.bus.emit('roundEnd', { winningTeam, reason, score: { ...this.roundScore }, matchOver: this.matchOver });
  }

  _startActionPhase(now) {
    this.phase = 'action';
    this.phaseEndsAt = now + this.ACTION_MS;
    this.spikeState = { planted: false, position: null, site: null, plantedAt: 0 };
    this.spikeWasPlantedThisRound = false;
    this.bus.emit('actionPhaseStart', {});
  }

  _startBuyPhase(now) {
    this._setupRound(now);
    this.phase = 'buy';
    this.phaseEndsAt = now + this.BUY_MS;
    this.bus.emit('buyPhaseStart', { round: this.currentRound });
  }

  _setupRound(now) {
    const spawnsA = TFPS.MapData.SPAWNS.attacker;
    const spawnsD = TFPS.MapData.SPAWNS.defender;

    this.player.resetForNewRound(spawnsA[0]);

    for (let i = 0; i < this.attackerBots.length; i++) {
      const bot = this.attackerBots[i];
      const lane = TFPS.Utils.choice(['A', 'Mid', 'B']);
      const objective = lane === 'Mid'
        ? { kind: 'holdMid', node: 'midJunction' }
        : { kind: 'plant', node: lane === 'A' ? 'aSiteCenter' : 'bSiteCenter', site: lane };
      bot.resetForNewRound(spawnsA[i + 1], objective);
      bot.autoBuy();
    }

    for (let i = 0; i < this.defenderBots.length; i++) {
      const bot = this.defenderBots[i];
      const site = Math.random() < 0.5 ? 'A' : 'B';
      bot.resetForNewRound(spawnsD[i], { kind: 'defend', node: site === 'A' ? 'aSiteEntry' : 'bSiteEntry', site });
      bot.autoBuy();
    }

    this.abilities.reset();
  }
};
