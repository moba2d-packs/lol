import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const SpellObject = api.SpellObject;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;
const tint = api.text.tint;

/**
 * Vọng Âm Luden — the mage's wave-clear, and the only splash in this shop
 * that a caster can buy without owning a single basic attack.
 *
 * Móc Sét Statikk chains, Rìu Tiamat cleaves, Cuồng Cung Runaan forks: three
 * ways to hit more than one body, all of them bought by a swing. This is the
 * same purchase for the person whose damage is a cast — every eight seconds
 * the next spell that lands throws an echo onto everything standing with the
 * target.
 *
 * ## The number is sized against this shop, not rescaled from the live item
 *
 * Live Luden's is 100 (+10% AP) magic on a ~2000-health pool — five percent
 * of a health bar, which on a 100-point pool is five damage and invisible. So
 * it is sized instead against the shop's own existing splash proc, **Móc Sét
 * Statikk** (70% of attack, ~14-20 to the target, chaining to three), and
 * against **Vĩnh Sương**'s 30: 12 to the target and 8 to each of three others
 * is 36 across four bodies, on an eight-second clock.
 *
 * ## It scales with the wearer's ability power, and it is the only item here
 * that says so
 *
 * The live item has always carried a ratio (100 **+10% AP**), and this one was
 * a pair of flat numbers: an echo that was worth exactly as much on the last
 * item as on the first, in the one shelf of the shop whose entire purpose is
 * making abilities hit harder. Reported as exactly that.
 *
 * The engine will not do it for us and that is deliberate: `economy/ItemShop`
 * switches `damageScalesWithAbilityPower` off for every item passive and
 * active, because most of this shop's procs already read the wearer's *attack*
 * damage and drawing from both stats at once would pay them twice. So the
 * scaling is written out here, as arithmetic, with its own ratio — which is
 * also how the source item states it, and it keeps the item honest against
 * `Item_StatikkShiv.ts` and the rest of the AD procs, which are untouched.
 *
 * **A share of the multiplier, not the whole of it** (`LUDENS_ABILITY_RATIO`).
 * `stats.abilityPower` here is a fraction that multiplies a *whole ability*, so
 * handing the echo all of it would make a shop item scale exactly as hard as
 * the spell that triggered it — the thing the source's 10% ratio is small
 * precisely to avoid.
 *
 * ## The clock is also the re-entry guard
 *
 * The echo is itself magic damage credited to the wearer, so it arrives
 * straight back at `onDamageDealt` below — the same trap
 * `Item_Liandry.ts`'s burn falls into. Here the fix costs nothing extra:
 * `startRearm` is called **before** the first `takeDamage`, so the re-entrant
 * call finds `rearmed` already false and returns. Core's rearm clock rather
 * than a hand-rolled timestamp, because it is the one that parks itself
 * across a death and a sell-and-rebuy (`Buff.rearmMsLeft`) — an echo that came
 * back armed every time the wearer respawned would be a different item.
 */

/** How long between echoes, however many spells land in between. */
export const LUDENS_COOLDOWN_MS = 8_000;

/** What the echo deals to the body that was actually hit. */
export const LUDENS_PRIMARY_DAMAGE = 12;

/** And to each other enemy standing with them. */
export const LUDENS_SPLASH_DAMAGE = 8;

/**
 * How much of the wearer's ability power the echo takes — half of it.
 *
 * See the header on why this is written here rather than left to the engine,
 * and why it is a share. At `+100%` ability power a 12 becomes an 18 and each
 * 8 becomes a 12: the echo grows with the build that bought it without ever
 * becoming the reason a mage buys the item.
 */
export const LUDENS_ABILITY_RATIO = 0.5;

/**
 * What the echo is worth out of this wearer, as a multiplier — `1` for a mage
 * who has bought nothing, which is every mage until they do.
 *
 * Floored at zero for the reason `combat/Amplification.ts` floors its own: an
 * ability-power suppression deep enough would otherwise turn the proc into a
 * heal. Exported so the test does not restate the arithmetic.
 */
export const ludensScale = (wearer: AttackableUnit): number => {
  const power = wearer.stats?.abilityPower?.value;
  if (!Number.isFinite(power)) return 1;
  return Math.max(0, 1 + LUDENS_ABILITY_RATIO * (power as number));
};

/** How many *others* it reaches. */
export const LUDENS_SPLASH_TARGETS = 3;

/** How far, measured from the victim rather than from the caster. */
export const LUDENS_SPLASH_RADIUS = 170;

export const LUDENS_STACK_ID = 'item_ludens';

export const LUDENS_SOURCE = 'Vọng Âm Luden';

/** How long the echo stays on screen. Inside the item noise budget. */
export const LUDENS_ECHO_MS = 320;

