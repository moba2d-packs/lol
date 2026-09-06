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
import Item_Rylai, { RYLAI_SLOW_MS, RYLAI_SLOW_PERCENT } from '../../spells/Item_Rylai';
import Item_Shadowflame, {
  SHADOWFLAME_BONUS,
  SHADOWFLAME_THRESHOLD,
} from '../../spells/Item_Shadowflame';
import Item_Ludens, {
  LUDENS_COOLDOWN_MS,
  LUDENS_PRIMARY_DAMAGE,
  LUDENS_SPLASH_DAMAGE,
  LUDENS_SPLASH_RADIUS,
  LUDENS_SPLASH_TARGETS,
} from '../../spells/Item_Ludens';
import Item_Liandry, {
  Item_Liandry_Burn,
  LIANDRY_BURN_MS,
  LIANDRY_BURN_STACK_ID,
  LIANDRY_TICK_MS,
  liandryTickRatio,
} from '../../spells/Item_Liandry';

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

describe('Mặt Nạ Đọa Đày Liandry', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    // Stubbed, never unstubbed: `vi.unstubAllGlobals()` would take
    // `createVector` and the rest of `installSketchMathGlobals`'s p5 shims
    // with it, and the next `createUnit` throws inside core.
    vi.stubGlobal('deltaTime', LIANDRY_TICK_MS);
  });

  const burnOn = (unit: { buffs: AnyBuff[] }): Item_Liandry_Burn | undefined =>
    live(unit).find(buff => buff.stackId === LIANDRY_BURN_STACK_ID) as
      | Item_Liandry_Burn
      | undefined;

  /** Drive one burn for `ms` of game time, in `LIANDRY_TICK_MS / 5` steps. */
  const smoulder = (burn: Item_Liandry_Burn, ms: number): void => {
    const step = LIANDRY_TICK_MS / 5;
    vi.stubGlobal('deltaTime', step);
    for (let elapsed = 0; elapsed < ms && !burn.toRemove; elapsed += step) burn.update();
  };

  it('sets a burn on whoever the holder hits with magic damage', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    expect(pressSpell(new Item_Liandry(holder))).toBe(true);

    victim.takeDamage(20, holder, 'MAGIC');

    const burn = burnOn(victim);
    expect(burn).toBeTruthy();
    expect(burn?.duration).toBe(LIANDRY_BURN_MS);
  });

  it('leaves a physical hit, and an ally, alone', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const ally = createUnit(game, 200);
    pressSpell(new Item_Liandry(holder));

    victim.takeDamage(20, holder, 'PHYSICAL');
    ally.takeDamage(20, holder, 'MAGIC');

    expect(burnOn(victim)).toBeUndefined();
    expect(burnOn(ally)).toBeUndefined();
  });

  it("bites a share of the VICTIM's own maximum health, not the wearer's", () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    // A fat target, so the anti-tank claim is measured rather than asserted:
    // the wearer's own bar is the fixture's default 100 and must not appear
    // anywhere in the answer.
    victim.stats.maxHealth.baseValue = 400;
    pressSpell(new Item_Liandry(holder));
    victim.takeDamage(20, holder, 'MAGIC');
    const burn = burnOn(victim);
    expect(burn).toBeTruthy();

    const hurt = vi.spyOn(victim, 'takeDamage');
    smoulder(burn as Item_Liandry_Burn, LIANDRY_TICK_MS);

    expect(hurt).toHaveBeenCalledTimes(1);
    expect(hurt.mock.calls[0][0]).toBeCloseTo(400 * liandryTickRatio(), 6);
    expect(hurt.mock.calls[0][1]).toBe(holder);
    expect(hurt.mock.calls[0][2]).toBe('MAGIC');
  });

  /**
   * The one that would have shipped as a permanent burn. Each tick is magic
   * damage credited to the wearer, so it comes straight back to the armed
   * passive's `onDamageDealt` — and a `RENEW_EXISTING` refresh off it would
   * rewind the three seconds every half-second, for ever.
   */
  it('does not refresh itself off its own tick, so it actually goes out', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    victim.stats.maxHealth.baseValue = 4_000;
    pressSpell(new Item_Liandry(holder));
    victim.takeDamage(20, holder, 'MAGIC');
    const burn = burnOn(victim) as Item_Liandry_Burn;

    smoulder(burn, LIANDRY_BURN_MS * 2);

    expect(burn.toRemove, 'the burn renewed itself off its own damage').toBe(true);
    expect(burnOn(victim)).toBeUndefined();
  });

  it('is refreshed by the holder landing more magic on the same target', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    pressSpell(new Item_Liandry(holder));
    victim.takeDamage(20, holder, 'MAGIC');
    const burn = burnOn(victim) as Item_Liandry_Burn;

    smoulder(burn, LIANDRY_BURN_MS - LIANDRY_TICK_MS);
    expect(burn.toRemove).toBe(false);
    victim.takeDamage(20, holder, 'MAGIC');

    expect(burn.timeElapsed).toBe(0);
    expect(burnOn(victim)).toBe(burn);
  });
});

