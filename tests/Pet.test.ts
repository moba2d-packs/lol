/**
 * The one caller, so "a pet is a unit" is proved end to end rather than only
 * on `Pet`'s own base-class tests (`@moba2d/core`'s own suite covers those —
 * `tests/game/combat/Pet.test.ts`). Hallucinate's clone used to be inert art
 * that walked around; it is a pet now, which means it fights and it can be
 * killed.
 *
 * Moved here from core (content-pack-and-repo-split batch 6 task 10, fix
 * round 1): each describe block below is a claim about one of *this pack's*
 * spells' own behaviour — Shaco W's hidden/targetable transitions, Jinx E's
 * chompers matching `docs/abilities/jinx/e.json`, Annie R's recast racing
 * its own cooldown state and the pet's scan interval — not about `Pet` in
 * general, so it belongs with the content it is a fact about.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildTestApi } from '@moba2d/core/testing';
import { createGame, createUnit, installSpellObjectGlobals, pressSpell } from '@moba2d/core/testing/spell';
import Shaco_R, { Shaco_R_Clone } from '../spells/Shaco_R';
import { ARM_TIME_MS } from '../spells/Shaco_W';
import Shaco_W, { ATTACK_DAMAGE, FEAR_RANGE, Shaco_W_Box, Shaco_W_Bullet_Object } from '../spells/Shaco_W';
import { CHOMPED_STACK_ID, LAND_TIME_MS, ARM_TIME_MS as CHOMPER_ARM_MS } from '../spells/Jinx_E';
import Jinx_E, { Jinx_E_Chomper } from '../spells/Jinx_E';
import Annie_R from '../spells/Annie_R';

const __api = buildTestApi();
const { Pet, Champion } = __api.units;
type Champion = InstanceType<typeof __api.units.Champion>;
// `Pet.ts`'s own scan cadence — not reachable through `ContentApi.units`
// (a module-level constant, not a static on the class), so restated as a
// literal. Only ever used to advance `deltaTime` past one scan tick, never
// asserted against, so a stale copy could only make this test wait longer
// than necessary, not pass when it should fail.
const PET_SCAN_INTERVAL_MS = 250;


// Both classes are named as bare types below (`let box: Shaco_W_Box`) as well
// as constructed — `const Shaco_W_Box = Shaco_W_Box` only binds
// the value, so the type needs its own alias off the factory's return type.

installSpellObjectGlobals();

/**
 * The one caller, so "a pet is a unit" is proved end to end rather than only
 * on the base class. Hallucinate's clone used to be inert art that walked
 * around; it is a pet now, which means it fights and it can be killed.
 */
describe('Shaco R summons a real pet', () => {
  it('puts a fighting, expiring Pet into the world', () => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    const enemy = createUnit(game, 150, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;
    (game as unknown as { worldMouse: unknown }).worldMouse = enemy.position.copy();

    const spell = new Shaco_R(shaco);
    // The sanctioned way to drive a cast in a test — spell-runtime-drive-seam
    // bans reaching for `.onSpellCast()` directly. See that seam's own doc
    // comment (`src/seams/spellRuntimeDrive.ts`).
    pressSpell(spell, { at: enemy.position });

    const clone = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is InstanceType<typeof Pet> => object instanceof Pet
    );
    expect(clone, 'the clone is a Pet, not a SpellObject').toBeTruthy();
    expect(clone!.teamId).toBe(shaco.teamId);
    expect(clone!.targetable).toBe(true); // killable, unlike a shroom

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    clone!.update();
    vi.stubGlobal('deltaTime', 16);
    expect(clone!.basicAttack.target).toBe(enemy);
  });
});

/**
 * The rule a trap lives or dies by: while it is hidden it is not a target.
 * `Invisible` alone only hides the body — the box stayed in every
 * `canTakeDamageFromTeam` query, so it could be shot out of the air before it
 * ever triggered, which is no trap at all.
 */
