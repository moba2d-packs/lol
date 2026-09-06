import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  releaseSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';

import Xerath_Q, {
  pulseRange,
  Q_CANCEL_REFUND,
  Q_CHARGE_MS,
  Q_DAMAGE,
  Q_HALF_WIDTH,
  Q_MAX_RANGE,
  Q_MIN_RANGE,
  Q_SELF_SLOW,
} from '../../spells/Xerath_Q';
import Xerath_W, {
  W_CORE_DAMAGE,
  W_CORE_RADIUS,
  W_CORE_SLOW,
  W_DAMAGE,
  W_DELAY_MS,
  W_RADIUS,
  W_SLOW,
  Xerath_W_Eye,
} from '../../spells/Xerath_W';
import Xerath_E, {
  E_DAMAGE,
  E_MAX_STUN_MS,
  E_MIN_STUN_MS,
  E_RANGE,
  orbStunMs,
  Xerath_E_Orb,
} from '../../spells/Xerath_E';
import Xerath_R, {
  R_IMPACT_DELAY_MS,
  R_RECAST_GAP_MS,
  R_SHOT_DAMAGE,
  R_SHOT_RADIUS,
  R_SHOTS,
  R_UNUSED_REFUND,
  R_WINDOW_MS,
  Xerath_R_Shell,
} from '../../spells/Xerath_R';

const __api = buildTestApi();
const { Slow, Stun } = __api.buffs;
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

function shellsPending(game: TestGame): Xerath_R_Shell[] {
  return (game.objectManager._objectToBeAdd as unknown[]).filter(
    object => object instanceof Xerath_R_Shell
  ) as Xerath_R_Shell[];
}

