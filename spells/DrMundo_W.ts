import type { AttackableUnit, GameObjectRuntimeContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const Spell = api.Spell;
const Buff = api.buffs.Buff;
const BuffAddType = api.enums.BuffAddType;
const SpellObject = api.SpellObject;
const Champion = api.units.Champion;
const Monster = api.units.Monster;
const dmg = api.text.dmg;

const SOURCE_LABEL = 'Máy Sốc Tim';

/** Cool electric blue-white — the defibrillator, distinct from the toxic greens elsewhere in the kit. */
const SPARK: [number, number, number] = [140, 220, 255];
const CASING: [number, number, number] = [70, 78, 92];

export const COOLDOWN_MS = 10_000;

/** Paid in health, like every other cost in this kit — Dr. Mundo has no mana bar. */
export const HEALTH_COST = 8;

/** Same floor idiom as Soraka_W and DrMundo_Q: never cast down to nothing. */
export const MIN_HEALTH_RATIO = 0.12;

export const DURATION_MS = 2_000;

export const TICK_MS = 400;

export const TICK_DAMAGE = 4;

/** Rescaled from the record's 325: fits the 90-260 AoE band this canvas asks for. */
export const RADIUS = 150;

/** Share of every hit Mundo takes while charging, banked toward the payout below. */
export const STORE_RATIO = 0.6;

export const DETONATE_DAMAGE = 12;

/** Fraction of the bank paid out if the detonation only found minions. */
export const BASE_HEAL_RATIO = 0.5;

/** The record's own bonus: full payout if a champion or a monster was caught. */
export const CHAMPION_HEAL_RATIO = 1.0;

/** How long a zap flash lingers on the ring after each tick. */
const FLASH_MS = 200;

/**
 * Heart Zapper.
 *
 * The record charges for up to three seconds and can be recast early or left
 * to detonate automatically. That early-recast input is dropped here on
 * purpose: the engine's recast/channel forms are built for a channel that
 * roots the caster or a charge that grows with hold time, and Heart Zapper is
 * neither — Mundo keeps moving through the whole window in the real kit. Built
 * as one fixed-length buff instead: it always runs the rescaled two seconds
 * and always resolves the same way at the end, which keeps the "store damage,
 * pay it back" identity the design brief cares about without inventing a
 * cast form the rest of this ability does not actually need.
 *
 * `takeHeal` is the only door the payout uses — never hand-rolled arithmetic —
 * so the heal-cut and `healingReceived` seams this champion exists to argue
 * with both see it.
 */
export default class DrMundo_W extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_drmundo_w');
  name = 'Sốc Điện Tim (DrMundo_W)';
  description =
    `Sạc điện trong <span class="time">${secs(DURATION_MS)} giây</span>: mỗi ${secs(TICK_MS)} giây gây ` +
    `${dmg(TICK_DAMAGE, 'MAGIC')} cho kẻ địch gần đó, và tích trữ ` +
    `<span class="buff">${pct(STORE_RATIO)}%</span> sát thương Mundo nhận vào. Khi kết thúc, kích nổ gây thêm ` +
    `${dmg(DETONATE_DAMAGE, 'MAGIC')} quanh Mundo và hồi lại một phần sát thương đã hứng: ` +
    `bằng ${pct(BASE_HEAL_RATIO)}% lượng tích trữ (${pct(CHAMPION_HEAL_RATIO)}% nếu kích nổ trúng tướng địch hoặc quái lớn).`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  healthCost = HEALTH_COST;

  checkCastCondition(): boolean {
    return this.hasHealthToSpare;
  }

  onSpellCast(): void {
    const charge = new DrMundo_W_Charge(DURATION_MS, this.owner, this.owner);
    charge.stackId = 'drmundo_w_charge';
    charge.image = this.image;
    this.owner.addBuff(charge);

    const rig = new DrMundo_W_Object(this.owner, charge);
    rig.attachTo(this.owner, charge);
    this.game.objectManager.addObject(rig);
  }

  private get hasHealthToSpare(): boolean {
    const max = this.owner.stats.maxHealth.value;
    if (max <= 0) return false;
    return this.owner.stats.health.value > max * MIN_HEALTH_RATIO + this.healthCost;
  }
}

function nearbyEnemies(
  game: GameObjectRuntimeContext,
  unit: AttackableUnit,
  radius: number
): AttackableUnit[] {
  return game.objectManager.queryObjects({
    area: new Circle({ x: unit.position.x, y: unit.position.y, r: radius }),
    filters: [PredefinedFilters.canTakeDamageFromTeam(unit.teamId), PredefinedFilters.visibleTo(unit)],
  }) as AttackableUnit[];
}

/**
 * The mechanic, apart from the art: ticks damage while live, banks a share of
 * every hit Mundo takes, and pays the bank back the moment it ends — whether
 * that end is the timer or `deactivateBuff()` called early. `onDeactivate`
 * runs exactly once (`Buff.deactivateBuff` latches it), so the detonation
 * cannot double-fire.
 */
export class DrMundo_W_Charge extends Buff {
  name = 'Sạc Điện';
  description =
    `Tích <span class="buff">${pct(STORE_RATIO)}%</span> sát thương Mundo hứng vào; khi hết hiệu lực,` +
    ` nổ gây ${dmg(DETONATE_DAMAGE, 'MAGIC')} và hồi lại lượng đã tích.`;
  buffAddType = BuffAddType.REPLACE_EXISTING;

