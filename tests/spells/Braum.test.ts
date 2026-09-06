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

import Braum_Q, {
  applyConcussion,
  Braum_Q_Ice,
  Braum_Q_Passive,
  concussionStacks,
  CONCUSSION_DAMAGE,
  CONCUSSION_TO_STUN,
  Q_DAMAGE,
  Q_SLOW_PERCENT,
} from '../../spells/Braum_Q';
import Braum_W, {
  Braum_W_Bulwark,
  Braum_W_Bulwark_Self,
  W_RESIST,
  W_SELF_BONUS,
  W_STANDOFF,
} from '../../spells/Braum_W';
import Braum_E, {
  Braum_E_Barrier,
  Braum_E_Wall,
  coveredBy,
  E_REACH,
  E_REDUCTION,
} from '../../spells/Braum_E';
import Braum_R, {
  Braum_R_Fissure,
  R_DAMAGE,
  R_FIELD_SLOW,
  R_FIELD_TICK_MS,
  R_FIRST_KNOCKUP_MS,
  R_HALF_WIDTH,
  R_KNOCKUP_MS,
} from '../../spells/Braum_R';

const __api = buildTestApi();
const { Airborne, Dash, Slow, Stun } = __api.buffs;
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

describe('Braum', () => {
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

  describe("Winter's Bite and Concussive Blows", () => {
    it('freezes the first body it meets and leaves one blow on it', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Braum_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const ice = pending(game, Braum_Q_Ice);
      for (let tick = 0; tick < 200 && !ice.toRemove; tick++) ice.update();

      expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
      expect(buffOf(victim, Slow)?.percent).toBe(Q_SLOW_PERCENT);
      expect(concussionStacks(victim)).toBe(1);
    });

    /**
     * The count lives on one buff rather than on four overlapping ones, so the
     * victim wears a single row saying how close they are — which is the whole
     * information this passive exists to broadcast.
     */
    it('stuns on the fourth blow and consumes every stack doing it', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      for (let blow = 1; blow < CONCUSSION_TO_STUN; blow++) {
        applyConcussion(owner, victim);
        expect(concussionStacks(victim)).toBe(blow);
        expect(buffOf(victim, Stun), `blow ${blow} should not stun`).toBeUndefined();
      }

      applyConcussion(owner, victim);
      expect(buffOf(victim, Stun), 'the fourth blow did not stun').toBeTruthy();
      expect(victim.stats.health.value).toBe(100 - CONCUSSION_DAMAGE);
      expect(concussionStacks(victim), 'the stacks were not consumed').toBe(0);
    });

    it('refuses to stun the same body twice inside the immunity window', () => {
      const victim = unit(game, 60, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      for (let blow = 0; blow < CONCUSSION_TO_STUN; blow++) applyConcussion(owner, victim);
      const afterFirst = victim.stats.health.value;
      buffOf(victim, Stun)!.deactivateBuff();

      for (let blow = 0; blow < CONCUSSION_TO_STUN; blow++) applyConcussion(owner, victim);

      expect(buffOf(victim, Stun), 'it stunned straight through the immunity').toBeUndefined();
      // …and the second run still spent its stacks, so the build-up is not banked.
      expect(victim.stats.health.value).toBe(afterFirst);
      expect(concussionStacks(victim)).toBe(0);
    });

    it("arms Braum's own swing with a blow, once", () => {
      const q = new Braum_Q(owner);
      q.onUpdate();
      q.onUpdate();
      expect(live(owner).filter(buff => buff instanceof Braum_Q_Passive)).toHaveLength(1);

      const victim = unit(game, 60, 'red');
      const armed = buffOf(owner, Braum_Q_Passive)!;
      armed.onHit({
        attacker: owner,
        victim,
        damage: 10,
        ranged: false,
        crit: false,
        echo: false,
      } as never);
      expect(concussionStacks(victim)).toBe(1);

      // A phantom swing is the same blow arriving twice: counting it would halve
      // the number of real hits the stun needs.
      armed.onHit({
        attacker: owner,
        victim,
        damage: 10,
        ranged: false,
        crit: false,
        echo: true,
      } as never);
      expect(concussionStacks(victim)).toBe(1);
    });
  });

  describe('Stand Behind Me', () => {
    it('covers the ally and himself, and gives himself the larger share', () => {
      const ally = unit(game, 150, 'blue');
      game.objectManager.addObject(ally);
      game.objectManager.update();

      expect(pressSpell(new Braum_W(owner), { target: ally })).toBe(true);

      expect(buffOf(ally, Braum_W_Bulwark), 'the ally was not covered').toBeTruthy();
      expect(ally.stats.armor.value).toBe(W_RESIST);
      expect(owner.stats.armor.value).toBe(W_RESIST + W_SELF_BONUS);
      expect(buffOf(owner, Braum_W_Bulwark_Self)).toBeTruthy();
    });

    it('puts his body between the ally and the nearest enemy', () => {
      const ally = unit(game, 150, 'blue');
      const threat = unit(game, 400, 'red');
      game.objectManager.addObject(ally);
      game.objectManager.addObject(threat);
      game.objectManager.update();

      expect(pressSpell(new Braum_W(owner), { target: ally })).toBe(true);

      const dash = buffOf(owner, Dash);
      expect(dash, 'he did not move at all').toBeTruthy();
      // On the ally-to-threat line, a standoff short of the ally — so he ends up
      // on the far side of them from the danger rather than on top of them.
      expect(dash!.dashDestination?.x).toBeCloseTo(ally.position.x + W_STANDOFF, 4);
      expect(dash!.dashDestination?.y).toBeCloseTo(0, 4);
    });

    it('self-casts into the larger bonus and does not dash anywhere', () => {
      expect(pressSpell(new Braum_W(owner), { target: owner })).toBe(true);

      expect(owner.stats.armor.value).toBe(W_RESIST + W_SELF_BONUS);
      expect(owner.stats.magicResist.value).toBe(W_RESIST + W_SELF_BONUS);
      expect(buffOf(owner, Dash), 'a self-cast should not move him').toBeUndefined();
    });
  });

  describe('Unbreakable', () => {
    it('reads the arc from the shield, not from the caster', () => {
      expect(coveredBy(0, 0)).toBe(true);
      expect(coveredBy(0, Math.PI)).toBe(false);
      // The seam wraps: a shield facing just past -π covers a threat just past π.
      expect(coveredBy(Math.PI - 0.1, -Math.PI + 0.1)).toBe(true);
    });

    it('eats the first hit from the front whole and halves the rest', () => {
      const front = unit(game, 300, 'red');
      const behind = unit(game, -300, 'red');
      game.objectManager.addObject(front);
      game.objectManager.addObject(behind);
      game.objectManager.update();

      expect(pressSpell(new Braum_E(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const wall = buffOf(owner, Braum_E_Wall)!;

      expect(wall.modifyIncomingDamage(40, front), 'the first hit was not blocked').toBe(0);
      expect(wall.modifyIncomingDamage(40, front)).toBe(40 * (1 - E_REDUCTION));
      // Behind the shield is behind the shield.
      expect(wall.modifyIncomingDamage(40, behind)).toBe(40);
    });

    it('breaks a hostile bolt that flies into the plate, and leaves an allied one alone', () => {
      expect(pressSpell(new Braum_E(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const barrier = pending(game, Braum_E_Barrier);

      const hostile = { isMissile: true, toRemove: false, owner: { teamId: 'red' }, position: { x: E_REACH - 20, y: 0 } };
      const friendly = { isMissile: true, toRemove: false, owner: { teamId: 'blue' }, position: { x: E_REACH - 20, y: 0 } };
      const behind = { isMissile: true, toRemove: false, owner: { teamId: 'red' }, position: { x: -(E_REACH - 20), y: 0 } };
      game.objectManager.objects.push(hostile as never, friendly as never, behind as never);

      barrier.update();

      expect(hostile.toRemove, 'the bolt went straight through').toBe(true);
      expect(friendly.toRemove).toBe(false);
      expect(behind.toRemove, 'the shield is a direction, not a bubble').toBe(false);
      expect(barrier.broken).toBe(1);
    });

    it('drops the barrier with the buff, however the buff ended', () => {
      expect(pressSpell(new Braum_E(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const barrier = pending(game, Braum_E_Barrier);
      buffOf(owner, Braum_E_Wall)!.deactivateBuff();

      barrier.update();
      expect(barrier.toRemove).toBe(true);
    });
  });

  describe('Glacial Fissure', () => {
    /** Run the crack out to its full length. */
    function open(): Braum_R_Fissure {
      expect(pressSpell(new Braum_R(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const fissure = pending(game, Braum_R_Fissure);
      for (let tick = 0; tick < 400 && !fissure.settled; tick++) fissure.update();
      return fissure;
    }

    it('throws the first body it reaches higher than the ones behind it', () => {
      const near = unit(game, 100, 'red');
      const far = unit(game, 280, 'red');
      game.objectManager.addObject(near);
      game.objectManager.addObject(far);
      game.objectManager.update();

      open();

      expect(near.stats.health.value).toBe(100 - R_DAMAGE);
      expect(far.stats.health.value).toBe(100 - R_DAMAGE);
      expect(buffOf(near, Airborne)?.duration).toBe(R_FIRST_KNOCKUP_MS);
      expect(buffOf(far, Airborne)?.duration).toBe(R_KNOCKUP_MS);
    });

    it('leaves the line alone off to the side', () => {
      const aside = unit(game, 200, 'red', R_HALF_WIDTH + 60);
      game.objectManager.addObject(aside);
      game.objectManager.update();

      open();

      expect(aside.stats.health.value).toBe(100);
    });

    /**
     * The load-bearing one. This runs four times a second for three seconds and
     * `Slow` stacks ten deep by default — a 40% slow re-applied per tick becomes
     * a root inside a second, which is a different ability.
     */
    it('renews one slow on the ice rather than stacking a fresh one every tick', () => {
      const standing = unit(game, 200, 'red');
      game.objectManager.addObject(standing);
      game.objectManager.update();

      const fissure = open();
      vi.stubGlobal('deltaTime', R_FIELD_TICK_MS);
      for (let tick = 0; tick < 6; tick++) fissure.update();

      const slows = live(standing).filter(buff => buff instanceof Slow);
      expect(slows).toHaveLength(1);
      expect((slows[0] as never as { percent: number }).percent).toBe(R_FIELD_SLOW);
    });

    it('damages each body once however many frames the crack takes to reach it', () => {
      const victim = unit(game, 280, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const fissure = open();
      // Keep running the field: the crack is spent and must not re-cut anyone.
      vi.stubGlobal('deltaTime', R_FIELD_TICK_MS);
      for (let tick = 0; tick < 4; tick++) fissure.update();

      expect(victim.stats.health.value).toBe(100 - R_DAMAGE);
    });
  });
});