describe('Vọng Âm Luden', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 100);
  });

  it('echoes off the first magic hit, onto the victim and the clump around them', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 300, 'red');
    const beside = createUnit(game, 300 + LUDENS_SPLASH_RADIUS / 2, 'red');
    const far = createUnit(game, 300 + LUDENS_SPLASH_RADIUS * 3, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, victim, beside, far]);
    expect(pressSpell(new Item_Ludens(holder))).toBe(true);

    const onVictim = vi.spyOn(victim, 'takeDamage');
    const onBeside = vi.spyOn(beside, 'takeDamage');
    const onFar = vi.spyOn(far, 'takeDamage');
    victim.takeDamage(5, holder, 'MAGIC');

    // The 5 is the hit that armed it; the echo is the second call.
    expect(onVictim.mock.calls.map(call => call[0])).toEqual([5, LUDENS_PRIMARY_DAMAGE]);
    expect(onBeside.mock.calls.map(call => call[0])).toEqual([LUDENS_SPLASH_DAMAGE]);
    expect(onFar, 'the echo reached past its own radius').not.toHaveBeenCalled();
  });

  it('reaches no more than the three others it advertises', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 300, 'red');
    // One more than the cap, all well inside the radius.
    const clump = [1, 2, 3, 4].map(i => createUnit(game, 300 + i * 20, 'red'));
    game.setPlayer(holder);
    indexObjects(game, [holder, victim, ...clump]);
    pressSpell(new Item_Ludens(holder));

    const spies = clump.map(unit => vi.spyOn(unit, 'takeDamage'));
    victim.takeDamage(5, holder, 'MAGIC');

    expect(spies.filter(spy => spy.mock.calls.length > 0)).toHaveLength(LUDENS_SPLASH_TARGETS);
  });

  /**
   * The echo is magic damage credited to the wearer, so it arrives back at
   * the same hook that fired it. `startRearm` is called before the first
   * `takeDamage` precisely so the re-entrant call finds the clock already
   * running — without that ordering this item is an infinite loop the first
   * time it fires.
   */
  it('does not echo its own echo', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 300, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, victim]);
    pressSpell(new Item_Ludens(holder));

    const onVictim = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(5, holder, 'MAGIC');

    // The hit and one echo, and nothing after it: an echo of the echo would
    // recurse until the stack gave out.
    expect(onVictim.mock.calls.map(call => call[0])).toEqual([5, LUDENS_PRIMARY_DAMAGE]);
  });

  it('holds its clock: no second echo until the window is up', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 300, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, victim]);
    pressSpell(new Item_Ludens(holder));
    const armed = live(holder)[0];

    victim.takeDamage(5, holder, 'MAGIC');
    const quiet = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(5, holder, 'MAGIC');
    expect(quiet).toHaveBeenCalledTimes(1);

    vi.stubGlobal('deltaTime', LUDENS_COOLDOWN_MS);
    armed.update();
    victim.takeDamage(5, holder, 'MAGIC');

    expect(quiet.mock.calls.map(call => call[0])).toEqual([5, 5, LUDENS_PRIMARY_DAMAGE]);
  });

  it('never echoes off a physical hit', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 300, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, victim]);
    pressSpell(new Item_Ludens(holder));

    const onVictim = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(5, holder, 'PHYSICAL');

    expect(onVictim).toHaveBeenCalledTimes(1);
  });
});

