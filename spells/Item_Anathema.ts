import type {
  AttackableUnit as AttackableUnitType,
  CastContext,
  CastSpec,
  DamageType,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const TargetResolver = api.combat.TargetResolver;
const withinRange = api.combat.Reach.withinRange;
const effectiveRange = api.combat.Reach.effectiveRange;
const canSee = api.combat.Vision.canSee;
const Champion = api.units.Champion;

/**
 * Găng Xích Thù Hận — the first thing in this shop that is bought against a
 * *person* rather than against a damage type.
 *
 * Every other defensive row answers a category: Áo Vải answers magic, Giáp
 * Lụa answers attacks, Vòng Sắt Cổ Tự answers a burst. This one asks the
 * player to name the champion who keeps killing them and then makes that
 * champion, specifically, worth 25% less — which is a different decision,
 * and the only one on the shelf that a player has to keep making as the fight
 * changes hands.
 *
 * ## Two simplifications, both stated on the card's own terms
 *
 * 1. **No ramp.** Live is up to 30% *built up over sixty seconds*. A
 *    sixty-second ramp never completes in a practice-room fight, so the
 *    player would spend the whole item's life looking at the bottom of a
 *    curve they never see the top of. A flat 25% is the same purchase with
 *    the part nobody would ever reach removed.
 * 2. **No tenacity shred.** Live also cuts the marked champion's tenacity by
 *    20%. It *is* expressible — a negative-`tenacity` `StatAmp` on the enemy
 *    — but it is a second mechanic on a row that already asks the hardest
 *    question in the shop, and the item's identity is the reduction.
 *
 * ## The seam is real, and it is not the one `data.ts` says is missing
 *
 * `Buff.modifyIncomingDamage(damage, attacker, type)` **is** told the
 * attacker, so `attacker === nemesis ? damage * 0.75 : damage` is honest
 * arithmetic rather than a guess. What `data.ts` records as unbuildable is a
 * different question — that hook is never told the *source spell*, which is
 * why Lời Thề Hiệp Sĩ and Dạ Kiếm cannot be built. This item does not need to
 * know which ability hit it, only who swung.
 *
 * Reducing is what the hook is *for*, so unlike `Item_Maw.ts` and
 * `Item_ForceOfNature.ts` there is no latch here: those two need a second
 * pass because they *react* (a shield, a stat grant), and reacting inside the
 * mitigation chain is the thing that is banned.
 *
 * > **Trap (AGENTS.md):** a `UNIT`-targeted spell must declare
 * > `targetingRequest.targetTeam: 'ENEMY'`. Omit it and targeting defaults to
 * > `'ANY'`, the nearest-target fallback resolves the caster with the cursor
 * > on empty ground, and the item marks its own wearer as their nemesis.
 */

/** How much less the marked champion's damage is worth. */
export const ANATHEMA_REDUCTION = 0.25;

/** How far away a nemesis can be named. */
export const ANATHEMA_RANGE = 500;

/** The practice room's ceiling for an item active (`Item_Ghostblade.ts`). */
export const ANATHEMA_COOLDOWN_MS = 20_000;

export const ANATHEMA_STACK_ID = 'item_anathema_nemesis';

// Chain iron with blood in it: a grudge, and never confusable with the
// blue-white of a shield.
const CHAINS: [number, number, number] = [215, 120, 110];

/** Whether `target` is somebody a grudge can name. */
export const isNemesisTarget = (target: unknown): target is AttackableUnitType =>
  target instanceof Champion && target.targetable && !target.toRemove && !target.isDead;

/**
 * The grudge, worn by the wearer rather than by the enemy.
 *
 * On the wearer because the effect is *theirs*: it survives the nemesis
 * walking out of range, being untargetable, or standing in a bush, and it is
 * the wearer's own buff bar that has to say who it is pointed at. Permanent
 * (`duration = 0`, no countdown) — the card says "until you mark someone
 * else", and re-marking is `REPLACE_EXISTING` on one fixed slot.
 */
export class Item_Anathema_Nemesis extends Buff {
  name = 'Kẻ Thù';
  description =
    `Nhận ít hơn <span class="buff">${pct(ANATHEMA_REDUCTION)}%</span> sát thương từ tướng địch ` +
    `bị đánh dấu, cho đến khi đánh dấu mục tiêu khác.`;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  /** Who the grudge is against. Set by the active before the buff is added. */
  nemesis: AttackableUnitType | null = null;

  onUpdate(): void {
    // A grudge against a corpse is a slot the player cannot re-use and a HUD
    // row pointing at nothing. The mark ends with them.
    const nemesis = this.nemesis;
    if (!nemesis || nemesis.isDead || nemesis.toRemove) this.deactivateBuff();
  }

  modifyIncomingDamage(damage: number, attacker?: AttackableUnitType, _type?: DamageType): number {
    // `takeDamage`'s mitigation loop walks `this.buffs` **without skipping
    // `toRemove`**, and a deactivated buff lingers in that array until the
    // next `updateBuffs()` compaction. So a re-mark — which is
    // `REPLACE_EXISTING` deactivating the old grudge and pushing a new one —
    // would leave the previous nemesis reduced as well for the rest of the
    // frame, and a hit that lands in between is answered by a grudge the
    // player has already moved. Nothing else in the chain has to care,
    // because nothing else in the chain is replaced mid-fight.
    if (this.toRemove) return damage;
    if (!attacker || attacker !== this.nemesis) return damage;
    return damage * (1 - ANATHEMA_REDUCTION);
  }

  /**
   * A ring on the marked champion, so the wearer can see who they picked
   * without reading a tooltip mid-fight. Decoration only: the reduction above
   * runs whether or not anybody is looking.
   */
  draw(): void {
    const nemesis = this.nemesis;
    if (!nemesis || nemesis.isDead || nemesis.toRemove) return;
    const size = nemesis.animatedValues.displaySize + 12;
    const [r, g, b] = CHAINS;

    push();
    noFill();
    stroke(r, g, b, 200);
    strokeWeight(2);
    circle(nemesis.position.x, nemesis.position.y, size);
    // Four short links off the ring, so it reads as a chain rather than as
    // one more selection circle.
    strokeWeight(3);
    for (let i = 0; i < 4; i++) {
      const angle = (TWO_PI * i) / 4 + frameCount / 60;
      line(
        nemesis.position.x + Math.cos(angle) * (size / 2),
        nemesis.position.y + Math.sin(angle) * (size / 2),
        nemesis.position.x + Math.cos(angle) * (size / 2 + 7),
        nemesis.position.y + Math.sin(angle) * (size / 2 + 7)
      );
    }
    pop();
  }
}

export default class Item_Anathema extends Spell {
  image = api.asset('item_anathemas_chains');
  name = 'Găng Xích Thù Hận (Item_Anathema)';
  description =
    `Kích hoạt: đánh dấu một tướng địch làm Kẻ Thù — bạn nhận ít hơn` +
    ` ${pct(ANATHEMA_REDUCTION)}% sát thương từ chúng, cho đến khi đánh dấu mục tiêu khác` +
    ` (hồi lại sau ${secs(ANATHEMA_COOLDOWN_MS)} giây)`;
  coolDown = ANATHEMA_COOLDOWN_MS;
  manaCost = 0;

  range = ANATHEMA_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      // See the header. Without this the item marks its own wearer.
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isNemesisTarget(candidate),
      getTargetInfo: candidate =>
        isNemesisTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) return super.press(context);

    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  onUpdate(): void {
    if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
      this.cancel('TARGET_INVALID');
    }
  }

  onSpellCast(context: CastContext): void {
    const target = context.target;
    if (!isNemesisTarget(target)) return;

    const grudge = new Item_Anathema_Nemesis(0, this.owner, this.owner);
    grudge.nemesis = target;
    grudge.stackId = ANATHEMA_STACK_ID;
    grudge.image = this.image;
    // Tied to the item, not the life: selling the gauntlet drops the grudge.
    grudge.sourceSpell = this;
    this.owner.addBuff(grudge);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnitType {
    return (
      isNemesisTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}