  /** Health banked so far, in already-mitigated points — what `onDeactivate` pays out. */
  banked = 0;
  /** `timeElapsed` at the last tick, so the attached rig can flash without its own clock. */
  lastZapAtMs = -Infinity;

  private tickTimer = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) {
      this.deactivateBuff();
      return;
    }

    this.tickTimer += deltaTime;
    while (this.tickTimer >= TICK_MS) {
      this.tickTimer -= TICK_MS;
      this.pulse();
    }
  }

  /** Every hit Mundo takes while this is live feeds the payout — not just what he deals. */
  onDamageTaken(_swung: number, landed: number): void {
    if (landed <= 0) return;
    this.banked += landed * STORE_RATIO;
  }

  private pulse(): void {
    this.lastZapAtMs = this.timeElapsed;
    for (const enemy of nearbyEnemies(this.game, this.sourceUnit, RADIUS)) {
      enemy.takeDamage(TICK_DAMAGE, this.sourceUnit, 'MAGIC', SOURCE_LABEL);
    }
  }

  onDeactivate(): void {
    let caughtBigTarget = false;
    for (const enemy of nearbyEnemies(this.game, this.sourceUnit, RADIUS)) {
      enemy.takeDamage(DETONATE_DAMAGE, this.sourceUnit, 'MAGIC', SOURCE_LABEL);
      if (enemy instanceof Champion || enemy instanceof Monster) caughtBigTarget = true;
    }

    const ratio = caughtBigTarget ? CHAMPION_HEAL_RATIO : BASE_HEAL_RATIO;
    const heal = this.banked * ratio;
    // The seam every heal in the game goes through — healingReceived and any
    // live heal-cut both apply here automatically, never in this file.
    if (heal > 0) this.sourceUnit.takeHeal(heal, this.sourceUnit);

    this.game.objectManager.addObject(
      new DrMundo_W_Detonation(this.sourceUnit, this.sourceUnit.position.copy())
    );
  }
}

/**
 * The rig itself: a ring drawn at the *real* damage radius (rule 1 of the VFX
 * standard — the reach it draws is the reach the ticks actually use), sparking
 * on every tick rather than glowing continuously, so a player watching from
 * across the fight can count the ticks landing same as Mundo can.
 */
export class DrMundo_W_Object extends SpellObject {
  private charge: DrMundo_W_Charge;

  constructor(owner: AttackableUnit, charge: DrMundo_W_Charge) {
    super(owner);
    this.charge = charge;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    if (this.charge.toRemove) this.toRemove = true;
  }

  draw(): void {
    const charge = this.charge;
    const left = charge.duration ? constrain(1 - charge.timeElapsed / charge.duration, 0, 1) : 0;
    const sinceZap = charge.timeElapsed - charge.lastZapAtMs;
    const flash = constrain(1 - sinceZap / FLASH_MS, 0, 1);

    push();
    translate(this.position.x, this.position.y);

    // the real reach of the tick, drawn plainly so it never has to be guessed
    noFill();
    stroke(SPARK[0], SPARK[1], SPARK[2], 70);
    strokeWeight(2);
    circle(0, 0, RADIUS * 2);

    // paddles held to the chest: casing plus two contact points
    noStroke();
    fill(CASING[0], CASING[1], CASING[2], 235);
    rectMode(CENTER);
    rect(0, -6, 26, 34, 4);
    fill(SPARK[0], SPARK[1], SPARK[2], 140 + 90 * flash);
    circle(-7, -10, 8);
    circle(7, -10, 8);

    // the zap itself: a jagged bolt from the casing outward, only while fresh
    if (flash > 0) {
      stroke(SPARK[0], SPARK[1], SPARK[2], 235 * flash);
      strokeWeight(2.5);
      for (let i = 0; i < 3; i++) {
        const a = -HALF_PI + (i - 1) * 0.7;
        const reach = 22 + flash * 20;
        const midX = cos(a) * reach * 0.5 + random(-3, 3);
        const midY = -6 + sin(a) * reach * 0.5 + random(-3, 3);
        line(0, -6, midX, midY);
        line(midX, midY, cos(a) * reach, -6 + sin(a) * reach);
      }
      noStroke();
      fill(255, 255, 255, 200 * flash);
      circle(0, -6, 14 * flash + 6);
    }

    // how much longer the charge holds
    noFill();
    stroke(30, 60, 90, 130);
    strokeWeight(4);
    circle(0, 0, 60);
    stroke(200, 235, 255, 235);
    strokeWeight(4);
    arc(0, 0, 60, 60, -HALF_PI, -HALF_PI + TWO_PI * left);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((RADIUS + 30) * 2);
  }
}

/** The detonation: one hard flash at the real burst radius, gone fast. */
export class DrMundo_W_Detonation extends SpellObject {
  lifeTime = 300;
  age = 0;

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const grown = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(SPARK[0], SPARK[1], SPARK[2], 235 * fade);
    strokeWeight(6 * fade + 1);
    circle(0, 0, RADIUS * 2 * grown);
    stroke(255, 255, 255, 200 * fade);
    strokeWeight(2);
    circle(0, 0, RADIUS * 1.6 * grown);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((RADIUS + 20) * 2);
  }
}
