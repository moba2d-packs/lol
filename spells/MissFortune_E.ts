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


export const E_RADIUS = 190;

export const E_DURATION_MS = 2_000;

export const E_TICK_MS = 250;

export const E_TICK_DAMAGE = 4;

export const E_TICKS = Math.floor(E_DURATION_MS / E_TICK_MS);

export const E_TOTAL_DAMAGE = E_TICKS * E_TICK_DAMAGE;

export const E_SLOW_PERCENT = 0.4;

/** How far she can put it down. */
export const E_CAST_RANGE = 340;

export const E_MANA = 60;


const CRIMSON: [number, number, number] = [206, 44, 62];

const GOLD: [number, number, number] = [232, 186, 96];

const LEATHER: [number, number, number] = [58, 36, 40];


export default class MissFortune_E extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Zone | api.enums.SpellRole.Cc;

  targetingMode = 'POINT' as const;
  image = api.asset('spell_missfortune_e');
  name = 'Mưa Đạn (MissFortune_E)';
  description =
    `Trút một trận mưa đạn xuống một điểm trong <span>${E_CAST_RANGE}px</span>, bán kính ` +
    `<span>${E_RADIUS}px</span>, kéo dài <span class="time">${secs(E_DURATION_MS)} giây</span>. ` +
    `Mỗi <span class="time">${secs(E_TICK_MS)} giây</span> gây ${dmg(E_TICK_DAMAGE, 'MAGIC')} ` +
    `(tổng ${dmg(E_TOTAL_DAMAGE, 'MAGIC')} nếu đứng yên trong đó) và ` +
    `<span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span> mọi kẻ địch bên trong.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_CAST_RANGE;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(E_CAST_RANGE, this.owner)
    );
    this.game.objectManager.addObject(new MissFortune_E_Rain(this.owner, to.x, to.y));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The storm on the ground.
 *
 * Ground art: it is a place on the map that champions run through, and they
 * have to stay readable inside it. The slow is `RENEW_EXISTING` — this ticks
 * four times a second, and `Slow`'s default stacks ten deep, so a stacking
 * version of this exact shape is how a 40% slow becomes a root inside a second.
 */
export class MissFortune_E_Rain extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  ticksDone = 0;
  private tickMs = 0;
  readonly atX: number;
  readonly atY: number;
  /** Where the last volley landed, seeded per tick so the picture never re-rolls. */
  splashes: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  update(): void {
    this.age += deltaTime;
    this.tickMs += deltaTime;
    // Volleys first, expiry second: the storm *is* its volleys, and checking
    // the clock ahead of the tick loses the last one on any frame long enough
    // to carry both — which is exactly what a slow frame is.
    while (this.tickMs >= E_TICK_MS && this.ticksDone < E_TICKS) {
      this.tickMs -= E_TICK_MS;
      this.volley();
    }
    if (this.age >= E_DURATION_MS || this.ticksDone >= E_TICKS) this.toRemove = true;
  }

  /** One quarter-second of bullets: everything standing under it. */
  private volley(): void {
    this.ticksDone += 1;
    this.splashes = [];

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: E_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      if (Math.hypot(victim.position.x - this.atX, victim.position.y - this.atY) > E_RADIUS + body) {
        continue;
      }
      victim.takeDamage(E_TICK_DAMAGE, this.owner, 'MAGIC');
      const slow = new Slow(E_TICK_MS * 2, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = E_SLOW_PERCENT;
      victim.addBuff(slow);
      this.splashes.push({ x: victim.position.x, y: victim.position.y });
    }
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / E_DURATION_MS);
    const beat = (this.age % E_TICK_MS) / E_TICK_MS;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(LEATHER[0], LEATHER[1], LEATHER[2], 90);
    circle(0, 0, E_RADIUS * 2);
    noFill();
    stroke(LEATHER[0], LEATHER[1], LEATHER[2], 220);
    strokeWeight(6);
    circle(0, 0, E_RADIUS * 2);
    stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 240);
    strokeWeight(3);
    // The clock, as an arc, so the zone needs no number beside it.
    arc(0, 0, E_RADIUS * 2, E_RADIUS * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);

    // The rain itself: twelve hard slugs on a fixed lattice, falling in step
    // with the tick so the rhythm of the damage is visible.
    noStroke();
    rectMode(CENTER);
    for (let i = 0; i < 12; i++) {
      const spin = (Math.PI * 2 * i) / 12 + i * 0.37;
      const out = E_RADIUS * (0.25 + 0.7 * ((i / 12 + beat) % 1));
      fill(GOLD[0], GOLD[1], GOLD[2], 220);
      push();
      translate(Math.cos(spin) * out, Math.sin(spin) * out);
      rotate(spin + Math.PI / 2);
      rect(0, 0, 4, 12, 2);
      pop();
    }
    pop();

    // A hard tick-mark on every body it caught this volley.
    push();
    for (const splash of this.splashes) {
      noFill();
      stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 200);
      strokeWeight(2);
      circle(splash.x, splash.y, 20);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((E_RADIUS + 40) * 2);
  }
}
