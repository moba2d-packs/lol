import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const Q_DAMAGE = 18;

export const Q_RANGE = 220;

export const Q_ARC_DEG = 55;

/**
 * `docs/abilities/akali/q.json`: "targets **beyond a certain range** are also
 * slowed". The slow is the far half of the cone, not the whole of it — which is
 * what makes Five Point Strike a poke that keeps its distance rather than a
 * point-blank one that also roots.
 */
export const Q_SLOW_FROM = 130;

export const Q_SLOW_PERCENT = 0.5;

export const Q_SLOW_MS = 500;

/** Five kunai, and the number is in the ability's own name. */
export const Q_KUNAI = 5;

export const Q_MANA = 30;


const SHADOW: [number, number, number] = [18, 26, 30];

const JADE: [number, number, number] = [46, 214, 160];

const NEON: [number, number, number] = [236, 64, 122];


export default class Akali_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Poke;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_akali_q');
  name = 'Phi Đao Năm Cánh (Akali_Q)';
  description =
    `Phóng ${Q_KUNAI} phi tiêu thành hình quạt ${Q_ARC_DEG}° xa <span>${Q_RANGE}px</span>, ` +
    `gây ${dmg(Q_DAMAGE, 'MAGIC')}. Kẻ địch đứng xa hơn <span>${Q_SLOW_FROM}px</span> ` +
    `còn bị <span class="buff">Làm Chậm ${pct(Q_SLOW_PERCENT)}%</span> trong ` +
    `<span class="time">${secs(Q_SLOW_MS)} giây</span>.`;
  /**
   * The record charges 1.5s and pays for it in energy; this pack has no energy
   * bar, so the rhythm has to live in the cooldown instead. Four seconds is the
   * fastest basic on this shelf, which is the shape of the ability — a poke she
   * throws constantly — without it being free.
   */
  coolDown = 4_000;
  manaCost = Q_MANA;
  range = Q_RANGE;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);
    const reach = effectiveRange(Q_RANGE, this.owner);
    const halfArc = (Q_ARC_DEG * Math.PI) / 360;
    const atX = this.owner.position.x;
    const atY = this.owner.position.y;
    const struck: { x: number; y: number; slowed: boolean }[] = [];

    // No vision filter: a fan of thrown kunai still lands on the champion in a bush.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: atX, y: atY, r: reach }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      const dx = victim.position.x - atX;
      const dy = victim.position.y - atY;
      const away = Math.hypot(dx, dy);
      if (away > reach + body) continue;

      let offAxis = Math.atan2(dy, dx) - heading;
      while (offAxis > Math.PI) offAxis -= Math.PI * 2;
      while (offAxis < -Math.PI) offAxis += Math.PI * 2;
      // A wide body just outside the wedge edge is still hit by it, and a body
      // standing on the caster is inside whatever its heading says.
      const bodyArc = Math.atan2(body, Math.max(away, 1));
      if (Math.abs(offAxis) > halfArc + bodyArc) continue;

      victim.takeDamage(Q_DAMAGE, this.owner, 'MAGIC');
      const slowed = away >= Q_SLOW_FROM;
      if (slowed) {
        // `RENEW_EXISTING`: `Slow` stacks ten deep by default, and a poke this
        // fast would otherwise turn a 50% slow into a standstill in two casts.
        const slow = new Slow(Q_SLOW_MS, this.owner, victim);
        slow.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
        slow.percent = Q_SLOW_PERCENT;
        victim.addBuff(slow);
      }
      struck.push({ x: victim.position.x, y: victim.position.y, slowed });
    }

    this.game.objectManager.addObject(new Akali_Q_Fan(this.owner, heading, reach, struck));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * Five kunai leaving her hand at once, and the line past which they slow.
 *
 * The blades are drawn as flat leaf shapes flying outward along the same wedge
 * the hit test walks, and the slow boundary is an arc at `Q_SLOW_FROM` — so the
 * one thing a player has to learn about this ability (stand close, take less)
 * is painted on the ground rather than buried in the tooltip.
 */
export class Akali_Q_Fan extends SpellObject {
  lifeTime = 300;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly struck: { x: number; y: number; slowed: boolean }[];

  constructor(
    owner: AttackableUnit,
    heading: number,
    reach: number,
    struck: { x: number; y: number; slowed: boolean }[]
  ) {
    super(owner);
    this.position = owner.position.copy();
    this.heading = heading;
    this.reach = reach;
    this.struck = struck;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const flown = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const halfArc = (Q_ARC_DEG * Math.PI) / 360;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // The line past which they bite: an arc, on the number the slow uses.
    noFill();
    stroke(NEON[0], NEON[1], NEON[2], 150 * fade);
    strokeWeight(2);
    arc(0, 0, Q_SLOW_FROM * 2, Q_SLOW_FROM * 2, -halfArc, halfArc);

    // The kunai themselves — a flat leaf blade each, spread across the wedge.
    for (let i = 0; i < Q_KUNAI; i++) {
      const spin = -halfArc + (halfArc * 2 * i) / (Q_KUNAI - 1);
      const gone = this.reach * flown;
      push();
      rotate(spin);
      noStroke();
      fill(SHADOW[0], SHADOW[1], SHADOW[2], 220 * fade);
      quad(gone - 16, 0, gone - 4, -5, gone + 10, 0, gone - 4, 5);
      fill(JADE[0], JADE[1], JADE[2], 235 * fade);
      quad(gone - 8, 0, gone - 1, -2, gone + 8, 0, gone - 1, 2);
      pop();
    }
    pop();

    // A mark on every body that took one, brighter where the slow landed.
    push();
    for (const hit of this.struck) {
      noFill();
      stroke(
        hit.slowed ? NEON[0] : JADE[0],
        hit.slowed ? NEON[1] : JADE[1],
        hit.slowed ? NEON[2] : JADE[2],
        235 * fade
      );
      strokeWeight(3);
      const reach = 12 * (0.5 + 0.5 * flown);
      line(hit.x - reach, hit.y - reach, hit.x + reach, hit.y + reach);
      line(hit.x - reach, hit.y + reach, hit.x + reach, hit.y - reach);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 40) * 2);
  }
}
