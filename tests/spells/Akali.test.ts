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

import Akali_Q, { Q_DAMAGE, Q_RANGE, Q_SLOW_FROM, Q_SLOW_PERCENT } from '../../spells/Akali_Q';
import Akali_W, {
  Akali_W_Shroud,
  W_BREAK_MS,
  W_DURATION_MS,
  W_OFFSET,
  W_RADIUS,
} from '../../spells/Akali_W';
import Akali_E, {
  Akali_E_Mark,
  Akali_E_Shuriken,
  E_DASH_DAMAGE,
  E_FLIP_BACK,
  E_SHURIKEN_DAMAGE,
} from '../../spells/Akali_E';
import Akali_R, {
  executionDamage,
  R_DAMAGE,
  R_RECAST_GAP_MS,
  R_RECAST_MAX,
  R_RECAST_MIN,
} from '../../spells/Akali_R';

const __api = buildTestApi();
const { Dash, Invisible, Slow } = __api.buffs;
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

/** The most recent live buff of a kind — the flip and the chase are both `Dash`. */
const lastBuffOf = <T>(owner: AttackableUnit, Kind: new (...args: never[]) => T): T | undefined =>
  [...live(owner)].reverse().find(buff => buff instanceof (Kind as never)) as T | undefined;

function pending<T>(game: TestGame, Kind: new (...args: never[]) => T): T {
  const queue = game.objectManager._objectToBeAdd as unknown[];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] instanceof (Kind as never)) return queue[i] as T;
  }
  throw new Error('nothing of that kind was spawned');
}

