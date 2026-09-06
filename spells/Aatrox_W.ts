import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const VectorUtils = api.utils.VectorUtils;
const effectiveRange = api.combat.Reach.effectiveRange;
const Dash = api.buffs.Dash;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


/**
 * `docs/abilities/aatrox/w.json`: the chain deals its damage on the hit **and
 * again** when the tether closes, so the number here is half of what a body
 * that never left the circle actually takes.
 */
export const W_DAMAGE = 14;

export const W_SLOW_PERCENT = 0.3;

export const W_SLOW_MS = 1_500;

/** Record: the tether lives 1.5 seconds, and that is the window to walk out of it. */
export const W_TETHER_MS = 1_500;

/**
 * How far the chain will stretch before it snaps.
 *
 * The record ties the target to *the ground beneath them* rather than to
 * Aatrox, which is what makes this an escapable root rather than a leash — so
 * the number is a distance from the anchor, not from the caster, and walking
 * away from the anchor is the whole counter-play.
 */
export const W_TETHER_RADIUS = 150;

export const W_RANGE = 330;

export const W_SPEED = 15;

/** How fast the chain reels a caught body back in, in px a frame. */
export const W_PULL_SPEED = 14;

export const W_MANA = 40;


const IRON: [number, number, number] = [46, 32, 34];

const BLOOD: [number, number, number] = [186, 26, 44];

const EMBER: [number, number, number] = [255, 138, 120];


export default class Aatrox_W extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_aatrox_w');
  name = 'Xiềng Xích Địa Ngục (Aatrox_W)';
  description =
    `Quăng một sợi xích thẳng về phía trước. Kẻ địch đầu tiên trúng phải nhận ` +
    `${dmg(W_DAMAGE, 'PHYSICAL')} và bị <span class="buff">Làm Chậm ${pct(W_SLOW_PERCENT)}%</span> ` +
    `trong <span class="time">${secs(W_SLOW_MS)} giây</span>, đồng thời bị xích vào mặt đất ` +
    `<span class="time">${secs(W_TETHER_MS)} giây</span>. Nếu sau đó nó vẫn còn trong vòng ` +
    `<span>${W_TETHER_RADIUS}px</span> quanh cọc xích, nó nhận thêm ${dmg(W_DAMAGE, 'PHYSICAL')} ` +
    `và bị <span class="buff">kéo về</span> đúng chỗ bị xích.`;
  coolDown = 9_000;
  manaCost = W_MANA;
  range = W_RANGE;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(W_RANGE, this.owner)
    );

    const chain = new Aatrox_W_Chain(this.owner);
    chain.destination = to;
    this.game.objectManager.addObject(chain);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The chain going out: one body, then it is spent.
 *
 * Drawn as links rather than as a line, because what it does next — stay
 * behind on the ground as a stake — has to look like the same object. The links
 * are laid along the flight path from the caster, so the picture says where it
 * came from as well as where it is.
 */
export class Aatrox_W_Chain extends MissileSpellObject {
  speed = W_SPEED;
  size = 26;
  maxHitCount = 1;

  onHit(victim: AttackableUnit): void {
    victim.takeDamage(W_DAMAGE, this.owner, 'PHYSICAL');

    // `RENEW_EXISTING`: a second chain landing on the same body must rewind one
    // slow, not stack a second copy of it (`Slow`'s default stacks ten deep).
    const slow = new Slow(W_SLOW_MS, this.owner, victim);
    slow.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    slow.percent = W_SLOW_PERCENT;
    victim.addBuff(slow);

    this.game.objectManager.addObject(
      new Aatrox_W_Tether(this.owner, victim, victim.position.x, victim.position.y)
    );
  }

  draw(): void {
    const backX = this.owner.position.x;
    const backY = this.owner.position.y;
    const span = Math.hypot(this.position.x - backX, this.position.y - backY);
    const heading = Math.atan2(this.position.y - backY, this.position.x - backX);
    const links = Math.max(1, Math.min(14, Math.round(span / 22)));

    push();
    translate(backX, backY);
    rotate(heading);
    rectMode(CENTER);
    for (let i = 1; i <= links; i++) {
      const at = (span * i) / links;
      noFill();
      stroke(IRON[0], IRON[1], IRON[2], 235);
      strokeWeight(5);
      rect(at, 0, 16, 10, 4);
      stroke(BLOOD[0], BLOOD[1], BLOOD[2], 220);
      strokeWeight(2);
      rect(at, 0, 16, 10, 4);
    }
    // The head of the chain: a barb, which is the part that catches.
    noStroke();
    fill(EMBER[0], EMBER[1], EMBER[2], 240);
    triangle(span + 14, 0, span - 8, -9, span - 8, 9);
    pop();
  }

