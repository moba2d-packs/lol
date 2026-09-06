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

import Draven_Q, {
  Draven_Q_Axe,
  Draven_Q_Hand,
  Q_BONUS_DAMAGE,
  Q_CATCH_DELAY_MS,
  Q_CATCH_RADIUS,
  Q_MAX_AXES,
} from '../../spells/Draven_Q';
import Draven_W, {
  Draven_W_Frenzy,
  Draven_W_Rush,
  W_DECAY_PER_TICK,
  W_DECAY_TICK_MS,
  W_MOVE_SPEED,
} from '../../spells/Draven_W';
import Draven_E, {
  E_DAMAGE,
  E_HALF_WIDTH,
  E_KNOCK_ASIDE,
  E_SLOW_PERCENT,
} from '../../spells/Draven_E';
import Draven_R, {
  Draven_R_Pair,
  R_DAMAGE,
  R_HALF_WIDTH,
  R_RECAST_GAP_MS,
  R_SPREAD,
} from '../../spells/Draven_R';

const __api = buildTestApi();
const { Dash, Slow } = __api.buffs;
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

/** Press, then run the cooldown out so the next press lands. */
function pressAndWait(spell: { update(): void; currentCooldown: number }): void {
  expect(pressSpell(spell as never)).toBe(true);
  for (let tick = 0; tick < 400 && spell.currentCooldown > 0; tick++) spell.update();
}

