import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Speedup = api.buffs.Speedup;
const AoePulse = api.AoePulse;
const Champion = api.units.Champion;
const tint = api.text.tint;

/**
 * Trát Lệnh Đế Vương — the enchanter item whose payout belongs to somebody
 * else, and the only row in this shop that pays for a *second* player acting.
 *
 * Lư Hương Sôi Sục and Khúc Ca Shurelya hand an ally something and hope they
 * use it. This one only pays when they actually do: the mark sits on the
 * enemy doing nothing until a teammate commits to the same target, and then
 * it detonates and shoves them forward. It is the item that makes "focus this
 * one" a thing the shop rewards rather than a thing the shop hopes for.
 *
 * ## Simplified, and the reason is an engine gap
 *
 * Live Mandate marks off *your abilities that slow or immobilise*. That is
 * not observable from a pack: `EventType.ON_BUFF_ADD` exists in core's enum
 * and **is emitted nowhere in `src/`** — grepped, along with `ON_HEAL`, which
 * is why two other candidates for this shelf were dropped outright — so "I
 * just applied a slow" is a question nothing can answer. The mark therefore
 * comes off your **magic damage**, which is the seam every other mage row in
 * this shop already rides (`Item_GrievousMagic.ts` opened it).
 *
 * ## The detonation seam is real
 *
 * `Buff.onDamageTaken(swung, landed, attacker)` on the *marked enemy* is told
 * the attacker, so "an ally of my wearer just hit this" is answerable on the
 * victim's own body. Champions only: a lane creep chipping the marked target
 * would spend the mark half a second after it landed, every time, and the
 * item would be a wave-clear buff for minions.
 *
 * > **Same re-entry class as `Item_Shadowflame.ts`.** The detonation is
 * > itself damage on the marked enemy, so it re-enters `onDamageTaken`.
 * > `consumed` is set **before** the `takeDamage` call, not after.
 *
 * The damage is credited to the wearer —
 * `takeDamage(12, wearer, 'MAGIC', 'Trát Lệnh Đế Vương')` — so the kill
 * ledger and the death recap name the enchanter rather than "Không rõ", which
 * is half of what an enchanter's item is for.
 *
 * The 12 is not a rescale of live's 75 (that would be ~4 on this pool and
 * invisible); it is sized level with `Item_Ludens.ts`'s echo and the shop's
 * other procs. The move-speed share and its two seconds are live's own,
 * unchanged. The per-target clock is 8s against live's 6, because this
 * shop's per-target clocks sit at 8-10 (`Item_SunderedSky.ts` 8s,
 * `Item_Heartsteel.ts` 10s).
 */

/** How long the mark waits for a teammate. */
export const MANDATE_MARK_MS = 4_000;

/** What the detonation deals, credited to the wearer. */
export const MANDATE_DAMAGE = 12;

/** And what the ally who set it off gets, and for how long. */
export const MANDATE_ALLY_SPEED = 0.2;
export const MANDATE_ALLY_SPEED_MS = 2_000;

/** Per-target: how long before the same enemy can be marked again. */
export const MANDATE_PER_TARGET_MS = 8_000;

export const MANDATE_STACK_ID = 'item_imperial_mandate';
export const MANDATE_MARK_STACK_ID = 'item_imperial_mandate_mark';
export const MANDATE_HASTE_STACK_ID = 'item_imperial_mandate_rush';

export const MANDATE_SOURCE = 'Trát Lệnh Đế Vương';

export const MANDATE_BURST_RADIUS = 44;
export const MANDATE_BURST_MS = 260;

// Imperial gold-white: an order, not a spell — and clearly not Lư Hương Sôi
// Sục's rose, so two enchanter items never read as one.
const MANDATE: [number, number, number] = [250, 215, 130];

/**
 * The mark, worn by the enemy.
 *
 * On the enemy because that is the body the question is asked of — "did an
 * ally of the marker just hit *you*" — and because it is the thing the whole
 * team has to be able to see in order to act on it.
 */
export class Item_ImperialMandate_Mark extends Buff {
  name = MANDATE_SOURCE;
  description =
    `Bị đánh dấu: đồng minh đầu tiên đánh trúng sẽ kích nổ, gây ` +
    `${tint(`${MANDATE_DAMAGE} sát thương phép`, 'MAGIC')} và nhận ` +
    `<span class="buff">${pct(MANDATE_ALLY_SPEED)}%</span> tốc chạy trong ` +
    `<span class="time">${secs(MANDATE_ALLY_SPEED_MS)} giây</span>.`;
  buffAddType = api.enums.BuffAddType.RENEW_EXISTING;

  /** The enchanter who set it. `sourceUnit`, named for what it means here. */
  get marker(): AttackableUnit {
    return this.sourceUnit;
  }

