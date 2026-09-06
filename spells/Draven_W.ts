import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Speedup = api.buffs.Speedup;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;


export const W_ATTACK_SPEED = 0.35;

export const W_ATTACK_SPEED_MS = 3_000;

export const W_MOVE_SPEED = 0.55;

/** The move speed is short and decays; the attack speed is flat and lasts. */
export const W_MOVE_SPEED_MS = 1_500;

export const W_DECAY_TICK_MS = 250;

export const W_DECAY_PER_TICK = 0.18;

export const W_MANA = 30;


const BLOOD: [number, number, number] = [178, 34, 34];

const GOLD: [number, number, number] = [230, 184, 76];


/** The rush itself: full at the press, draining from the first quarter-second. */
export class Draven_W_Rush extends Speedup {
  name = 'Xung Huyết';
  stackId = 'draven_w_rush';
  private decayMs = 0;

  onUpdate(): void {
    super.onUpdate();
    this.decayMs += deltaTime;
    while (this.decayMs >= W_DECAY_TICK_MS) {
      this.decayMs -= W_DECAY_TICK_MS;
      this.percent *= 1 - W_DECAY_PER_TICK;
      // Off the unit, changed, back on: `addModifier` folds the number in, so
      // mutating one already applied would drift the stat instead of animating it.
      this.targetUnit.stats.removeModifier(this.statsModifier);
      this.statsModifier.speed.percentBaseBonus = this.percent;
      this.targetUnit.stats.addModifier(this.statsModifier);
    }
  }
}


/** The steady half — three seconds of swinging, undecayed. */
export class Draven_W_Frenzy extends StatAmp {
  name = 'Xung Huyết';
  stackId = 'draven_w_frenzy';
  bonuses = { attackSpeed: { percentBaseBonus: W_ATTACK_SPEED } };
}


/**
 * Blood Rush.
 *
 * `resetCoolDown()` is the interesting half and it is not called from here:
 * `Draven_Q.catchAxe` finds this spell on its owner and clears it, which is the
 * loop the champion is built out of. Nothing in this file has to know that
 * happens — the ability is just a rush, and catching an axe is what buys another.
 */
export default class Draven_W extends Spell {
  static aiRoles = api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_draven_w');
  name = 'Xung Huyết (Draven_W)';
  description =
    `Nhận <span class="buff">+${pct(W_ATTACK_SPEED)}% tốc đánh</span> trong ` +
    `<span class="time">${secs(W_ATTACK_SPEED_MS)} giây</span> và ` +
    `<span class="buff">+${pct(W_MOVE_SPEED)}% tốc chạy</span> tụt dần ` +
    `${pct(W_DECAY_PER_TICK)}% mỗi <span class="time">${secs(W_DECAY_TICK_MS)} giây</span>. ` +
    `Bắt được một <span class="buff">Rìu Xoay</span> sẽ hoàn lại chiêu này ngay lập tức.`;
  coolDown = 9_000;
  manaCost = W_MANA;

  onSpellCast(): void {
    const rush = new Draven_W_Rush(W_MOVE_SPEED_MS, this.owner, this.owner);
    rush.image = this.image;
    rush.percent = W_MOVE_SPEED;
    this.owner.addBuff(rush);

    const frenzy = new Draven_W_Frenzy(W_ATTACK_SPEED_MS, this.owner, this.owner);
    frenzy.image = this.image;
    this.owner.addBuff(frenzy);

    this.game.objectManager.addObject(new Draven_W_Surge(this.owner));
  }
}


/**
 * The moment it kicks in: three hard chevrons sweeping out behind him and gone.
 * Deliberately short — the buff row and the speed are the ability, and a
 * three-second effect under his feet would be noise for the whole of it.
 */
export class Draven_W_Surge extends SpellObject {
  lifeTime = 340;
  age = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    for (let i = 0; i < 3; i++) {
      const grown = 26 + 30 * i + 40 * out;
      stroke(BLOOD[0], BLOOD[1], BLOOD[2], (200 - i * 45) * fade);
      strokeWeight(5 - i);
      circle(0, 0, grown * 2);
    }
    stroke(GOLD[0], GOLD[1], GOLD[2], 235 * fade);
    strokeWeight(3);
    circle(0, 0, (26 + 40 * out) * 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(340);
  }
}
