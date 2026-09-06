import type { AttackableUnit, BasicAttackHit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const EventType = api.enums.EventType;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;
const StatAmp = api.buffs.StatAmp;
const Champion = api.units.Champion;
const Rectangle = api.utils.Quadtree.Rectangle;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


/** How long the empowered swing waits to be spent. */
export const Q_WINDOW_MS = 4_000;

/** Bonus physical damage the empowered attack carries, on top of the swing itself. */
export const Q_BONUS_DAMAGE = 24;

/**
 * `docs/abilities/trundle/q.json` gives 75% for 0.1 seconds — a real slow, but
 * one so short it is a rules footnote rather than something a player can see:
 * at 60fps that is six frames, most of which are spent inside the swing's own
 * windup. Stretched to a visible fraction of a second so "Chomp slows" is a
 * fact a player standing in it can actually confirm, not just read in a
 * tooltip; the percentage is kept close to the record.
 */
export const Q_SLOW_PERCENT = 0.6;

export const Q_SLOW_MS = 400;

/** Bonus attack damage Trundle keeps after the bite lands. */
export const Q_AD_GAIN = 16;

/** Half of `Q_AD_GAIN` — what the target's own bonus AD is docked by. */
export const Q_AD_DRAIN = Q_AD_GAIN / 2;

/** How long both the gain and the drain last. */
export const Q_STEAL_DURATION_MS = 5_000;


/**
 * Chomp: the next basic attack, but it takes a bite. Like `Darius_W`, pressing
 * Q does nothing by itself — it arms `Trundle_Q_Buff`, which waits on
 * `ON_ATTACK_HIT` and spends itself on the first swing that lands, so the bite
 * rides the real attack (on-hit items, crit, the attack's own validity checks)
 * instead of being a second hit the spell deals by hand.
 *
 * The record also gives the empowered swing +25 range and has it reset
 * Trundle's own attack timer. The range bonus is left out: it would need to
 * reach into the attack controller's reach check *while the buff is armed*,
 * which is a second seam this ability does not otherwise touch, for a bonus
 * too small to read on a canvas this size. The timer reset is kept — see
 * `Trundle_Q_Buff.land` — because `Champion.basicAttack.cooldownMs` is public
 * content-API surface and the alternative (a Chomp that competes with the
 * attack it was supposed to enable) is a worse ability for a one-line fix.
 */
export default class Trundle_Q extends Spell {
  /**
   * Told: the next attack deals bonus damage and steals attack damage. The
   * slow it applies is too brief to build on, so no `Cc`.
   */
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Buff;

  // Nothing is aimed: the bite goes wherever the standing attack order goes.
  targetingMode = 'SELF' as const;
  image = api.asset('spell_trundle_q');
  name = 'Nhai Nuốt (Trundle_Q)';
  description =
    `Cường hóa đòn đánh thường tiếp theo trong <span class="time">${secs(Q_WINDOW_MS)} giây</span>:` +
    ` gây thêm ${dmg(Q_BONUS_DAMAGE, 'PHYSICAL')} và` +
    ` <span class="buff">Làm Chậm ${pct(Q_SLOW_PERCENT)}%</span> trong <span class="time">${secs(Q_SLOW_MS)} giây</span>.` +
    ` Sau đó, Trundle nhận <span class="buff">${Q_AD_GAIN} sát thương đánh thường</span> trong` +
    ` <span class="time">${secs(Q_STEAL_DURATION_MS)} giây</span>, còn mục tiêu mất` +
    ` <span class="buff">${Q_AD_DRAIN} sát thương đánh thường</span> trong cùng thời gian đó.`;
  coolDown = 3_500;
  manaCost = 20;

  onSpellCast(): void {
    const armed = new Trundle_Q_Buff(Q_WINDOW_MS, this.owner, this.owner);
    armed.image = this.image;
    this.owner.addBuff(armed);
  }
}


export class Trundle_Q_Buff extends Buff {
  name = 'Cắn Xé Sẵn Sàng';
  description =
    `Đòn đánh kế tiếp gây thêm ${dmg(Q_BONUS_DAMAGE, 'PHYSICAL')},` +
    ` <span class="buff">Làm Chậm ${pct(Q_SLOW_PERCENT)}%</span> và cướp` +
    ` <span class="buff">${Q_AD_DRAIN} sát thương đánh thường</span> của mục tiêu.`;
  stackId = 'trundle_q_armed';

  private stopListening?: () => void;
  private art: Trundle_Q_Object | null = null;

  onActivate(): void {
    this.art = new Trundle_Q_Object(this.targetUnit);
    this.art.attachTo(this.targetUnit, this);
    this.game.objectManager.addObject(this.art);

    this.stopListening = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        // the event is global: every Trundle on the map hears every swing
        if (attacker !== this.targetUnit || !victim || victim.isDead) return;
        this.land(victim);
      }
    );
  }

  private land(victim: AttackableUnit): void {
    victim.takeDamage(Q_BONUS_DAMAGE, this.targetUnit, 'PHYSICAL', 'Cắn Xé Băng Giá');

    if (!victim.isDead) {
      const slow = new Slow(Q_SLOW_MS, this.targetUnit, victim);
      slow.percent = Q_SLOW_PERCENT;
      slow.image = this.image;
      victim.addBuff(slow);

      const gain = new StatAmp(Q_STEAL_DURATION_MS, this.targetUnit, this.targetUnit);
      gain.name = 'Cướp Sức Mạnh';
      gain.stackId = 'trundle_q_ad_gain';
      gain.image = this.image;
      gain.bonuses = { attackDamage: { baseBonus: Q_AD_GAIN } };
      this.targetUnit.addBuff(gain);

      // A flat `flatBonus` docking, not a percentage: the record takes "half
      // of the bonus AD Trundle just gained", a fixed number decided at the
      // moment of the bite, not a share of whatever the victim is holding.
      const drain = new StatAmp(Q_STEAL_DURATION_MS, this.targetUnit, victim);
      drain.name = 'Mất Sức Mạnh';
      drain.stackId = 'trundle_q_ad_drain';
      drain.image = this.image;
      drain.bonuses = { attackDamage: { flatBonus: -Q_AD_DRAIN } };
      victim.addBuff(drain);
    }

    // Resets the swing timer rather than merely allowing it to continue — the
    // whole point of an empowered *next* attack is that casting it does not
    // cost the attack that follows.
    if (this.targetUnit instanceof Champion) {
      this.targetUnit.basicAttack.cooldownMs = 0;
    }

    this.art?.discharge();
    this.deactivateBuff();
  }

  onDeactivate(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    if (this.art) {
      this.art.fadeOut();
      this.art = null;
    }
  }
}


