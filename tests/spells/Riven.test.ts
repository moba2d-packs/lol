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
import {
  Q_CHARGES,
  Q_CHARGE_GAP_MS,
  Q_DAMAGE,
  Q_DAMAGE_FINAL,
  Q_LEAP_HEIGHT,
  Q_SLAM_RADIUS,
  Q_STEP,
  Q_STEP_FINAL,
  Q_WINDOW_MS,
  Riven_Q_Leap,
} from '../../spells/Riven_Q';
import Riven_Q from '../../spells/Riven_Q';
import { R_DAMAGE, R_DAMAGE_MAX, R_DURATION_MS, R_EXECUTE_THRESHOLD } from '../../spells/Riven_R';
import Riven_R, { Riven_R_WindSlash } from '../../spells/Riven_R';
const __api = buildTestApi();
const { Airborne } = __api.buffs;
type AttackableUnit = InstanceType<typeof __api.units.AttackableUnit>;

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  // regen would drift the exact-damage assertions below by a fraction per update
  result.stats.healthRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

/** A hand-built cast context: createGame's createSpellContext returns undefined. */
function contextFor(caster: AttackableUnit, dx: number, dy: number) {
  return {
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    origin: { x: caster.position.x, y: caster.position.y },
    cursorWorld: { x: caster.position.x + dx, y: caster.position.y + dy },
    direction: { x: Math.sign(dx), y: Math.sign(dy) },
  } as any;
}

/** The leap the newest cast spawned, still in the pending queue. */
function findLeap(game: TestGame): Riven_Q_Leap {
  const pending = game.objectManager._objectToBeAdd as unknown[];
  for (let i = pending.length - 1; i >= 0; i--) {
    const candidate = pending[i];
    if (candidate instanceof Riven_Q_Leap) return candidate;
  }
  throw new Error('no Riven_Q_Leap was spawned');
}

/**
 * Play the leap out: the object is added, she travels, the dash ends. The third
 * charge pays out on the landing, so a test that only calls `onSpellCast` sees
 * nothing — that delay is the ability, not a gap in the test.
 */
function landLeap(game: TestGame, owner: AttackableUnit, x: number, y = 0): Riven_Q_Leap {
  const leap = findLeap(game);
  leap.onAdded();
  owner.position.set(x, y);
  // The leap's own dash, not `buffs.find(Dash)`: a deactivated buff stays in the
  // list until the unit's next `update()`, and three casts leave three of them
  // there — `find` hands back the first, which is already spent.
  leap.dash?.deactivateBuff();
  leap.update();
  return leap;
}

function findWindSlash(game: TestGame): Riven_R_WindSlash {
  const pending = game.objectManager._objectToBeAdd as unknown[];
  for (const candidate of pending) {
    if (candidate instanceof Riven_R_WindSlash) return candidate;
  }
  throw new Error('no Riven_R_WindSlash was spawned');
}