describe('Ngọn Lửa Hắc Hóa', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
  });

  /** Put `unit` on `share` of its own maximum health. */
  const wound = (unit: ReturnType<typeof createUnit>, share: number): void => {
    unit.stats.health.baseValue = unit.stats.maxHealth.value * share;
  };

  it('adds nothing while the target is above the line', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 200, 'red');
    expect(pressSpell(new Item_Shadowflame(holder))).toBe(true);
    wound(victim, 0.9);

    const hurt = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(10, holder, 'MAGIC');

    expect(hurt.mock.calls.map(call => call[0])).toEqual([10]);
  });

  it('follows a magic hit that leaves the target under the line', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 200, 'red');
    pressSpell(new Item_Shadowflame(holder));
    wound(victim, SHADOWFLAME_THRESHOLD / 2);

    const hurt = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(10, holder, 'MAGIC');

    expect(hurt.mock.calls.map(call => call[0])).toEqual([10, 10 * SHADOWFLAME_BONUS]);
    expect(hurt.mock.calls[1][2]).toBe('MAGIC');
    expect(hurt.mock.calls[1][1]).toBe(holder);
  });

  /**
   * The share comes off what **landed**, not off what was swung: an
   * amplification that ignored a shield or a resistance would be a bigger
   * item than the one on the card.
   */
  it('takes its share of what landed, not of what was swung', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 200, 'red');
    pressSpell(new Item_Shadowflame(holder));
    // A big pool so the probe survives the hit, and a real wall so what
    // lands is visibly less than what was swung. The curve itself is core's;
    // all this asserts is that the follow-up follows the smaller number.
    victim.stats.maxHealth.baseValue = 1_000;
    victim.stats.magicResist.baseValue = 100;
    victim.stats.health.baseValue = 1_000 * (SHADOWFLAME_THRESHOLD / 2);

    const hurt = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(40, holder, 'MAGIC');
    const [swung, followUp] = hurt.mock.calls.map(call => call[0]);

    expect(swung).toBe(40);
    expect(followUp).toBeGreaterThan(0);
    expect(followUp, 'the follow-up ignored the wall the hit went through').toBeLessThan(
      40 * SHADOWFLAME_BONUS
    );
  });

  it('leaves a physical hit, and an ally, alone', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 200, 'red');
    const ally = createUnit(game, 260);
    pressSpell(new Item_Shadowflame(holder));
    wound(victim, 0.1);
    wound(ally, 0.1);

    const onVictim = vi.spyOn(victim, 'takeDamage');
    const onAlly = vi.spyOn(ally, 'takeDamage');
    victim.takeDamage(10, holder, 'PHYSICAL');
    ally.takeDamage(10, holder, 'MAGIC');

    expect(onVictim).toHaveBeenCalledTimes(1);
    expect(onAlly).toHaveBeenCalledTimes(1);
  });

  /**
   * The follow-up is itself magic damage from the wearer, so it re-enters the
   * hook that fired it — and this item has no cooldown to close the loop, so
   * the latch is the only thing that does.
   */
  it('does not follow up its own follow-up', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 200, 'red');
    pressSpell(new Item_Shadowflame(holder));
    wound(victim, 0.3);

    const hurt = vi.spyOn(victim, 'takeDamage');
    victim.takeDamage(4, holder, 'MAGIC');

    expect(hurt).toHaveBeenCalledTimes(2);
  });
});