/** How far the jaw hangs out in front of Trundle's body while armed. */
const JAW_REACH = 34;


/**
 * The armed bite: a pair of ice-blue fangs hovering in front of Trundle,
 * closing the instant the swing lands. Fangs rather than an orbiting rune
 * because the ability is about *his mouth*, not a spell effect draped on him —
 * `Darius_W`'s hip-axe already owns "a weapon hangs off his body while armed",
 * so this reads differently by being a bite rather than a blade.
 */
export class Trundle_Q_Object extends SpellObject {
  age = 0;
  /** 1 right after the bite lands, decaying to 0 as the snap art fades. */
  spent = 0;

  discharge(): void {
    this.spent = 1;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.spent > 0) this.spent = Math.max(0, this.spent - deltaTime / 220);
  }

  fadeOut(): void {
    if (this.spent <= 0) this.toRemove = true;
  }

  draw(): void {
    const draw01 = constrain(this.age / 180, 0, 1);
    const out = draw01 * draw01;
    // the jaws snap shut on the bite, then ease back open while armed
    const bite = this.spent > 0 ? this.spent : 1;
    const gap = (1 - bite * 0.85) * 12 + 3;

    push();
    translate(this.owner.position.x, this.owner.position.y);
    noStroke();
    for (const side of [-1, 1] as const) {
      push();
      translate(JAW_REACH * out, side * gap);
      rotate(side * -0.5);
      fill(200, 235, 255, 235 * out);
      triangle(0, 0, 16, side * 3, 0, side * 9);
      fill(255, 255, 255, 250 * out);
      triangle(0, 0, 11, side * 2, 0, side * 5.5);
      pop();
    }

    // the snap: a burst of frost where the bite closed
    if (this.spent > 0) {
      const grow = 1 - this.spent;
      noFill();
      stroke(150, 220, 255, 230 * this.spent);
      strokeWeight(4 * this.spent + 1);
      circle(JAW_REACH * out + 14, 0, 20 + 34 * grow);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.owner.position.x - 60,
      y: this.owner.position.y - 60,
      w: 120,
      h: 120,
      data: this,
    });
  }
}
