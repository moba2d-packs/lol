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

import Aatrox_Q, {
  Q_CASTS,
  Q_DAMAGE,
  Q_GAP_MS,
  Q_KNOCKUP_MS,
  Q_LANE_SWEET_FROM,
  Q_SWEET_DAMAGE,
  Q_WINDOW_MS,
  swingHit,
} from '../../spells/Aatrox_Q';
import Aatrox_W, {
  Aatrox_W_Chain,
  Aatrox_W_Tether,
  W_DAMAGE,
  W_SLOW_PERCENT,
  W_TETHER_MS,
  W_TETHER_RADIUS,
} from '../../spells/Aatrox_W';
import Aatrox_E, { Aatrox_E_Passive, E_DASH_DISTANCE, E_OMNIVAMP } from '../../spells/Aatrox_E';
import Aatrox_R, {
  Aatrox_R_Unleashed,
  R_DECAY_PER_TICK,
  R_DECAY_TICK_MS,
  R_DURATION_MS,
  R_HEALING_RECEIVED,
  R_SPEED_PERCENT,
  R_TAKEDOWN_EXTENSION_MS,
} from '../../spells/Aatrox_R';

const __api = buildTestApi();
const { Airborne, Dash, Fear, Slow } = __api.buffs;
const EventType = __api.enums.EventType;
type AttackableUnit = InstanceType<typeof __api.units.AttackableUnit>;

/** A body with a flat health pool: regen would drift the exact-damage sums below. */
function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
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

/** The newest object of `Kind` the last cast queued, still pending. */
function pending<T>(game: TestGame, Kind: new (...args: never[]) => T): T {
  const queue = game.objectManager._objectToBeAdd as unknown[];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] instanceof (Kind as never)) return queue[i] as T;
  }
  throw new Error(`nothing of that kind was spawned`);
}

