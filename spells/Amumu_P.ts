import type { AttackableUnit, CastSpec, DamageType, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const tint = api.text.tint;

/**
 * Cursed Touch — the first **champion** passive in this pack.
 *
 * ## Why it is written as amplification and not as a shred
 *
 * The record (`docs/abilities/amumu/champion.json`) says a cursed target
 * "takes bonus magic damage **from all sources**", and that phrase is the
 * whole ability: Amumu is not a champion who does more damage, he is a
 * champion who makes his team's mages do more. Two implementations were
 * available and only one says that.
 *
 *   - `magicPenetration` on Amumu is attacker-side — it would help Amumu and
 *     nobody else, which deletes the reason he is picked beside a mage.
 *   - A negative `magicResist` on the victim helps everyone, but says
 *     something subtly different: it makes the victim *softer*, so it stacks
 *     oddly with penetration and lands differently on a target that has no
 *     magic resist to take. It is also arithmetically much weaker than it
 *     looks on this engine's `1 + mr/100` curve — a third off 25 magic resist
 *     is about 7% more damage, not 30%.
 *
 * So it is `Buff.modifyIncomingDamage`, which is exactly "more damage reaches
 * this body", answers only for `MAGIC`, and is the first use of that hook in
 * this pack. `AMP` is then the number the record states rather than a number
 * that has to be back-solved through a resistance curve.
 *
 * ## Why the curse is a buff on the victim, not a set on Amumu
 *
 * The damage has to be amplified when *anyone* deals it, including allies who
 * have never heard of Amumu, so the effect has to live on the body taking the
 * hit. That also gets refresh, expiry and death cleanup for free, and means
 * two Amumus in one match curse one target once rather than twice.
 */

/** How much more magic damage a cursed body takes, from anyone. */
export const AMP = 0.1;

/** How long the curse lasts after the swing that applied it. */
export const CURSE_MS = 3_000;

export const CURSE_STACK_ID = 'amumu_p_curse';

/**
 * The mark, on the victim.
 *
 * `REPLACE_EXISTING` rather than stacking: the record is a duration refreshed
 * by every swing, not a growing multiplier, and a stacking version would make
 * an Amumu who stands still hitting one target the highest-damage champion in
 * the pack by a distance.
 */
export class Amumu_P_Curse extends Buff {
  name = 'Nguyền Rủa';
  description =
    `Nhận thêm ${tint(`${pct(AMP)}% sát thương phép`, 'MAGIC')} từ ` +
    `<span class="buff">mọi nguồn</span>.`;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  image = api.asset('spell_amumu_w');

  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit, type?: DamageType): number {
    // Physical and true damage walk past untouched. The curse is what makes a
    // mage's team want him, and amplifying everything would make it a
    // strictly-better armour shred as well.
    if (type !== 'MAGIC') return damage;
    return damage * (1 + AMP);
  }
}


/**
 * The armed half, on Amumu, for as long as he is alive.
 *
 * `echo` is checked because a propagated hit is somebody else's item doubling
 * his swing, and a curse applied twice in one frame is the same curse — but
 * the check is cheap and it is the rule `OnHit.ts` asks every on-hit effect to
 * follow, so it is followed rather than reasoned around.
 */
export class Amumu_P_CursedTouch extends Buff {
  name = 'Chạm Nguyền';
  description =
    `Đòn đánh thường <span class="buff">nguyền rủa</span> mục tiêu trong ` +
    `<span class="time">${secs(CURSE_MS)} giây</span>: mục tiêu nhận thêm ` +
    `${tint(`${pct(AMP)}% sát thương phép`, 'MAGIC')} từ mọi nguồn.`;

  onHit(hit: OnHitEvent): void {
    if (hit.echo) return;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    const curse = new Amumu_P_Curse(CURSE_MS, this.targetUnit, victim);
    curse.stackId = CURSE_STACK_ID;
    victim.addBuff(curse);
  }
}


export default class Amumu_P extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_amumu_w');
  name = 'Cú Đập Nguyền Rủa (Amumu_P)';
  description =
    `Nội tại: đòn đánh thường nguyền rủa mục tiêu trong ${secs(CURSE_MS)} giây,` +
    ` khiến mục tiêu nhận thêm ${tint(`${pct(AMP)}% sát thương phép`, 'MAGIC')} từ mọi nguồn`;
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
    const armed = new Amumu_P_CursedTouch(0, this.owner, this.owner);
    armed.stackId = 'amumu_p';
    armed.image = this.image;
    // The ability bar already says he has a passive; a permanent icon on the
    // buff bar beside it is the same sentence twice, every frame.
    armed.hudVisible = false;
    this.owner.addBuff(armed);
  }
}
