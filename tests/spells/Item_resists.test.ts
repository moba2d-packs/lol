import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';
import Item_Terminus, {
  Item_Terminus_Juxtaposition,
  TERMINUS_MAX_STACKS,
  TERMINUS_PEN_PER_STACK,
  TERMINUS_RESIST_PER_STACK,
  TERMINUS_STACK_MS,
} from '../../spells/Item_Terminus';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();

/**
 * The rows added on 2026-09-06 whose purchase is **taking less damage** — a
 * counter that ramps while you swing, an aura that pays for standing in the
 * fight, and a mark that answers one champion in particular.
 *
 * Each of them re-issues or holds state that is easy to get wrong in a way
 * nothing complains about (a ramp that double-counts, an aura that heals off
 * a camp, a mark that never comes off a corpse), so those are the cases.
 */

type AnyBuff = InstanceType<typeof api.buffs.Buff>;
const live = (unit: { buffs: AnyBuff[] }): AnyBuff[] => unit.buffs.filter(buff => !buff.toRemove);

const swing = (attacker: unknown, victim: unknown, echo = false) =>
  api.combat.applyOnHitEffects({
    attacker,
    victim,
    damage: 10,
    ranged: false,
    crit: false,
    echo,
  } as never);

describe('Cung Chạng Vạng', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 100);
  });

  const armed = (holder: ReturnType<typeof createUnit>): Item_Terminus_Juxtaposition => {
    expect(pressSpell(new Item_Terminus(holder))).toBe(true);
    return live(holder)[0] as Item_Terminus_Juxtaposition;
  };

  it('banks one stack a swing, up to the cap', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const bow = armed(holder);

    for (let i = 0; i < TERMINUS_MAX_STACKS + 4; i++) swing(holder, victim);

    expect(bow.stacks).toBe(TERMINUS_MAX_STACKS);
  });

  it('banks nothing from an echoed application', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const bow = armed(holder);

    for (let i = 0; i < 5; i++) swing(holder, victim, true);

    expect(bow.stacks).toBe(0);
  });

  it('cuts deeper and stands harder off the same counter', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    holder.stats.armor.baseValue = 40;
    holder.stats.magicResist.baseValue = 20;
    const bow = armed(holder);

    swing(holder, victim);
    swing(holder, victim);

    expect(bow.stacks).toBe(2);
    expect(holder.stats.armorPenetration.value).toBeCloseTo(TERMINUS_PEN_PER_STACK * 2, 6);
    expect(holder.stats.armor.value).toBeCloseTo(40 * (1 + TERMINUS_RESIST_PER_STACK * 2), 6);
    expect(holder.stats.magicResist.value).toBeCloseTo(
      20 * (1 + TERMINUS_RESIST_PER_STACK * 2),
      6
    );
  });

  /**
   * One `StatAmp` re-issued at the new magnitude, not N stacked ones. If the
   * surge stacked, three swings would grant six stacks' worth and the ramp
   * would be twice the item on the card — and nothing about it would look
   * wrong from the outside.
   */
  it('re-issues one grant rather than stacking three', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    holder.stats.armor.baseValue = 40;
    armed(holder);

    for (let i = 0; i < TERMINUS_MAX_STACKS; i++) swing(holder, victim);

    // The armed passive plus exactly one surge.
    expect(live(holder)).toHaveLength(2);
    expect(holder.stats.armor.value).toBeCloseTo(
      40 * (1 + TERMINUS_RESIST_PER_STACK * TERMINUS_MAX_STACKS),
      6
    );
  });

  it('drops the whole count once the window closes, and hands the stats back', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    holder.stats.armor.baseValue = 40;
    const bow = armed(holder);
    swing(holder, victim);
    swing(holder, victim);

    vi.stubGlobal('deltaTime', TERMINUS_STACK_MS + 100);
    // The surge expires on its own clock; the counter is told by the armed
    // passive's own tick, which is the half that can go stale.
    for (const buff of [...holder.buffs]) buff.update();
    bow.update();

    expect(bow.stacks).toBe(0);
    expect(holder.stats.armorPenetration.value).toBe(0);
    expect(holder.stats.armor.value).toBe(40);
  });
});