describe('a hidden pet cannot be picked or hit', () => {
  const placeBox = () => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    pressSpell(new Shaco_W(shaco), { at: shaco.position });
    const box = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Shaco_W_Box => object instanceof Shaco_W_Box
    );
    return { game, shaco, box: box! };
  };

  const arm = (box: Shaco_W_Box) => {
    vi.stubGlobal('deltaTime', ARM_TIME_MS + 50);
    box.update();
    vi.stubGlobal('deltaTime', 16);
    // Status flags settle on the frame *after* the buff lands: the buff loop
    // that folds `statusFlagsToDisable` into the unit runs at the top of
    // `AttackableUnit.update`, and `setHidden` happens below it. One frame of
    // lag on a trap that arms over a second is not worth special-casing, but
    // it is worth stating.
    box.update();
  };

  it('is targetable while it is still being placed, and not once it hides', () => {
    const { box } = placeBox();

    expect(box.hidden).toBe(false);
    expect(box.targetable).toBe(true);

    arm(box);

    expect(box.hidden).toBe(true);
    expect(box.targetable).toBe(false);
  });

  it('becomes a killable body the moment it pops out', () => {
    const { game, box } = placeBox();
    arm(box);

    const victim = createUnit(game, 10, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    box.update();
    box.update(); // the same one-frame settle, in the other direction

    expect(box.triggered).toBe(true);
    expect(box.hidden).toBe(false);
    expect(box.targetable).toBe(true);
    // ...and the fear went out with the reveal, in the same call.
    expect(victim.buffs.length).toBeGreaterThan(0);
  });
});

/**
 * Read off `docs/abilities/jinx/e.json`, because the first pass was written
 * from memory and got three things wrong: chompers are not stealthed, they do
 * not attack, and a champion can only be caught by one of them.
 */
describe('Flame Chompers match the imported ability data', () => {
  const throwChompers = () => {
    const game = createGame();
    const jinx = createUnit(game, 0, 'blue');
    (game as unknown as { worldMouse: unknown }).worldMouse = jinx.position.copy();
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    pressSpell(new Jinx_E(jinx), { at: jinx.position });
    const chompers: Jinx_E_Chomper[] = [];
    for (const object of game.objectManager._objectToBeAdd) {
      // `Array.prototype.filter` cannot narrow here — see CLAUDE.md.
      if (object instanceof Jinx_E_Chomper) chompers.push(object);
    }
    return { game, jinx, chompers };
  };

  const arm = (chomper: Jinx_E_Chomper) => {
    vi.stubGlobal('deltaTime', LAND_TIME_MS + CHOMPER_ARM_MS + 50);
    chomper.update();
    vi.stubGlobal('deltaTime', 16);
  };

  it('lands three of them, in plain sight', () => {
    const { chompers } = throwChompers();

    expect(chompers).toHaveLength(3);
    for (const chomper of chompers) {
      arm(chomper);
      chomper.update();
      expect(chomper.hidden, 'chompers are visible, not stealthed').toBe(false);
      expect(chomper.targetable).toBe(true);
    }
  });

  it('bites a champion, and only the first chomper does', () => {
    const { game, jinx, chompers } = throwChompers();
    const victim = new Champion({ game, position: jinx.position.copy(), teamId: 'red' });
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    for (const chomper of chompers) arm(chomper);
    for (const chomper of chompers) chomper.update();

    const roots = victim.buffs.filter(buff => buff.stackId === CHOMPED_STACK_ID);
    expect(roots).toHaveLength(1);
    expect(chompers.filter(chomper => chomper.bitten)).toHaveLength(1);
  });

  it('never orders an attack — a chomper is a trap, not a fighter', () => {
    const { game, jinx, chompers } = throwChompers();
    const victim = new Champion({ game, position: jinx.position.copy(), teamId: 'red' });
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const chomper = chompers[0];
    arm(chomper);
    chomper.update();

    expect(chomper.basicAttack.target).toBeFalsy();
  });
});

/**
 * The recast half of a summon. Both bugs here were invisible from the outside
 * — the pet takes one step and stops — and neither was in the pet's movement
 * code:
 *
 *   1. `Annie_R` went to COOLDOWN after summoning, and the runtime rejects a
 *      press in COOLDOWN *before* `checkCastCondition` runs. Every R press
 *      while Tibbers was out was thrown away before the move order was read.
 *   2. The pet's own 250ms target scan owns movement while it holds a target
 *      (`BasicAttackController` writes `destination` every frame), so it
 *      overwrote the order as soon as anything was in aggro range.
 */
