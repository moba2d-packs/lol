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

import Lucian_Q, {
  lightslingerOn,
  LIGHTSLINGER_DAMAGE,
  Q_DAMAGE,
  Q_HALF_WIDTH,
  Q_LENGTH,
} from '../../spells/Lucian_Q';
import Lucian_W, {
  Lucian_W_Blaze,
  Lucian_W_Cross,
  markOn,
  W_CROSS_ARM,
  W_DAMAGE,
  W_SPEED_PERCENT,
} from '../../spells/Lucian_W';
import Lucian_E, {
  E_DASH,
  E_REFUND_CHAMPION_MS,
  E_REFUND_MS,
} from '../../spells/Lucian_E';
import Lucian_R, {
  R_SHOT_DAMAGE,
  R_SHOT_INTERVAL_MS,
  R_SHOTS,
  R_TOTAL_DAMAGE,
} from '../../spells/Lucian_R';

const __api = buildTestApi();
const { Dash, Speedup } = __api.buffs;
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

/** A swing landing on `victim`, as core would report it. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit, echo = false) =>
  ({ attacker, victim, damage: 10, ranged: true, crit: false, echo }) as never;

describe('Lucian', () => {
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

  describe('Piercing Light and Lightslinger', () => {
    it('pierces everything on the line and leaves the second shot loaded', () => {
      const near = unit(game, 120, 'red');
      const far = unit(game, 300, 'red');
      const aside = unit(game, 200, 'red', Q_HALF_WIDTH + 50);
      game.objectManager.addObject(near);
      game.objectManager.addObject(far);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      expect(pressSpell(new Lucian_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);

      expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(far.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(aside.stats.health.value).toBe(100);
      expect(lightslingerOn(owner), 'the ability did not load the second shot').toBeTruthy();
    });

    it('cuts nothing past the end of the beam', () => {
      const beyond = unit(game, Q_LENGTH + 80, 'red');
      game.objectManager.addObject(beyond);
      game.objectManager.update();

      expect(pressSpell(new Lucian_Q(owner), { at: { x: 900, y: 0 } })).toBe(true);
      expect(beyond.stats.health.value).toBe(100);
    });

    it('fires the second shot on the next real swing, once', () => {
      const victim = unit(game, 120, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Lucian_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const after = victim.stats.health.value;
      const loaded = lightslingerOn(owner)!;

      // A phantom swing is the ability's own echo arriving twice.
      loaded.onHit(swing(owner, victim, true));
      expect(victim.stats.health.value).toBe(after);

      loaded.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(after - LIGHTSLINGER_DAMAGE);
      expect(lightslingerOn(owner), 'the shot was not spent').toBeUndefined();
    });

    /**
     * The refund is the E's passive, and the Q file only reports the hit — so
     * this is the seam between the two files, checked from the outside.
     */
    it('buys a slice of Relentless Pursuit back per landed shot, doubled on a champion', () => {
      const creep = unit(game, 120, 'red');
      const champion = unit(game, 160, 'red');
      champion.killCredit = 'champion';
      game.objectManager.addObject(creep);
      game.objectManager.addObject(champion);
      game.objectManager.update();

      const q = new Lucian_Q(owner);
      const e = new Lucian_E(owner);
      (owner as unknown as { spells: unknown[] }).spells = [q, e];
      e.currentCooldown = e.coolDown;

      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      lightslingerOn(owner)!.onHit(swing(owner, creep));
      expect(e.currentCooldown).toBe(e.coolDown - E_REFUND_MS);

      expect(pressSpell(new Lucian_W(owner), { at: { x: 400, y: 0 } })).toBe(true);
      lightslingerOn(owner)!.onHit(swing(owner, champion));
      expect(e.currentCooldown).toBe(e.coolDown - E_REFUND_MS - E_REFUND_CHAMPION_MS);
    });
  });

  describe('Ardent Blaze', () => {
    /**
     * Fly the missile until it detonates and hand back the cross, *before* it
     * has resolved — so a caller can place bodies relative to where the
     * detonation actually landed rather than guessing at the flight.
     */
    function throwBlaze(): Lucian_W_Cross {
      expect(pressSpell(new Lucian_W(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const blaze = pending(game, Lucian_W_Blaze);
      for (let tick = 0; tick < 200 && !blaze.toRemove; tick++) blaze.update();
      return pending(game, Lucian_W_Cross);
    }

    /** …and the ordinary case, with nothing to place. */
    function detonate(): Lucian_W_Cross {
      const cross = throwBlaze();
      cross.onAdded();
      return cross;
    }

    it('marks what the cross catches, on both arms', () => {
      const alongTheShot = unit(game, 0, 'red');
      const acrossIt = unit(game, 0, 'red');
      game.objectManager.addObject(alongTheShot);
      game.objectManager.addObject(acrossIt);
      game.objectManager.update();

      const cross = throwBlaze();
      // Placed off the detonation, not off a guess at where the missile stopped.
      alongTheShot.position.set(cross.atX + W_CROSS_ARM - 20, cross.atY);
      acrossIt.position.set(cross.atX, cross.atY + W_CROSS_ARM - 20);
      cross.onAdded();

      expect(alongTheShot.stats.health.value).toBe(100 - W_DAMAGE);
      expect(markOn(alongTheShot), 'the body on the shot line was not marked').toBeTruthy();
      expect(markOn(acrossIt), 'the body on the cross arm was not marked').toBeTruthy();
    });

    it('leaves a body in the quadrant between the arms alone', () => {
      const between = unit(game, 0, 'red');
      game.objectManager.addObject(between);
      game.objectManager.update();

      const cross = throwBlaze();
      between.position.set(cross.atX + 80, cross.atY + 80);
      cross.onAdded();

      expect(between.stats.health.value).toBe(100);
    });

    /**
     * `onDamageTaken` is the seam: it fires on the *victim* with whoever dealt
     * the blow, which is exactly the question the record asks.
     */
    it('hastens Lucian when he damages a body he has marked, and nobody else', () => {
      const victim = unit(game, 300, 'red');
      const other = unit(game, 900, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.addObject(other);
      game.objectManager.update();

      detonate();
      expect(buffOf(owner, Speedup), 'the mark should not haste on its own').toBeUndefined();

      victim.takeDamage(5, owner, 'PHYSICAL');
      expect(buffOf(owner, Speedup)?.percent).toBe(W_SPEED_PERCENT);

      // Somebody else hitting the marked body does not hasten Lucian.
      const before = live(owner).length;
      victim.takeDamage(5, other, 'PHYSICAL');
      expect(live(owner).length).toBe(before);
    });
  });

  describe('Relentless Pursuit', () => {
    it('dashes the distance on its own card and loads the second shot', () => {
      const e = new Lucian_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);

      expect(buffOf(owner, Dash)?.dashDestination?.x).toBeCloseTo(E_DASH, 6);
      expect(lightslingerOn(owner)).toBeTruthy();
    });
  });

  describe('The Culling', () => {
    it('fires its whole magazine into the first body on the line', () => {
      const front = unit(game, 150, 'red');
      const behind = unit(game, 300, 'red');
      front.stats.health.baseValue = 500;
      front.stats.maxHealth.baseValue = 500;
      game.objectManager.addObject(front);
      game.objectManager.addObject(behind);
      game.objectManager.update();

      const r = new Lucian_R(owner);
      expect(pressSpell(r, { at: { x: 900, y: 0 } })).toBe(true);

      vi.stubGlobal('deltaTime', R_SHOT_INTERVAL_MS);
      for (let tick = 0; tick < R_SHOTS + 4; tick++) r.onUpdate();

      expect(r.shotsFired).toBe(R_SHOTS);
      expect(500 - front.stats.health.value).toBe(R_TOTAL_DAMAGE);
      // A body behind the first is real cover, which is the whole decision.
      expect(behind.stats.health.value).toBe(100);
    });

    it('stops firing the moment it is ended early', () => {
      const victim = unit(game, 150, 'red');
      victim.stats.health.baseValue = 500;
      victim.stats.maxHealth.baseValue = 500;
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Lucian_R(owner);
      expect(pressSpell(r, { at: { x: 900, y: 0 } })).toBe(true);

      // Driven through `update`, not `onUpdate`: the record makes the early stop
      // wait, and it is the *runtime* that enforces that wait.
      vi.stubGlobal('deltaTime', R_SHOT_INTERVAL_MS);
      for (let tick = 0; tick < 3; tick++) r.update();
      const spent = r.shotsFired;
      expect(spent).toBeGreaterThan(0);

      expect(pressSpell(r, { at: { x: 900, y: 0 } }), 'the early stop was refused').toBe(true);
      r.onUpdate();
      r.onUpdate();

      expect(r.shotsFired).toBe(spent);
      expect(500 - victim.stats.health.value).toBe(spent * R_SHOT_DAMAGE);
    });

    it('stops firing off a corpse', () => {
      const victim = unit(game, 150, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Lucian_R(owner);
      expect(pressSpell(r, { at: { x: 900, y: 0 } })).toBe(true);
      // `isDead` is the death ledger, not the health pool — zeroing the number
      // is not dying, and a test that did that would pass on a live champion.
      owner.die({ killer: undefined, reviveAfter: 5_000 } as never);

      vi.stubGlobal('deltaTime', R_SHOT_INTERVAL_MS);
      r.onUpdate();
      expect(r.shotsFired).toBe(0);
    });
  });
});
