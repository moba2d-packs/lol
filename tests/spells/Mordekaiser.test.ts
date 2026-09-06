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

import Mordekaiser_Q, {
  darknessStacks,
  DARKNESS_TICK_DAMAGE,
  DARKNESS_TICK_MS,
  DARKNESS_TO_RISE,
  feedDarkness,
  Mordekaiser_DarknessRise,
  Q_DAMAGE,
  Q_HALF_WIDTH,
  Q_ISOLATED_DAMAGE,
} from '../../spells/Mordekaiser_Q';
import Mordekaiser_W, {
  Mordekaiser_W_Reservoir,
  Mordekaiser_W_Shield,
  reservoirOn,
  W_CAP_SHARE,
  W_DEALT_SHARE,
  W_HEAL_SHARE,
  W_RECAST_GAP_MS,
  W_TAKEN_SHARE,
} from '../../spells/Mordekaiser_W';
import Mordekaiser_E, {
  E_DAMAGE,
  E_DELAY_MS,
  E_PENETRATION,
  E_RADIUS,
  Mordekaiser_E_Claw,
} from '../../spells/Mordekaiser_E';
import Mordekaiser_R, {
  Mordekaiser_R_Drained,
  Mordekaiser_R_Stolen,
  R_DRAG_TO,
  R_HEAL_SHARE,
  R_STEAL_SHARE,
} from '../../spells/Mordekaiser_R';

const __api = buildTestApi();
const { Dash } = __api.buffs;
type AttackableUnit = InstanceType<typeof __api.units.AttackableUnit>;

function unit(game: TestGame, x: number, teamId: string, y = 0): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.position.set(x, y);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.stats.healthRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

/** A body that counts for Darkness Rise. */
function champion(game: TestGame, x: number, teamId: string, y = 0): AttackableUnit {
  const result = unit(game, x, teamId, y);
  result.killCredit = 'champion';
  return result;
}

const live = (owner: AttackableUnit) => owner.buffs.filter(buff => !buff.toRemove);

const buffOf = <T>(owner: AttackableUnit, Kind: new (...args: never[]) => T): T | undefined =>
  live(owner).find(buff => buff instanceof (Kind as never)) as T | undefined;

function pending<T>(game: TestGame, Kind: new (...args: never[]) => T): T {
  const queue = game.objectManager._objectToBeAdd as unknown[];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] instanceof (Kind as never)) return queue[i] as T;
  }
  throw new Error('nothing of that kind was spawned');
}

