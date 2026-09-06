import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';
import Item_Serylda, {
  SERYLDA_SLOW_MS,
  SERYLDA_SLOW_PERCENT,
  SERYLDA_THRESHOLD,
} from '../../spells/Item_Serylda';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();
const { Slow } = api.buffs;

/**
 * The lethality shelf added on 2026-09-06 — the rows that stand on Dao Hung
 * Tàn, the first cheap penetration this shop has ever sold.
 *
 * They are the attack-damage mirrors of the mage shelf beside them, and the
 * cases here are deliberately the same questions asked from the other side:
 * does it read the right damage type, does it respect its own threshold, and
 * does a per-hit re-application compound something that should land once.
 */

type AnyBuff = InstanceType<typeof api.buffs.Buff>;
const live = (unit: { buffs: AnyBuff[] }): AnyBuff[] => unit.buffs.filter(buff => !buff.toRemove);
const slowsOn = (unit: { buffs: AnyBuff[] }): AnyBuff[] =>
  live(unit).filter(buff => buff instanceof Slow);

describe('Thương Phục Hận Serylda', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
  });

  /** Put `unit` on `share` of its own maximum health. */
  const wound = (unit: ReturnType<typeof createUnit>, share: number): void => {
    unit.stats.health.baseValue = unit.stats.maxHealth.value * share;
  };

  it('arms one permanent, hidden buff on the holder', () => {
    const holder = createUnit(game, 0);
    expect(pressSpell(new Item_Serylda(holder))).toBe(true);

    const armed = live(holder);
    expect(armed).toHaveLength(1);
    expect(armed[0].duration).toBe(0);
    expect(armed[0].hudVisible).toBe(false);
  });

  it('says nothing while the target is still above half', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Serylda(holder));
    wound(victim, 0.9);

    victim.takeDamage(5, holder, 'PHYSICAL');

    expect(slowsOn(victim)).toHaveLength(0);
  });

  it('slows a physical hit that leaves the target under the line', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Serylda(holder));
    wound(victim, SERYLDA_THRESHOLD / 2);
    const unslowed = victim.stats.speed.value;

    victim.takeDamage(5, holder, 'PHYSICAL');

    const grudge = slowsOn(victim);
    expect(grudge).toHaveLength(1);
    expect((grudge[0] as unknown as { percent: number }).percent).toBe(SERYLDA_SLOW_PERCENT);
    expect(grudge[0].duration).toBe(SERYLDA_SLOW_MS);
    expect(victim.stats.speed.value).toBeCloseTo(unslowed * (1 - SERYLDA_SLOW_PERCENT), 6);
  });

  /**
   * `TRUE` counts as physical here, the way `Item_GrievousStrike.ts` argues
   * it: it is what an armour-shredding build deals, and a lethality build is
   * exactly who is holding this spear.
   */
  it('counts true damage as physical', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Serylda(holder));
    wound(victim, 0.2);

    victim.takeDamage(5, holder, 'TRUE');

    expect(slowsOn(victim)).toHaveLength(1);
  });

  it('leaves a magic hit to Trượng Pha Lê Rylai, and an ally alone', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const ally = createUnit(game, 200);
    pressSpell(new Item_Serylda(holder));
    wound(victim, 0.2);
    wound(ally, 0.2);

    victim.takeDamage(5, holder, 'MAGIC');
    ally.takeDamage(5, holder, 'PHYSICAL');

    expect(slowsOn(victim)).toHaveLength(0);
    expect(slowsOn(ally)).toHaveLength(0);
  });

  it('is one slow renewed, not ten stacked, however often the hits land', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Serylda(holder));
    victim.stats.maxHealth.baseValue = 10_000;
    wound(victim, 0.2);
    const unslowed = victim.stats.speed.value;

    for (let i = 0; i < 12; i++) victim.takeDamage(1, holder, 'PHYSICAL');

    expect(slowsOn(victim)).toHaveLength(1);
    expect(victim.stats.speed.value).toBeCloseTo(unslowed * (1 - SERYLDA_SLOW_PERCENT), 6);
  });
});
