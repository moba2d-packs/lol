import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


/** `docs/abilities/xerath/r.json`: four recasts, each one a shell. */
export const R_SHOTS = 4;

export const R_WINDOW_MS = 5_000;

/** The record's own static gap between shells. */
export const R_RECAST_GAP_MS = 600;

export const R_SHOT_DAMAGE = 14;

export const R_TOTAL_DAMAGE = R_SHOTS * R_SHOT_DAMAGE;

export const R_SHOT_RADIUS = 140;

export const R_RANGE = 520;

/** How long a shell hangs before it lands. */
export const R_IMPACT_DELAY_MS = 500;

/** What an unspent barrage hands back — the record refunds half the cooldown. */
export const R_UNUSED_REFUND = 0.5;

export const R_MANA = 100;


const STONE: [number, number, number] = [46, 42, 62];

const ARCANE: [number, number, number] = [96, 170, 246];

const VIOLET: [number, number, number] = [168, 120, 246];


/**
 * Rite of the Arcane — one press to set up, four to fire.
 *
 * `active.recasts` is what makes this expressible: without it the runtime
 * completes the activation on the *first* recast, so the barrage would be one
 * shell and the ability would be a worse W. `recastDelayMs` is then the gap
 * between consecutive shells rather than a one-off wait, which is exactly the
 * record's "static cooldown" per cast.
 */
export default class Xerath_R extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Burst;

  static aiRecastAfterMs = R_RECAST_GAP_MS + 100;

  targetingMode = 'POINT' as const;
  image = api.asset('spell_xerath_r');
  name = 'Nghi Thức Ma Pháp (Xerath_R)';
  description =
    `Xerath bắt rễ xuống đất trong <span class="time">${secs(R_WINDOW_MS)} giây</span> và ` +
    `<b>bấm lại</b> tới <span>${R_SHOTS}</span> lần để nã đạn pháp xuống bất kỳ điểm nào trong ` +
    `<span>${R_RANGE}px</span>. Mỗi quả rơi sau ` +
    `<span class="time">${secs(R_IMPACT_DELAY_MS)} giây</span>, gây ` +
    `${dmg(R_SHOT_DAMAGE, 'MAGIC')} trong bán kính <span>${R_SHOT_RADIUS}px</span> — tổng cộng ` +
    `${dmg(R_TOTAL_DAMAGE, 'MAGIC')}. Hết giờ mà chưa bắn quả nào thì ` +
    `<span class="buff">hoàn lại ${pct(R_UNUSED_REFUND)}% hồi chiêu</span>.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_RANGE;

  /** How many shells have gone out. The HUD badge under the icon reads this. */
  shotsFired = 0;

  get stackCount(): number {
    return Math.max(0, R_SHOTS - this.shotsFired);
  }

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'POINT',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: {
        maxDurationMs: R_WINDOW_MS,
        recastDelayMs: R_RECAST_GAP_MS,
        recasts: R_SHOTS,
      },
      // He is planted, but this is not a channel: he keeps aiming, and only
      // crowd control takes the barrage off him.
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(): void {
    this.shotsFired = 0;
    this.game.objectManager.addObject(new Xerath_R_Sight(this.owner));
  }

  onRecast(context: CastContext): void {
    if (this.shotsFired >= R_SHOTS || this.owner.isDead) return;
    this.shotsFired += 1;

    // `aimPoint` is a `p5.Vector`; `context.cursorWorld` is a frozen plain
    // `{x, y}`. The fallback mixed the two shapes, so the cursor half has to be
    // rebuilt into a vector rather than handed straight to a p5 helper.
    const aim = this.aimPoint ?? context.cursorWorld;
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      createVector(aim.x, aim.y),
      effectiveRange(R_RANGE, this.owner)
    );
    this.game.objectManager.addObject(new Xerath_R_Shell(this.owner, to.x, to.y));
  }

  onComplete(): void {
    // Nothing fired: half the cooldown back, exactly as the record has it.
    if (this.shotsFired === 0) {
      this.currentCooldown = Math.max(0, this.currentCooldown * (1 - R_UNUSED_REFUND));
    }
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** One shell: it hangs, then it lands. The delay is the counter-play. */
export class Xerath_R_Shell extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  landed = false;
  private fadeMs = 0;
  readonly atX: number;
  readonly atY: number;
  readonly struck: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  update(): void {
    if (this.landed) {
      this.fadeMs += deltaTime;
      if (this.fadeMs >= 280) this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    if (this.age < R_IMPACT_DELAY_MS) return;
    this.landed = true;
    this.detonate();
  }

  private detonate(): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: R_SHOT_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      if (Math.hypot(victim.position.x - this.atX, victim.position.y - this.atY) > R_SHOT_RADIUS + body) {
        continue;
      }
      victim.takeDamage(R_SHOT_DAMAGE, this.owner, 'MAGIC');
      this.struck.push({ x: victim.position.x, y: victim.position.y });
    }
  }

  draw(): void {
    const winding = Math.min(1, this.age / R_IMPACT_DELAY_MS);
    const fade = this.landed ? Math.max(0, 1 - this.fadeMs / 280) : 1;
    const out = this.landed ? Math.min(1, this.fadeMs / 280) : 0;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(STONE[0], STONE[1], STONE[2], 90 * fade);
    circle(0, 0, R_SHOT_RADIUS * 2);
    noFill();
    stroke(STONE[0], STONE[1], STONE[2], 220 * fade);
    strokeWeight(5);
    circle(0, 0, R_SHOT_RADIUS * 2);
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 240 * fade);
    strokeWeight(4);
    arc(0, 0, R_SHOT_RADIUS * 2, R_SHOT_RADIUS * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * winding);

    if (!this.landed) {
      // The shell overhead, coming down: a hard wedge, shrinking as it falls.
      const height = (1 - winding) * 40;
      noStroke();
      fill(ARCANE[0], ARCANE[1], ARCANE[2], 235);
      triangle(-10, -height - 16, 10, -height - 16, 0, -height);
    } else {
      stroke(ARCANE[0], ARCANE[1], ARCANE[2], 245 * fade);
      strokeWeight(6);
      circle(0, 0, R_SHOT_RADIUS * 2 * out);
    }
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(ARCANE[0], ARCANE[1], ARCANE[2], 235 * fade);
      strokeWeight(3);
      rectMode(CENTER);
      rect(mark.x, mark.y, 24, 24);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_SHOT_RADIUS + 60) * 2);
  }
}


/**
 * What he can reach while the barrage is up: one hard ring on the real range.
 *
 * Ground art — everyone standing inside it needs to be readable, because the
 * ring is the information and the bodies in it are the targets.
 */
export class Xerath_R_Sight extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= R_WINDOW_MS || this.owner.isDead) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / R_WINDOW_MS);
    const radius = R_RANGE;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    // Dashed rather than solid: it is a boundary, not a wall, and a solid ring
    // this large would sit over half the fight.
    stroke(STONE[0], STONE[1], STONE[2], 190);
    strokeWeight(4);
    const segments = 40;
    for (let i = 0; i < segments; i += 2) {
      const from = (Math.PI * 2 * i) / segments;
      arc(0, 0, radius * 2, radius * 2, from, from + (Math.PI * 2) / segments);
    }
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 230);
    strokeWeight(3);
    arc(0, 0, radius * 2, radius * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_RANGE + 40) * 2);
  }
}
