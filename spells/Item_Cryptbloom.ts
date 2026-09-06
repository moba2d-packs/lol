import type { AttackableUnit, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { alliedChampionsAround } from './Item_Shurelya';
import { pct } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const AoePulse = api.AoePulse;
const EventType = api.enums.EventType;

/**
 * Hoa Tử Linh — the first item in this shop that pays out on a **kill**.
 *
 * Every other reward here is paid by an action the wearer takes: a swing, a
 * cast, a button, a step. This one is paid by an outcome, which makes it the
 * mage's version of the thing a fed carry gets for free — the fight you win
 * puts the team back on its feet for the next one, and it is why the item
 * belongs beside Dây Chuyền Chuộc Tội on the shelf rather than beside Mũ Phù
 * Thủy Rabadon.
 *
 * ## Kills, not takedowns, and the reason is an engine gap
 *
 * The live item reads *takedowns* — kills or assists. Assists are not
 * observable from a pack: `payAssists` and the participation ledger are
 * private on `AttackableUnit`, and `UnitDeathEvent` carries the killer and
 * the credit and nothing else. So this is **kills only**, and the shop card
 * deliberately does not say "hạ gục hoặc hỗ trợ".
 *
 * `EventType.ON_DIE` itself is real and is emitted exactly once per death, on
 * the transition in `die()`, after the tally and the bounty are paid — so a
 * listener sees the world with the kill already counted. `creditedTo ?? killer`
 * is what core's own doc comment says to read: a pet's last hit is booked to
 * whoever summoned it, and a champion finished off by a turret is booked to
 * the last enemy champion who hurt them.
 *
 * ## The heal is a share of each recipient's own bar
 *
 * A flat number stops mattering the moment somebody buys health, which is the
 * argument `Item_Redemption.ts` (12%) and `Item_Mikael.ts` (15%) already make.
 * 8% is under Redemption's because Redemption costs a fifteen-second button
 * press and this costs a kill, which in a practice room is the cheaper of the
 * two. It goes through `takeHeal`, never a raw health write, so Vết Thương
 * Sâu and `healingReceived` both apply exactly as they do to every other heal.
 */

/** The bloom, as a share of each RECIPIENT's own maximum health. */
export const CRYPTBLOOM_HEAL_PERCENT = 0.08;

/** How far it reaches. Dây Chuyền Chuộc Tội's own radius, so the two agree. */
export const CRYPTBLOOM_RADIUS = 260;

export const CRYPTBLOOM_STACK_ID = 'item_cryptbloom';

export const CRYPTBLOOM_RING_MS = 520;
export const CRYPTBLOOM_FLARE_RADIUS = 34;
export const CRYPTBLOOM_FLARE_MS = 320;

// Crypt green-white: life out of a death, and clearly not Chuộc Tội's dawn
// gold — two heals landing in one scrum have to be tellable apart.
const BLOOM: [number, number, number] = [170, 245, 190];

export class Item_Cryptbloom_Bloom extends Buff {
  name = 'Hoa Tử Linh';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  private stopWatchingDeaths: (() => void) | null = null;

  onActivate(): void {
    this.stopWatchingDeaths = this.game.eventManager.on(
      EventType.ON_DIE,
      (event: { killer?: AttackableUnit; creditedTo?: AttackableUnit; credit?: string }) => {
        // A minion, a camp or a tower is not a takedown. `credit` is the
        // victim's own `killCredit`, so this asks the question without the
        // pack having to know core's unit classes.
        if (event.credit !== 'champion') return;
        if ((event.creditedTo ?? event.killer) !== this.targetUnit) return;
        this.bloom();
      }
    );
  }

  onDeactivate(): void {
    this.stopWatchingDeaths?.();
    this.stopWatchingDeaths = null;
  }

  private bloom(): void {
    const wearer = this.targetUnit;
    if (wearer.isDead || wearer.toRemove) return;

    const covered: AttackableUnit[] = [
      wearer,
      ...alliedChampionsAround(wearer, CRYPTBLOOM_RADIUS),
    ];

    for (const ally of covered) {
      if (ally.isDead || ally.toRemove) continue;
      ally.takeHeal(ally.stats.maxHealth.value * CRYPTBLOOM_HEAL_PERCENT, wearer);

      const flare = new AoePulse(wearer);
      flare.position = ally.position.copy();
      flare.radius = CRYPTBLOOM_FLARE_RADIUS;
      flare.lifeTime = CRYPTBLOOM_FLARE_MS;
      flare.color = [...BLOOM];
      flare.fillAlpha = 50;
      this.game.objectManager.addObject(flare);
    }

    // Reach on the ring, recipients on the flares — the Locket/Chuộc Tội
    // two-layer honesty, so nobody has to guess who was covered.
    const ring = new AoePulse(wearer);
    ring.position = wearer.position.copy();
    ring.radius = CRYPTBLOOM_RADIUS;
    ring.lifeTime = CRYPTBLOOM_RING_MS;
    ring.color = [...BLOOM];
    ring.fillAlpha = 24;
    this.game.objectManager.addObject(ring);
  }
}

export default class Item_Cryptbloom extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_cryptbloom');
  name = 'Hoa Tử Linh (Item_Cryptbloom)';
  description =
    `Nội tại: khi bạn hạ gục một tướng địch, hồi ${pct(CRYPTBLOOM_HEAL_PERCENT)}% máu tối đa` +
    ` cho bản thân và các đồng minh xung quanh`;
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
    const bloom = new Item_Cryptbloom_Bloom(0, this.owner, this.owner);
    bloom.stackId = CRYPTBLOOM_STACK_ID;
    bloom.image = this.image;
    // Tied to the item: selling it unsubscribes the listener, which is the
    // half a raw `eventManager.on` would leak.
    bloom.sourceSpell = this;
    this.owner.addBuff(bloom);
  }
}
