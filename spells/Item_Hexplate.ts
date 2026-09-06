import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;
const Champion = api.units.Champion;
const EventType = api.enums.EventType;
const SpellSlot = api.enums.SpellSlot;

/**
 * Khiên Hextech Thử Nghiệm — the only row in this shop that is bought for one
 * key.
 *
 * Every other proc here reads a swing, a cast, a step or a hit. This one
 * reads **the ultimate**, and nothing else: the four seconds after it goes
 * off are the four seconds the item exists for, and the shave off its own
 * cooldown is the item paying you to press it again. It is the fighter's
 * answer to Đao Chớp Navori — that one turns swings into casts, this one
 * turns the one cast that matters into swings.
 *
 * ## Identifying the ultimate, and why nothing else can trip it
 *
 * `spell === wearer.spells[SpellSlot.R]`. That row is the champion's **kit**,
 * which deliberately excludes Hồi Thành, the passive and every held item's
 * own active — so this item cannot power itself, which is the loop
 * `Spell.countsAsAbilityCast` exists to close on the spellblade side.
 * `SpellSlot.R` is **4**: slot 0 is the basic attack, and counting from zero
 * by hand is a documented bug in this codebase.
 *
 * `ON_POST_CAST_SPELL` fires inside the runtime's release step, and
 * `startCooldown` runs *before* that step for both `startAt: 'start'` and
 * `startAt: 'release'` — so the clock this shaves is always already running.
 * That ordering is the whole reason the shave can be a one-liner here rather
 * than a flag read a frame later.
 *
 * ## Two simplifications
 *
 * - **Four seconds, not live's eight.** This pack's ultimates sit on
 *   cooldowns of ten seconds or less (`@moba2d/core/testing/tempo`'s ceiling,
 *   measured off this very roster), so an eight-second window would be about
 *   80% uptime — a permanent buff wearing a cooldown's clothes, which is
 *   exactly what core's `duty-scan` exists to catch. Four is a window.
 * - **A 20% shave rather than 30 ability haste.** The haste stat would speed
 *   the *whole kit* up, which is a different and much larger item; the shave
 *   touches the ultimate that just went off and nothing else. It is a
 *   slightly smaller number than live's for the same reason.
 *
 * One `StatAmp` carrying both grants rather than a `StatAmp` plus a
 * `Speedup`: two buffs would be two rows and two clocks for one four-second
 * window, and the feedback the player actually reads here is the ultimate
 * they just pressed.
 */

/** Share of the wearer's own base swing rate, while the plate is hot. */
export const HEXPLATE_ATTACK_SPEED = 0.3;

/** And of their move speed. */
export const HEXPLATE_MOVE_SPEED = 0.15;

/** How long it stays hot. See the header for why this is not live's eight. */
export const HEXPLATE_DURATION_MS = 4_000;

/** Share filed off the ultimate's own remaining cooldown, once, on cast. */
export const HEXPLATE_COOLDOWN_REFUND = 0.2;

export const HEXPLATE_STACK_ID = 'item_hexplate';
export const HEXPLATE_SURGE_STACK_ID = 'item_hexplate_surge';

export class Item_Hexplate_Charge extends Buff {
  name = 'Khiên Hextech Thử Nghiệm';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class). The
  // four-second surge below is the visible half.
  hudVisible = false;

  private stopWatchingCasts: (() => void) | null = null;

  onActivate(): void {
    this.stopWatchingCasts = this.game.eventManager.on(
      EventType.ON_POST_CAST_SPELL,
      (spell: { owner?: unknown; currentCooldown?: number }) => {
        const wearer = this.targetUnit;
        if (spell.owner !== wearer) return;
        if (!(wearer instanceof Champion)) return;
        if (spell !== wearer.spells?.[SpellSlot.R]) return;
        this.charge(spell);
      }
    );
  }

  onDeactivate(): void {
    this.stopWatchingCasts?.();
    this.stopWatchingCasts = null;
  }

  private charge(ultimate: { currentCooldown?: number }): void {
    const wearer = this.targetUnit;
    if (wearer.isDead || wearer.toRemove) return;

    const surge = new StatAmp(HEXPLATE_DURATION_MS, wearer, wearer);
    surge.bonuses = {
      attackSpeed: { percentBaseBonus: HEXPLATE_ATTACK_SPEED },
      speed: { percentBaseBonus: HEXPLATE_MOVE_SPEED },
    };
    surge.name = 'Khiên Hextech Thử Nghiệm';
    // One press, one window: a second ultimate inside four seconds rewinds
    // the clock rather than stacking a second grant nobody priced.
    surge.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    surge.stackId = HEXPLATE_SURGE_STACK_ID;
    surge.image = this.image;
    wearer.addBuff(surge);

    // The clock is already running — see the header on `startCooldown`'s
    // ordering — so this is a real shave rather than a write to zero.
    const left = ultimate.currentCooldown ?? 0;
    if (left > 0) ultimate.currentCooldown = left * (1 - HEXPLATE_COOLDOWN_REFUND);
  }
}

export default class Item_Hexplate extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_experimental_hexplate');
  name = 'Khiên Hextech Thử Nghiệm (Item_Hexplate)';
  description =
    `Nội tại: sau khi dùng chiêu cuối, tăng ${pct(HEXPLATE_ATTACK_SPEED)}% tốc đánh và` +
    ` ${pct(HEXPLATE_MOVE_SPEED)}% tốc chạy trong ${secs(HEXPLATE_DURATION_MS)} giây, đồng thời` +
    ` giảm ${pct(HEXPLATE_COOLDOWN_REFUND)}% thời gian hồi còn lại của chiêu cuối`;
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
    const plate = new Item_Hexplate_Charge(0, this.owner, this.owner);
    plate.stackId = HEXPLATE_STACK_ID;
    plate.image = this.image;
    // Tied to the item: selling the plate unsubscribes the listener, which is
    // the half a raw `eventManager.on` would leak.
    plate.sourceSpell = this;
    this.owner.addBuff(plate);
  }
}
