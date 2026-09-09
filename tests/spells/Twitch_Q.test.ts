import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
} from '@moba2d/core/testing/spell';
import type { CastContext } from '@moba2d/core/content/types';
import Twitch_Q, { Twitch_Q_Object } from '../../spells/Twitch_Q';
import { POISON_PER_TICK } from '../../spells/Twitch_W';
import { buildTestApi } from '@moba2d/core/testing';

const api = buildTestApi();
const { Champion, AttackableUnit } = api.units;
const { DamageOverTime } = api.buffs;

const context: CastContext = Object.freeze({
  spellId: 'twitch-q',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 1, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

describe('Twitch Q stealth VFX does not survive death', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('drops the cloak the instant the caster dies mid-stealth, and stays dropped through a respawn elsewhere', () => {
    const game = createGame();
    const twitch = createUnit(game, 0, 'blue');
    twitch.animatedValues.displaySize = 20;
    const spawned: unknown[] = [];
    game.objectManager.addObject = ((object: unknown) =>
      spawned.push(object)) as typeof game.objectManager.addObject;

    const spell = new Twitch_Q(twitch);
    spell.press(context);

    // named rather than counted: a bare length silently asserts the whole kit,
    // so adding a buff to Ambush reads as a regression in an unrelated file
    const applied = twitch.buffs.map(buff => buff.constructor.name).sort();
    expect(applied).toEqual(['Invisible', 'Phasing', 'Speedup']);
    const cloak = spawned.find((o): o is Twitch_Q_Object => o instanceof Twitch_Q_Object)!;
    expect(cloak).toBeInstanceOf(Twitch_Q_Object);
    expect(cloak._cloaked).toBe(true);

    // Killed well inside the 4s stealth window — the old bug relied on the
    // buff's own duration to expire it, which only happened to work because
    // the base 5s respawn timer outlasts a 4s Q. Any death mid-stealth must
    // clear it immediately, not "eventually if the timer allows it".
    twitch.die({ reviveAfter: 5_000 });

    expect(cloak._cloaked).toBe(false);
    expect(twitch.buffs).toHaveLength(0);

    // Respawning elsewhere must not bring the cloak back to life.
    twitch.respawn();
    twitch.position.set(999, 999);
    expect(cloak._cloaked).toBe(false);
    expect(twitch.buffs).toHaveLength(0);
  });

  it('self-removes shortly after a mid-stealth death instead of parking on screen forever', () => {
    const game = createGame();
    const twitch = createUnit(game, 0, 'blue');
    twitch.animatedValues.displaySize = 20;
    const spawned: unknown[] = [];
    game.objectManager.addObject = ((object: unknown) =>
      spawned.push(object)) as typeof game.objectManager.addObject;

    const spell = new Twitch_Q(twitch);
    spell.press(context);
    const cloak = spawned.find((o): o is Twitch_Q_Object => o instanceof Twitch_Q_Object)!;

    twitch.die({ reviveAfter: 5_000 });

    // one big tick past both the smoke's own lifetime and the mote decay window
    vi.stubGlobal('deltaTime', cloak.lifeTime + 700);
    cloak.update();

    expect(cloak.toRemove).toBe(true);
  });
});


/**
 * **The rat's whole kit is a poison and a vanish, and core's stealth rule has
 * to let him use both.**
 *
 * A hit ends a stealth on both ends of it (`combat/StealthBreak.ts`), which is
 * right for a hit somebody is dealing and wrong for a poison that has been
 * ticking on its own clock since before he vanished. He is the champion the
 * carve-out was asked for, so it is asserted on him rather than only on core's
 * synthetic buff: W the enemy, Q away, and stay gone while they burn.
 */
describe('Twitch Q — his own poison does not give him away', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    // The burn paints flames, and they are rolled from p5's own maths.
    installSketchMathGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden while the poison he applied before vanishing keeps ticking', () => {
    const game = createGame();
    const twitch = new Champion({ game, teamId: 'blue' } as never) as never as InstanceType<
      typeof AttackableUnit
    >;
    twitch.position.set(0, 0);
    game.setPlayer(twitch as never);
    const victim = createUnit(game, 120, 'red');

    // The poison, applied while he is still visible — `Twitch_W_Object` builds
    // exactly this buff for every body standing in the puddle.
    const poison = new DamageOverTime(5_000, twitch, victim);
    poison.damagePerTick = POISON_PER_TICK;
    poison.tickInterval = 100;
    victim.addBuff(poison);

    // …and only then the vanish.
    expect(new Twitch_Q(twitch).press(context)).toBe(true);
    twitch.updateBuffs();
    expect(twitch.isStealthed, 'Q did not hide him at all').toBe(true);

    const before = victim.stats.health.value;
    vi.stubGlobal('deltaTime', 300);
    victim.updateBuffs();
    vi.stubGlobal('deltaTime', 16);

    expect(victim.stats.health.value, 'the poison never ticked').toBeLessThan(before);
    twitch.updateBuffs();
    expect(twitch.isStealthed).toBe(true);
  });
});
