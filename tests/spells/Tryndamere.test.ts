import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '@moba2d/core/testing/spell';
import { TRYNDAMERE_Q_AD_BONUS_MAX, TRYNDAMERE_Q_BASE_HEAL, TRYNDAMERE_Q_MAX_HEAL, TRYNDAMERE_Q_MISSING_HEALTH_HEAL, TRYNDAMERE_Q_STACK_ID } from '../../spells/Tryndamere_Q';
import Tryndamere_Q from '../../spells/Tryndamere_Q';
import { TRYNDAMERE_W_AD_REDUCTION, TRYNDAMERE_W_RADIUS, TRYNDAMERE_W_STACK_ID } from '../../spells/Tryndamere_W';
import Tryndamere_W from '../../spells/Tryndamere_W';
import { TRYNDAMERE_E_DAMAGE, Tryndamere_E_Object } from '../../spells/Tryndamere_E';
import Tryndamere_E from '../../spells/Tryndamere_E';
import { TRYNDAMERE_R_STACK_ID } from '../../spells/Tryndamere_R';
import Tryndamere_R from '../../spells/Tryndamere_R';
const __api = buildTestApi();
const { Dash, Slow, StatAmp } = __api.buffs;
type StatAmp = InstanceType<typeof __api.buffs.StatAmp>;
type Dash = InstanceType<typeof __api.buffs.Dash>;
type AttackableUnit = InstanceType<typeof __api.units.AttackableUnit>;

describe('Tryndamere', () => {
  let game: TestGame;
  let tryn: AttackableUnit;

  function build(x: number, teamId: string): AttackableUnit {
    const unit = createUnit(game, x, teamId);
    unit.position.set(x, 0);
    unit.collisionRadius = 10;
    unit.stats.size.baseValue = 20;
    unit.stats.speed.baseValue = 10;
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = 100;
    unit.stats.attackDamage.baseValue = 20;
    return unit;
  }

  function spawn(x: number, teamId: string): AttackableUnit {
    const unit = build(x, teamId);
    game.objectManager.addObject(unit);
    game.objectManager.update();
    return unit;
  }

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    tryn = build(0, 'blue');
    game.setPlayer(tryn);
    game.objectManager.addObject(tryn);
    game.objectManager.update();
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('Q heals and arms him harder the lower he is, and never past its cap', () => {
    tryn.stats.health.baseValue = 10; // 90 missing out of 100
    const q = new Tryndamere_Q(tryn);

    const expected = TRYNDAMERE_Q_BASE_HEAL + 90 * TRYNDAMERE_Q_MISSING_HEALTH_HEAL;
    expect(q.healAmount()).toBe(expected);
    q.onSpellCast();

    // `takeHeal` deals in whole points, so the pool gets the rounded figure
    expect(tryn.stats.health.value).toBe(10 + Math.round(expected));
    const rage = tryn.buffs.find(buff => buff.stackId === TRYNDAMERE_Q_STACK_ID) as StatAmp;
    expect(rage).toBeTruthy();
    expect(rage.bonuses.attackDamage?.flatBonus).toBe(Math.round(TRYNDAMERE_Q_AD_BONUS_MAX * 0.9));

    // and the gamble has a ceiling: one point of health does not heal for 45+
    tryn.stats.health.baseValue = 1;
    expect(q.healAmount()).toBe(TRYNDAMERE_Q_MAX_HEAL);
  });

  it('W blunts and slows everyone in earshot, and nobody beyond it', () => {
    const near = spawn(200, 'red');
    const far = spawn(TRYNDAMERE_W_RADIUS + 200, 'red');

    new Tryndamere_W(tryn).onSpellCast();

    const cower = near.buffs.find(buff => buff.stackId === TRYNDAMERE_W_STACK_ID) as StatAmp;
    expect(cower.bonuses.attackDamage?.flatBonus).toBe(-TRYNDAMERE_W_AD_REDUCTION);
    expect(near.stats.attackDamage.value).toBe(20 - TRYNDAMERE_W_AD_REDUCTION);
    expect(near.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(far.buffs.length).toBe(0);
  });

  it('E cuts each body it passes exactly once, however many frames it touches it', () => {
    const victim = spawn(60, 'red');
    new Tryndamere_E(tryn).onSpellCast();

    const spin = tryn.buffs.find(buff => buff instanceof Dash) as Dash;
    expect(spin).toBeTruthy();
    spin.onDashUpdate?.();
    spin.onDashUpdate?.();
    spin.onDashUpdate?.();

    expect(victim.stats.health.value).toBe(100 - TRYNDAMERE_E_DAMAGE);
  });

  /** The whirl object, still in the pending queue right after the cast. */
  function findBlades(): Tryndamere_E_Object {
    for (const candidate of game.objectManager._objectToBeAdd as unknown[]) {
      if (candidate instanceof Tryndamere_E_Object) return candidate;
    }
    throw new Error('no Tryndamere_E_Object was spawned');
  }

  it('carries the whirl with him instead of leaving it where he cast it', () => {
    // `attachTo` before `addBuff` resolved nothing — the anchor buff was not on
    // him yet — so the blades detached on their first frame and played out at
    // the cast point while he dashed away. Reported from a real match.
    new Tryndamere_E(tryn).onSpellCast();
    const blades = findBlades();
    expect(blades.attachmentLost).toBe(false);

    tryn.position.set(120, 0);
    blades.update();

    expect(blades.spinning).toBe(true);
    expect(blades.position.x).toBe(120);
  });

  it('stops the whirl the moment the dash carrying it ends', () => {
    new Tryndamere_E(tryn).onSpellCast();
    const blades = findBlades();

    blades.update();
    expect(blades.spinning).toBe(true);

    const spin = tryn.buffs.find(buff => buff instanceof Dash) as Dash;
    spin.deactivateBuff();
    blades.update();

    expect(blades.spinning).toBe(false);
  });

  it('R makes him untouchable for its duration', () => {
    new Tryndamere_R(tryn).onSpellCast();

    const rage = tryn.buffs.find(buff => buff.stackId === TRYNDAMERE_R_STACK_ID);
    expect(rage).toBeTruthy();

    tryn.takeDamage(60, spawn(200, 'red'));
    expect(tryn.stats.health.value).toBe(100);
  });
});