describe('Aatrox', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Press, then let the gap (or the cooldown) run out, so the next press lands.
   * Answers with the stack badge **as the press left it** — waiting out the
   * real cooldown also lapses the combo window, which refills it.
   */
  function pressAndWait(
    spell: { update(): void; currentCooldown: number; stackCount?: number },
    at = { x: 400, y: 0 }
  ): number | undefined {
    expect(pressSpell(spell as never, { at })).toBe(true);
    const spent = spell.stackCount;
    for (let tick = 0; tick < 200 && spell.currentCooldown > 0; tick++) spell.update();
    return spent;
  }

  describe('The Darkin Blade', () => {
    it('escalates the three swings, and only the Sweetspot knocks up', () => {
      // x = 200 is past `Q_LANE_SWEET_FROM` on the first two shapes and inside
      // the *outer* ring of the third, so one body reads all three answers.
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Aatrox_Q(owner);
      expect(q.stackCount).toBe(Q_CASTS);

      expect(pressAndWait(q)).toBe(Q_CASTS - 1);
      expect(victim.stats.health.value).toBe(100 - Q_SWEET_DAMAGE[0]);
      expect(buffOf(victim, Airborne), 'the Sweetspot did not knock up').toBeTruthy();

      expect(pressAndWait(q)).toBe(Q_CASTS - 2);
      expect(victim.stats.health.value).toBe(100 - Q_SWEET_DAMAGE[0] - Q_SWEET_DAMAGE[1]);

      expect(pressAndWait(q)).toBe(0);
      // The third cast is a circle planted ahead of him: at 200 the body is
      // inside the swing but outside its Sweetspot, so this is the edge number.
      expect(victim.stats.health.value).toBe(
        100 - Q_SWEET_DAMAGE[0] - Q_SWEET_DAMAGE[1] - Q_DAMAGE[2]
      );
      // …and the combo is whole again, because waiting out the real cooldown
      // waits out the window as well.
      expect(q.stackCount).toBe(Q_CASTS);
    });

    it('leaves a body behind the swing alone', () => {
      const behind = unit(game, -140, 'red');
      game.objectManager.addObject(behind);
      game.objectManager.update();

      expect(pressSpell(new Aatrox_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(behind.stats.health.value).toBe(100);
    });

    it('reads the far edge of the first swing as the Sweetspot and the near edge as not', () => {
      expect(swingHit(0, Q_LANE_SWEET_FROM + 10, 0)).toBe('sweet');
      expect(swingHit(0, Q_LANE_SWEET_FROM - 10, 0)).toBe('edge');
      // Wide of the lane is a miss however far along it stands.
      expect(swingHit(0, Q_LANE_SWEET_FROM, 200)).toBe('miss');
    });

    it('refills the swings when the window lapses', () => {
      const q = new Aatrox_Q(owner);
      expect(pressSpell(q, { at: { x: 400, y: 0 } })).toBe(true);
      expect(q.stackCount).toBe(Q_CASTS - 1);

      vi.stubGlobal('deltaTime', Q_WINDOW_MS - 1);
      q.onUpdate();
      expect(q.stackCount).toBe(Q_CASTS - 1);

      vi.stubGlobal('deltaTime', 2);
      q.onUpdate();
      expect(q.stackCount).toBe(Q_CASTS);
    });

    /**
     * **Driven through `pressSpell`, not the hook.**
     *
     * `Spell.runtime` freezes `castSpec` on the opening press, so a spec that
     * answered "is this the last swing" from live state would answer for that
     * first press for the rest of the match — the real cooldown would never
     * start and the ability would be free. That is a bug a damage assertion is
     * structurally blind to; it shipped in this pack once, on Riven.
     */
    it('charges the gap for the first two swings and the real cooldown for the third', () => {
      const q = new Aatrox_Q(owner);
      const charged: number[] = [];
      for (let cast = 0; cast < 6; cast++) {
        expect(pressSpell(q, { at: { x: 400, y: 0 } }), `press ${cast + 1} was refused`).toBe(true);
        charged.push(Math.round(q.currentCooldown));
        for (let tick = 0; tick < 2_000 && q.currentCooldown > 0; tick++) q.update();
      }

      expect(charged).toEqual([Q_GAP_MS, Q_GAP_MS, q.coolDown, Q_GAP_MS, Q_GAP_MS, q.coolDown]);
    });

    it('knocks up for exactly as long as the record says', () => {
      const victim = unit(game, 200, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Aatrox_Q(owner), { at: { x: 400, y: 0 } })).toBe(true);
      expect(buffOf(victim, Airborne)?.duration).toBe(Q_KNOCKUP_MS);
    });
  });

  describe('Infernal Chains', () => {
    /** Fly the chain until it catches something (or gives up). */
    function throwChain(victim: AttackableUnit): Aatrox_W_Tether {
      game.objectManager.addObject(victim);
      game.objectManager.update();

      expect(pressSpell(new Aatrox_W(owner), { at: { x: 400, y: 0 } })).toBe(true);
      const chain = pending(game, Aatrox_W_Chain);
      for (let tick = 0; tick < 200 && !chain.toRemove; tick++) chain.update();
      return pending(game, Aatrox_W_Tether);
    }

    it('catches the first body it meets, slows it, and stakes the ground under it', () => {
      const victim = unit(game, 150, 'red');
      const tether = throwChain(victim);

      expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
      expect(buffOf(victim, Slow)?.percent).toBe(W_SLOW_PERCENT);
      // The stake is where the body *stood*, not where Aatrox stands: walking
      // away from it is the counter-play, and a stake on the caster would have
      // none.
      expect(Math.abs(tether.anchorX - victim.position.x)).toBeLessThan(20);
    });

    it('pays the second half and reels in a body that stayed inside the circle', () => {
      const victim = unit(game, 150, 'red');
      const tether = throwChain(victim);
      const anchorX = tether.anchorX;

      vi.stubGlobal('deltaTime', W_TETHER_MS);
      tether.update();

      expect(victim.stats.health.value).toBe(100 - W_DAMAGE * 2);
      const pull = buffOf(victim, Dash);
      expect(pull, 'nothing reeled the body in').toBeTruthy();
      expect(pull!.dashDestination?.x).toBe(anchorX);
    });

    it('pays nothing for a body that walked out of the circle', () => {
      const victim = unit(game, 150, 'red');
      const tether = throwChain(victim);
      const hit = victim.stats.health.value;

      victim.position.set(tether.anchorX + W_TETHER_RADIUS + 40, 0);
      vi.stubGlobal('deltaTime', W_TETHER_MS);
      tether.update();

      expect(victim.stats.health.value).toBe(hit);
      expect(buffOf(victim, Dash)).toBeUndefined();
    });

    it('drops off a corpse rather than reeling it in', () => {
      const victim = unit(game, 150, 'red');
      const tether = throwChain(victim);
      // `isDead` is the death ledger, not the health pool — zeroing the number
      // is not dying, and a test that did that would pass on a live champion.
      victim.die({ killer: undefined, reviveAfter: 5_000 } as never);
      const hit = victim.stats.health.value;

      vi.stubGlobal('deltaTime', W_TETHER_MS);
      tether.update();

      expect(victim.stats.health.value).toBe(hit);
      expect(tether.toRemove).toBe(true);
    });
  });

  describe('Umbral Dash', () => {
    /**
     * The passive is the reason this ability was worth writing: it is a *stat*,
     * so every point of it is a heal core can see — a file that added health
     * back by hand would look the same and be invisible to the whole wound
     * shelf.
     */
    it('grants omnivamp without ever being cast, and only once', () => {
      const e = new Aatrox_E(owner);

      e.onUpdate();
      expect(owner.stats.omnivamp.value).toBeCloseTo(E_OMNIVAMP, 6);

      e.onUpdate();
      expect(live(owner).filter(buff => buff instanceof Aatrox_E_Passive)).toHaveLength(1);
    });

    it('dashes the distance on its own card', () => {
      const e = new Aatrox_E(owner);
      expect(pressSpell(e, { at: { x: 400, y: 0 } })).toBe(true);

      const dash = buffOf(owner, Dash);
      expect(dash, 'nothing moved him').toBeTruthy();
      expect(dash!.dashDestination?.x).toBeCloseTo(E_DASH_DISTANCE, 6);
    });
  });

  describe('World Ender', () => {
    it('unleashes all three bonuses on one buff row', () => {
      owner.stats.attackDamage.baseValue = 20;
      const baseSpeed = owner.stats.speed.value;

      expect(pressSpell(new Aatrox_R(owner))).toBe(true);

      const rows = live(owner).filter(buff => buff instanceof Aatrox_R_Unleashed);
      expect(rows, 'the ultimate should be one row, not three').toHaveLength(1);
      expect(owner.stats.healingReceived.value).toBeCloseTo(R_HEALING_RECEIVED, 6);
      expect(owner.stats.attackDamage.value).toBeGreaterThan(20);
      expect(owner.stats.speed.value).toBeCloseTo(baseSpeed * (1 + R_SPEED_PERCENT), 6);
    });

    it('drains the movement bonus as the form runs', () => {
      expect(pressSpell(new Aatrox_R(owner))).toBe(true);
      const unleashed = buffOf(owner, Aatrox_R_Unleashed)!;
      const opening = owner.stats.speed.value;

      vi.stubGlobal('deltaTime', R_DECAY_TICK_MS);
      unleashed.update();

      expect(unleashed.speedPercent).toBeCloseTo(R_SPEED_PERCENT * (1 - R_DECAY_PER_TICK), 6);
      expect(owner.stats.speed.value).toBeLessThan(opening);
    });

    it('scatters what is small enough to run and leaves champions standing', () => {
      const minion = unit(game, 120, 'red');
      const champion = unit(game, 140, 'red');
      champion.killCredit = 'champion';
      game.objectManager.addObject(minion);
      game.objectManager.addObject(champion);
      game.objectManager.update();

      expect(pressSpell(new Aatrox_R(owner))).toBe(true);

      expect(buffOf(minion, Fear), 'the minion should have run').toBeTruthy();
      expect(buffOf(champion, Fear), 'a duellist ultimate must not fear champions').toBeUndefined();
    });

    it('pushes the remaining time back up on a champion takedown', () => {
      const r = new Aatrox_R(owner);
      expect(pressSpell(r)).toBe(true);
      const unleashed = buffOf(owner, Aatrox_R_Unleashed)!;

      // Most of the way through: a third of the form left.
      unleashed.timeElapsed = R_DURATION_MS - 1_000;
      game.eventManager.emit(EventType.ON_DIE, {
        unit: owner,
        creditedTo: owner,
        credit: 'champion',
      });

      expect(unleashed.timeElapsed).toBe(R_DURATION_MS - R_TAKEDOWN_EXTENSION_MS);
    });

    it('ignores a minion kill, and stops listening once the form is gone', () => {
      const r = new Aatrox_R(owner);
      expect(pressSpell(r)).toBe(true);
      const unleashed = buffOf(owner, Aatrox_R_Unleashed)!;

      unleashed.timeElapsed = R_DURATION_MS - 1_000;
      game.eventManager.emit(EventType.ON_DIE, {
        unit: owner,
        creditedTo: owner,
        credit: 'minion',
      });
      expect(unleashed.timeElapsed).toBe(R_DURATION_MS - 1_000);

      // And once the form has ended, a later takedown must not reach a buff
      // that is no longer there — the listener comes off with it.
      unleashed.deactivateBuff();
      r.onUpdate();
      const before = unleashed.timeElapsed;
      game.eventManager.emit(EventType.ON_DIE, {
        unit: owner,
        creditedTo: owner,
        credit: 'champion',
      });
      expect(unleashed.timeElapsed).toBe(before);
    });
  });
});
