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

import Fiora_Q, {
  Fiora_Q_Duelist,
  Fiora_Vital,
  identifyVital,
  Q_DAMAGE,
  Q_STAB_REFUND,
  triggerVital,
  VITAL_ARM_MS,
  VITAL_DAMAGE,
  VITAL_HEAL,
  vitalOn,
} from '../../spells/Fiora_Q';
import Fiora_W, { Fiora_W_Parry, W_DAMAGE, W_STANCE_MS, W_STUN_MS } from '../../spells/Fiora_W';
import Fiora_E, {
  E_SECOND_BONUS,
  E_SLOW_PERCENT,
  E_SWINGS,
  Fiora_E_Bladework,
} from '../../spells/Fiora_E';
import Fiora_R, {
  Fiora_R_Victory,
  R_HEAL_PER_TICK,
  R_TICK_MS,
  R_ZONE_RADIUS,
} from '../../spells/Fiora_R';

const __api = buildTestApi();
const { Slow, Stun } = __api.buffs;
const EventType = __api.enums.EventType;
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
  ({ attacker, victim, damage: 10, ranged: false, crit: false, echo }) as never;

/** Arm a Vital facing `side` on `victim` and let it become targetable. */
function armVital(fiora: AttackableUnit, victim: AttackableUnit, side: number): Fiora_Vital {
  const vital = identifyVital(fiora, victim, side);
  vi.stubGlobal('deltaTime', VITAL_ARM_MS);
  vital.update();
  vi.stubGlobal('deltaTime', 100);
  return vital;
}

