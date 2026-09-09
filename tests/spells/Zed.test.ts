/**
 * **A shadow's copy is Zed's ability, so it hits for what Zed's build says.**
 *
 * Reported the same way the jester's box was: the tooltip over W's mirrored
 * ability is rescaled by the champion who owns it, and the shadow was dealing
 * the first-frame number forever. A shadow is a bare `Champion` — no inventory,
 * no bonus attack damage, no ability power — and `combat/Amplification.ts`
 * reads the stat block of whoever deals the hit, which was the shadow's empty
 * one. `Zed_W_Clone.abilityDamageOwner` is the answer, and this is the ability
 * it was reported on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';

import Zed_W, { Zed_W_Clone } from '../../spells/Zed_W';
import Zed_E from '../../spells/Zed_E';

const api = buildTestApi();
const { Champion } = api.units;

/** What one sweep of the blade is authored at, before any build touches it. */
const E_DAMAGE = 15;
/** `Amplification.ABILITY_SCALING_PER_ATTACK_DAMAGE` — a point of bonus attack damage. */
const PER_ATTACK_DAMAGE = 0.05;

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
  vi.stubGlobal('deltaTime', 16);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A shadow standing where W put it, built by pressing the real ability rather
 * than by constructing the class — the clone only wires up its mimicry in
 * `onAdded`, which is the manager's to call.
 */
const shadowAt = (game: TestGame, zed: InstanceType<typeof Champion>, x: number) => {
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(x, 0);
  expect(pressSpell(new Zed_W(zed), { at: { x, y: 0 } })).toBe(true);

  const clone = game.objectManager._objectToBeAdd.find(
    (object: unknown): object is Zed_W_Clone => object instanceof Zed_W_Clone
  );
  expect(clone, 'W built no shadow').toBeTruthy();
  // Let it arrive: it dashes out of Zed and only starts mirroring once it has.
  for (let tick = 0; tick < 80; tick++) game.objectManager.update();
  return clone!;
};

describe('Zed W — the shadow reads Zed’s build', () => {
  const sweep = (bonusAttackDamage: number): number => {
    const game = createGame();
    const zed = new Champion({ game, teamId: 'blue' } as never) as never as InstanceType<
      typeof Champion
    >;
    zed.position.set(0, 0);
    zed.destination.set(0, 0);
    game.setPlayer(zed as never);
    zed.stats.attackDamage.flatBonus = bonusAttackDamage;

    // Far enough that only the shadow's blade can reach it — Zed's own sweep
    // is 100 wide and he never leaves the origin, so every point of damage
    // below is the copy's.
    const victim = createUnit(game, 340, 'red');
    victim.stats.maxHealth.baseValue = 500;
    victim.stats.health.baseValue = 500;
    // The body is in the world for the whole sweep, so it is also *regenerating*
    // for the whole sweep — a couple of points of health back is the difference
    // between reading 45 and reading 42.7.
    victim.stats.healthRegen.baseValue = 0;
    game.objectManager.addObject(victim as never);

    const clone = shadowAt(game, zed, 320);
    expect(clone.position.dist(victim.position), 'the shadow landed out of reach').toBeLessThan(100);

    expect(pressSpell(new Zed_E(zed), { at: { x: 0, y: 0 } })).toBe(true);
    // The blade is a bar sweeping around the body: a full turn is what
    // guarantees it has passed the victim's bearing once.
    for (let tick = 0; tick < 40; tick++) game.objectManager.update();

    return 500 - victim.stats.health.value;
  };

  it('mirrors the ability at its authored number for a Zed who has bought nothing', () => {
    expect(sweep(0)).toBe(E_DAMAGE);
  });

  it('mirrors it at Zed’s number once he has bought damage', () => {
    // 15 × (1 + 40 × 0.05) = 45, by hand. The shadow owns none of that
    // attack damage; Zed does.
    const expected = Math.round(E_DAMAGE * (1 + 40 * PER_ATTACK_DAMAGE));
    expect(sweep(40)).toBe(expected);
  });
});