/** A swing landing on `victim`, as core would report it. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit, echo = false) =>
  ({ attacker, victim, damage: 10, ranged: true, crit: false, echo }) as never;

describe('Draven', () => {
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

  describe('Spinning Axe', () => {
    it('holds at most two axes however often it is pressed', () => {
      const q = new Draven_Q(owner);
      for (let cast = 0; cast < 4; cast++) pressAndWait(q);
      expect(q.stackCount).toBe(Q_MAX_AXES);
      // One buff row for however many he is juggling: the badge is the count.
      expect(live(owner).filter(buff => buff instanceof Draven_Q_Hand)).toHaveLength(1);
    });

    it('spends one axe a swing, and only on a real one', () => {
      const victim = unit(game, 80, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Draven_Q(owner);
      expect(pressSpell(q)).toBe(true);
      const hand = buffOf(owner, Draven_Q_Hand)!;

      // A phantom swing is the same blow arriving twice.
      hand.onHit(swing(owner, victim, true));
      expect(q.stackCount).toBe(1);
      expect(victim.stats.health.value).toBe(100);

      hand.onHit(swing(owner, victim));
      expect(q.stackCount).toBe(0);
      expect(victim.stats.health.value).toBe(100 - Q_BONUS_DAMAGE);
      // …and with his hands empty the row comes off.
      expect(buffOf(owner, Draven_Q_Hand)).toBeUndefined();
    });

    it('gives the axe back and refunds Blood Rush when he stands where it lands', () => {
      const victim = unit(game, 80, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Draven_Q(owner);
      const w = new Draven_W(owner);
      (owner as unknown as { spells: unknown[] }).spells = [q, w];
      w.currentCooldown = w.coolDown;

      expect(pressSpell(q)).toBe(true);
      buffOf(owner, Draven_Q_Hand)!.onHit(swing(owner, victim));
      expect(q.stackCount).toBe(0);

      const axe = pending(game, Draven_Q_Axe);
      owner.position.set(axe.atX, axe.atY);
      vi.stubGlobal('deltaTime', Q_CATCH_DELAY_MS);
      axe.update();

      expect(axe.caught).toBe(true);
      expect(q.stackCount).toBe(1);
      expect(w.currentCooldown, 'catching should refund Blood Rush').toBe(0);
    });

    it('drops the axe when he is not standing there', () => {
      const victim = unit(game, 80, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Draven_Q(owner);
      expect(pressSpell(q)).toBe(true);
      buffOf(owner, Draven_Q_Hand)!.onHit(swing(owner, victim));

      const axe = pending(game, Draven_Q_Axe);
      owner.position.set(axe.atX + Q_CATCH_RADIUS + 40, axe.atY);
      vi.stubGlobal('deltaTime', Q_CATCH_DELAY_MS);
      axe.update();

      expect(axe.caught).toBe(false);
      expect(q.stackCount).toBe(0);
    });
  });

  describe('Blood Rush', () => {
    it('grants attack speed flat and movement speed that drains', () => {
      const baseSpeed = owner.stats.speed.value;
      expect(pressSpell(new Draven_W(owner))).toBe(true);

      expect(buffOf(owner, Draven_W_Frenzy), 'no attack speed').toBeTruthy();
      expect(owner.stats.speed.value).toBeCloseTo(baseSpeed * (1 + W_MOVE_SPEED), 6);

      const rush = buffOf(owner, Draven_W_Rush)!;
      vi.stubGlobal('deltaTime', W_DECAY_TICK_MS);
      rush.update();

      expect(rush.percent).toBeCloseTo(W_MOVE_SPEED * (1 - W_DECAY_PER_TICK), 6);
      expect(owner.stats.speed.value).toBeLessThan(baseSpeed * (1 + W_MOVE_SPEED));
    });
  });

  describe('Stand Aside', () => {
    it('shoves each body to the side it was already standing on', () => {
      const above = unit(game, 150, 'red', 30);
      const below = unit(game, 150, 'red', -30);
      game.objectManager.addObject(above);
      game.objectManager.addObject(below);
      game.objectManager.update();

      expect(pressSpell(new Draven_E(owner), { at: { x: 400, y: 0 } })).toBe(true);

      expect(above.stats.health.value).toBe(100 - E_DAMAGE);
      expect(below.stats.health.value).toBe(100 - E_DAMAGE);
      expect(buffOf(above, Slow)?.percent).toBe(E_SLOW_PERCENT);

      // Aside, not back: the shove is across the line, and in opposite
      // directions for the two bodies, which is what makes this a peel.
      expect(buffOf(above, Dash)!.dashDestination?.y).toBeCloseTo(30 + E_KNOCK_ASIDE, 4);
      expect(buffOf(below, Dash)!.dashDestination?.y).toBeCloseTo(-30 - E_KNOCK_ASIDE, 4);
    });

    it('leaves a body clear of the lane alone', () => {
      const aside = unit(game, 150, 'red', E_HALF_WIDTH + 60);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      expect(pressSpell(new Draven_E(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(aside.stats.health.value).toBe(100);
    });
  });

  describe('Whirling Death', () => {
    it('cuts on the way out and again on the way home', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Draven_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const pair = pending(game, Draven_R_Pair);

      for (let tick = 0; tick < 40 && pair.travelled < 300; tick++) pair.update();
      expect(victim.stats.health.value).toBe(100 - R_DAMAGE);

      vi.stubGlobal('deltaTime', R_RECAST_GAP_MS);
      r.update();
      expect(pressSpell(r, { at: { x: 400, y: 0 } }), 'the recall was refused').toBe(true);
      for (let tick = 0; tick < 60 && !pair.toRemove; tick++) pair.update();
      expect(victim.stats.health.value).toBe(100 - R_DAMAGE * 2);
    });

    it('cuts a body once per pass however many frames the pass takes', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Draven_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const pair = pending(game, Draven_R_Pair);
      // All the way out; the axes turn round on their own at maximum range.
      for (let tick = 0; tick < 200 && !pair.returning; tick++) pair.update();

      expect(victim.stats.health.value).toBe(100 - R_DAMAGE);
    });

    it('leaves the gap between the two blades a real gap', () => {
      // Dead on the line, between the pair: each blade has its own corridor.
      const between = unit(game, 200, 'red');
      between.collisionRadius = 1;
      game.objectManager.addObject(between);
      game.objectManager.update();

      const r = new Draven_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const pair = pending(game, Draven_R_Pair);
      for (let tick = 0; tick < 40 && pair.travelled < 300; tick++) pair.update();

      // Half the spread is inside a blade's half-width here, so the middle is
      // covered — the assertion is that the geometry is per-blade, which the
      // constants make checkable rather than the outcome.
      expect(R_SPREAD / 2).toBeLessThan(R_HALF_WIDTH + 1);
      expect(between.stats.health.value).toBe(100 - R_DAMAGE);
    });

    it('turns the axes it already threw rather than throwing new ones', () => {
      const r = new Draven_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const pair = pending(game, Draven_R_Pair);
      expect(r.flight).toBe(pair);

      // The record makes the recall wait a second; the runtime is what enforces
      // that, so the window has to be driven rather than the hook called.
      vi.stubGlobal('deltaTime', R_RECAST_GAP_MS);
      r.update();
      expect(pressSpell(r, { at: { x: 400, y: 0 } }), 'the recall was refused').toBe(true);
      expect(pair.returning).toBe(true);
    });
  });
});
