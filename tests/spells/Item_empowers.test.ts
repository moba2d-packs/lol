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
import Item_ImperialMandate, {
  Item_ImperialMandate_Mark,
  Item_ImperialMandate_Order,
  MANDATE_ALLY_SPEED,
  MANDATE_ALLY_SPEED_MS,
  MANDATE_DAMAGE,
  MANDATE_MARK_MS,
  MANDATE_MARK_STACK_ID,
  MANDATE_PER_TARGET_MS,
} from '../../spells/Item_ImperialMandate';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();
const { Champion } = api.units;
const { Speedup } = api.buffs;

/**
 * The two rows added on 2026-09-06 whose payout lands on somebody *acting* —
 * an ally who commits to the marked target, and a wearer who has just spent
 * their ultimate.
 *
 * Both are re-entrant by construction (a detonation is damage on the body
 * that was watching for damage; a cooldown refund runs inside a cast), so
 * those are the cases that matter here alongside the arithmetic.
 */

type AnyBuff = InstanceType<typeof api.buffs.Buff>;
const live = (unit: { buffs: AnyBuff[] }): AnyBuff[] => unit.buffs.filter(buff => !buff.toRemove);

describe('Trát Lệnh Đế Vương', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 100);
  });

  const champion = (x: number, teamId: string) =>
    new Champion({ game, position: createVector(x, 0), teamId } as never);

  const worn = (holder: ReturnType<typeof champion>): Item_ImperialMandate_Order => {
    expect(pressSpell(new Item_ImperialMandate(holder))).toBe(true);
    return live(holder)[0] as Item_ImperialMandate_Order;
  };

  const markOn = (unit: { buffs: AnyBuff[] }): Item_ImperialMandate_Mark | undefined =>
    live(unit).find(buff => buff.stackId === MANDATE_MARK_STACK_ID) as
      | Item_ImperialMandate_Mark
      | undefined;

  it('marks an enemy champion off magic damage, and nothing else', () => {
    const holder = champion(0, 'blue');
    const enemy = champion(120, 'red');
    const creep = createUnit(game, 160, 'red');
    worn(holder);

    enemy.takeDamage(5, holder, 'MAGIC');
    creep.takeDamage(5, holder, 'MAGIC');

    const mark = markOn(enemy);
    expect(mark).toBeTruthy();
    expect(mark?.duration).toBe(MANDATE_MARK_MS);
    expect(markOn(creep), 'a lane creep is not who this row is for').toBeUndefined();
  });

  it('leaves a physical hit alone', () => {
    const holder = champion(0, 'blue');
    const enemy = champion(120, 'red');
    worn(holder);

    enemy.takeDamage(5, holder, 'PHYSICAL');

    expect(markOn(enemy)).toBeUndefined();
  });

  it('does not spend the mark on the enchanter who set it', () => {
    const holder = champion(0, 'blue');
    const enemy = champion(120, 'red');
    worn(holder);
    enemy.takeDamage(5, holder, 'MAGIC');

    const hurt = vi.spyOn(enemy, 'takeDamage');
    enemy.takeDamage(5, holder, 'MAGIC');

    expect(hurt.mock.calls.map(call => call[0])).toEqual([5]);
    expect(markOn(enemy)).toBeTruthy();
  });

  it('detonates for an ally, credits the enchanter, and shoves the ally forward', () => {
    const holder = champion(0, 'blue');
    const ally = champion(60, 'blue');
    const enemy = champion(120, 'red');
    worn(holder);
    enemy.takeDamage(5, holder, 'MAGIC');

    const hurt = vi.spyOn(enemy, 'takeDamage');
    enemy.takeDamage(7, ally, 'PHYSICAL');

    expect(hurt.mock.calls.map(call => call[0])).toEqual([7, MANDATE_DAMAGE]);
    // Credited to the enchanter, so the kill ledger and the death recap name
    // them rather than "Không rõ".
    expect(hurt.mock.calls[1][1]).toBe(holder);
    expect(hurt.mock.calls[1][2]).toBe('MAGIC');

    const rush = live(ally).find(buff => buff instanceof Speedup) as InstanceType<typeof Speedup>;
    expect(rush).toBeTruthy();
    expect(rush.percent).toBe(MANDATE_ALLY_SPEED);
    expect(rush.duration).toBe(MANDATE_ALLY_SPEED_MS);
    expect(markOn(enemy), 'the mark survived being spent').toBeUndefined();
  });

  /**
   * The detonation is itself damage on the marked body, which is the body
   * watching for damage. `consumed` is set before the `takeDamage` call, not
   * after — the whole difference between one detonation and a stack overflow.
   */
  it('does not detonate off its own detonation', () => {
    const holder = champion(0, 'blue');
    const ally = champion(60, 'blue');
    const enemy = champion(120, 'red');
    worn(holder);
    enemy.takeDamage(5, holder, 'MAGIC');

    const hurt = vi.spyOn(enemy, 'takeDamage');
    enemy.takeDamage(7, ally, 'PHYSICAL');

    expect(hurt).toHaveBeenCalledTimes(2);
  });

  it('is not spent by a minion chipping at the marked target', () => {
    const holder = champion(0, 'blue');
    const enemy = champion(120, 'red');
    const friendlyCreep = createUnit(game, 60);
    worn(holder);
    enemy.takeDamage(5, holder, 'MAGIC');

    const hurt = vi.spyOn(enemy, 'takeDamage');
    enemy.takeDamage(3, friendlyCreep, 'PHYSICAL');

    expect(hurt.mock.calls.map(call => call[0])).toEqual([3]);
    expect(markOn(enemy)).toBeTruthy();
  });

  it('holds a per-target clock, so one enemy cannot be re-marked at once', () => {
    const holder = champion(0, 'blue');
    const ally = champion(60, 'blue');
    const enemy = champion(120, 'red');
    const order = worn(holder);
    enemy.takeDamage(5, holder, 'MAGIC');
    enemy.takeDamage(7, ally, 'PHYSICAL');
    expect(markOn(enemy)).toBeUndefined();

    enemy.takeDamage(5, holder, 'MAGIC');
    expect(markOn(enemy), 'the clock let it be re-marked immediately').toBeUndefined();

    vi.stubGlobal('deltaTime', MANDATE_PER_TARGET_MS + 100);
    order.update();
    enemy.takeDamage(5, holder, 'MAGIC');

    expect(markOn(enemy)).toBeTruthy();
  });
});
