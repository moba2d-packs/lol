import type {
  AttackableUnit,
  BasicAttackHit,
  GameObjectRuntimeContext,
  StatAmp as StatAmpInstance,
} from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const EventType = api.enums.EventType;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Champion = api.units.Champion;
const Pet = api.units.Pet;
const dmgRange = api.text.dmgRange;
const tint = api.text.tint;

const SOURCE_LABEL = 'Chấn Thương Cùn';

/** Blunt, heavy impact — brown-red, distinct from Q's rust-green and W's electric blue. */
const BRUISE: [number, number, number] = [180, 62, 46];
const IRON: [number, number, number] = [96, 84, 78];

export const COOLDOWN_MS = 8_000;

/** How long the empowered swing stays armed. */
export const WINDOW_MS = 4_000;

export const BASE_BONUS_DAMAGE = 10;

/** What the bonus reaches at (or past) `MISSING_HEALTH_CAP` missing health. */
export const MAX_BONUS_DAMAGE = 26;

/** The record's own cap: the missing-health scaling stops adding past 70% missing. */
export const MISSING_HEALTH_CAP = 0.7;

export const BONUS_RANGE = 30;

/** A ratio, not an absolute number, so it survives the health-pool rescale untouched. */
export const MINION_MONSTER_MULTIPLIER = 1.4;

/** Radius of the shove around whoever got hit — the "sends the body flying" reach. */
export const CLEAVE_RADIUS = 90;

export const CLEAVE_DAMAGE_RATIO = 0.6;

/**
 * Blunt Force Trauma.
 *
 * Three cuts from `docs/abilities/drmundo/e.json`, all in the direction of
 * "the record's cost model does not fit this pack's identity split":
 *
 * 1. **No cost.** The record bills this in health same as Q and W, but the
 *    design brief scopes the health-cost identity to Q and W specifically —
 *    a bruiser that pays health on every single button, including the one
 *    that lets him keep fighting, stops being able to fight. `manaCost` is
 *    still zero rather than some invented mana pool: Dr. Mundo has none.
 * 2. **The passive bonus attack damage is gone.** This kit ships four files —
 *    Q, W, E, R — with no fifth passive slot to hang it from, and folding a
 *    permanent stat line into an active spell's tooltip would show a number
 *    the spell itself does not grant.
 * 3. **The corpse-fling is a burst, not a flight.** The record sends a dead
 *    minion or small monster travelling in a line, damaging everyone it
 *    passes through — full physics on a rescaled ~100 HP canvas would cost
 *    more geometry than the identity is worth. `CLEAVE_RADIUS` around the
 *    victim keeps the "hitting one thing hurts what's behind it" read
 *    without simulating a flying body.
 *
 * What is kept: the arm-then-swing shape (same engine idiom as `Sett_Q`), the
 * missing-health scaling that rewards fighting at low health — the exact
 * health Q and W's own costs put him at — and the minion/monster multiplier,
 * carried over unchanged because a ratio needs no rescaling.
 */
