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

import MissFortune_Q, {
  loveTap,
  loveTapOn,
  LOVE_TAP_DAMAGE,
  MissFortune_Q_Passive,
  MissFortune_Q_Shot,
  Q_BOUNCE_DAMAGE,
  Q_BOUNCE_RANGE,
  Q_DAMAGE,
} from '../../spells/MissFortune_Q';
import MissFortune_W, {
  MissFortune_W_Saunter,
  MissFortune_W_Strut,
  W_CALM_MS,
  W_MOVE_SPEED,
  W_TAP_REFUND_MS,
} from '../../spells/MissFortune_W';
import MissFortune_E, {
  E_CAST_MS,
  E_RADIUS,
  E_SLOW_PERCENT,
  E_TICK_DAMAGE,
  E_TICK_MS,
  E_TICKS,
  MissFortune_E_Rain,
} from '../../spells/MissFortune_E';
import MissFortune_R, {
  R_ARC_DEG,
  R_LENGTH,
  R_WAVE_DAMAGE,
  R_WAVE_MS,
} from '../../spells/MissFortune_R';

const __api = buildTestApi();
const { Slow, Speedup } = __api.buffs;
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

describe('Miss Fortune', () => {
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

  describe('Love Tap', () => {
    it('pays for a new body and not for the one already wearing the mark', () => {
      const first = unit(game, 80, 'red');
      const second = unit(game, 120, 'red');
      game.objectManager.addObject(first);
      game.objectManager.addObject(second);
      game.objectManager.update();

      expect(loveTap(owner, first)).toBe(true);
      expect(first.stats.health.value).toBe(100 - LOVE_TAP_DAMAGE);
      expect(loveTapOn(first)).toBeTruthy();

      // Same body again: an ordinary swing.
      expect(loveTap(owner, first)).toBe(false);
      expect(first.stats.health.value).toBe(100 - LOVE_TAP_DAMAGE);

      // Switching is what she is paid for, and the mark goes with her.
      expect(loveTap(owner, second)).toBe(true);
      expect(second.stats.health.value).toBe(100 - LOVE_TAP_DAMAGE);
      expect(loveTapOn(first), 'the mark should be single').toBeUndefined();
    });

    it('rides her basic attack, and not a phantom of it', () => {
      const victim = unit(game, 80, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new MissFortune_Q(owner);
      q.onUpdate();
      const passive = buffOf(owner, MissFortune_Q_Passive)!;

      passive.onHit(swing(owner, victim, true));
      expect(victim.stats.health.value).toBe(100);

      passive.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100 - LOVE_TAP_DAMAGE);
    });

    it('buys a slice of Strut back for a new mark only', () => {
      const first = unit(game, 80, 'red');
      game.objectManager.addObject(first);
      game.objectManager.update();

      const w = new MissFortune_W(owner);
      (owner as unknown as { spells: unknown[] }).spells = [w];
      w.currentCooldown = w.coolDown;

      loveTap(owner, first);
      expect(w.currentCooldown).toBe(w.coolDown - W_TAP_REFUND_MS);
      loveTap(owner, first);
      expect(w.currentCooldown, 'the same body paid twice').toBe(w.coolDown - W_TAP_REFUND_MS);
    });
  });

  describe('Double Up', () => {
    /** Fire the shot and fly it until it lands. */
    function fire(): MissFortune_Q_Shot {
      expect(pressSpell(new MissFortune_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const shot = pending(game, MissFortune_Q_Shot);
      for (let tick = 0; tick < 200 && !shot.toRemove; tick++) shot.update();
      return shot;
    }

    it('bounces past the first body to the one standing behind it', () => {
      const front = unit(game, 150, 'red');
      const behind = unit(game, 250, 'red');
      game.objectManager.addObject(front);
      game.objectManager.addObject(behind);
      game.objectManager.update();

      const shot = fire();

      expect(front.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(behind.stats.health.value).toBe(100 - Q_BOUNCE_DAMAGE);
      expect(shot.bouncedTo).toBe(behind);
    });

    it('will not bounce backwards, or past the bounce range', () => {
      const front = unit(game, 220, 'red');
      const beside = unit(game, 100, 'red');
      const tooFar = unit(game, 220 + Q_BOUNCE_RANGE + 60, 'red');
      game.objectManager.addObject(front);
      game.objectManager.addObject(beside);
      game.objectManager.addObject(tooFar);
      game.objectManager.update();

      // `beside` sits between her and the primary, so the shot meets it first —
      // and *its* bounce may only look further down the line.
      const shot = fire();
      expect(shot.bouncedTo).toBe(front);
      expect(tooFar.stats.health.value).toBe(100);
    });

    it('is a plain shot when nothing stands behind', () => {
      const alone = unit(game, 200, 'red');
      game.objectManager.addObject(alone);
      game.objectManager.update();

      const shot = fire();
      expect(alone.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(shot.bouncedTo).toBeNull();
    });
  });

  describe('Strut', () => {
    it('grants attack speed on the press', () => {
      expect(pressSpell(new MissFortune_W(owner))).toBe(true);
      expect(buffOf(owner, MissFortune_W_Strut), 'nothing sped her swing up').toBeTruthy();
      expect(owner.stats.attackSpeed.value).toBeGreaterThanOrEqual(0);
    });

    /**
     * `onDamageTaken` is the clock's reset, which is the honest reading of
     * "without taking damage" — it fires for every hit that lands on her,
     * whatever dealt it, so nothing has to enumerate the ways she can be hurt.
     */
    it('walks faster once she is left alone, and stops the moment she is hit', () => {
      const attacker = unit(game, 300, 'red');
      game.objectManager.addObject(attacker);
      game.objectManager.update();

      const w = new MissFortune_W(owner);
      w.onUpdate();
      const saunter = buffOf(owner, MissFortune_W_Saunter)!;
      const baseSpeed = owner.stats.speed.value;

      vi.stubGlobal('deltaTime', W_CALM_MS);
      saunter.update();
      expect(saunter.sauntering).toBe(true);
      expect(owner.stats.speed.value).toBeCloseTo(baseSpeed * (1 + W_MOVE_SPEED), 6);

      owner.takeDamage(5, attacker, 'PHYSICAL');
      expect(saunter.calmMs).toBe(0);
      expect(buffOf(owner, Speedup), 'the walk survived being hit').toBeUndefined();
      expect(owner.stats.speed.value).toBeCloseTo(baseSpeed, 6);
    });
  });

  describe('Make It Rain', () => {
    /**
     * She plants for `E_CAST_MS` before the storm goes up — a cast time is a
     * root (`Spell.holdStillWhileCasting`), and it is what she was missing:
     * the storm used to appear behind a champion who never broke stride.
     * Nothing spawns until the wind-up is spent, so every test here runs it.
     */
    const throwIt = (at: { x: number; y: number }) => {
      const spell = new MissFortune_E(owner);
      expect(pressSpell(spell, { at })).toBe(true);
      // `pending` throws when it finds nothing, so the absence is asked for
      // by hand.
      const queue = (game.objectManager as unknown as { _objectToBeAdd: unknown[] })
        ._objectToBeAdd;
      expect(
        queue.some(object => object instanceof MissFortune_E_Rain),
        'it fell before the wind-up was over'
      ).toBe(false);

      vi.stubGlobal('deltaTime', E_CAST_MS + 20);
      spell.update();
      vi.stubGlobal('deltaTime', 16);
      return spell;
    };

    it('plants her for the wind-up rather than letting her walk it off', () => {
      owner.moveTo(600, 0);
      expect(owner.destination.x, 'the fixture never started walking').toBe(600);

      throwIt({ x: 200, y: 0 });

      expect(owner.destination.x).toBe(owner.position.x);
      expect(pending(game, MissFortune_E_Rain), 'the storm never fell').toBeTruthy();
    });

    it('ticks its damage and renews one slow rather than stacking', () => {
      const standing = unit(game, 200, 'red');
      standing.stats.health.baseValue = 500;
      standing.stats.maxHealth.baseValue = 500;
      game.objectManager.addObject(standing);
      game.objectManager.update();

      throwIt({ x: 200, y: 0 });
      const rain = pending(game, MissFortune_E_Rain);

      vi.stubGlobal('deltaTime', E_TICK_MS);
      for (let tick = 0; tick < E_TICKS + 2; tick++) rain.update();

      expect(rain.ticksDone).toBe(E_TICKS);
      expect(500 - standing.stats.health.value).toBe(E_TICKS * E_TICK_DAMAGE);
      const slows = live(standing).filter(buff => buff instanceof Slow);
      expect(slows, 'four ticks a second would stack this into a root').toHaveLength(1);
      expect((slows[0] as never as { percent: number }).percent).toBe(E_SLOW_PERCENT);
    });

    it('leaves the ground outside the circle alone', () => {
      const outside = unit(game, 200 + E_RADIUS + 60, 'red');
      game.objectManager.addObject(outside);
      game.objectManager.update();

      throwIt({ x: 200, y: 0 });
      const rain = pending(game, MissFortune_E_Rain);
      vi.stubGlobal('deltaTime', E_TICK_MS);
      rain.update();

      expect(outside.stats.health.value).toBe(100);
    });
  });

  describe('Bullet Time', () => {
    /**
     * Drive the channel through the *runtime*, which is the only thing that
     * knows when a wave is due — the waves arrive on `onChannelTick`, and a test
     * calling that by hand would be testing its own clock instead of the
     * ability's.
     */
    function channel(r: MissFortune_R, waves: number): void {
      vi.stubGlobal('deltaTime', R_WAVE_MS);
      for (let tick = 0; tick < waves * 2 + 4 && r.wavesFired < waves; tick++) r.update();
    }

    it('pays a wave into the wedge and leaves anything outside it alone', () => {
      const inside = unit(game, 200, 'red');
      const wide = unit(game, 100, 'red', 300);
      const beyond = unit(game, R_LENGTH + 80, 'red');
      game.objectManager.addObject(inside);
      game.objectManager.addObject(wide);
      game.objectManager.addObject(beyond);
      game.objectManager.update();

      const r = new MissFortune_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      channel(r, 1);

      expect(r.wavesFired, 'the channel never fired').toBeGreaterThanOrEqual(1);
      expect(100 - inside.stats.health.value).toBe(r.wavesFired * R_WAVE_DAMAGE);
      expect(wide.stats.health.value).toBe(100);
      expect(beyond.stats.health.value).toBe(100);
    });

    it('is a real channel, so the runtime is what ends it when she moves', () => {
      const r = new MissFortune_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      // CHANNELED is the one form that breaks on the caster's own movement,
      // which is exactly what separates this ultimate from Lucian's.
      expect(r.castSpec.interrupts).toMatchObject({ move: true });
      expect(r.castSpec.channel?.durationMs).toBeGreaterThan(0);
    });

    it('fires nothing off a corpse', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new MissFortune_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      // `isDead` is the death ledger, not the health pool — zeroing the number
      // is not dying, and a test that did that would pass on a live champion.
      owner.die({ killer: undefined, reviveAfter: 5_000 } as never);
      channel(r, 3);

      expect(victim.stats.health.value).toBe(100);
    });

    /**
     * **The shape has to be on screen for the whole barrage.** It used to be
     * painted by each wave at an alpha of 60 and faded inside 300ms, so the one
     * thing both sides need to read — where the bullets are going — blinked ten
     * times across one channel. `MissFortune_R_Field` holds it.
     */
    it('paints the cone for the whole channel and takes it away when interrupted', () => {
      const r = new MissFortune_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);

      const field = r.field;
      expect(field, 'nothing held the cone on screen').toBeTruthy();
      expect(field!.reach).toBeGreaterThanOrEqual(R_LENGTH);
      expect(field!.toRemove).toBe(false);

      channel(r, 2);
      expect(field!.toRemove, 'the cone went away while she was still firing').toBe(false);

      // Interrupted: the cone is a promise about the next wave, and there is
      // not going to be one.
      r.cancel('MOVE');
      expect(field!.toRemove).toBe(true);
      expect(r.field).toBeNull();
    });

    it('keeps the wedge it was aimed at when she turns to look elsewhere', () => {
      const behind = unit(game, -200, 'red');
      game.objectManager.addObject(behind);
      game.objectManager.update();

      const r = new MissFortune_R(owner);
      expect(pressSpell(r, { at: { x: 400, y: 0 } })).toBe(true);
      (game as unknown as { worldMouse: unknown }).worldMouse = { x: -400, y: 0 };
      channel(r, 1);

      expect(behind.stats.health.value, 'the wedge followed the cursor').toBe(100);
      expect(Math.abs(r.heading)).toBeLessThan((R_ARC_DEG * Math.PI) / 360);
    });
  });
});
