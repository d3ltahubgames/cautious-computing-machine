// Economy.js — credit constants and round-end payout logic.
window.TFPS = window.TFPS || {};

TFPS.Economy = {
  KILL_REWARD: 200,
  WIN_BONUS: 3000,
  LOSS_BONUS_BASE: 1900,
  LOSS_BONUS_STEP: 500,
  LOSS_BONUS_MAX_STREAK: 4,
  PLANT_BONUS: 300,
  CREDIT_CAP: 9000,
  START_CREDITS: 800,

  grantRoundEnd(winners, losers, loserStreakAfterThisLoss, spikeWasPlantedThisRound, losingTeamWasAttacker) {
    for (const e of winners) e.credits = Math.min(this.CREDIT_CAP, e.credits + this.WIN_BONUS);
    const streak = Math.min(loserStreakAfterThisLoss, this.LOSS_BONUS_MAX_STREAK);
    let loseBonus = this.LOSS_BONUS_BASE + this.LOSS_BONUS_STEP * streak;
    for (const e of losers) {
      let amt = loseBonus;
      if (spikeWasPlantedThisRound && losingTeamWasAttacker) amt += this.PLANT_BONUS;
      e.credits = Math.min(this.CREDIT_CAP, e.credits + amt);
    }
  },
};