describe('a summoned pet obeys the recast', () => {
  const summonTibbers = () => {
    const game = createGame();
    const annie = createUnit(game, 0, 'blue');
    game.setPlayer(annie); // the attack path reads `game.player` for its reticle
    (game as unknown as { worldMouse: unknown }).worldMouse = createVector(300, 0);
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    const spell = new Annie_R(annie);
    spell.press({
      spellId: 'annie-r',
      activationId: 'a',
      startedAtMs: 0,
      caster: annie,
      origin: { x: 0, y: 0 },
      cursorWorld: { x: 300, y: 0 },
      direction: { x: 1, y: 0 },
    } as never);
    return { game, annie, spell, tibbers: spell.tibbers! };
  };

  it('leaves the key live while the pet is out, instead of going on cooldown', () => {
    const { spell, tibbers } = summonTibbers();

    expect(tibbers).toBeTruthy();
    expect(spell.currentCooldown).toBe(0);
  });

  it('walks the whole way to the point rather than one step', () => {
    const { tibbers } = summonTibbers();
    const target = createVector(900, 0);

    tibbers.commandTo(target);
    expect(tibbers.underOrders).toBe(true);

    // Many frames of its own update loop: the order has to survive all of them.
    for (let i = 0; i < 20; i++) tibbers.update();

    expect(tibbers.underOrders, 'still walking, order intact').toBe(true);
    expect(tibbers.destination.x).toBeCloseTo(target.x, 5);
  });

  it('keeps the order even with an enemy inside its aggro radius', () => {
    const { game, tibbers } = summonTibbers();
    const enemy = createUnit(game, 40, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

    tibbers.commandTo(createVector(900, 0));
    vi.stubGlobal('deltaTime', 300); // past the scan interval
    tibbers.update();
    vi.stubGlobal('deltaTime', 16);

    expect(tibbers.basicAttack.target, 'the order outranks the scan').toBeFalsy();
    expect(tibbers.destination.x).toBeCloseTo(900, 5);
  });

  it('hands control back once it arrives', () => {
    const { game, tibbers } = summonTibbers();
    const enemy = createUnit(game, 40, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

    tibbers.commandTo(createVector(900, 0));
    tibbers.position.set(900, 0); // walked there
    vi.stubGlobal('deltaTime', 300);
    tibbers.update();
    tibbers.update();
    vi.stubGlobal('deltaTime', 16);

    expect(tibbers.underOrders).toBe(false);
    expect(tibbers.basicAttack.target).toBe(enemy);
  });
});

/**
 * The disguise.
 *
 * A decoy that reads as a summon is a decoy nobody has ever been fooled by:
 * the enemy reads the bar before they read the body, and a narrow badge with a
 * lifetime clock ticking under it says "fake" from across the screen.
 * `Pet.disguisedAsChampion` hands back the champion frame; the numbers drawn
 * inside that frame have to be copied here, because only this spell knows who
 * is being impersonated.
 */
describe("Shaco R's clone is dressed as Shaco, not as a summon", () => {
  const summonClone = (dress: (shaco: Champion) => void = () => {}) => {
    const game = createGame();
    const shaco = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    dress(shaco);

    pressSpell(new Shaco_R(shaco), { at: shaco.position });
    const clone = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Shaco_R_Clone => object instanceof Shaco_R_Clone
    );
    return { game, shaco, clone: clone! };
  };

  it('wears the champion frame rather than the summon badge', () => {
    const { clone } = summonClone();

    expect(clone.disguisedAsChampion).toBe(true);
  });

  it('copies the pool the bar is drawn from, at the fill its champion is on', () => {
    // Tick marks are drawn off `maxHealth` and the bar is filled off health, so
    // a stock pet's 100/100 beside a hurt champion's 210/640 is two different
    // pictures before anybody looks at the bodies.
    const { shaco, clone } = summonClone(source => {
      source.stats.maxHealth.baseValue = 640;
      source.stats.health.baseValue = 210;
    });

    expect(clone.stats.maxHealth.value).toBe(shaco.stats.maxHealth.value);
    expect(clone.stats.health.value).toBe(shaco.stats.health.value);
  });

  it('swings the way its champion swings, so its first attack does not give it away', () => {
    const { clone } = summonClone(source => {
      source.stats.attackRange.baseValue = 120;
      source.stats.attackDamage.baseValue = 47;
    });

    expect(clone.stats.attackRange.value).toBe(120);
    expect(clone.stats.attackDamage.value).toBe(47);
  });

  it('prints its summoner’s score in the frame’s score box', () => {
    const { shaco, clone } = summonClone();

    expect(clone.score).toBe(shaco.score);
  });
});

/**
 * **A summon's damage is its summoner's ability damage.**
 *
 * Reported against this box: the tooltip promises `7 (+n)` — `Spell`
 * rescales a `damage` span by the champion who owns the ability — and the
 * bolts landed for a flat 7 however much ability power Shaco had bought.
 * Two separate reasons, both in core and both silent: the box is the unit
 * *dealing* the hit and it owns nothing, and nothing stamped an attribution
 * on a pet, so `abilityPowerScales()` answered no and the amplifier was never
 * reached at all. `@moba2d/core`'s `tests/game/combat/Pet.test.ts` holds both
 * halves on the base class; this is the ability it was reported on.
 *
 * Driven through `objectManager.update()` rather than `box.update()`, and that
 * is the point rather than a detail: the attribution a bolt is born with is the
 * one the manager brackets its summoner's update in. A test that called the
 * pet's `update()` by hand would be testing a path the game never takes.
 */
describe('the jester box hits for what its tooltip promises', () => {
  const fireOneVolley = (abilityPower: number) => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    shaco.stats.abilityPower.baseValue = abilityPower;
    game.setPlayer(shaco as never);
    (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();

    const victim = createUnit(game, FEAR_RANGE / 2, 'red');
    victim.stats.maxHealth.baseValue = 500;
    victim.stats.health.baseValue = 500;
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    pressSpell(new Shaco_W(shaco), { at: shaco.position });

    // Arm and trigger: one long tick to reach ARM_TIME_MS, then ordinary ones
    // for the reveal, the volley and the bolt's flight.
    vi.stubGlobal('deltaTime', ARM_TIME_MS + 50);
    game.objectManager.update();
    game.objectManager.update();
    vi.stubGlobal('deltaTime', 16);
    // Enough ticks for the volley to be fired and its bolt to cross the gap,
    // and comfortably fewer than the 500ms that would fire a second volley.
    for (let tick = 0; tick < 12; tick++) game.objectManager.update();

    const bolts = game.objectManager.objects.filter(
      (object: unknown) => object instanceof Shaco_W_Bullet_Object
    );
    return { victim, bolts, spent: 500 - victim.stats.health.value };
  };

  it('deals its authored number for a Shaco who has bought nothing', () => {
    const { bolts, spent } = fireOneVolley(0);

    expect(bolts.length, 'the box never fired').toBeGreaterThan(0);
    expect(spent).toBe(ATTACK_DAMAGE);
  });

  /**
   * The decoy's parting explosion is the same fact one level up: it names Shaco
   * as the attacker, so it always had the right stats, and it still did not
   * scale — the hit is dealt from `Pet.expire()`, and nothing stamped an
   * attribution on a pet, so `abilityPowerScales()` said no.
   */
  it('and the decoy’s parting explosion scales too', () => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    shaco.stats.abilityPower.baseValue = 1;
    game.setPlayer(shaco as never);
    (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();

    const victim = createUnit(game, 40, 'red');
    victim.stats.maxHealth.baseValue = 500;
    victim.stats.health.baseValue = 500;
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const spell = new Shaco_R(shaco);
    expect(pressSpell(spell, { at: { x: 40, y: 0 } })).toBe(true);

    // Run it out: the clone explodes when its own clock ends, through
    // `Pet.expire()`, inside the manager's attribution bracket.
    vi.stubGlobal('deltaTime', spell.cloneLifeTime + 100);
    game.objectManager.update();
    game.objectManager.update();
    vi.stubGlobal('deltaTime', 16);

    // 30 × (1 + 1.0), the figure `Shaco_R`'s description tags with `dmg`.
    expect(500 - victim.stats.health.value).toBe(60);
  });

  it('scales with Shaco’s ability power, not the box’s empty stat block', () => {
    // +100%: 7 × 2, by hand, which is exactly what the tooltip prints as
    // `7 (+7)`.
    const { spent } = fireOneVolley(1);

    expect(spent).toBe(ATTACK_DAMAGE * 2);
  });
});