describe('Fiora', () => {
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

  describe("Duelist's Dance", () => {
    it('pays out only from the side the Vital is open on', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      // Open on the far side, away from Fiora: a blow from where she stands
      // comes in at the closed quarter.
      armVital(owner, victim, 0);
      expect(triggerVital(owner, victim), 'the closed side paid out').toBe(false);
      expect(victim.stats.health.value).toBe(100);

      // Walk round.
      owner.position.set(400, 0);
      const before = victim.stats.health.value;
      expect(triggerVital(owner, victim)).toBe(true);
      expect(before - victim.stats.health.value).toBe(VITAL_DAMAGE);
    });

    it('does not pay out before the Vital is armed', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      // Open on the near side and then walk round to it: the only thing keeping
      // this from paying out is that it has not armed yet.
      identifyVital(owner, victim, 0);
      owner.position.set(400, 0);
      expect(triggerVital(owner, victim), 'an unarmed Vital paid out').toBe(false);
    });

    it('heals her and opens the next quarter somewhere else', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();
      owner.stats.health.baseValue = 50;

      const vital = armVital(owner, victim, 0);
      owner.position.set(400, 0);
      const openedOn = vital.side;

      expect(triggerVital(owner, victim)).toBe(true);
      expect(owner.stats.health.value).toBe(50 + VITAL_HEAL);

      const next = vitalOn(victim);
      expect(next, 'no new Vital was identified').toBeTruthy();
      expect(next!.side, 'it opened on the same quarter').not.toBe(openedOn);
    });

    it('triggers off her basic attack as readily as off her blade', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Fiora_Q(owner);
      q.onUpdate();
      const duelist = buffOf(owner, Fiora_Q_Duelist)!;
      armVital(owner, victim, 0);
      owner.position.set(400, 0);

      const before = victim.stats.health.value;
      duelist.onHit(swing(owner, victim));
      expect(before - victim.stats.health.value).toBe(VITAL_DAMAGE);
    });
  });

  describe('Lunge', () => {
    it('stabs the nearest body and takes half the cooldown back off', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Fiora_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      const charged = q.currentCooldown;
      q.stab();

      expect(victim.stats.health.value).toBeLessThanOrEqual(100 - Q_DAMAGE);
      expect(q.currentCooldown).toBeCloseTo(charged * (1 - Q_STAB_REFUND), 4);
    });

    it('takes nothing back off when the blade finds nothing', () => {
      const q = new Fiora_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      const charged = q.currentCooldown;
      q.stab();
      expect(q.currentCooldown).toBe(charged);
    });
  });

  describe('Riposte', () => {
    it('takes nothing at all while the stance is up', () => {
      const attacker = unit(game, 200, 'red');
      game.objectManager.addObject(attacker);
      game.objectManager.update();

      expect(pressSpell(new Fiora_W(owner), { at: { x: 400, y: 0 } })).toBe(true);
      owner.takeDamage(40, attacker, 'PHYSICAL');

      expect(owner.stats.health.value).toBe(100);
    });

    /**
     * `blocksIncoming` is the same hook `Dash.unstoppable` uses, which is what
     * makes debuff immunity expressible without a status flag of its own — and
     * what the stun below is counted from.
     */
    it('turns crowd control away and answers with a stun instead of a slow', () => {
      const victim = unit(game, 150, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const w = new Fiora_W(owner);
      expect(pressSpell(w, { at: { x: 400, y: 0 } })).toBe(true);
      const parry = buffOf(owner, Fiora_W_Parry)!;

      owner.addBuff(new Stun(2_000, victim, owner));
      expect(buffOf(owner, Stun), 'the stun landed through the parry').toBeUndefined();
      expect(parry.negated).toBe(1);

      vi.stubGlobal('deltaTime', W_STANCE_MS);
      w.onUpdate();

      expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
      expect(buffOf(victim, Stun)?.duration).toBe(W_STUN_MS);
    });

    it('slows instead when it turned nothing away', () => {
      const victim = unit(game, 150, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const w = new Fiora_W(owner);
      expect(pressSpell(w, { at: { x: 400, y: 0 } })).toBe(true);
      vi.stubGlobal('deltaTime', W_STANCE_MS);
      w.onUpdate();

      expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
      expect(buffOf(victim, Stun)).toBeUndefined();
      expect(buffOf(victim, Slow), 'nothing slowed the body it hit').toBeTruthy();
    });
  });

  describe('Bladework', () => {
    it('slows on the first swing, hurts on the second, and is spent', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const e = new Fiora_E(owner);
      expect(pressSpell(e)).toBe(true);
      const work = buffOf(owner, Fiora_E_Bladework)!;
      expect(e.stackCount).toBe(E_SWINGS);

      work.onHit(swing(owner, victim));
      expect(buffOf(victim, Slow)?.percent).toBe(E_SLOW_PERCENT);
      expect(victim.stats.health.value, 'the first swing should not add damage').toBe(100);
      expect(e.stackCount).toBe(E_SWINGS - 1);

      work.onHit(swing(owner, victim));
      expect(victim.stats.health.value).toBe(100 - E_SECOND_BONUS);
      // Two swings, not four seconds of attack speed.
      expect(buffOf(owner, Fiora_E_Bladework)).toBeUndefined();
    });

    it('spends nothing on a phantom swing', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const e = new Fiora_E(owner);
      expect(pressSpell(e)).toBe(true);
      buffOf(owner, Fiora_E_Bladework)!.onHit(swing(owner, victim, true));
      expect(e.stackCount).toBe(E_SWINGS);
    });
  });

  describe('Grand Challenge', () => {
    it('opens every side of the challenged body at once', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Fiora_R(owner);
      expect(pressSpell(r, { target: victim })).toBe(true);
      expect(r.challenged).toBe(victim);

      const vital = vitalOn(victim)!;
      expect(vital.allSides).toBe(true);
      vi.stubGlobal('deltaTime', VITAL_ARM_MS);
      vital.update();
      vi.stubGlobal('deltaTime', 100);

      // From behind, from in front — the duel does not care.
      owner.position.set(-400, 0);
      expect(triggerVital(owner, victim)).toBe(true);
      owner.position.set(400, 0);
      expect(triggerVital(owner, victim)).toBe(true);
    });

    it('grows a healing zone where the challenged body falls', () => {
      const victim = unit(game, 200, 'red');
      const ally = unit(game, 220, 'blue');
      ally.stats.health.baseValue = 40;
      game.objectManager.addObject(victim);
      game.objectManager.addObject(ally);
      game.objectManager.update();

      const r = new Fiora_R(owner);
      expect(pressSpell(r, { target: victim })).toBe(true);

      game.eventManager.emit(EventType.ON_DIE, { unit: victim, credit: 'champion' });
      const zone = pending(game, Fiora_R_Victory);
      expect(zone.atX).toBe(victim.position.x);

      vi.stubGlobal('deltaTime', R_TICK_MS);
      zone.update();
      expect(ally.stats.health.value).toBe(40 + R_HEAL_PER_TICK);
      // …and it reaches only as far as it says it does.
      expect(Math.abs(ally.position.x - zone.atX)).toBeLessThan(R_ZONE_RADIUS);
    });

    it('grows nothing when somebody else’s body dies', () => {
      const victim = unit(game, 200, 'red');
      const bystander = unit(game, 260, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.addObject(bystander);
      game.objectManager.update();

      const r = new Fiora_R(owner);
      expect(pressSpell(r, { target: victim })).toBe(true);
      const before = game.objectManager._objectToBeAdd.length;

      game.eventManager.emit(EventType.ON_DIE, { unit: bystander, credit: 'champion' });
      expect(game.objectManager._objectToBeAdd.length).toBe(before);
      expect(r.challenged).toBe(victim);
    });
  });
});