  /** True from the instant the detonation starts. See the header. */
  private consumed = false;

  onDamageTaken(_swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (this.consumed) return;
    if (!attacker) return;
    const marker = this.marker;
    // The enchanter's own hits set the mark; they do not spend it.
    if (attacker === marker) return;
    if (attacker.teamId !== marker.teamId) return;
    // Champions only: a lane creep would spend every mark half a second
    // after it landed.
    if (!(attacker instanceof Champion)) return;

    const victim = this.targetUnit;
    if (victim.isDead || victim.toRemove) return;

    // Before the `takeDamage`, not after — the detonation is damage on this
    // same body and comes straight back here.
    this.consumed = true;

    victim.takeDamage(MANDATE_DAMAGE, marker, 'MAGIC', MANDATE_SOURCE);

    const rush = new Speedup(MANDATE_ALLY_SPEED_MS, marker, attacker);
    rush.name = MANDATE_SOURCE;
    rush.percent = MANDATE_ALLY_SPEED;
    rush.stackId = MANDATE_HASTE_STACK_ID;
    rush.image = this.image;
    attacker.addBuff(rush);

    const burst = new AoePulse(marker);
    burst.position = victim.position.copy();
    burst.radius = MANDATE_BURST_RADIUS;
    burst.lifeTime = MANDATE_BURST_MS;
    burst.color = [...MANDATE];
    burst.fillAlpha = 55;
    this.game.objectManager.addObject(burst);

    this.deactivateBuff();
  }

  /**
   * The mark itself: a thin ring on the marked body, so the *team* can see
   * what to hit. This is the one item VFX in the shop drawn for somebody
   * other than its owner, which is the whole point of the row.
   */
  draw(): void {
    const victim = this.targetUnit;
    if (victim.isDead || this.consumed) return;
    const size = victim.animatedValues.displaySize + 10;
    const [r, g, b] = MANDATE;

    push();
    noFill();
    stroke(r, g, b, 210);
    strokeWeight(2);
    // A broken ring rather than a closed one: a selection circle is a closed
    // one, and the two must not be confusable at a glance.
    for (let i = 0; i < 3; i++) {
      const start = (TWO_PI * i) / 3 + frameCount / 50;
      arc(victim.position.x, victim.position.y, size, size, start, start + 1.2);
    }
    pop();
  }
}

export class Item_ImperialMandate_Order extends Buff {
  name = MANDATE_SOURCE;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  /** Per-victim: the clock reading at which that enemy can be marked again. */
  private readyAgainAt = new Map<AttackableUnit, number>();
  private nowMs = 0;

  onUpdate(): void {
    this.nowMs += deltaTime;
  }

  onDamageDealt(_swung: number, _landed: number, victim: AttackableUnit, type: DamageType): void {
    if (type !== 'MAGIC') return;
    if (victim.isDead || victim.toRemove) return;
    if (victim.teamId === this.targetUnit.teamId) return;
    if (!(victim instanceof Champion)) return;

    const readyAt = this.readyAgainAt.get(victim) ?? -Infinity;
    if (this.nowMs < readyAt) return;

    // Prune while we are here: an entry whose window has closed is
    // bookkeeping about a fight that is over. `Item_SunderedSky.ts`'s ledger.
    for (const [marked, at] of this.readyAgainAt) {
      if (this.nowMs >= at || marked.toRemove) this.readyAgainAt.delete(marked);
    }
    this.readyAgainAt.set(victim, this.nowMs + MANDATE_PER_TARGET_MS);

    const mark = new Item_ImperialMandate_Mark(MANDATE_MARK_MS, this.targetUnit, victim);
    mark.stackId = MANDATE_MARK_STACK_ID;
    mark.image = this.image;
    victim.addBuff(mark);
  }
}

export default class Item_ImperialMandate extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_imperial_mandate');
  name = 'Trát Lệnh Đế Vương (Item_ImperialMandate)';
  description =
    `Nội tại: sát thương phép của bạn đánh dấu kẻ địch trong ${secs(MANDATE_MARK_MS)} giây;` +
    ` khi một đồng minh đánh trúng, dấu ấn nổ gây ${MANDATE_DAMAGE} sát thương phép và tăng` +
    ` ${pct(MANDATE_ALLY_SPEED)}% tốc chạy cho đồng minh đó trong` +
    ` ${secs(MANDATE_ALLY_SPEED_MS)} giây`;
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
    const order = new Item_ImperialMandate_Order(0, this.owner, this.owner);
    order.stackId = MANDATE_STACK_ID;
    order.image = this.image;
    order.sourceSpell = this;
    this.owner.addBuff(order);
  }
}
