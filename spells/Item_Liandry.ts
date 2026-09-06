import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const tint = api.text.tint;

/**
 * Mặt Nạ Đọa Đày Liandry — the anti-tank mage item, and the first thing in
 * this shop whose damage is a share of **the victim's** health rather than of
 * the wearer's.
 *
 * Every other percent-health number here (Thiêu Đốt, Trái Tim Khổng Thần,
 * Giáp Người Chết) reads the *wearer's* bar, because those ride tank items and
 * health is what their owner buys. This one reads the target's, which is the
 * whole purchase: a mage's flat 15-35 is worth less against every point of
 * health the front line adds, and this is the row that answers that.
 *
 * ## Why the burn is a pack-local ticking `Buff` and not `api.buffs.DamageOverTime`
 *
 * Core's `DamageOverTime` is ready-made for this — `damagePerTick`,
 * `damageType`, `tickInterval`, already `RENEW_EXISTING`, and it carries a
 * flame `ParticleSystem`. Its tick is `takeDamage(damage, sourceUnit, type)`
 * with **no source label**, so every point of it would land in the death
 * recap as "Không rõ". AGENTS.md's "label your damage" rule exists precisely
 * to stop that, and a burn a player cannot name is a burn they cannot decide
 * to walk away from. One `onUpdate` body over (`Item_Immolate.ts`'s shape) is
 * the whole cost of getting the name right.
 *
 * ## The number, and why it is not the live one
 *
 * Live Torment burns 2% of maximum health a second for three seconds. Here it
 * is **1.2%/s**, because in this engine the burn refreshes off *every* magic
 * tick rather than off a single application — a mage holding a channel keeps
 * it alight indefinitely, which the source item's version cannot do. On a
 * 100-point champion that is 3.6 over the full burn, an addition to a spell's
 * own 15-35 rather than a second spell; on a 300-health tank it is 10.8,
 * which is the job it was bought for.
 *
 * > **The re-entry that would have made it permanent.** The burn's own tick is
 * > magic damage credited to the wearer, so it arrives straight back at
 * > `onDamageDealt` below — and a `RENEW_EXISTING` refresh off it would rewind
 * > the three seconds every half-second, for ever. `ticking` is the latch that
 * > closes it; without that line the only way to put this burn out is to die.
 */

/** How long the burn lasts after the magic hit that set it. */
export const LIANDRY_BURN_MS = 3_000;

/** How often it bites. Twice a second — fast enough to read as a burn. */
export const LIANDRY_TICK_MS = 500;

/** Magic damage per second, as a share of the VICTIM's maximum health. */
export const LIANDRY_MAX_HEALTH_RATIO_PER_SECOND = 0.012;

export const LIANDRY_STACK_ID = 'item_liandry';

/** The victim's slot: one burn per victim, renewed rather than stacked. */
export const LIANDRY_BURN_STACK_ID = 'item_liandry_burn';

/** The recap groups by this. */
export const LIANDRY_SOURCE = 'Mặt Nạ Đọa Đày Liandry';

// Torment violet-orange: magic's own hue with heat in it, so the burn is
// tellable from Thiêu Đốt's plain embers at a glance.
const TORMENT: [number, number, number] = [230, 120, 190];

/** What one tick takes off the victim, as a share of their own maximum health. */
export const liandryTickRatio = (): number =>
  LIANDRY_MAX_HEALTH_RATIO_PER_SECOND * (LIANDRY_TICK_MS / 1_000);

/**
 * The burn itself, worn by the victim.
 *
 * On the victim rather than tracked in a ledger on the wearer, for two
 * reasons: the target can see it (a burn nobody can point at is a health bar
 * that drains for no stated reason), and it outlives the wearer — walking
 * away, or killing the mage, does not put it out inside its three seconds.
 */
export class Item_Liandry_Burn extends Buff {
  name = LIANDRY_SOURCE;
  description =
    `Thiêu đốt: mất ` +
    `${tint(`${pct(LIANDRY_MAX_HEALTH_RATIO_PER_SECOND)}% máu tối đa`, 'MAGIC')} mỗi giây trong ` +
    `<span class="time">${secs(LIANDRY_BURN_MS)} giây</span>.`;
  buffAddType = api.enums.BuffAddType.RENEW_EXISTING;

  /** True only while this buff's own `takeDamage` is in flight. See the header. */
  ticking = false;

  sinceTick = 0;

  onUpdate(): void {
    this.sinceTick += deltaTime;
    if (this.sinceTick < LIANDRY_TICK_MS) return;
    this.sinceTick = 0;

    const victim = this.targetUnit;
    if (victim.isDead || victim.toRemove) return;

    const bite = victim.stats.maxHealth.value * liandryTickRatio();
    this.ticking = true;
    try {
      victim.takeDamage(bite, this.sourceUnit, 'MAGIC', LIANDRY_SOURCE);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * One thin ring of heat on the burning body. Decoration only — the tick
   * above runs whether or not anybody is looking (`draw` is skipped
   * off-screen), which is the rule `tests/vfxRules.test.ts` enforces.
   */
  draw(): void {
    const victim = this.targetUnit;
    if (victim.isDead) return;
    const size = victim.animatedValues.displaySize + 6;
    const [r, g, b] = TORMENT;

    push();
    noFill();
    stroke(r, g, b, 150 + 40 * Math.sin(frameCount / 6));
    strokeWeight(2);
    circle(victim.position.x, victim.position.y, size);
    pop();
  }
}

export class Item_Liandry_Torment extends Buff {
  name = LIANDRY_SOURCE;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  onDamageDealt(_swung: number, _landed: number, victim: AttackableUnit, type: DamageType): void {
    if (type !== 'MAGIC') return;
    if (victim.isDead || victim.toRemove) return;
    if (victim.teamId === this.targetUnit.teamId) return;

    // See the header: the burn's own tick comes back through here, and
    // refreshing off it would make three seconds permanent.
    const alight = victim.buffs.find(
      buff => !buff.toRemove && buff.stackId === LIANDRY_BURN_STACK_ID
    ) as Item_Liandry_Burn | undefined;
    if (alight?.ticking) return;

    // One burn per victim, whoever set it: two Liandry's in one team renew a
    // single burn rather than stacking two, exactly as the wound shelf's two
    // items share one `HealCut`.
    const burn = new Item_Liandry_Burn(LIANDRY_BURN_MS, this.targetUnit, victim);
    burn.stackId = LIANDRY_BURN_STACK_ID;
    burn.image = this.image;
    victim.addBuff(burn);
  }
}

export default class Item_Liandry extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_liandrys_torment');
  name = 'Mặt Nạ Đọa Đày Liandry (Item_Liandry)';
  description =
    `Nội tại: sát thương phép gây ra thiêu đốt mục tiêu,` +
    ` gây ${pct(LIANDRY_MAX_HEALTH_RATIO_PER_SECOND)}% máu tối đa của mục tiêu mỗi giây` +
    ` trong ${secs(LIANDRY_BURN_MS)} giây`;
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
    const torment = new Item_Liandry_Torment(0, this.owner, this.owner);
    torment.stackId = LIANDRY_STACK_ID;
    torment.image = this.image;
    torment.sourceSpell = this;
    this.owner.addBuff(torment);
  }
}