describe('Akali', () => {
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

  describe('Five Point Strike', () => {
    it('slows only what stands past the far line, and damages both', () => {
      const near = unit(game, Q_SLOW_FROM - 30, 'red');
      const far = unit(game, Q_SLOW_FROM + 30, 'red');
      game.objectManager.addObject(near);
      game.objectManager.addObject(far);
      game.objectManager.update();

      expect(pressSpell(new Akali_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);

      expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(far.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(buffOf(near, Slow), 'the near body should not be slowed').toBeUndefined();
      expect(buffOf(far, Slow)?.percent).toBe(Q_SLOW_PERCENT);
    });

    it('cuts nothing outside the wedge or past its reach', () => {
      // Well off the axis, and well past the end of the cone.
      const wide = unit(game, 100, 'red', 200);
      const beyond = unit(game, Q_RANGE + 80, 'red');
      game.objectManager.addObject(wide);
      game.objectManager.addObject(beyond);
      game.objectManager.update();

      expect(pressSpell(new Akali_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);

      expect(wide.stats.health.value).toBe(100);
      expect(beyond.stats.health.value).toBe(100);
    });

    it('renews one slow rather than stacking a second', () => {
      const victim = unit(game, Q_SLOW_FROM + 30, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Akali_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      for (let tick = 0; tick < 200 && q.currentCooldown > 0; tick++) q.update();
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);

      // `Slow` stacks ten deep by default, and a 50% slow stacked twice is a
      // standstill on a four-second cooldown.
      expect(live(victim).filter(buff => buff instanceof Slow)).toHaveLength(1);
    });
  });

  describe('Twilight Shroud', () => {
    /** Cast the smoke and hand back the object it queued. */
    function drop(): Akali_W_Shroud {
      expect(pressSpell(new Akali_W(owner), { at: { x: 400, y: 0 } })).toBe(true);
      return pending(game, Akali_W_Shroud);
    }

    it('hides her while she stands in it and drops the cloak the moment she leaves', () => {
      const shroud = drop();
      // The bomb lands ahead of her, so she has to step into her own smoke.
      owner.position.set(W_OFFSET, 0);
      shroud.update();
      expect(buffOf(owner, Invisible), 'the smoke did not hide her').toBeTruthy();

      owner.position.set(W_OFFSET + W_RADIUS + 60, 0);
      shroud.update();
      expect(buffOf(owner, Invisible), 'the cloak followed her out').toBeUndefined();
    });

    /**
     * Core ends a stealth the moment its owner attacks or casts
     * (`combat/StealthBreak.ts`). The shroud reads *that*, rather than
     * subscribing to the two action events itself, so it can never disagree
     * with core about what counts as acting.
     */
    it('refuses to hide her again for a moment after her own cloak is torn off', () => {
      const shroud = drop();
      owner.position.set(W_OFFSET, 0);
      shroud.update();
      const cloak = buffOf(owner, Invisible)!;

      cloak.deactivateBuff();
      shroud.update();
      expect(shroud.breakMsLeft).toBe(W_BREAK_MS);
      expect(buffOf(owner, Invisible)).toBeUndefined();

      // …and it comes back once the moment has passed.
      vi.stubGlobal('deltaTime', W_BREAK_MS);
      shroud.update();
      shroud.update();
      expect(buffOf(owner, Invisible), 'the smoke never hid her again').toBeTruthy();
    });

    it('takes the cloak with it when the smoke runs out', () => {
      const shroud = drop();
      owner.position.set(W_OFFSET, 0);
      shroud.update();
      expect(buffOf(owner, Invisible)).toBeTruthy();

      vi.stubGlobal('deltaTime', W_DURATION_MS);
      shroud.update();

      expect(shroud.toRemove).toBe(true);
      expect(buffOf(owner, Invisible)).toBeUndefined();
    });
  });

  describe('Shuriken Flip', () => {
    it('flips backwards away from the throw', () => {
      const e = new Akali_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);

      const flip = buffOf(owner, Dash);
      expect(flip, 'she did not flip at all').toBeTruthy();
      expect(flip!.dashDestination?.x).toBeCloseTo(-E_FLIP_BACK, 6);
    });

    it('marks the first body the shuriken finds, and the recast comes back to it', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const e = new Akali_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);
      const shuriken = pending(game, Akali_E_Shuriken);
      for (let tick = 0; tick < 200 && !shuriken.toRemove; tick++) shuriken.update();

      expect(victim.stats.health.value).toBe(100 - E_SHURIKEN_DAMAGE);
      expect(e.marked).toBe(victim);
      expect(buffOf(victim, Akali_E_Mark), 'the shuriken left no mark').toBeTruthy();

      // The recast dash chases the mark and pays on arrival, not on the press.
      expect(pressSpell(e, { at: { x: 400, y: 0 } }), 'the recast was refused').toBe(true);
      const chase = lastBuffOf(owner, Dash)!;
      expect(victim.stats.health.value).toBe(100 - E_SHURIKEN_DAMAGE);
      owner.position.set(victim.position.x, victim.position.y);
      chase.onDashUpdate?.();
      expect(victim.stats.health.value).toBe(100 - E_SHURIKEN_DAMAGE - E_DASH_DAMAGE);
    });

    it('pays the arrival exactly once however many frames the dash runs', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const e = new Akali_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);
      const shuriken = pending(game, Akali_E_Shuriken);
      for (let tick = 0; tick < 200 && !shuriken.toRemove; tick++) shuriken.update();

      expect(pressSpell(e, { at: { x: 400, y: 0 } }), 'the recast was refused').toBe(true);
      const chase = lastBuffOf(owner, Dash)!;
      owner.position.set(victim.position.x, victim.position.y);
      chase.onDashUpdate?.();
      chase.onDashUpdate?.();
      chase.onDashUpdate?.();

      expect(victim.stats.health.value).toBe(100 - E_SHURIKEN_DAMAGE - E_DASH_DAMAGE);
    });

    it('does nothing on a recast that never marked anything', () => {
      const e = new Akali_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);
      // The flip's own dash is standing, and it is the only movement this
      // activation may ever produce: with nothing marked, the recast has
      // nowhere to go.
      const flip = lastBuffOf(owner, Dash);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);
      expect(lastBuffOf(owner, Dash)).toBe(flip);
    });
  });

  describe('Perfect Execution', () => {
    it('cuts everything the opening line runs through', () => {
      const onLine = unit(game, 150, 'red');
      const aside = unit(game, 150, 'red', 200);
      game.objectManager.addObject(onLine);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      expect(pressSpell(new Akali_R(owner), { at: { x: 400, y: 0 } })).toBe(true);

      expect(onLine.stats.health.value).toBe(100 - R_DAMAGE);
      expect(aside.stats.health.value).toBe(100);
    });

    it('ramps the recast on how much health the body has already lost', () => {
      expect(executionDamage(1)).toBe(R_RECAST_MIN);
      expect(executionDamage(0)).toBe(R_RECAST_MAX);
      expect(executionDamage(0.5)).toBe((R_RECAST_MIN + R_RECAST_MAX) / 2);
      // Clamped rather than extrapolated: an overhealed body is not worth less
      // than nothing, and a negative pool is not worth more than everything.
      expect(executionDamage(2)).toBe(R_RECAST_MIN);
      expect(executionDamage(-1)).toBe(R_RECAST_MAX);
    });

    it('pays the recast per body, so one dash can be worth two different numbers', () => {
      const healthy = unit(game, 120, 'red');
      const hurt = unit(game, 200, 'red');
      // Low, but not so low that the opening dash kills it — a corpse takes
      // nothing on the recast and the comparison below would prove nothing.
      hurt.stats.health.baseValue = 60;
      game.objectManager.addObject(healthy);
      game.objectManager.addObject(hurt);
      game.objectManager.update();

      const r = new Akali_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const afterFirst = { healthy: healthy.stats.health.value, hurt: hurt.stats.health.value };
      expect(hurt.isDead, 'the opening dash killed the hurt body').toBe(false);

      // The static gap has to pass before the runtime will take the recast.
      vi.stubGlobal('deltaTime', R_RECAST_GAP_MS);
      r.update();
      expect(pressSpell(r, { at: { x: 400, y: 0 } }), 'the recast was refused').toBe(true);

      const onHealthy = afterFirst.healthy - healthy.stats.health.value;
      const onHurt = afterFirst.hurt - hurt.stats.health.value;
      expect(onHealthy).toBeGreaterThan(0);
      expect(onHurt).toBeGreaterThan(onHealthy);
    });

    it('refuses the recast until the static gap has passed', () => {
      const victim = unit(game, 150, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Akali_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      const afterFirst = victim.stats.health.value;

      // No time has passed, so this press is the one the record makes wait.
      pressSpell(r, { at: { x: 400, y: 0 } });
      expect(victim.stats.health.value).toBe(afterFirst);
    });
  });
});
