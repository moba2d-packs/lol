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
import Item_ProfaneHydra, {
  PROFANE_COOLDOWN_MS,
  PROFANE_DAMAGE,
  PROFANE_EXECUTE_BONUS,
  PROFANE_EXECUTE_THRESHOLD,
  PROFANE_RADIUS,
} from '../../spells/Item_ProfaneHydra';
import Item_Voltaic, {
  Item_Voltaic_Charge,
  VOLTAIC_BONUS_DAMAGE,
  VOLTAIC_CHARGE_DISTANCE,
  VOLTAIC_MOVEMENT_EPSILON,
  VOLTAIC_SLOW_MS,
  VOLTAIC_SLOW_PERCENT,
} from '../../spells/Item_Voltaic';
import Item_Serylda, {
  SERYLDA_SLOW_MS,
  SERYLDA_SLOW_PERCENT,
  SERYLDA_THRESHOLD,
} from '../../spells/Item_Serylda';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();
const { Slow } = api.buffs;
const { Champion } = api.units;

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

describe('Kiếm Điện Phong', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 100);
  });

  const armed = (holder: ReturnType<typeof createUnit>): Item_Voltaic_Charge => {
    expect(pressSpell(new Item_Voltaic(holder))).toBe(true);
    return live(holder)[0] as Item_Voltaic_Charge;
  };

  /** Walk `steps` frames of `perFrame` units, ticking the buff each frame. */
  const walk = (
    holder: ReturnType<typeof createUnit>,
    charge: Item_Voltaic_Charge,
    steps: number,
    perFrame: number
  ): void => {
    for (let i = 0; i < steps; i++) {
      holder.position.set(holder.position.x + perFrame, holder.position.y);
      charge.update();
    }
  };

  const swing = (attacker: unknown, victim: unknown, echo = false) =>
    api.combat.applyOnHitEffects({
      attacker,
      victim,
      damage: 10,
      ranged: false,
      crit: false,
      echo,
    } as never);

  it('banks the distance walked, and stops at the threshold', () => {
    const holder = createUnit(game, 0);
    const charge = armed(holder);

    walk(holder, charge, 100, 10);

    expect(charge.travelled).toBe(VOLTAIC_CHARGE_DISTANCE);
    expect(charge.charged()).toBe(true);
  });

  it('counts a frame of standing still as nothing', () => {
    const holder = createUnit(game, 0);
    const charge = armed(holder);

    walk(holder, charge, 40, VOLTAIC_MOVEMENT_EPSILON / 2);

    expect(charge.travelled).toBe(0);
  });

  it('adds nothing to a swing thrown before the blade is full', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const charge = armed(holder);
    walk(holder, charge, 2, 10);

    const hurt = vi.spyOn(victim, 'takeDamage');
    swing(holder, victim);

    expect(hurt).not.toHaveBeenCalled();
    expect(slowsOn(victim)).toHaveLength(0);
  });

  it('spends the whole blade on one swing: a flat bite and a hard stagger', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const charge = armed(holder);
    walk(holder, charge, 100, 10);

    const hurt = vi.spyOn(victim, 'takeDamage');
    swing(holder, victim);

    expect(hurt.mock.calls.map(call => call[0])).toEqual([VOLTAIC_BONUS_DAMAGE]);
    expect(hurt.mock.calls[0][2]).toBe('PHYSICAL');
    const arc = slowsOn(victim);
    expect(arc).toHaveLength(1);
    expect((arc[0] as unknown as { percent: number }).percent).toBe(VOLTAIC_SLOW_PERCENT);
    expect(arc[0].duration).toBe(VOLTAIC_SLOW_MS);
    expect(charge.travelled).toBe(0);
  });

  it('never discharges off an echoed application', () => {
    const holder = createUnit(game, 0);
    const victim = createUnit(game, 120, 'red');
    const charge = armed(holder);
    walk(holder, charge, 100, 10);

    const hurt = vi.spyOn(victim, 'takeDamage');
    swing(holder, victim, true);

    expect(hurt).not.toHaveBeenCalled();
    expect(charge.travelled).toBe(VOLTAIC_CHARGE_DISTANCE);
  });
});

describe('Mãng Xà Kích', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createGame();
  });

  const champion = (x: number, teamId: string) =>
    new Champion({ game, position: createVector(x, 0), teamId } as never);

  it('bites every enemy champion inside its reach, and nobody outside it', () => {
    const holder = champion(0, 'blue');
    const near = champion(PROFANE_RADIUS / 2, 'red');
    const far = champion(PROFANE_RADIUS * 3, 'red');
    const ally = champion(PROFANE_RADIUS / 3, 'blue');
    game.setPlayer(holder);
    indexObjects(game, [holder, near, far, ally]);

    const onNear = vi.spyOn(near, 'takeDamage');
    const onFar = vi.spyOn(far, 'takeDamage');
    const onAlly = vi.spyOn(ally, 'takeDamage');
    expect(pressSpell(new Item_ProfaneHydra(holder))).toBe(true);

    expect(onNear.mock.calls.map(call => call[0])).toEqual([PROFANE_DAMAGE]);
    expect(onNear.mock.calls[0][2]).toBe('PHYSICAL');
    expect(onFar).not.toHaveBeenCalled();
    expect(onAlly).not.toHaveBeenCalled();
  });

  it('hits harder against a target already under the line', () => {
    const holder = champion(0, 'blue');
    const healthy = champion(40, 'red');
    const dying = champion(80, 'red');
    game.setPlayer(holder);
    indexObjects(game, [holder, healthy, dying]);
    dying.stats.health.baseValue = dying.stats.maxHealth.value * (PROFANE_EXECUTE_THRESHOLD / 2);

    const onHealthy = vi.spyOn(healthy, 'takeDamage');
    const onDying = vi.spyOn(dying, 'takeDamage');
    pressSpell(new Item_ProfaneHydra(holder));

    expect(onHealthy.mock.calls[0][0]).toBe(PROFANE_DAMAGE);
    expect(onDying.mock.calls[0][0]).toBeCloseTo(PROFANE_DAMAGE * (1 + PROFANE_EXECUTE_BONUS), 6);
  });

  it('comes back inside the practice room twenty-second ceiling', () => {
    const holder = champion(0, 'blue');
    game.setPlayer(holder);
    const hydra = new Item_ProfaneHydra(holder);

    expect(hydra.coolDown).toBe(PROFANE_COOLDOWN_MS);
    expect(hydra.coolDown).toBeLessThanOrEqual(20_000);
  });
});
