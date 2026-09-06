import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi } from '@moba2d/core/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '@moba2d/core/testing/spell';

import Annie_R, { Annie_R_Passive, ANNIE_R_PENETRATION } from '../../spells/Annie_R';
import Darius_E, { Darius_E_Passive, DARIUS_E_PENETRATION } from '../../spells/Darius_E';
import Pantheon_R, { Pantheon_R_Passive, PANTHEON_R_PENETRATION } from '../../spells/Pantheon_R';
import { Garen_E_Object, SHRED_AT_HIT, SHRED_PERCENT as GAREN_SHRED } from '../../spells/Garen_E';
import Garen_W, { TENACITY } from '../../spells/Garen_W';
import Olaf_R, { DURATION as OLAF_DURATION, TENACITY as OLAF_TENACITY } from '../../spells/Olaf_R';
import Amumu_P, { AMP as AMUMU_AMP, Amumu_P_Curse, Amumu_P_CursedTouch } from '../../spells/Amumu_P';
import { Katarina_R_Lotus, KATARINA_R_RADIUS, KATARINA_R_WOUND_PERCENT } from '../../spells/Katarina_R';
import { Nasus_E_Object, SHRED_PERCENT as NASUS_SHRED } from '../../spells/Nasus_E';
import { Varus_E_Object, WOUND_PERCENT as VARUS_WOUND } from '../../spells/Varus_E';
import Vi_W, { W_SHRED } from '../../spells/Vi_W';
import { Singed_Q_Cloud } from '../../spells/Singed_Q';
import Singed_R, { ABILITY_POWER, POISON_WOUND_PERCENT } from '../../spells/Singed_R';

installSketchMathGlobals();
installSpellObjectGlobals();

const api = buildTestApi();
const { HealCut, StatAmp } = api.buffs;

/**
 * Every ability here shipped with a *substitute* for a mechanic the engine did
 * not have yet — a movement slow standing in for armour reduction, omnivamp
 * standing in for tenacity, a penetration passive simply left out. The engine
 * has all of them now, and `docs/abilities/<champion>/<slot>.json` — the wiki
 * text this pack imported — is what each one is checked against.
 *
 * They are in one file rather than scattered across eight because they are one
 * class of bug, found by one sweep, and the next sweep should have one place to
 * start from. What each ability *does* beyond this is still its own file's
 * business; this only asks whether the mechanic the record names is present.
 */

const live = (unit: { buffs: { toRemove: boolean }[] }) => unit.buffs.filter(b => !b.toRemove);

/** The armour share a shred buff on `unit` takes, or 0 if nothing is shredding. */
const armourShred = (unit: { buffs: unknown[] }): number => {
  for (const buff of unit.buffs as { toRemove: boolean; bonuses?: Record<string, { percentBonus?: number }> }[]) {
    if (buff.toRemove) continue;
    const share = buff.bonuses?.armor?.percentBonus;
    if (typeof share === 'number' && share < 0) return -share;
  }
  return 0;
};

const wounded = (unit: { buffs: unknown[] }): boolean =>
  (unit.buffs as { toRemove: boolean }[]).some(b => b instanceof HealCut && !b.toRemove);

describe('the passives that were never implemented', () => {
  let game: TestGame;
  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 16);
  });

  it.each([
    ['Annie R — magic penetration', Annie_R, Annie_R_Passive, 'magicPenetration', ANNIE_R_PENETRATION],
    ['Darius E — armor penetration', Darius_E, Darius_E_Passive, 'armorPenetration', DARIUS_E_PENETRATION],
    ['Pantheon R — armor penetration', Pantheon_R, Pantheon_R_Passive, 'armorPenetration', PANTHEON_R_PENETRATION],
  ])('%s is on without the ability being cast', (_name, SpellClass, PassiveClass, stat, share) => {
    const owner = createUnit(game, 0, 'blue');
    const spell = new (SpellClass as never as new (o: unknown) => { onUpdate: () => void })(owner);

    spell.onUpdate();

    const passives = live(owner).filter(b => b instanceof (PassiveClass as never));
    expect(passives, 'the record calls this a passive, so no cast should be needed').toHaveLength(1);
    expect((passives[0] as never as { bonuses: Record<string, { flatBonus: number }> }).bonuses[stat as string].flatBonus).toBe(share);

    // Armed once, not once a frame: a second pass must not stack a second copy.
    spell.onUpdate();
    expect(live(owner).filter(b => b instanceof (PassiveClass as never))).toHaveLength(1);
  });
});

