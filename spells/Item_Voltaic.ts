import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;
const AoePulse = api.AoePulse;
const tint = api.text.tint;

/**
 * Kiếm Điện Phong — the second item in this shop that charges off **walking**,
 * and deliberately the opposite half of the first.
 *
 * Giáp Người Chết banks distance and spends it on a payload that scales with
 * the wearer's own health: it is a tank closing a gap. This banks the same
 * distance and spends it on a flat bite plus a hard stagger: it is an assassin
 * arriving. The two are the same verb bought for opposite reasons, which is
 * why this one deliberately grants **no** movement speed while charging —
 * the plate already sells that, and a second item selling it would make the
 * first redundant rather than different.
 *
 * ## The three numbers, and where each came from
 *
 * - **8 physical.** Live is 100 on a ~2000-health pool, five percent of a
 *   bar. The shop's own comparable is Giáp Người Chết's full-charge payload,
 *   `8 + 5% máu tối đa` — so the same 8, without the health scaling, because
 *   this is not a tank item.
 * - **40% for a second.** Live is 99% decaying over 0.75s, and that does not
 *   rescale: source distances are halved on this canvas, so a 99% slow *is* a
 *   root. This shop's slows sit at 25-50%, and this is the top of that band
 *   because it is the whole reason to buy the row.
 * - **240 units of travel.** Live charges over 100 Summoner's Rift units;
 *   240 here is what `Item_DeadMansPlate.ts`'s own meter is measured against,
 *   so the two chargers fill at a comparable pace.
 *
 * The meter does not bleed away while the wearer stands still — the live item
 * does not either, and a decay would make this Giáp Người Chết with a
 * different payload rather than a different item.
 */

/** Units of travel that fill the blade. */
export const VOLTAIC_CHARGE_DISTANCE = 240;

/** Movement under this in one frame is standing still (jitter, a push-out). */
export const VOLTAIC_MOVEMENT_EPSILON = 0.4;

/** What the charged swing adds, flat and physical. */
export const VOLTAIC_BONUS_DAMAGE = 8;

export const VOLTAIC_SLOW_PERCENT = 0.4;
export const VOLTAIC_SLOW_MS = 1_000;

export const VOLTAIC_STACK_ID = 'item_voltaic';
export const VOLTAIC_SLOW_STACK_ID = 'item_voltaic_arc';

export const VOLTAIC_SOURCE = 'Kiếm Điện Phong';

/** The discharge flash: one ring on the victim, item-noise size. */
export const VOLTAIC_FLASH_RADIUS = 46;
export const VOLTAIC_FLASH_MS = 240;

// Storm white-blue. Cold and electric, so a charged blade never reads as the
// plate's warm steel.
const VOLT: [number, number, number] = [170, 220, 255];

export class Item_Voltaic_Charge extends Buff {
  name = VOLTAIC_SOURCE;
  description =
    `Di chuyển tích điện; khi đầy, đòn đánh kế tiếp gây thêm ` +
    `${tint(`${VOLTAIC_BONUS_DAMAGE} sát thương vật lý`, 'PHYSICAL')} và làm chậm ` +
    `<span class="buff">${pct(VOLTAIC_SLOW_PERCENT)}%</span> trong ` +
    `<span class="time">${secs(VOLTAIC_SLOW_MS)} giây</span>.`;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  /** Units walked since the last discharge, capped at the threshold. */
  travelled = 0;

  private lastX = 0;
  private lastY = 0;
  private started = false;

  onActivate(): void {
    this.lastX = this.targetUnit.position.x;
    this.lastY = this.targetUnit.position.y;
    this.started = true;
  }

  onUpdate(): void {
    if (!this.started) return;

    const at = this.targetUnit.position;
    const stepped = Math.hypot(at.x - this.lastX, at.y - this.lastY);
    this.lastX = at.x;
    this.lastY = at.y;
    if (stepped <= VOLTAIC_MOVEMENT_EPSILON) return;

    this.travelled = Math.min(VOLTAIC_CHARGE_DISTANCE, this.travelled + stepped);
  }

  /** Whether the very next swing would discharge — what `draw` shows. */
  charged(): boolean {
    return this.travelled >= VOLTAIC_CHARGE_DISTANCE;
  }

  onHit(hit: OnHitEvent): void {
    // The discharge is one swing's, not every application that swing fans out
    // into — an echo arrives with the meter already emptied anyway, so this
    // is the rule stated rather than an optimisation.
    if (hit.echo) return;
    if (!this.charged()) return;
    this.travelled = 0;

    const wearer = this.targetUnit;
    hit.victim.takeDamage(VOLTAIC_BONUS_DAMAGE, wearer, 'PHYSICAL', VOLTAIC_SOURCE);
    if (hit.victim.isDead || hit.victim.toRemove) return;

    const arc = new Slow(VOLTAIC_SLOW_MS, wearer, hit.victim);
    arc.name = VOLTAIC_SOURCE;
    arc.percent = VOLTAIC_SLOW_PERCENT;
    arc.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    arc.stackId = VOLTAIC_SLOW_STACK_ID;
    hit.victim.addBuff(arc);

    const flash = new AoePulse(wearer);
    flash.position = hit.victim.position.copy();
    flash.radius = VOLTAIC_FLASH_RADIUS;
    flash.lifeTime = VOLTAIC_FLASH_MS;
    flash.color = [...VOLT];
    flash.fillAlpha = 40;
    this.game.objectManager.addObject(flash);
  }

  /**
   * The loaded state, worn on the body — and only once the blade is actually
   * full, because that is the one moment the meter changes a decision (swing
   * now, or keep walking). Honest by construction: it asks the same
   * `charged()` that `onHit` spends against.
   */
  draw(): void {
    if (!this.charged()) return;
    const unit = this.targetUnit;
    const radius = unit.animatedValues.displaySize / 2 + 6;
    const [r, g, b] = VOLT;

    push();
    noFill();
    stroke(r, g, b, 210 + 40 * Math.sin(frameCount / 5));
    strokeWeight(2.5);
    arc(unit.position.x, unit.position.y, radius * 2, radius * 2, -PI * 0.9, -PI * 0.1);
    pop();
  }
}

export default class Item_Voltaic extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_voltaic_cyclosword');
  name = 'Kiếm Điện Phong (Item_Voltaic)';
  description =
    `Nội tại: di chuyển tích điện; khi tích đầy, đòn đánh kế tiếp gây thêm` +
    ` ${VOLTAIC_BONUS_DAMAGE} sát thương vật lý và làm chậm` +
    ` ${pct(VOLTAIC_SLOW_PERCENT)}% trong ${secs(VOLTAIC_SLOW_MS)} giây`;
  coolDown = 0;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: 0 },
    };
  }

  onSpellCast() {
    const charge = new Item_Voltaic_Charge(0, this.owner, this.owner);
    charge.stackId = VOLTAIC_STACK_ID;
    charge.image = this.image;
    // Tied to the item: selling the blade takes the meter with it.
    charge.sourceSpell = this;
    this.owner.addBuff(charge);
  }
}