describe('Xerath', () => {
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

  describe('Arcanopulse', () => {
    it('reaches further the longer it is held, and stops growing at full charge', () => {
      expect(pulseRange(0)).toBe(Q_MIN_RANGE);
      expect(pulseRange(Q_CHARGE_MS)).toBe(Q_MAX_RANGE);
      expect(pulseRange(Q_CHARGE_MS * 3)).toBe(Q_MAX_RANGE);
    });

    it('slows him while he charges and lets go of the slow when it fires', () => {
      const q = new Xerath_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      expect(buffOf(owner, Slow)?.percent, 'the charge did not slow him').toBe(Q_SELF_SLOW);

      expect(releaseSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      expect(buffOf(owner, Slow), 'the charge slow outlived the shot').toBeUndefined();
    });

    it('pierces everything inside the reach it charged to, and nothing past it', () => {
      const near = unit(game, Q_MIN_RANGE - 40, 'red');
      const far = unit(game, Q_MIN_RANGE + 80, 'red');
      const aside = unit(game, 120, 'red', Q_HALF_WIDTH + 60);
      game.objectManager.addObject(near);
      game.objectManager.addObject(far);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      const q = new Xerath_Q(owner);
      expect(pressSpell(q, { at: { x: 900, y: 0 } })).toBe(true);
      // Released at once: the shot only reaches `Q_MIN_RANGE`.
      expect(releaseSpell(q, { at: { x: 900, y: 0 } })).toBe(true);

      expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(far.stats.health.value, 'an uncharged pulse reached full range').toBe(100);
      expect(aside.stats.health.value).toBe(100);
    });

    it('hands half the cooldown back when the charge is abandoned', () => {
      const q = new Xerath_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      q.cancel('MAX_DURATION');

      expect(q.currentCooldown).toBeCloseTo(q.coolDown * (1 - Q_CANCEL_REFUND), 4);
      expect(buffOf(owner, Slow), 'the charge slow outlived the cancel').toBeUndefined();
    });
  });

  describe('Eye of Destruction', () => {
    /** Cast at a point and let the column come down. */
    function land(at: { x: number; y: number }): Xerath_W_Eye {
      expect(pressSpell(new Xerath_W(owner), { at })).toBe(true);
      const eye = pending(game, Xerath_W_Eye);
      vi.stubGlobal('deltaTime', W_DELAY_MS);
      eye.update();
      vi.stubGlobal('deltaTime', 100);
      return eye;
    }

    it('pays more in the middle than at the rim, and slows harder there too', () => {
      const bullseye = unit(game, 300, 'red');
      const edge = unit(game, 300, 'red', W_RADIUS - 20);
      game.objectManager.addObject(bullseye);
      game.objectManager.addObject(edge);
      game.objectManager.update();

      land({ x: 300, y: 0 });

      expect(bullseye.stats.health.value).toBe(100 - W_CORE_DAMAGE);
      expect(edge.stats.health.value).toBe(100 - W_DAMAGE);
      expect(buffOf(bullseye, Slow)?.percent).toBe(W_CORE_SLOW);
      expect(buffOf(edge, Slow)?.percent).toBe(W_SLOW);
    });

    it('does nothing while it is still winding, which is the counter-play', () => {
      const victim = unit(game, 300, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Xerath_W(owner), { at: { x: 300, y: 0 } })).toBe(true);
      const eye = pending(game, Xerath_W_Eye);
      eye.update();

      expect(eye.landed).toBe(false);
      expect(victim.stats.health.value).toBe(100);
    });

    it('leaves the ground outside the outer circle alone', () => {
      const outside = unit(game, 300 + W_RADIUS + 60, 'red');
      game.objectManager.addObject(outside);
      game.objectManager.update();

      land({ x: 300, y: 0 });
      expect(outside.stats.health.value).toBe(100);
    });

    it('measures the middle on the body’s centre, so a wide body clipping it is still rim', () => {
      // Just outside the core radius: the outer ring catches it, the middle
      // does not, which is the record's own split.
      const clipping = unit(game, 300 + W_CORE_RADIUS + 10, 'red');
      clipping.collisionRadius = 25;
      game.objectManager.addObject(clipping);
      game.objectManager.update();

      land({ x: 300, y: 0 });
      expect(clipping.stats.health.value).toBe(100 - W_DAMAGE);
    });
  });

  describe('Shocking Orb', () => {
    it('stuns longer the further it flew', () => {
      expect(orbStunMs(0)).toBe(E_MIN_STUN_MS);
      expect(orbStunMs(E_RANGE)).toBe(E_MAX_STUN_MS);
      expect(orbStunMs(E_RANGE * 2)).toBe(E_MAX_STUN_MS);
      expect(orbStunMs(E_RANGE / 2)).toBe((E_MIN_STUN_MS + E_MAX_STUN_MS) / 2);
    });

    it('pays the near stun on a body at his feet and the far one across the map', () => {
      const near = unit(game, 60, 'red');
      game.objectManager.addObject(near);
      game.objectManager.update();

      expect(pressSpell(new Xerath_E(owner), { at: { x: 900, y: 0 } })).toBe(true);
      const orb = pending(game, Xerath_E_Orb);
      orb.onAdded();
      for (let tick = 0; tick < 200 && !orb.toRemove; tick++) orb.update();

      expect(near.stats.health.value).toBe(100 - E_DAMAGE);
      const stun = buffOf(near, Stun);
      expect(stun, 'the orb did not stun').toBeTruthy();
      expect(stun!.duration).toBe(orb.paidStunMs);
      expect(orb.paidStunMs).toBeLessThan(E_MAX_STUN_MS);
    });

    it('is worth more against a body it had to cross the map to reach', () => {
      const far = unit(game, E_RANGE - 40, 'red');
      game.objectManager.addObject(far);
      game.objectManager.update();

      expect(pressSpell(new Xerath_E(owner), { at: { x: 900, y: 0 } })).toBe(true);
      const orb = pending(game, Xerath_E_Orb);
      orb.onAdded();
      for (let tick = 0; tick < 200 && !orb.toRemove; tick++) orb.update();

      expect(orb.paidStunMs).toBeGreaterThan(orbStunMs(E_RANGE / 2));
    });
  });

  describe('Rite of the Arcane', () => {
    /** Advance the activation far enough that the next shell is allowed. */
    function waitForNextShell(r: Xerath_R): void {
      vi.stubGlobal('deltaTime', R_RECAST_GAP_MS);
      r.update();
      vi.stubGlobal('deltaTime', 100);
    }

    it('fires four shells and no more', () => {
      const r = new Xerath_R(owner);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);
      expect(r.stackCount).toBe(R_SHOTS);

      for (let shot = 0; shot < R_SHOTS; shot++) {
        waitForNextShell(r);
        expect(pressSpell(r, { at: { x: 300, y: 0 } }), `shell ${shot + 1} was refused`).toBe(true);
      }
      expect(r.shotsFired).toBe(R_SHOTS);
      expect(r.stackCount).toBe(0);

      // A fifth press has nothing left to fire.
      waitForNextShell(r);
      pressSpell(r, { at: { x: 300, y: 0 } });
      expect(r.shotsFired).toBe(R_SHOTS);
    });

    it('lands a shell after its delay and not before', () => {
      const victim = unit(game, 300, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Xerath_R(owner);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);
      waitForNextShell(r);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);

      const shell = pending(game, Xerath_R_Shell);
      shell.update();
      expect(victim.stats.health.value, 'the shell landed instantly').toBe(100);

      vi.stubGlobal('deltaTime', R_IMPACT_DELAY_MS);
      shell.update();
      expect(victim.stats.health.value).toBe(100 - R_SHOT_DAMAGE);
    });

    it('leaves a body outside the shell circle alone', () => {
      const outside = unit(game, 300 + R_SHOT_RADIUS + 60, 'red');
      game.objectManager.addObject(outside);
      game.objectManager.update();

      const r = new Xerath_R(owner);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);
      waitForNextShell(r);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);

      const shell = pending(game, Xerath_R_Shell);
      vi.stubGlobal('deltaTime', R_IMPACT_DELAY_MS);
      shell.update();
      expect(outside.stats.health.value).toBe(100);
    });

    it('hands half the cooldown back when the whole barrage goes unspent', () => {
      const r = new Xerath_R(owner);
      expect(pressSpell(r, { at: { x: 300, y: 0 } })).toBe(true);
      expect(shellsPending(game)).toHaveLength(0);

      // Let the window run out with nothing fired.
      vi.stubGlobal('deltaTime', R_WINDOW_MS);
      r.update();

      expect(r.shotsFired).toBe(0);
      expect(r.currentCooldown).toBeCloseTo(r.coolDown * (1 - R_UNUSED_REFUND), 4);
    });
  });
});
