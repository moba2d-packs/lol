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

import Jax_Q, { Q_ARRIVE_RADIUS, Q_DAMAGE } from '../../spells/Jax_Q';
import Jax_W, { empowerOn, Jax_W_Charge, W_BONUS_DAMAGE } from '../../spells/Jax_W';
import Jax_E, {
  counterDamage,
  E_MAX_DODGES,
  E_RADIUS,
  E_RECAST_GAP_MS,
  E_SPELL_REDUCTION,
  E_STANCE_MS,
  E_STUN_MS,
  Jax_E_Evasion,
} from '../../spells/Jax_E';
import Jax_R, {
  Jax_R_Counter,
  Jax_R_Grandmaster,
  R_ARMOR,
  R_ARMOR_PER_EXTRA,
  R_DAMAGE,
  R_MAGIC_RESIST_SHARE,
  R_PASSIVE_DAMAGE,
  R_PASSIVE_HITS,
  R_PASSIVE_HITS_UNLEASHED,
} from '../../spells/Jax_R';

const __api = buildTestApi();
const { Dash, Stun } = __api.buffs;
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

/** A swing landing on `victim`, as core would report it. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit, echo = false) =>
  ({ attacker, victim, damage: 10, ranged: false, crit: false, echo }) as never;

describe('Jax', () => {
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

  describe('Leap Strike', () => {
    it('lands on the body it aimed at and hits it once', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Jax_Q(owner);
      expect(pressSpell(q, { target: victim })).toBe(true);
      const leap = buffOf(owner, Dash)!;

      // Nothing lands on the press: the blow is at the end of the jump.
      expect(victim.stats.health.value).toBe(100);
      owner.position.set(victim.position.x, victim.position.y);
      leap.onDashUpdate?.();
      leap.onDashUpdate?.();

      expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    });

    it('chases a body that moved rather than the ground it stood on', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Jax_Q(owner);
      expect(pressSpell(q, { target: victim })).toBe(true);
      const leap = buffOf(owner, Dash)!;

      victim.position.set(320, 0);
      owner.position.set(200, 0);
      leap.onDashUpdate?.();
      expect(leap.dashDestination?.x, 'the leap kept aiming at empty ground').toBe(320);
      expect(victim.stats.health.value).toBe(100);

      owner.position.set(320 - Q_ARRIVE_RADIUS / 2, 0);
      leap.onDashUpdate?.();
      expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    });

    it('spends an Empower charge on the landing, exactly as a swing would', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Jax_W(owner))).toBe(true);
      const q = new Jax_Q(owner);
      expect(pressSpell(q, { target: victim })).toBe(true);
      const leap = buffOf(owner, Dash)!;
      owner.position.set(victim.position.x, victim.position.y);
      leap.onDashUpdate?.();

      expect(victim.stats.health.value).toBe(100 - Q_DAMAGE - W_BONUS_DAMAGE);
      expect(empowerOn(owner), 'the charge was not spent').toBeUndefined();
    });
  });

  describe('Empower', () => {
    it('spends on the next real swing and not on a phantom', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Jax_W(owner))).toBe(true);
      const charge = buffOf(owner, Jax_W_Charge)!;

      charge.onHit(swing(owner, victim, true));
      expect(victim.stats.health.value).toBe(100);
      expect(empowerOn(owner)).toBeTruthy();

      charge.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100 - W_BONUS_DAMAGE);
      expect(empowerOn(owner)).toBeUndefined();
    });
  });

  describe('Counter Strike', () => {
    it('turns physical damage aside whole and blunts the rest', () => {
      const attacker = unit(game, 200, 'red');
      game.objectManager.addObject(attacker);
      game.objectManager.update();

      expect(pressSpell(new Jax_E(owner))).toBe(true);
      const evasion = buffOf(owner, Jax_E_Evasion)!;

      owner.takeDamage(30, attacker, 'PHYSICAL');
      expect(owner.stats.health.value, 'a blow got through').toBe(100);
      expect(evasion.dodges).toBe(1);

      owner.takeDamage(40, attacker, 'MAGIC');
      expect(owner.stats.health.value).toBe(100 - 40 * (1 - E_SPELL_REDUCTION));
    });

    it('builds the counter out of what it turned aside, and stops at the cap', () => {
      expect(counterDamage(0)).toBe(20);
      expect(counterDamage(E_MAX_DODGES)).toBeGreaterThan(counterDamage(0));
      expect(counterDamage(E_MAX_DODGES + 5)).toBe(counterDamage(E_MAX_DODGES));
    });

    it('goes off on its own when the stance runs out, stunning what it caught', () => {
      const victim = unit(game, E_RADIUS - 40, 'red');
      const attacker = unit(game, 400, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.addObject(attacker);
      game.objectManager.update();

      const e = new Jax_E(owner);
      expect(pressSpell(e)).toBe(true);
      owner.takeDamage(30, attacker, 'PHYSICAL');
      owner.takeDamage(30, attacker, 'PHYSICAL');

      vi.stubGlobal('deltaTime', E_STANCE_MS);
      e.onUpdate();

      expect(victim.stats.health.value).toBe(100 - counterDamage(2));
      expect(buffOf(victim, Stun)?.duration).toBe(E_STUN_MS);
      // Idempotent: the recast and the stance running out can share a frame.
      e.onUpdate();
      expect(victim.stats.health.value).toBe(100 - counterDamage(2));
    });

    it('refuses the recast until the record’s gap has passed', () => {
      const victim = unit(game, E_RADIUS - 40, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const e = new Jax_E(owner);
      expect(pressSpell(e)).toBe(true);
      // No time has passed, so the runtime is what refuses this one.
      pressSpell(e);
      expect(victim.stats.health.value).toBe(100);

      vi.stubGlobal('deltaTime', E_RECAST_GAP_MS);
      e.update();
      expect(pressSpell(e), 'the counter was refused after the gap').toBe(true);
      expect(victim.stats.health.value).toBeLessThan(100);
    });
  });

  describe('Grandmaster-at-Arms', () => {
    it('pays a heavy blow every second swing, and every swing while the form is up', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Jax_R(owner);
      r.onUpdate();
      const counter = buffOf(owner, Jax_R_Counter)!;
      expect(r.hitsNeeded).toBe(R_PASSIVE_HITS);

      counter.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100);
      counter.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100 - R_PASSIVE_DAMAGE);

      // Under the form the fuse is one blow, not two.
      owner.addBuff(new Jax_R_Grandmaster(5_000, owner, owner));
      expect(r.hitsNeeded).toBe(R_PASSIVE_HITS_UNLEASHED);
      counter.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100 - R_PASSIVE_DAMAGE * 2);
    });

    it('charges nothing on a phantom swing', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Jax_R(owner);
      r.onUpdate();
      buffOf(owner, Jax_R_Counter)!.onHit(swing(owner, victim, true));
      expect(r.stackCount).toBe(0);
    });

    it('pays resistances for the champions the swing caught, and nothing for a creep', () => {
      const champion = unit(game, 80, 'red');
      champion.killCredit = 'champion';
      const creep = unit(game, 110, 'red');
      game.objectManager.addObject(champion);
      game.objectManager.addObject(creep);
      game.objectManager.update();

      expect(pressSpell(new Jax_R(owner))).toBe(true);

      expect(champion.stats.health.value).toBe(100 - R_DAMAGE);
      expect(creep.stats.health.value, 'the creep should still be hit').toBe(100 - R_DAMAGE);
      // One champion, so the first tier and nothing on top of it.
      expect(owner.stats.armor.value).toBe(R_ARMOR);
      expect(owner.stats.magicResist.value).toBe(Math.round(R_ARMOR * R_MAGIC_RESIST_SHARE));
    });

    it('pays more for each champion past the first', () => {
      for (const x of [70, 100, 130]) {
        const champion = unit(game, x, 'red');
        champion.killCredit = 'champion';
        game.objectManager.addObject(champion);
      }
      game.objectManager.update();

      expect(pressSpell(new Jax_R(owner))).toBe(true);
      expect(owner.stats.armor.value).toBe(R_ARMOR + R_ARMOR_PER_EXTRA * 2);
    });

    it('pays nothing at all when it catches only creeps', () => {
      const creep = unit(game, 80, 'red');
      game.objectManager.addObject(creep);
      game.objectManager.update();

      expect(pressSpell(new Jax_R(owner))).toBe(true);
      expect(owner.stats.armor.value).toBe(0);
    });
  });
});