  getDisplayBoundingBox() {
    // Drawn all the way back to the caster, so a box on the head alone would
    // cull the whole chain the moment the head left the screen.
    const span = Math.hypot(
      this.position.x - this.owner.position.x,
      this.position.y - this.owner.position.y
    );
    return this.squareDisplayBoundingBox((span + this.size) * 2);
  }
}


/**
 * The stake in the ground, and the clock on it.
 *
 * Not `attachTo(victim)`: it is anchored to the *ground*, and a body that walks
 * out of the circle has beaten it — an attached object would follow the body
 * and there would be nothing to walk out of. Ground art for the same reason,
 * so the circle a player is trying to leave is under their feet rather than
 * over them.
 */
export class Aatrox_W_Tether extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** Whether the clock has already been settled — a pull may not be paid twice. */
  settled = false;
  readonly victim: AttackableUnit;
  readonly anchorX: number;
  readonly anchorY: number;

  constructor(owner: AttackableUnit, victim: AttackableUnit, anchorX: number, anchorY: number) {
    super(owner);
    this.position = createVector(anchorX, anchorY);
    this.victim = victim;
    this.anchorX = anchorX;
    this.anchorY = anchorY;
  }

  /** How far the caught body has managed to get from the stake. */
  get slack(): number {
    return Math.hypot(this.victim.position.x - this.anchorX, this.victim.position.y - this.anchorY);
  }

  update(): void {
    if (this.settled) {
      this.toRemove = true;
      return;
    }

    // A corpse has already paid; the chain drops off it rather than reeling it in.
    if (this.victim.isDead) {
      this.settled = true;
      this.toRemove = true;
      return;
    }

    this.age += deltaTime;
    if (this.age < W_TETHER_MS) return;

    this.settled = true;
    this.toRemove = true;
    if (this.slack > W_TETHER_RADIUS) return;

    this.victim.takeDamage(W_DAMAGE, this.owner, 'PHYSICAL');
    const pull = new Dash(W_TETHER_MS, this.owner, this.victim);
    pull.dashDestination = createVector(this.anchorX, this.anchorY);
    pull.dashSpeed = W_PULL_SPEED;
    pull.showTrail = false;
    this.victim.addBuff(pull);
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / W_TETHER_MS);
    const escaped = this.slack > W_TETHER_RADIUS;

    push();
    // The circle to get out of, on exactly the radius the pull will measure.
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 200);
    strokeWeight(4);
    circle(this.anchorX, this.anchorY, W_TETHER_RADIUS * 2);
    // …and the same ring again, drawn only as far round as the clock has left,
    // so the countdown is the shape rather than a number floating beside it.
    stroke(escaped ? IRON[0] : BLOOD[0], escaped ? IRON[1] : BLOOD[1], escaped ? IRON[2] : BLOOD[2], 240);
    strokeWeight(5);
    arc(
      this.anchorX,
      this.anchorY,
      W_TETHER_RADIUS * 2,
      W_TETHER_RADIUS * 2,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * left
    );

    // The chain still running from the stake to whatever it caught. It goes
    // slack — drawn thinner — the moment the body is out of range, which is the
    // one frame of warning the caster gets that the pull will not come.
    stroke(escaped ? IRON[0] : EMBER[0], escaped ? IRON[1] : EMBER[1], escaped ? IRON[2] : EMBER[2], 225);
    strokeWeight(escaped ? 2 : 4);
    line(this.anchorX, this.anchorY, this.victim.position.x, this.victim.position.y);

    // The stake itself.
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 240);
    circle(this.anchorX, this.anchorY, 20);
    fill(EMBER[0], EMBER[1], EMBER[2], 235);
    circle(this.anchorX, this.anchorY, 9);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((W_TETHER_RADIUS + 60) * 2);
  }
}