describe('the passive that was never written at all', () => {
  let game: TestGame;
  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 16);
  });

  /**
   * `amumu/champion.json`: his attacks curse, and a cursed target "takes bonus
   * magic damage **from all sources**". Amumu shipped with four abilities and
   * no passive at all — `ChampionEntry.passive` existed in core and no
   * champion in this pack had ever used it.
   */
  it('Amumu curses on hit, and the curse amplifies anyone’s magic damage', () => {
    const amumu = createUnit(game, 0, 'blue');
    const ally = createUnit(game, 20, 'blue');
    const victim = createUnit(game, 80, 'red');
    game.setPlayer(amumu);

    expect(pressSpell(new Amumu_P(amumu))).toBe(true);
    const armed = live(amumu).find(b => b instanceof Amumu_P_CursedTouch) as never as {
      onHit: (hit: unknown) => void;
    };
    expect(armed, 'the passive armed nothing').toBeTruthy();

    armed.onHit({ attacker: amumu, victim, damage: 10, ranged: false, crit: false, echo: false });

    const curse = live(victim).find(b => b instanceof Amumu_P_Curse) as never as {
      modifyIncomingDamage: (d: number, a?: unknown, t?: string) => number;
    };
    expect(curse, 'the swing did not curse').toBeTruthy();

    // "from all sources" is the whole ability: an ally who has never heard of
    // Amumu gets the amplification too.
    expect(curse.modifyIncomingDamage(100, ally, 'MAGIC')).toBeCloseTo(100 * (1 + AMUMU_AMP), 6);
    // and only magic — otherwise it is a strictly better armour shred as well
    expect(curse.modifyIncomingDamage(100, ally, 'PHYSICAL')).toBe(100);
  });

  it('does not curse again on an echoed hit', () => {
    // A propagated swing is somebody else's item doubling his attack, and
    // `OnHit.ts` asks every effect to ignore one.
    const amumu = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 80, 'red');
    game.setPlayer(amumu);

    expect(pressSpell(new Amumu_P(amumu))).toBe(true);
    const armed = live(amumu).find(b => b instanceof Amumu_P_CursedTouch) as never as {
      onHit: (hit: unknown) => void;
    };
    armed.onHit({ attacker: amumu, victim, damage: 10, ranged: false, crit: false, echo: true });

    expect(live(victim).some(b => b instanceof Amumu_P_Curse)).toBe(false);
  });
});

describe('the substitutions', () => {
  let game: TestGame;
  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 16);
  });

  /** `garen/w.json`: "grants himself a shield and 60% tenacity". */
  it('Garen W grants tenacity, which used to be omnivamp because there was no such stat', () => {
    const garen = createUnit(game, 0, 'blue');
    game.setPlayer(garen);

    expect(pressSpell(new Garen_W(garen))).toBe(true);

    const amp = live(garen).find(
      b => b instanceof StatAmp && (b as never as { bonuses: Record<string, unknown> }).bonuses.tenacity
    ) as never as { bonuses: { tenacity: { baseBonus: number } } };
    expect(amp, 'nothing granted tenacity').toBeTruthy();
    expect(amp.bonuses.tenacity.baseBonus).toBe(TENACITY);
    expect(
      live(garen).some(b => (b as never as { bonuses?: Record<string, unknown> }).bonuses?.omnivamp),
      'the omnivamp stand-in is still there'
    ).toBe(false);
  });

  /**
   * `olaf/r.json`: he "becomes immune to disables" **for the duration**, not
   * at the moment of the press. Stripping on cast alone left a stun landing a
   * second later holding him for the remaining six seconds of his own
   * ultimate — the exact situation the ability exists to deny.
   */
  it('Olaf R keeps shrugging off crowd control after the cast, not only at it', () => {
    const olaf = createUnit(game, 0, 'blue');
    game.setPlayer(olaf);

    expect(pressSpell(new Olaf_R(olaf))).toBe(true);

    const amp = live(olaf).find(
      b => (b as never as { bonuses?: Record<string, unknown> }).bonuses?.tenacity
    ) as never as { bonuses: { tenacity: { baseBonus: number } }; duration: number };
    expect(amp, 'nothing granted tenacity').toBeTruthy();
    expect(amp.bonuses.tenacity.baseBonus).toBe(OLAF_TENACITY);
    // The whole ultimate, not a window at the front of it.
    expect(amp.duration).toBe(OLAF_DURATION);
  });

  /** `vi/w.json`: the third stack inflicts "20% armor reduction for 4 seconds". */
  it('Vi W tears armour on the third stack, where it used to slow', () => {
    const vi_ = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 80, 'red');
    game.setPlayer(vi_);
    const spell = new Vi_W(vi_);
    pressSpell(spell);

    for (let hit = 0; hit < 3; hit++) spell.onAttackLanded({ attacker: vi_, victim } as never);

    expect(armourShred(victim)).toBeCloseTo(W_SHRED, 6);
  });
});

