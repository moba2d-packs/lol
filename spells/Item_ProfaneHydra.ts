import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { enemyChampionsAround } from './Item_FrozenHeart';
import { pct, secs } from '../text';

const Spell = api.Spell;
const AoePulse = api.AoePulse;
const dmg = api.text.dmg;

/**
 * Mãng Xà Kích's active — the third button on the hydra family's shape
 * (Rìu Tiamat's cleave in the passive slot, something of its own in the
 * active), and the one that is bought to *finish* rather than to start.
 *
 * Chùy Phản Kích's active catches a fight that has not started; Khiên Băng
 * Randuin's stops one from leaving. This one is pressed when somebody is
 * already low: a flat bite everywhere, raised by 40% against anybody under a
 * third of their bar, which is the same line Ngọn Lửa Hắc Hóa reads one shelf
 * over and the reason the two never end up in the same build.
 *
 * Champions only, exactly as `Item_Stridebreaker.ts` argues it: the item's
 * *passive* half is Rìu Tiamat's cleave, which is where the waves are, and
 * the active is for the person trying to walk away. An active that also
 * cleared the wave would make the passive decorative.
 *
 * ## The numbers
 *
 * 18 sits inside this pack's stated spell band (15-35) and beside the shop's
 * other buttons — Chùy Phản Kích's ~10-14 plus a slow, Vĩnh Sương's 30 plus a
 * root. The +40% under 35% is the live item's own fraction, unchanged: both
 * halves are shares and neither needed rescaling. The cooldown is 12s against
 * live's 10 — between Vĩnh Sương's 10 and Chùy Phản Kích's 14, and well
 * inside the practice room's 20-second ceiling that `Item_Ghostblade.ts`
 * records.
 */

/** The bite, flat and physical. */
export const PROFANE_DAMAGE = 18;

/** How much more it is worth against somebody already losing. */
export const PROFANE_EXECUTE_BONUS = 0.4;

/** The line, as a share of the victim's maximum health. */
export const PROFANE_EXECUTE_THRESHOLD = 0.35;

/** How far it reaches. Tighter than the other two self-burst buttons: this is a cleaver. */
export const PROFANE_RADIUS = 200;

/** Inside the actives' 10-18s band; the practice room's ceiling is 20s. */
export const PROFANE_COOLDOWN_MS = 12_000;

export const PROFANE_SOURCE = 'Mãng Xà Kích';

export const PROFANE_RING_MS = 420;
export const PROFANE_FLARE_RADIUS = 34;
export const PROFANE_FLARE_MS = 260;

// Serpent green-black: not Chùy Phản Kích's storm rust and not Khiên Băng
// Randuin's ice, so three self-burst rings are three items in a scrum.
const PROFANE: [number, number, number] = [130, 210, 120];

export default class Item_ProfaneHydra extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_profane_hydra');
  name = 'Mãng Xà Kích (Item_ProfaneHydra)';
  description =
    `Kích hoạt: gây ${dmg(PROFANE_DAMAGE, 'PHYSICAL')} quanh bạn, cộng thêm` +
    ` ${pct(PROFANE_EXECUTE_BONUS)}% lên mục tiêu còn dưới` +
    ` ${pct(PROFANE_EXECUTE_THRESHOLD)}% máu tối đa (hồi lại sau` +
    ` ${secs(PROFANE_COOLDOWN_MS)} giây)`;
  coolDown = PROFANE_COOLDOWN_MS;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onSpellCast() {
    for (const enemy of enemyChampionsAround(this.owner, PROFANE_RADIUS)) {
      const max = enemy.stats.maxHealth.value;
      const low = max > 0 && enemy.stats.health.baseValue <= max * PROFANE_EXECUTE_THRESHOLD;
      const bite = low ? PROFANE_DAMAGE * (1 + PROFANE_EXECUTE_BONUS) : PROFANE_DAMAGE;
      enemy.takeDamage(bite, this.owner, 'PHYSICAL', PROFANE_SOURCE);

      const flare = new AoePulse(this.owner);
      flare.position = enemy.position.copy();
      // The bigger flare is the bigger number: the one thing a player has to
      // be able to read off this button is which of the bodies it just
      // finished was worth pressing it on.
      flare.radius = PROFANE_FLARE_RADIUS * (low ? 1.35 : 1);
      flare.lifeTime = PROFANE_FLARE_MS;
      flare.color = [...PROFANE];
      flare.fillAlpha = 50;
      this.game.objectManager.addObject(flare);
    }

    // Reach on the ring, victims on the flares — the Locket/Randuin two-layer
    // honesty, so nobody has to guess how far the swing went.
    const ring = new AoePulse(this.owner);
    ring.position = this.owner.position.copy();
    ring.radius = PROFANE_RADIUS;
    ring.lifeTime = PROFANE_RING_MS;
    ring.color = [...PROFANE];
    ring.fillAlpha = 26;
    this.game.objectManager.addObject(ring);
  }
}
