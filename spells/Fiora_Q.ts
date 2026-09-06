import type { AttackableUnit, Buff, CastContext, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Dash = api.buffs.Dash;
const Speedup = api.buffs.Speedup;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;
const heal = api.text.heal;


/* -------------------------------------------------------------- Vitals

   Duelist's Dance lives in this file rather than in a passive slot of its
   own, because Lunge is what identifies one and Lunge is what usually
   triggers one. `Fiora_R` reaches in for the two exported helpers, exactly
   as `Riven_Q` reaches into `Riven_R` for its empowerment flag.
   ---------------------------------------------------------------------- */

/** How near she has to be for a Vital to appear, and to stay. */
export const VITAL_RADIUS = 420;

/** One quarter of a body — the record puts a Vital North, East, South or West. */
export const VITAL_ARC_DEG = 90;

/** The record's "1.75 seconds to become targetable", halved with everything else. */
export const VITAL_ARM_MS = 900;

export const VITAL_LIFE_MS = 8_000;

/** What triggering one is worth. True damage, exactly as the record has it. */
export const VITAL_DAMAGE = 12;

export const VITAL_HEAL = 10;

export const VITAL_SPEED = 0.3;

export const VITAL_SPEED_MS = 1_800;


export const Q_DASH = 130;

export const Q_DASH_SPEED = 20;

export const Q_DAMAGE = 20;

/** How far past the end of the dash the stab reaches. */
export const Q_STAB_RANGE = 95;

/** `docs/abilities/fiora/q.json`: "Stabbing a target reduces Lunge's cooldown by 50%." */
export const Q_STAB_REFUND = 0.5;

export const Q_MANA = 20;


const STEEL: [number, number, number] = [214, 220, 230];

const ROSE: [number, number, number] = [216, 88, 122];

const DUSK: [number, number, number] = [38, 30, 46];


/**
 * The Vital on a body: which quarter of it is open, and whether it is armed yet.
 *
 * A bare `Buff` — it grants no stat and sets no status flag, it is a *place* on
 * a body — so it writes its own sentence.
 */
export class Fiora_Vital extends BaseBuff {
  name = 'Điểm Yếu';
  stackId = 'fiora_vital';
  description = 'Một góc phần tư trên người đang hở. Fiora đánh từ hướng đó sẽ kích hoạt nó.';
  /** Which way the open quarter faces, in radians. */
  side = 0;
  /** Grand Challenge opens all four at once; then any direction counts. */
  allSides = false;
  private armedMs = 0;

  get armed(): boolean {
    return this.armedMs >= VITAL_ARM_MS;
  }

  onUpdate(): void {
    if (this.armedMs < VITAL_ARM_MS) this.armedMs += deltaTime;
  }

  /** Whether a blow arriving from `attacker` comes in through the opening. */
  opensTo(attacker: AttackableUnit): boolean {
    if (!this.armed) return false;
    if (this.allSides) return true;
    const heading = Math.atan2(
      attacker.position.y - this.targetUnit.position.y,
      attacker.position.x - this.targetUnit.position.x
    );
    let offAxis = heading - this.side;
    while (offAxis > Math.PI) offAxis -= Math.PI * 2;
    while (offAxis < -Math.PI) offAxis += Math.PI * 2;
    return Math.abs(offAxis) <= (VITAL_ARC_DEG * Math.PI) / 360;
  }
}


/** The live Vital on `unit`, whoever put it there. */
export function vitalOn(unit: AttackableUnit): Fiora_Vital | undefined {
  for (const buff of unit.buffs as Buff[]) {
    if (buff instanceof Fiora_Vital && !buff.toRemove) return buff;
  }
  return undefined;
}


/**
 * Fiora hit `victim` from somewhere. If that somewhere was the opening, the
 * Vital pays out and a new one is identified on the other side.
 *
 * Answers whether it triggered, so the ultimate can count how many of the four
 * she has taken.
 */
export function triggerVital(fiora: AttackableUnit, victim: AttackableUnit): boolean {
  const vital = vitalOn(victim);
  if (!vital || !vital.opensTo(fiora)) return false;

  victim.takeDamage(VITAL_DAMAGE, fiora, 'TRUE');
  fiora.takeHeal(VITAL_HEAL, fiora);

  const rush = new Speedup(VITAL_SPEED_MS, fiora, fiora);
  rush.stackId = 'fiora_vital_rush';
  rush.image = api.asset('spell_fiora_i');
  rush.percent = VITAL_SPEED;
  fiora.addBuff(rush);

  victim.game.objectManager.addObject(new Fiora_Vital_Burst(fiora, victim, vital.side));

  // Grand Challenge holds all four open for its whole duration; an ordinary
  // Vital is spent and the next one opens somewhere else.
  if (!vital.allSides) {
    vital.deactivateBuff();
    identifyVital(fiora, victim, vital.side + Math.PI / 2);
  }
  return true;
}


/** Open a quarter on `victim`, replacing whatever was there. */
export function identifyVital(
  fiora: AttackableUnit,
  victim: AttackableUnit,
  side: number
): Fiora_Vital {
  const vital = new Fiora_Vital(VITAL_LIFE_MS, fiora, victim);
  // Snapped to a quarter turn, because the record puts a Vital North, East,
  // South or West and a free angle would be unreadable at a glance.
  vital.side = Math.round(side / (Math.PI / 2)) * (Math.PI / 2);
  vital.image = api.asset('spell_fiora_i');
  victim.addBuff(vital);
  return vital;
}


export default class Fiora_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Dash;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_fiora_q');
  name = 'Lao Tới (Fiora_Q)';
  description =
    `Lướt <span>${Q_DASH}px</span> rồi đâm kẻ địch gần nhất, gây ${dmg(Q_DAMAGE, 'PHYSICAL')}. ` +
    `Đâm trúng thì <span class="buff">hoàn lại ${pct(Q_STAB_REFUND)}% hồi chiêu</span>. ` +
    `Nội tại: Fiora luôn nhìn ra một <span class="buff">Điểm Yếu</span> trên kẻ địch gần đó; ` +
    `đánh từ đúng hướng ấy gây thêm ${dmg(VITAL_DAMAGE, 'TRUE')}, hồi ` +
    `${heal(VITAL_HEAL, ' máu')} và cho cô ` +
    `<span class="buff">+${pct(VITAL_SPEED)}% tốc chạy</span> trong ` +
    `<span class="time">${secs(VITAL_SPEED_MS)} giây</span>.`;
  coolDown = 8_000;
  manaCost = Q_MANA;
  range = Q_DASH + Q_STAB_RANGE;

  onUpdate(): void {
    this.maintainPassive();
    this.watchVitals();
  }

  /** Her own swings trigger a Vital too, which is most of what the passive is. */
  private maintainPassive(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Fiora_Q_Duelist)) return;
    this.owner.addBuff(new Fiora_Q_Duelist(Infinity, this.owner, this.owner));
  }

  /**
   * One Vital, on the nearest enemy she can see, kept alive while she is near.
   *
   * Deliberately one rather than one per enemy: the record identifies Vitals on
   * "nearby enemy champions", and a quarter-circle drawn on every body in a
   * teamfight is unreadable — the ultimate is the ability that opens more.
   */
  private watchVitals(): void {
    if (!this.owner || this.owner.isDead) return;
    const nearest = this.nearestEnemy();
    if (!nearest) return;
    if (vitalOn(nearest)) return;
    // Away from Fiora, so the first one always asks her to walk round.
    const away = Math.atan2(
      nearest.position.y - this.owner.position.y,
      nearest.position.x - this.owner.position.x
    );
    identifyVital(this.owner, nearest, away);
  }

  nearestEnemy(): AttackableUnit | undefined {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(VITAL_RADIUS, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    let nearest: AttackableUnit | undefined;
    let closest = Infinity;
    for (const candidate of candidates) {
      const gap = Math.hypot(
        candidate.position.x - this.owner.position.x,
        candidate.position.y - this.owner.position.y
      );
      if (gap >= closest) continue;
      closest = gap;
      nearest = candidate;
    }
    return nearest;
  }

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const toX = this.owner.position.x + (aim.x / span) * Q_DASH;
    const toY = this.owner.position.y + (aim.y / span) * Q_DASH;

    if (Dash.CanDash(this.owner)) {
      const lunge = new Dash(800, this.owner, this.owner);
      lunge.dashDestination = createVector(toX, toY);
      lunge.dashSpeed = Q_DASH_SPEED;
      lunge.showTrail = false;
      // The stab happens where she *lands*, so it has to wait for the landing —
      // `onReachedDestination` rather than a stab resolved at the press.
      lunge.onReachedDestination = () => this.stab();
      this.owner.addBuff(lunge);
      return;
    }

    // Grounded: no dash, but the blade still goes in.
    this.stab();
  }

  /**
   * The thrust at the end of the lunge, at whatever is closest.
   *
   * A hit refunds half the cooldown, which is the ability's whole rhythm — a
   * Fiora who keeps finding a body keeps lunging.
   */
  stab(): void {
    const reach = effectiveRange(Q_STAB_RANGE, this.owner);
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: reach }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    let victim: AttackableUnit | undefined;
    let closest = Infinity;
    for (const candidate of candidates) {
      const gap = Math.hypot(
        candidate.position.x - this.owner.position.x,
        candidate.position.y - this.owner.position.y
      );
      if (gap >= closest) continue;
      closest = gap;
      victim = candidate;
    }
    if (!victim) return;

    victim.takeDamage(Q_DAMAGE, this.owner, 'PHYSICAL');
    triggerVital(this.owner, victim);
    this.currentCooldown = Math.max(0, this.currentCooldown * (1 - Q_STAB_REFUND));
    this.game.objectManager.addObject(
      new Fiora_Q_Thrust(this.owner, victim.position.x, victim.position.y)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** Always on: her basic attacks trigger a Vital exactly as her blade does. */
export class Fiora_Q_Duelist extends BaseBuff {
  name = 'Vũ Điệu Kiếm Sư';
  stackId = 'fiora_duelist';
  hudVisible = false;
  description = 'Đòn đánh thường của Fiora kích hoạt Điểm Yếu nếu tới từ đúng hướng.';

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice; a Vital is spent once.
    if (hit.echo) return;
    triggerVital(this.targetUnit, hit.victim);
  }
}