export default class DrMundo_E extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_drmundo_e');
  name = 'Đập Bầm Dập (DrMundo_E)';
  description =
    `Tăng cường đòn đánh thường tiếp theo trong <span class="time">${secs(WINDOW_MS)} giây</span>: ` +
    `+<span class="buff">${BONUS_RANGE}</span> tầm đánh và ${dmgRange(BASE_BONUS_DAMAGE, MAX_BONUS_DAMAGE, 'PHYSICAL', '', '-')} ` +
    `(càng ít máu, sát thương càng cao, tối đa khi mất ${pct(MISSING_HEALTH_CAP)}% máu). Gây ` +
    `${pct(MINION_MONSTER_MULTIPLIER)}% sát thương lên lính và quái rừng, và làm kẻ địch xung quanh mục tiêu ` +
    `trúng ${tint(`${pct(CLEAVE_DAMAGE_RATIO)}%`, 'PHYSICAL')} sát thương đó.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  private armed = false;
  private windowLeftMs = 0;
  private unhook: (() => void) | null = null;
  private amp: StatAmpInstance | null = null;
  private glow: DrMundo_E_Glow | null = null;

  get stackCount(): number | undefined {
    return this.armed ? 1 : undefined;
  }

  onSpellCast(): void {
    this.armed = true;
    this.windowLeftMs = WINDOW_MS;

    if (!this.unhook) {
      this.unhook = this.game.eventManager.on(EventType.ON_ATTACK_HIT, this.onAttackLanded);
    }

    if (this.amp && !this.amp.toRemove) this.amp.deactivateBuff();
    const amp = new StatAmp(WINDOW_MS, this.owner, this.owner);
    amp.stackId = 'drmundo_e_range';
    amp.name = 'Vung Búa';
    amp.bonuses = { attackRange: { baseBonus: BONUS_RANGE } };
    this.owner.addBuff(amp);
    this.amp = amp;

    if (!this.glow || this.glow.toRemove) {
      const glow = new DrMundo_E_Glow(this.owner, this);
      this.glow = glow;
      this.game.objectManager.addObject(glow);
    }
  }

  onUpdate(): void {
    if (this.windowLeftMs <= 0) return;
    this.windowLeftMs -= deltaTime;
    if (this.windowLeftMs <= 0) this.endWindow();
  }

  onRemoved(): void {
    super.onRemoved();
    this.endWindow();
  }

  private onAttackLanded = (hit: BasicAttackHit | undefined): void => {
    if (!hit || hit.attacker !== this.owner || !this.armed) return;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    this.armed = false;
    this.endWindow();

    const maxHealth = this.owner.stats.maxHealth.value;
    const missingFraction = maxHealth > 0 ? 1 - this.owner.stats.health.value / maxHealth : 0;
    const missingHealthScale = Math.min(missingFraction, MISSING_HEALTH_CAP) / MISSING_HEALTH_CAP;
    let bonus = BASE_BONUS_DAMAGE + (MAX_BONUS_DAMAGE - BASE_BONUS_DAMAGE) * missingHealthScale;

    const isLesser = !(victim instanceof Champion) && !(victim instanceof Pet);
    if (isLesser) bonus *= MINION_MONSTER_MULTIPLIER;

    victim.takeDamage(bonus, this.owner, 'PHYSICAL', SOURCE_LABEL);

    const splashDamage = bonus * CLEAVE_DAMAGE_RATIO;
    for (const enemy of nearbyEnemies(this.game, victim, CLEAVE_RADIUS)) {
      if (enemy === victim) continue;
      enemy.takeDamage(splashDamage, this.owner, 'PHYSICAL', SOURCE_LABEL);
    }

    this.game.objectManager.addObject(new DrMundo_E_Impact(this.owner, victim.position.copy()));
  };

  private endWindow(): void {
    this.windowLeftMs = 0;
    this.armed = false;
    if (this.glow) {
      this.glow.toRemove = true;
      this.glow = null;
    }
    if (this.unhook) {
      this.unhook();
      this.unhook = null;
    }
  }
}

function nearbyEnemies(
  game: GameObjectRuntimeContext,
  at: AttackableUnit,
  radius: number
): AttackableUnit[] {
  return game.objectManager.queryObjects({
    area: new Circle({ x: at.position.x, y: at.position.y, r: radius }),
    filters: [PredefinedFilters.canTakeDamageFromTeam(at.teamId)],
  }) as AttackableUnit[];
}

/**
 * The armed state, worn on the body: a wrapped forearm with veins standing out
 * — the "worn state is a thin stroke, never a fill" rule from the VFX
 * standard's noise budget, so Mundo stays visible underneath it.
 */
export class DrMundo_E_Glow extends SpellObject {
  age = 0;
  private spell: DrMundo_E;

  constructor(owner: AttackableUnit, spell: DrMundo_E) {
    super(owner);
    this.spell = spell;
    this.attachTo(owner);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
    if (!this.spell.stackCount) this.toRemove = true;
  }

  draw(): void {
    const pulse = 0.6 + 0.4 * sin(this.age / 110);
    const body = this.owner.animatedValues.displaySize * 0.5 || 27;

    push();
    translate(this.position.x, this.position.y);
    // one wrapped fist, forward of the body, rather than a ring that hides him
    const fx = body * 0.9;
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 220);
    strokeWeight(5);
    circle(fx, body * 0.15, 20);
    stroke(BRUISE[0], BRUISE[1], BRUISE[2], 140 + 100 * pulse);
    strokeWeight(2.5);
    circle(fx, body * 0.15, 26 + 3 * pulse);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(160);
  }
}

/** The swing landing: a heavy shockwave with cracks, on the victim, once. */
export class DrMundo_E_Impact extends SpellObject {
  lifeTime = 320;
  age = 0;
  radius = CLEAVE_RADIUS;
  private cracks: { angle: number; length: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    for (let i = 0; i < 8; i++) {
      this.cracks.push({ angle: random(0, TWO_PI), length: random(0.5, 1) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const grown = 1 - (1 - t) * (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);

    // the shove: one hard ring at the real splash radius
    noFill();
    stroke(BRUISE[0], BRUISE[1], BRUISE[2], 235 * fade);
    strokeWeight(7 * fade + 1);
    circle(0, 0, this.radius * 2 * grown);

    // cracks radiating from the point of impact — blunt trauma, not a cut
    stroke(IRON[0], IRON[1], IRON[2], 220 * fade);
    strokeWeight(3 * fade + 0.5);
    for (const crack of this.cracks) {
      const reach = this.radius * crack.length * grown;
      line(0, 0, cos(crack.angle) * reach, sin(crack.angle) * reach);
    }

    // dust burst right at the strike
    if (t < 0.4) {
      noStroke();
      fill(210, 200, 190, 160 * (1 - t / 0.4));
      circle(0, 0, 30 + 40 * t);
    }

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 30) * 2);
  }
}
