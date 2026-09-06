import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const W_RADIUS = 180;

/** The bright middle. `docs/abilities/xerath/w.json` pays more for it, twice over. */
export const W_CORE_RADIUS = 85;

export const W_DELAY_MS = 500;

export const W_DAMAGE = 18;

export const W_CORE_DAMAGE = 30;

export const W_SLOW = 0.25;

export const W_CORE_SLOW = 0.6;

export const W_SLOW_MS = 2_000;

export const W_CAST_RANGE = 400;

export const W_MANA = 55;


const STONE: [number, number, number] = [46, 42, 62];

const ARCANE: [number, number, number] = [96, 170, 246];

const VIOLET: [number, number, number] = [168, 120, 246];


export default class Xerath_W extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Zone | api.enums.SpellRole.Cc;

  targetingMode = 'POINT' as const;
  image = api.asset('spell_xerath_w');
  name = 'Vụ Nổ Năng Lượng (Xerath_W)';
  description =
    `Gọi một cột năng lượng xuống một điểm trong <span>${W_CAST_RANGE}px</span>. Sau ` +
    `<span class="time">${secs(W_DELAY_MS)} giây</span> nó nện xuống: vòng ngoài bán kính ` +
    `<span>${W_RADIUS}px</span> nhận ${dmg(W_DAMAGE, 'MAGIC')} và ` +
    `<span class="buff">Làm Chậm ${pct(W_SLOW)}%</span>, còn <span class="buff">tâm điểm</span> ` +
    `bán kính <span>${W_CORE_RADIUS}px</span> nhận ${dmg(W_CORE_DAMAGE, 'MAGIC')} và ` +
    `<span class="buff">Làm Chậm ${pct(W_CORE_SLOW)}%</span>, kéo dài ` +
    `<span class="time">${secs(W_SLOW_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = W_MANA;
  range = W_CAST_RANGE;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(W_CAST_RANGE, this.owner)
    );
    this.game.objectManager.addObject(new Xerath_W_Eye(this.owner, to.x, to.y));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The column, and the half-second before it lands.
 *
 * Both circles are drawn on the real radii from the first frame, because the
 * delay is the whole of the counter-play and the *inner* circle is the decision
 * — a player who only knows there is a blast coming has been told half of it.
 */
export class Xerath_W_Eye extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** True once it has landed. It pays out exactly once. */
  landed = false;
  private fadeMs = 0;
  readonly atX: number;
  readonly atY: number;
  /** Who took the middle, so the picture can say which half caught them. */
  readonly core: { x: number; y: number }[] = [];
  readonly rim: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  update(): void {
    if (this.landed) {
      this.fadeMs += deltaTime;
      if (this.fadeMs >= 300) this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    if (this.age < W_DELAY_MS) return;
    this.landed = true;
    this.strike();
  }

  private strike(): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: W_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      const away = Math.hypot(victim.position.x - this.atX, victim.position.y - this.atY);
      if (away > W_RADIUS + body) continue;

      // The middle is measured on the body's *centre*, the rim on its edge —
      // the record's own split, and the reason a wide body clipping the outer
      // ring is caught by it without also counting as a bullseye.
      const bullseye = away <= W_CORE_RADIUS;
      victim.takeDamage(bullseye ? W_CORE_DAMAGE : W_DAMAGE, this.owner, 'MAGIC');

      // `RENEW_EXISTING`: `Slow`'s default stacks ten deep, and two of these
      // landing together would be a root rather than a slow.
      const slow = new Slow(W_SLOW_MS, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = bullseye ? W_CORE_SLOW : W_SLOW;
      slow.image = api.asset('spell_xerath_w');
      victim.addBuff(slow);

      (bullseye ? this.core : this.rim).push({ x: victim.position.x, y: victim.position.y });
    }
  }

  draw(): void {
    const winding = Math.min(1, this.age / W_DELAY_MS);
    const fade = this.landed ? Math.max(0, 1 - this.fadeMs / 300) : 1;
    const landing = this.landed ? Math.min(1, this.fadeMs / 300) : 0;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(STONE[0], STONE[1], STONE[2], 90 * fade);
    circle(0, 0, W_RADIUS * 2);
    fill(VIOLET[0], VIOLET[1], VIOLET[2], 70 * fade);
    circle(0, 0, W_CORE_RADIUS * 2);

    noFill();
    stroke(STONE[0], STONE[1], STONE[2], 220 * fade);
    strokeWeight(5);
    circle(0, 0, W_RADIUS * 2);
    stroke(ARCANE[0], ARCANE[1], ARCANE[2], 235 * fade);
    strokeWeight(3);
    circle(0, 0, W_CORE_RADIUS * 2);
    // The clock on the outer rim, so the half-second is readable.
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 240 * fade);
    strokeWeight(4);
    arc(0, 0, W_RADIUS * 2, W_RADIUS * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * winding);

    // The column itself, once it comes down: a hard shaft collapsing inward.
    if (this.landed) {
      const shaft = W_CORE_RADIUS * (1 - 0.6 * landing);
      noStroke();
      fill(ARCANE[0], ARCANE[1], ARCANE[2], 220 * fade);
      rectMode(CENTER);
      rect(0, 0, shaft * 2, shaft * 2, 6);
      fill(255, 255, 255, 200 * fade);
      rect(0, 0, shaft, shaft, 4);
    }
    pop();

    push();
    for (const [marks, size] of [
      [this.rim, 22] as const,
      [this.core, 34] as const,
    ]) {
      for (const mark of marks) {
        noFill();
        stroke(ARCANE[0], ARCANE[1], ARCANE[2], 235 * fade);
        strokeWeight(3);
        rectMode(CENTER);
        rect(mark.x, mark.y, size, size);
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((W_RADIUS + 40) * 2);
  }
}