/** The thrust: a hard blade shape driven into the body it found. */
export class Fiora_Q_Thrust extends SpellObject {
  lifeTime = 220;
  age = 0;
  readonly heading: number;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.heading = Math.atan2(atY - owner.position.y, atX - owner.position.x);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const driven = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noStroke();
    fill(DUSK[0], DUSK[1], DUSK[2], 220 * fade);
    quad(-48 * driven, -4, 8, -2, 8, 2, -48 * driven, 4);
    fill(STEEL[0], STEEL[1], STEEL[2], 240 * fade);
    quad(-40 * driven, -2, 6, -1, 6, 1, -40 * driven, 2);
    fill(ROSE[0], ROSE[1], ROSE[2], 235 * fade);
    triangle(2, 0, -12, -7, -12, 7);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(160);
  }
}


/**
 * A Vital going off: the quarter-arc it was drawn on, snapping shut.
 *
 * Ground art, so the arc sits under the bodies rather than over them — it is a
 * mark on a champion, and the champion has to stay readable through it.
 */
export class Fiora_Vital_Burst extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 300;
  age = 0;
  readonly victim: AttackableUnit;
  readonly side: number;

  constructor(owner: AttackableUnit, victim: AttackableUnit, side: number) {
    super(owner);
    this.victim = victim;
    this.side = side;
    this.position = victim.position.copy();
  }

  update(): void {
    this.position.set(this.victim.position.x, this.victim.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t * t;
    const halfArc = (VITAL_ARC_DEG * Math.PI) / 360;
    const radius = 34 * (1 - 0.4 * t);

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(DUSK[0], DUSK[1], DUSK[2], 220 * fade);
    strokeWeight(8);
    arc(0, 0, radius * 2, radius * 2, this.side - halfArc, this.side + halfArc);
    stroke(ROSE[0], ROSE[1], ROSE[2], 245 * fade);
    strokeWeight(4);
    arc(0, 0, radius * 2, radius * 2, this.side - halfArc, this.side + halfArc);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(140);
  }
}
