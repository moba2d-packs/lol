/**
 * **The jester's blink is only worth casting if the two abilities it sets up
 * do not immediately give him away.**
 *
 * Q hides him for two seconds. W buries a box and R leaves a decoy, and both
 * were reported as cancelling the stealth the instant they were pressed —
 * which they did, and not because of anything in Shaco's own files: core ended
 * every stealth on every accepted cast. The rule is damage now, on either end
 * of it (`combat/StealthBreak.ts`), and this is the report it came from, so it
 * is asserted on the champion it was reported against rather than only on
 * core's own synthetic spells.
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

import Shaco_Q, { STEALTH_MS } from '../../spells/Shaco_Q';
import Shaco_W from '../../spells/Shaco_W';
import Shaco_R from '../../spells/Shaco_R';
import Shaco_E from '../../spells/Shaco_E';

const api = buildTestApi();
const { Champion } = api.units;

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
  vi.stubGlobal('deltaTime', 16);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Shaco who has just blinked, with the stealth settled onto his flags. */
const vanished = (game: TestGame) => {
  const shaco = new Champion({ game, teamId: 'blue' } as never) as never as InstanceType<
    typeof Champion
  >;
  shaco.position.set(0, 0);
  shaco.destination.set(0, 0);
  game.setPlayer(shaco as never);
  (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();

  expect(pressSpell(new Shaco_Q(shaco), { at: { x: 100, y: 0 } })).toBe(true);
  shaco.updateBuffs();
  expect(shaco.isStealthed, 'Q did not hide him at all').toBe(true);
  expect(STEALTH_MS).toBeGreaterThan(0);
  return shaco;
};

/** Settle the flags the way a frame would, then read. */
const stillHidden = (shaco: { updateBuffs: () => void; isStealthed: boolean }): boolean => {
  shaco.updateBuffs();
  return shaco.isStealthed;
};

describe('Shaco Q — the stealth survives everything that damages nobody', () => {
  it('stays hidden through Hộp Hề Ma Quái', () => {
    const game = createGame();
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    const shaco = vanished(game);

    expect(pressSpell(new Shaco_W(shaco), { at: { x: 60, y: 0 } })).toBe(true);

    expect(stillHidden(shaco)).toBe(true);
  });

  it('stays hidden through Phân Thân', () => {
    const game = createGame();
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    const shaco = vanished(game);

    expect(pressSpell(new Shaco_R(shaco), { at: { x: 200, y: 0 } })).toBe(true);

    expect(stillHidden(shaco)).toBe(true);
  });

  /**
   * The other half, so this is a rule and not an exemption: E is a thrown
   * dagger, it damages somebody, and it ends the stealth like anything else
   * that lands.
   */
  it('but a dagger that lands gives him away', () => {
    const game = createGame();
    const victim = createUnit(game, 120, 'red');
    victim.stats.maxHealth.baseValue = 500;
    victim.stats.health.baseValue = 500;
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    const shaco = vanished(game);

    expect(pressSpell(new Shaco_E(shaco), { at: victim.position })).toBe(true);
    // Still hidden while the dagger is in the air: the cast is not the hit.
    expect(stillHidden(shaco)).toBe(true);

    for (let tick = 0; tick < 40 && victim.stats.health.value === 500; tick++) {
      game.objectManager.update();
    }

    expect(victim.stats.health.value, 'the dagger never landed').toBeLessThan(500);
    expect(stillHidden(shaco)).toBe(false);
  });
});