describe('the missing debuffs', () => {
  let game: TestGame;
  beforeEach(() => {
    game = createGame();
    vi.stubGlobal('deltaTime', 16);
  });

  const facing = () => {
    const owner = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 40, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    return { owner, victim };
  };

  /** `nasus/e.json`: the fire inflicts "armor reduction, lingering for 1 second". */
  it('Nasus E tears armour off whoever stands in the fire', () => {
    const { owner, victim } = facing();
    const fire = new Nasus_E_Object(owner);

    vi.stubGlobal('deltaTime', 600);
    fire.update();

    expect(armourShred(victim)).toBeCloseTo(NASUS_SHRED, 6);
  });

  /** `varus/e.json`: desecrated ground slows "and inflict[s] them with Grievous Wounds". */
  it('Varus E wounds as well as slows', () => {
    const { owner, victim } = facing();
    const ground = new Varus_E_Object(owner);
    (ground as never as { landed: boolean }).landed = true;

    vi.stubGlobal('deltaTime', 500);
    ground.update();

    expect(wounded(victim), 'the slow shipped and the wound did not').toBe(true);
    const wound = victim.buffs.find(b => b instanceof HealCut) as never as { healCut: number };
    expect(wound.healCut).toBe(VARUS_WOUND);
  });

  /** `katarina/r.json`: each dagger "inflicts Grievous Wounds on the target for 3 seconds". */
  it('Katarina R wounds every target her daggers reach', () => {
    const { owner, victim } = facing();
    const lotus = new Katarina_R_Lotus(owner, KATARINA_R_RADIUS);

    vi.stubGlobal('deltaTime', 200);
    lotus.update();

    expect(wounded(victim)).toBe(true);
    expect(KATARINA_R_WOUND_PERCENT).toBeGreaterThan(0);
  });

  /**
   * `garen/e.json`: champions hit 6 times are inflicted with 25% armor
   * reduction. Both halves are asserted — the sixth hit tears, and the first
   * five do not, or "6 times" would be decoration.
   */
  it('Garen E tears armour only once the spin has landed enough hits', () => {
    const { owner, victim } = facing();
    const spin = new Garen_E_Object(owner);

    // Half-intervals on purpose: stepping exactly `interval` twice lands on
    // 5.999… and `Math.floor` reads it as the fifth hit, which is the test
    // lying about the code rather than the code being wrong.
    vi.stubGlobal('deltaTime', spin.interval * (SHRED_AT_HIT - 0.5));
    spin.update();
    expect(armourShred(victim), 'tore armour before the sixth hit').toBe(0);

    vi.stubGlobal('deltaTime', spin.interval);
    spin.update();
    expect(armourShred(victim)).toBeCloseTo(GAREN_SHRED, 6);
  });

  /**
   * `singed/r.json`: "During this time, Poison Trail additionally applies
   * Grievous Wounds" — so the poison alone must not, which is the half that
   * makes the ultimate worth pressing against a healer.
   */
  /**
   * `singed/r.json` lists what the potion grants and **ability power is first
   * on it**. This pack shipped health, speed and attack damage — three stats
   * that do nothing at all for the poison trail, which is where nearly all of
   * Singed's damage lives. So a damage-over-time champion's ultimate was the
   * one cast that did not touch his damage over time, and he fell off a cliff
   * the moment anyone bought health.
   */
  it('Singed’s potion is what makes his poison scale', () => {
    const { owner } = facing();
    game.setPlayer(owner);
    const before = owner.stats.abilityPower.value;

    pressSpell(new Singed_R(owner));

    expect(owner.stats.abilityPower.value).toBeCloseTo(before + ABILITY_POWER, 5);
    // A fraction, not points (core's `combat/Amplification.ts`) — so this is
    // the multiplier every ability he owns is worth while it burns.
    expect(ABILITY_POWER).toBeGreaterThan(0);
    expect(ABILITY_POWER).toBeLessThan(1);
  });

  it('Singed’s poison wounds only while Insanity Potion is up', () => {
    const { owner, victim } = facing();
    const cloud = new Singed_Q_Cloud(owner);

    // Over the cloud's own 400ms tick gate, or nothing happens at all and both
    // halves of this test pass for the wrong reason.
    vi.stubGlobal('deltaTime', 450);
    cloud.update();
    expect(wounded(victim), 'the poison wounded without the ultimate').toBe(false);

    game.setPlayer(owner);
    pressSpell(new Singed_R(owner));
    const second = new Singed_Q_Cloud(owner);
    second.update();
    expect(
      victim.buffs.some(b => b.constructor.name === 'DamageOverTime'),
      'the cloud never ticked, so the wound assertion below would be vacuous'
    ).toBe(true);

    expect(wounded(victim)).toBe(true);
    expect(POISON_WOUND_PERCENT).toBeGreaterThan(0);
  });
});
