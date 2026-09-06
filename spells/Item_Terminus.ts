import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;

/**
 * Cung Chạng Vạng — the on-hit build's *defensive* keystone, and the only row
 * in this shop whose offence and defence are the same three stacks.
 *
 * Cuồng Đao Guinsoo spins a marksman up; Giáp Thiên Nhiên walls a mage out.
 * This does both off one counter: keep swinging and you cut deeper *and*
 * stand harder, which is the whole reason a duelist buys it instead of one of
 * each.
 *
 * ## The simplification, stated plainly
 *
 * Live Juxtaposition **alternates**: a Light stack (armour and magic resist)
 * then a Dark stack (armour and magic penetration), three of each, and which
 * one a swing grants depends on which you have more of. That is dropped here
 * and **every stack grants both halves, each at about half a live stack's
 * size**. Three reasons, in order of weight: the alternation is a coin-flip
 * the player cannot see coming and so cannot play around; it needs two rows
 * on the buff bar to be legible at all, and this HUD's buff bar is the thing
 * that has broken twice; and the item's identity — "swing more, get harder to
 * kill and harder to block" — survives the cut completely. Live's five-second
 * window and three-stack cap are both kept.
 *
 * At three stacks: **+18% xuyên giáp**, under Nỏ Thần Dominik's 35% ceiling
 * so the armour wall keeps meaning something, and **+15%** on top of whatever
 * resistances the build already carries.
 *
 * ## Why the resists are a share and the penetration is flat
 *
 * `armorPenetration` is already a fraction — 0.06 is six percent of the
 * victim's armour ignored — so it goes on `flatBonus`, the slot core's own
 * `modifierFor` puts an item's penetration in. The resists go on
 * `percentBonus`, Giáp Thiên Nhiên's slot, so they multiply what the wearer
 * bought rather than adding points a late-game build would not notice.
 *
 * One counted `StatAmp` re-issued at the new magnitude, not N stacked ones —
 * `Item_ForceOfNature.ts`'s shape, and for its reason: `REPLACE_EXISTING` on a
 * fixed `stackId` swaps the whole modifier out, so the ramp can never
 * double-count and always shows one row.
 */

/** How many swings the bow holds at once. */
export const TERMINUS_MAX_STACKS = 3;

/** How long the stacks last after the last swing. They all fall together. */
export const TERMINUS_STACK_MS = 5_000;

/** Share of the victim's armour ignored, per stack. */
export const TERMINUS_PEN_PER_STACK = 0.06;

/** Share added to the wearer's own armour and magic resist, per stack. */
export const TERMINUS_RESIST_PER_STACK = 0.05;

export const TERMINUS_STACK_ID = 'item_terminus';
export const TERMINUS_SURGE_STACK_ID = 'item_terminus_surge';

// Twilight amber: the item is the hour between the two, and it must not read
// as Cuồng Đao Guinsoo's flame at a glance.
const TWILIGHT: [number, number, number] = [235, 185, 120];

export class Item_Terminus_Juxtaposition extends Buff {
  name = 'Cung Chạng Vạng';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class). The
  // *stacks* are visible — they are re-issued as their own `StatAmp` below.
  hudVisible = false;

  stacks = 0;

  private nowMs = 0;
  private lastHitAtMs = -Infinity;

  onUpdate(): void {
    this.nowMs += deltaTime;
    // The surge expires on its own clock; the counter has to be told.
    if (this.stacks > 0 && this.nowMs - this.lastHitAtMs > TERMINUS_STACK_MS) this.stacks = 0;
  }

  onHit(hit: OnHitEvent): void {
    // One swing, one stack. A phantom hit or a Runaan bolt banking a stack
    // would make the cap a property of attack speed rather than of the item.
    if (hit.echo) return;

    const wearer = this.targetUnit;
    if (wearer.isDead || wearer.toRemove) return;

    this.lastHitAtMs = this.nowMs;
    if (this.stacks >= TERMINUS_MAX_STACKS) {
      // Already capped: the window still has to be rewound, which re-issuing
      // the same magnitude does.
      this.issueSurge();
      return;
    }
    this.stacks += 1;
    this.issueSurge();
  }

  private issueSurge(): void {
    const wearer = this.targetUnit;
    const surge = new StatAmp(TERMINUS_STACK_MS, wearer, wearer);
    surge.bonuses = {
      armorPenetration: { flatBonus: TERMINUS_PEN_PER_STACK * this.stacks },
      armor: { percentBonus: TERMINUS_RESIST_PER_STACK * this.stacks },
      magicResist: { percentBonus: TERMINUS_RESIST_PER_STACK * this.stacks },
    };
    surge.name = 'Cung Chạng Vạng';
    surge.buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
    surge.stackId = TERMINUS_SURGE_STACK_ID;
    surge.image = this.image;
    wearer.addBuff(surge);
  }

  /**
   * The count, worn as pips on the wearer's rim — one per live stack, so the
   * player can see how close the bow is to full without reading the buff bar
   * mid-fight. Nothing at all at zero: an always-on ring would spend the item
   * noise budget saying "you own this item", which the inventory already says.
   */
  draw(): void {
    if (this.stacks <= 0) return;
    const unit = this.targetUnit;
    if (unit.isDead) return;
    const radius = unit.animatedValues.displaySize / 2 + 5;
    const [r, g, b] = TWILIGHT;

    push();
    noFill();
    stroke(r, g, b, 220);
    strokeWeight(3);
    for (let i = 0; i < this.stacks; i++) {
      const angle = -PI * 0.75 + i * (PI * 0.25);
      line(
        unit.position.x + Math.cos(angle) * radius,
        unit.position.y + Math.sin(angle) * radius,
        unit.position.x + Math.cos(angle) * (radius + 8),
        unit.position.y + Math.sin(angle) * (radius + 8)
      );
    }
    pop();
  }
}

export default class Item_Terminus extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_terminus');
  name = 'Cung Chạng Vạng (Item_Terminus)';
  description =
    `Nội tại: mỗi đòn đánh cộng 1 điểm trong ${secs(TERMINUS_STACK_MS)} giây` +
    ` (tối đa ${TERMINUS_MAX_STACKS}): mỗi điểm cho ${pct(TERMINUS_PEN_PER_STACK)}% xuyên giáp` +
    ` và ${pct(TERMINUS_RESIST_PER_STACK)}% giáp cùng kháng phép`;
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
    const bow = new Item_Terminus_Juxtaposition(0, this.owner, this.owner);
    bow.stackId = TERMINUS_STACK_ID;
    bow.image = this.image;
    bow.sourceSpell = this;
    this.owner.addBuff(bow);
  }
}
