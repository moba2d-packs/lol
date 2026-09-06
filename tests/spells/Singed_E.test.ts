import { describe, expect, it, vi } from 'vitest';

import { buildTestApi } from '@moba2d/core/testing';
import { createGame, createUnit, installSpellObjectGlobals } from '@moba2d/core/testing/spell';
import {
  DAMAGE,
  MAX_HEALTH_RATIO,
  THROW_DISTANCE,
  flingDamage,
} from '../../spells/Singed_E';
import Singed_E from '../../spells/Singed_E';
const __api = buildTestApi();
const { Dash, Airborne } = __api.buffs;
type Dash = InstanceType<typeof __api.buffs.Dash>;

installSpellObjectGlobals();

/**
 * A fling puts the victim on the *other* side of the caster. The first version
 * pushed along `caster -> victim` instead, which leaves them exactly where
 * they were relative to Singed and only further away — a shove, and the
 * opposite of what the ability is for.
 */
describe('Singed E throws the victim behind him', () => {
  it('lands them on the far side of Singed, not further out', () => {
    const game = createGame();
    const singed = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 120, 'red'); // due east of Singed
    // The lookup is Nasus Q's, already covered; this test is about where the
    // victim ends up, so hand the spell its target directly.
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const spell = new Singed_E(singed);
    spell.onSpellCast();

    const dash = victim.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
    expect(dash, 'the victim is dashed, not teleported').toBeTruthy();

    const landing = dash!.dashDestination!;
    // Due west of Singed: the sign of x flips, which is the whole fix.
    expect(landing.x).toBeCloseTo(-THROW_DISTANCE, 3);
    expect(landing.y).toBeCloseTo(0, 3);
    // ...and measured from Singed's feet, not from where the victim stood.
    expect(singed.position.dist(landing)).toBeCloseTo(THROW_DISTANCE, 3);

    expect(victim.buffs.some(buff => buff instanceof Airborne)).toBe(true);
    // Singed's own knock-up must not abort Singed's own displacement.
    expect(dash!.cancelable).toBe(false);
  });
});

/**
 * Fling grows with what the victim bought, and that is the whole reason it is
 * still worth casting late.
 *
 * The flat 28 this shipped with is a third of a champion's pool on the first
 * minute and a twelfth of it once everyone has six items — so the ability
 * quietly stopped mattering in exactly the fights it exists for. Upstream says
 * the damage is "based on the target's health ratio"
 * (`docs/abilities/singed/e.json`); this is that half, and these numbers are
 * plain arithmetic on the exported constants rather than anything the spell
 * computes for itself.
 */
describe('Singed E scales with the target, not with the clock', () => {
  const pool = (unit: ReturnType<typeof createUnit>, maxHealth: number) => {
    unit.stats.maxHealth.baseValue = maxHealth;
    return unit;
  };

  it('adds a share of the victim’s own health pool', () => {
    const game = createGame();
    const fresh = pool(createUnit(game, 100, 'red'), 100);
    const built = pool(createUnit(game, 100, 'red'), 375);

    expect(flingDamage(fresh)).toBe(DAMAGE + 100 * MAX_HEALTH_RATIO);
    expect(flingDamage(built)).toBe(DAMAGE + 375 * MAX_HEALTH_RATIO);
    // The point of the change, stated as the ratio it is: a target who spent
    // their whole build on health takes over half again as much.
    expect(flingDamage(built) / flingDamage(fresh)).toBeGreaterThan(1.5);
  });

  it('is still mostly its flat half against a jungle camp', () => {
    // Why there is no cap here and upstream has one: the biggest camp in this
    // pack carries 260, so its share is 21 against a flat 28. League caps at
    // 300 because its camps carry thousands.
    const game = createGame();
    const camp = pool(createUnit(game, 100, 'red'), 260);
    expect(flingDamage(camp) - DAMAGE).toBeLessThan(DAMAGE);
  });
});