describe('Riven', () => {
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
    (game as any).worldMouse = createVector(400, 0);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  function hasKnockup(victim: AttackableUnit): boolean {
    for (const buff of victim.buffs) {
      if (buff instanceof Airborne) return true;
    }
    return false;
  }

  it('spends three Q charges inside the window, and only the third knocks up', () => {
    const victim = unit(game, 250, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const q = new Riven_Q(owner);
    expect(q.stackCount).toBe(Q_CHARGES);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 1);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(hasKnockup(victim)).toBe(false);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 2);
    expect(victim.stats.health.value).toBe(100 - 2 * Q_DAMAGE);
    expect(hasKnockup(victim)).toBe(false);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(0);
    // The third is a leap: nothing lands until she does.
    expect(victim.stats.health.value).toBe(100 - 2 * Q_DAMAGE);
    expect(hasKnockup(victim)).toBe(false);

    landLeap(game, owner, Q_STEP_FINAL);
    expect(victim.stats.health.value).toBe(100 - 2 * Q_DAMAGE - Q_DAMAGE_FINAL);
    expect(hasKnockup(victim)).toBe(true);
  });

  it('refills the Q charges when the combo window lapses', () => {
    const q = new Riven_Q(owner);
    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 1);

    vi.stubGlobal('deltaTime', Q_WINDOW_MS - 1);
    q.onUpdate();
    expect(q.stackCount).toBe(Q_CHARGES - 1);

    vi.stubGlobal('deltaTime', 2);
    q.onUpdate();
    expect(q.stackCount).toBe(Q_CHARGES);
  });

  it('hits every unit in one Q slash exactly once', () => {
    const near = unit(game, 230, 'red');
    near.position.y = 40;
    const far = unit(game, 250, 'red');
    game.objectManager.addObject(near);
    game.objectManager.addObject(far);
    game.objectManager.update();

    new Riven_Q(owner).onSpellCast(contextFor(owner, 400, 0));

    expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(far.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('cuts a body she dashes straight through, however close it stands', () => {
    // The bug this pins: the fan lived at the arrival point, so a body standing
    // in front of her was *behind* the apex once she had dashed past it, 180°
    // off the wedge axis, and took nothing. The closer it stood the more surely
    // she whiffed. Reported from a real match.
    const hugging = unit(game, 40, 'red');
    const midway = unit(game, Q_STEP / 2, 'red');
    midway.position.y = 30;
    game.objectManager.addObject(hugging);
    game.objectManager.addObject(midway);
    game.objectManager.update();

    new Riven_Q(owner).onSpellCast(contextFor(owner, 400, 0));

    expect(hugging.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(midway.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('still opens the fan past the landing point, off the lane', () => {
    // Well clear of the corridor (110 off the axis, past the arrival), so this
    // one can only be the wedge.
    const wide = unit(game, 240, 'red');
    wide.position.y = 110;
    game.objectManager.addObject(wide);
    game.objectManager.update();

    new Riven_Q(owner).onSpellCast(contextFor(owner, 400, 0));

    expect(wide.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('cuts nothing behind the fan and off the lane', () => {
    const behind = unit(game, -160, 'red');
    game.objectManager.addObject(behind);
    game.objectManager.update();

    new Riven_Q(owner).onSpellCast(contextFor(owner, 400, 0));

    expect(behind.stats.health.value).toBe(100);
  });

  it('comes down on a body she took off next to, all the way round her', () => {
    // The leap is deliberately shorter than the slam is wide, so nothing she
    // was standing beside is left behind by the jump. `behind` is the case:
    // a wedge at the landing point could never have reached it.
    const hugging = unit(game, 40, 'red');
    const behind = unit(game, -30, 'red');
    game.objectManager.addObject(hugging);
    game.objectManager.addObject(behind);
    game.objectManager.update();

    const q = new Riven_Q(owner);
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));
    expect(hasKnockup(hugging)).toBe(false);

    landLeap(game, owner, Q_STEP_FINAL);

    expect(hasKnockup(hugging)).toBe(true);
    expect(hasKnockup(behind)).toBe(true);
    expect(Q_STEP_FINAL + 30).toBeLessThanOrEqual(Q_SLAM_RADIUS);
  });

  it('lifts her off the ground for the leap and puts her back down on it', () => {
    const q = new Riven_Q(owner);
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));

    const grounded = owner.stats.height.value;
    const leap = findLeap(game);
    leap.onAdded();
    expect(owner.stats.height.value).toBe(grounded + Q_LEAP_HEIGHT);

    landLeap(game, owner, Q_STEP_FINAL);
    expect(owner.stats.height.value).toBe(grounded);
  });

  it('does not finish the slam from a corpse', () => {
    const victim = unit(game, Q_STEP_FINAL, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const q = new Riven_Q(owner);
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));

    const before = victim.stats.health.value;
    // `isDead` is the death ledger, not the health pool — zeroing the number is
    // not dying, and a test that did that would pass on a live champion.
    owner.die({ killer: undefined, reviveAfter: 5_000 } as never);
    const leap = findLeap(game);
    leap.onAdded();
    leap.dash?.deactivateBuff();
    leap.update();

    expect(victim.stats.health.value).toBe(before);
    expect(leap.landed).toBe(true);
  });

  /**
   * Riven pays one cooldown for three casts, so the number on the field is not
   * comparable with any other Q on the shelf — the *rate* is. It shipped at
   * 3_500, the same as a single-cast Q, which let her cast at 2.6x everyone
   * else and read in play as "spam chiêu liên tục luôn".
   */
  it('casts at the pace of the shelf, not three times it', () => {
    const q = new Riven_Q(owner);
    const combo = Q_CHARGE_GAP_MS * (Q_CHARGES - 1) + q.coolDown;
    const perCast = combo / Q_CHARGES;
    // Zed and Nasus sit at 3.0s a cast, Yasuo at 3.5s.
    expect(perCast).toBeGreaterThan(2_800);
    expect(perCast).toBeLessThan(3_600);
  });

  /**
   * **Driven through `pressSpell`, not `onSpellCast`.**
   *
   * Every other Q test in this file calls `onSpellCast` directly, which is fine
   * for damage and charges and is *structurally blind* to the cooldown: none of
   * them touches `castSpec`, the runtime, or `currentCooldown`. That is how a
   * Riven who could Q without limit passed a green suite — the third swing was
   * charging the 313ms gap instead of the real cooldown, every time, and no
   * assertion in the repository looked.
   *
   * `Spell.runtime` resolves `castSpec` once on the opening press and freezes
   * it (`src/seams/castSpecFrozen.ts`), so a getter that read `charges` — 3 on
   * that first press — answered "not the final swing" for the rest of the
   * match. The spec is a constant now and `onSpellCast` sets the real cooldown
   * by hand, which is what `Ahri_R` has always done for the same three-dash
   * shape.
   */
  it('charges the gap for the first two swings and the real cooldown for the third', () => {
    const riven = unit(game, 0, 'blue');
    game.setPlayer(riven);
    const q = new Riven_Q(riven);

    const charged: number[] = [];
    for (let cast = 0; cast < 6; cast++) {
      expect(pressSpell(q, { at: { x: 400, y: 0 } }), `press ${cast + 1} was refused`).toBe(true);
      charged.push(Math.round(q.currentCooldown));
      for (let tick = 0; tick < 2_000 && q.currentCooldown > 0; tick++) q.update();
    }

    // Two combos' worth, so a cooldown that only behaves on the opening one
    // cannot pass either.
    expect(charged).toEqual([
      Q_CHARGE_GAP_MS,
      Q_CHARGE_GAP_MS,
      q.coolDown,
      Q_CHARGE_GAP_MS,
      Q_CHARGE_GAP_MS,
      q.coolDown,
    ]);
  });

  it('states its real cooldown in a spec that reads no live state', () => {
    // The spec is frozen on the opening press, so anything live in it describes
    // the spell as it was on that press for the rest of the match.
    const q = new Riven_Q(owner);
    const opening = q.castSpec.cooldown?.durationMs;
    q.onSpellCast(contextFor(owner, 400, 0));
    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 2);
    expect(q.castSpec.cooldown?.durationMs).toBe(opening);
    expect(opening).toBe(q.coolDown);
  });

  it('deals no damage on R first press and fires Wind Slash on the recast', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Riven_R(owner);
    r.onActivate();
    expect(victim.stats.health.value).toBe(100);

    r.onRecast(contextFor(owner, 400, 0));
    findWindSlash(game).update();
    expect(victim.stats.health.value).toBe(100 - R_DAMAGE);
  });

  it('ramps Wind Slash damage from R_DAMAGE at full health to R_DAMAGE_MAX at the threshold', () => {
    // Health ratios are chosen so the expected number is plain arithmetic on the
    // exported constants: full -> 24, three quarters -> the midpoint 36, at and
    // below half -> 48. Nothing here calls the spell's own ramp.
    expect(windSlashDamageAt(100)).toBe(R_DAMAGE);
    expect(windSlashDamageAt(75)).toBe((R_DAMAGE + R_DAMAGE_MAX) / 2);
    expect(windSlashDamageAt(R_EXECUTE_THRESHOLD * 100)).toBe(R_DAMAGE_MAX);
    expect(windSlashDamageAt(R_EXECUTE_THRESHOLD * 75)).toBe(R_DAMAGE_MAX);
  });

  it('ignores an R recast once the ultimate window has run out', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Riven_R(owner);
    r.onActivate();

    vi.stubGlobal('deltaTime', R_DURATION_MS);
    r.onUpdate();

    const pendingBefore = game.objectManager._objectToBeAdd.length;
    r.onRecast(contextFor(owner, 400, 0));
    expect(game.objectManager._objectToBeAdd.length).toBe(pendingBefore);
    expect(victim.stats.health.value).toBe(100);
  });
});

/**
 * One Wind Slash against one victim at `health` out of 100, in its own game so the
 * cone cannot reach the other cases' victims. Returns what actually landed.
 */
function windSlashDamageAt(health: number): number {
  const arena = createGame();
  const riven = unit(arena, 0, 'blue');
  arena.setPlayer(riven);
  const victim = unit(arena, 200, 'red');
  victim.stats.health.baseValue = health;
  arena.objectManager.addObject(victim);
  arena.objectManager.update();

  const before = victim.stats.health.value;
  const r = new Riven_R(riven);
  r.onActivate();
  r.onRecast(contextFor(riven, 400, 0));
  findWindSlash(arena).update();
  return before - victim.stats.health.value;
}