// Luden's own blue-violet: magic's hue, a shade cooler than Vĩnh Sương's
// arctic blue so the two mage procs are tellable apart in one scrum.
const ECHO: [number, number, number] = [150, 160, 255];

export class Item_Ludens_Echo extends Buff {
  name = LUDENS_SOURCE;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  onDamageDealt(_swung: number, _landed: number, victim: AttackableUnit, type: DamageType): void {
    if (type !== 'MAGIC') return;
    if (!this.rearmed) return;
    if (victim.isDead || victim.toRemove) return;
    if (victim.teamId === this.targetUnit.teamId) return;

    // Before the damage, not after: see the header — this is what stops the
    // echo echoing itself.
    this.startRearm(LUDENS_COOLDOWN_MS);

    const wearer = this.targetUnit;
    // One multiplier, read once, so the echo and its splash never disagree
    // about what the build is worth.
    const scale = ludensScale(wearer);
    victim.takeDamage(Math.round(LUDENS_PRIMARY_DAMAGE * scale), wearer, 'MAGIC', LUDENS_SOURCE);

    const others = this.othersAround(victim);
    for (const other of others) {
      other.takeDamage(Math.round(LUDENS_SPLASH_DAMAGE * scale), wearer, 'MAGIC', LUDENS_SOURCE);
    }

    this.game.objectManager.addObject(new Item_Ludens_Arc(wearer, victim, others));
  }

  /**
   * Who the echo reaches: hostiles standing around **the victim**, not around
   * the caster — the item punishes a clump, and the clump is wherever the
   * spell landed. Not vision-gated, for `Item_StatikkShiv.ts`'s reason: vision
   * gates acquisition, and this is a proc fanning out from a hit that already
   * landed.
   */
  private othersAround(victim: AttackableUnit): AttackableUnit[] {
    const found = this.game.objectManager.queryObjects({
      area: new api.utils.Quadtree.Circle({
        x: victim.position.x,
        y: victim.position.y,
        r: LUDENS_SPLASH_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.targetUnit.teamId)],
    }) as AttackableUnit[];

    const out: AttackableUnit[] = [];
    for (const unit of found) {
      if (unit === victim || unit === this.targetUnit) continue;
      out.push(unit);
      if (out.length === LUDENS_SPLASH_TARGETS) break;
    }
    return out;
  }
}

/**
 * The echo, drawn at exactly the reach it used: a ring on the victim that
 * opens out to `LUDENS_SPLASH_RADIUS`, and one straight thread to each body
 * it actually caught. The ring is the honest half — a player who can see how
 * far it went can decide whether to spread out — and the threads say who
 * paid, which the four damage numbers alone do not, since they land on four
 * different bars.
 */
export class Item_Ludens_Arc extends SpellObject {
  age = 0;
  victim: AttackableUnit;
  others: AttackableUnit[];

  constructor(owner: AttackableUnit, victim: AttackableUnit, others: AttackableUnit[]) {
    super(owner);
    this.victim = victim;
    this.others = others;
    this.position = victim.position.copy();
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= LUDENS_ECHO_MS) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / LUDENS_ECHO_MS, 0, 1);
    const fade = 1 - t;
    // Snap out, then hold: the ring has to reach its true edge early enough
    // to be read at all.
    const reach = LUDENS_SPLASH_RADIUS * (1 - (1 - t) * (1 - t));
    const [r, g, b] = ECHO;

    push();
    noFill();
    stroke(r, g, b, 220 * fade);
    strokeWeight(2);
    circle(this.position.x, this.position.y, reach * 2);
    strokeWeight(2.5);
    for (const other of this.others) {
      line(this.position.x, this.position.y, other.position.x, other.position.y);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((LUDENS_SPLASH_RADIUS + 40) * 2);
  }
}

export default class Item_Ludens extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_ludens_echo');
  name = 'Vọng Âm Luden (Item_Ludens)';
  description =
    `Nội tại: mỗi ${secs(LUDENS_COOLDOWN_MS)} giây, đòn phép kế tiếp phóng ra vọng âm gây` +
    ` ${dmg(LUDENS_PRIMARY_DAMAGE, 'MAGIC')} lên mục tiêu và` +
    ` ${dmg(LUDENS_SPLASH_DAMAGE, 'MAGIC')} lên tối đa ${LUDENS_SPLASH_TARGETS} kẻ địch gần đó.` +
    ` Cả hai con số ${tint(`tăng theo ${pct(LUDENS_ABILITY_RATIO)}% sức mạnh phép`)} của người mang.`;
  coolDown = 0;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: 0 },
    };
  }

  onSpellCast() {
    const echo = new Item_Ludens_Echo(0, this.owner, this.owner);
    echo.stackId = LUDENS_STACK_ID;
    echo.image = this.image;
    echo.sourceSpell = this;
    this.owner.addBuff(echo);
  }
}