describe('Mordekaiser', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 100);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Obliterate', () => {
    it('hits harder when it caught exactly one body', () => {
      const alone = champion(game, 150, 'red');
      game.objectManager.addObject(alone);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(alone.stats.health.value).toBe(100 - Q_ISOLATED_DAMAGE);
    });

    it('drops to the ordinary number the moment a second body is on the line', () => {
      const first = champion(game, 150, 'red');
      const second = champion(game, 220, 'red');
      game.objectManager.addObject(first);
      game.objectManager.addObject(second);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(first.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(second.stats.health.value).toBe(100 - Q_DAMAGE);
    });

    it('leaves a body clear of the slab alone', () => {
      const aside = champion(game, 150, 'red', Q_HALF_WIDTH + 60);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(aside.stats.health.value).toBe(100);
    });
  });

  describe('Darkness Rise', () => {
    it('lights on the third champion touched, and burns what stands nearby', () => {
      const victim = champion(game, 80, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      for (let hit = 1; hit < DARKNESS_TO_RISE; hit++) {
        feedDarkness(owner, victim);
        expect(darknessStacks(owner)).toBe(hit);
        expect(buffOf(owner, Mordekaiser_DarknessRise)).toBeUndefined();
      }

      feedDarkness(owner, victim);
      const aura = buffOf(owner, Mordekaiser_DarknessRise);
      expect(aura, 'the third hit did not light it').toBeTruthy();

      const before = victim.stats.health.value;
      vi.stubGlobal('deltaTime', DARKNESS_TICK_MS);
      aura!.update();
      expect(before - victim.stats.health.value).toBe(DARKNESS_TICK_DAMAGE);
    });

    it('counts champions and not creeps', () => {
      const creep = unit(game, 80, 'red');
      game.objectManager.addObject(creep);
      game.objectManager.update();

      for (let hit = 0; hit < DARKNESS_TO_RISE + 2; hit++) feedDarkness(owner, creep);
      expect(darknessStacks(owner)).toBe(0);
      expect(buffOf(owner, Mordekaiser_DarknessRise)).toBeUndefined();
    });
  });

  describe('Indestructible', () => {
    it('banks a share of both what he deals and what he takes, up to the cap', () => {
      const other = champion(game, 200, 'red');
      game.objectManager.addObject(other);
      game.objectManager.update();

      const w = new Mordekaiser_W(owner);
      w.onUpdate();
      const bank = buffOf(owner, Mordekaiser_W_Reservoir)!;

      other.takeDamage(20, owner, 'MAGIC');
      expect(bank.banked).toBeCloseTo(20 * W_DEALT_SHARE, 4);

      owner.takeDamage(20, other, 'MAGIC');
      expect(bank.banked).toBeCloseTo(20 * W_DEALT_SHARE + 20 * W_TAKEN_SHARE, 4);

      // …and it stops at a share of his own pool, however long the fight runs.
      for (let hit = 0; hit < 40; hit++) other.takeDamage(20, owner, 'MAGIC');
      expect(bank.banked).toBeCloseTo(owner.stats.maxHealth.value * W_CAP_SHARE, 4);
    });

    it('turns the bank into a shield and the shield into health', () => {
      const other = champion(game, 200, 'red');
      other.stats.health.baseValue = 500;
      other.stats.maxHealth.baseValue = 500;
      game.objectManager.addObject(other);
      game.objectManager.update();

      const w = new Mordekaiser_W(owner);
      w.onUpdate();
      for (let hit = 0; hit < 5; hit++) other.takeDamage(20, owner, 'MAGIC');
      const banked = reservoirOn(owner)!.banked;
      expect(banked).toBeGreaterThan(0);

      expect(pressSpell(w)).toBe(true);
      const shield = buffOf(owner, Mordekaiser_W_Shield)!;
      expect(shield.amount).toBe(Math.round(banked));
      expect(reservoirOn(owner)!.banked, 'the bank was not spent').toBe(0);

      owner.stats.health.baseValue = 40;
      vi.stubGlobal('deltaTime', W_RECAST_GAP_MS);
      w.update();
      expect(pressSpell(w), 'the cash-in was refused').toBe(true);

      // Through `takeHeal`, so every wound in the shop reaches it.
      expect(owner.stats.health.value).toBe(40 + Math.round(shield.amount * W_HEAL_SHARE));
      expect(buffOf(owner, Mordekaiser_W_Shield)).toBeUndefined();
    });

    it('puts up nothing when the bank is empty', () => {
      const w = new Mordekaiser_W(owner);
      w.onUpdate();
      expect(pressSpell(w)).toBe(true);
      expect(buffOf(owner, Mordekaiser_W_Shield)).toBeUndefined();
    });
  });

  describe("Death's Grasp", () => {
    it('grants magic penetration without being cast, and only once', () => {
      const e = new Mordekaiser_E(owner);
      e.onUpdate();
      e.onUpdate();
      expect(owner.stats.magicPenetration.value).toBeCloseTo(E_PENETRATION, 6);
    });

    it('waits, then closes on what is standing in it and hauls it inward', () => {
      const victim = champion(game, 200 + E_RADIUS - 40, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_E(owner), { at: { x: 200, y: 0 } })).toBe(true);
      const claw = pending(game, Mordekaiser_E_Claw);

      // Nothing while it is winding: the delay is the counter-play.
      claw.update();
      expect(victim.stats.health.value).toBe(100);

      vi.stubGlobal('deltaTime', E_DELAY_MS);
      claw.update();

      expect(victim.stats.health.value).toBe(100 - E_DAMAGE);
      const drag = buffOf(victim, Dash);
      expect(drag, 'nothing hauled the body inward').toBeTruthy();
      // Towards the claw, not past it.
      expect(drag!.dashDestination!.x).toBeLessThan(victim.position.x);
      expect(drag!.dashDestination!.x).toBeGreaterThanOrEqual(claw.atX);
    });

    it('leaves a body outside the circle alone', () => {
      const outside = champion(game, 200 + E_RADIUS + 60, 'red');
      game.objectManager.addObject(outside);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_E(owner), { at: { x: 200, y: 0 } })).toBe(true);
      const claw = pending(game, Mordekaiser_E_Claw);
      vi.stubGlobal('deltaTime', E_DELAY_MS);
      claw.update();

      expect(outside.stats.health.value).toBe(100);
      expect(buffOf(outside, Dash)).toBeUndefined();
    });
  });

  describe('Realm of Death', () => {
    it('drains the soul off the target and puts the same points on him', () => {
      const victim = champion(game, 200, 'red');
      victim.stats.armor.baseValue = 40;
      victim.stats.magicResist.baseValue = 20;
      victim.stats.attackDamage.baseValue = 30;
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_R(owner), { target: victim })).toBe(true);

      expect(buffOf(victim, Mordekaiser_R_Drained), 'the victim lost nothing').toBeTruthy();
      expect(buffOf(owner, Mordekaiser_R_Stolen), 'he gained nothing').toBeTruthy();
      expect(victim.stats.armor.value).toBeCloseTo(40 * (1 - R_STEAL_SHARE), 4);
      expect(owner.stats.armor.value).toBeCloseTo(40 * R_STEAL_SHARE, 4);
      expect(owner.stats.attackDamage.value).toBeCloseTo(30 * R_STEAL_SHARE, 4);
    });

    it('heals him for a share of the body he took it from', () => {
      const victim = champion(game, 200, 'red');
      victim.stats.maxHealth.baseValue = 300;
      victim.stats.health.baseValue = 300;
      owner.stats.health.baseValue = 40;
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_R(owner), { target: victim })).toBe(true);
      expect(owner.stats.health.value).toBe(40 + Math.round(300 * R_HEAL_SHARE));
    });

    it('hauls the target into the duel', () => {
      const victim = champion(game, 300, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Mordekaiser_R(owner), { target: victim })).toBe(true);
      const drag = buffOf(victim, Dash);
      expect(drag, 'the target was left where it stood').toBeTruthy();
      expect(drag!.dashDestination!.x).toBeCloseTo(R_DRAG_TO, 4);
    });
  });
});
