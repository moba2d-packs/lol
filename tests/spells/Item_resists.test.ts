import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, indexObjects } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';
import Item_UnendingDespair, {
  Item_UnendingDespair_Cloak,
  DESPAIR_BASE_PER_TICK,
  DESPAIR_HEAL_RATIO,
  DESPAIR_MAX_HEALTH_RATIO_PER_TICK,
  DESPAIR_RADIUS,
  DESPAIR_TICK_MS,
} from '../../spells/Item_UnendingDespair';
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
const { Champion } = api.units;

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

describe('Áo Choàng Diệt Vong', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', DESPAIR_TICK_MS);
  });

  const champion = (x: number, teamId: string) =>
    new Champion({ game, position: createVector(x, 0), teamId } as never);

  const worn = (holder: ReturnType<typeof champion>): Item_UnendingDespair_Cloak => {
    expect(pressSpell(new Item_UnendingDespair(holder))).toBe(true);
    return live(holder)[0] as Item_UnendingDespair_Cloak;
  };

  /** What one pulse swings at each champion, off the wearer's own bar. */
  const pulseFor = (holder: { stats: { maxHealth: { value: number } } }): number =>
    DESPAIR_BASE_PER_TICK + holder.stats.maxHealth.value * DESPAIR_MAX_HEALTH_RATIO_PER_TICK;

  it('pulses every enemy champion in reach and hands the wearer back double', () => {
    const holder = champion(0, 'blue');
    const near = champion(DESPAIR_RADIUS / 2, 'red');
    const far = champion(DESPAIR_RADIUS * 3, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, near, far]);
    const cloak = worn(holder);
    holder.stats.health.baseValue = 10;

    const onNear = vi.spyOn(near, 'takeDamage');
    const onFar = vi.spyOn(far, 'takeDamage');
    cloak.update();

    const pulse = pulseFor(holder);
    expect(onNear.mock.calls.map(call => call[0])).toEqual([pulse]);
    expect(onNear.mock.calls[0][2]).toBe('MAGIC');
    expect(onFar).not.toHaveBeenCalled();
    expect(holder.stats.health.baseValue).toBe(10 + Math.round(pulse * DESPAIR_HEAL_RATIO));
  });

  /**
   * The one that would have made a jungler unkillable: a camp is six bodies,
   * and a pulse that counted them would hand back twelve times the tick every
   * four seconds. `enemyChampionsAround` is the tank shelf's own sweep.
   */
  it('pays nothing for a minion or a camp standing in the same ring', () => {
    const holder = champion(0, 'blue');
    game.setPlayer(holder);
    const creep = createUnit(game, DESPAIR_RADIUS / 2, 'red');
    indexObjects(game, [holder, creep]);
    const cloak = worn(holder);
    holder.stats.health.baseValue = 10;

    const onCreep = vi.spyOn(creep, 'takeDamage');
    cloak.update();

    expect(onCreep).not.toHaveBeenCalled();
    expect(holder.stats.health.baseValue).toBe(10);
  });

  it('holds its clock: nothing happens between pulses', () => {
    const holder = champion(0, 'blue');
    const near = champion(DESPAIR_RADIUS / 2, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, near]);
    const cloak = worn(holder);

    const onNear = vi.spyOn(near, 'takeDamage');
    vi.stubGlobal('deltaTime', DESPAIR_TICK_MS / 4);
    for (let i = 0; i < 3; i++) cloak.update();
    expect(onNear).not.toHaveBeenCalled();

    cloak.update();
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
