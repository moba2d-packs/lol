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
import Item_Rylai, { RYLAI_SLOW_MS, RYLAI_SLOW_PERCENT } from '../../spells/Item_Rylai';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();
const { Slow } = api.buffs;

/**
 * The mage shelf added on 2026-09-06 — the passives that ride a caster's own
 * magic damage rather than a swing or a button.
 *
 * Every one of them hangs off `Buff.onDamageDealt` with `type === 'MAGIC'`,
 * which is the seam the wound shelf's magic half opened
 * (`Item_GrievousMagic.ts`). So the cases that matter are the same three
 * questions each time — does it fire on magic, does it stay off everything
 * else, and does re-firing on *every* tick of a burn compound something that
 * was only ever meant to land once.
 */

type AnyBuff = InstanceType<typeof api.buffs.Buff>;
const live = (unit: { buffs: AnyBuff[] }): AnyBuff[] => unit.buffs.filter(buff => !buff.toRemove);
const slowsOn = (unit: { buffs: AnyBuff[] }): AnyBuff[] =>
  live(unit).filter(buff => buff instanceof Slow);

describe('Trượng Pha Lê Rylai', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
  });

  it('arms one permanent, hidden buff on the holder and nobody else', () => {
    const holder = createUnit(game, 0);
    const enemy = createUnit(game, 200, 'red');
    expect(pressSpell(new Item_Rylai(holder))).toBe(true);

    const armed = live(holder);
    expect(armed).toHaveLength(1);
    expect(armed[0].duration).toBe(0);
    expect(armed[0].hudVisible).toBe(false);
    expect(live(enemy)).toHaveLength(0);
  });

  it('slows whoever the holder hits with magic damage', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Rylai(holder));
    const unslowed = victim.stats.speed.value;

    victim.takeDamage(20, holder, 'MAGIC');

    const chill = slowsOn(victim);
    expect(chill).toHaveLength(1);
    expect((chill[0] as unknown as { percent: number }).percent).toBe(RYLAI_SLOW_PERCENT);
    expect(chill[0].duration).toBe(RYLAI_SLOW_MS);
    expect(victim.stats.speed.value).toBeCloseTo(unslowed * (1 - RYLAI_SLOW_PERCENT), 6);
  });

  it('leaves a physical hit to the attack-damage half of the shop', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Rylai(holder));

    victim.takeDamage(20, holder, 'PHYSICAL');

    expect(slowsOn(victim)).toHaveLength(0);
  });

  it('never chills an ally caught by the same magic damage', () => {
    const holder = createUnit(game, 0);
    const ally = createUnit(game, 120);
    pressSpell(new Item_Rylai(holder));

    ally.takeDamage(20, holder, 'MAGIC');

    expect(slowsOn(ally)).toHaveLength(0);
  });

  /**
   * The one that would have shipped broken. `Slow` defaults to
   * `STACKS_AND_CONTINUE` with `maxStacks = 10`, and this passive re-applies
   * on every magic hit — so a burn ticking four times a second would reach
   * ten stacks inside three seconds and hold the target still. One slow,
   * clock rewound, however many times the sceptre fires.
   */
  it('is one slow renewed, not ten stacked, however often the magic lands', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Rylai(holder));
    const unslowed = victim.stats.speed.value;

    for (let i = 0; i < 12; i++) victim.takeDamage(1, holder, 'MAGIC');

    expect(slowsOn(victim)).toHaveLength(1);
    expect(victim.stats.speed.value).toBeCloseTo(unslowed * (1 - RYLAI_SLOW_PERCENT), 6);
  });
});
