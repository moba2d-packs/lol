import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const effectiveRange = api.combat.Reach.effectiveRange;
const Stun = api.buffs.Stun;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const dmg = api.text.dmg;


export const E_DAMAGE = 22;

export const E_RANGE = 400;

export const E_SPEED = 16;

/** The stun the orb is worth point-blank… */
export const E_MIN_STUN_MS = 500;

/** …and at the far end of its flight. The record scales it with travel. */
export const E_MAX_STUN_MS = 1_400;

export const E_MANA = 45;


const STONE: [number, number, number] = [46, 42, 62];

const ARCANE: [number, number, number] = [96, 170, 246];

const VIOLET: [number, number, number] = [168, 120, 246];


/** `E_MIN_STUN_MS` on a body at his feet, `E_MAX_STUN_MS` at maximum range. */
export function orbStunMs(travelled: number): number {
  const share = Math.max(0, Math.min(1, travelled / E_RANGE));
  return Math.round(E_MIN_STUN_MS + (E_MAX_STUN_MS - E_MIN_STUN_MS) * share);
}


export default class Xerath_E extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_xerath_e');
  name = 'Điện Tích Cầu (Xerath_E)';
  description =
    `Bắn một quả cầu năng lượng xa <span>${E_RANGE}px</span>. Kẻ địch đầu tiên trúng phải nhận ` +
    `${dmg(E_DAMAGE, 'MAGIC')} và bị <span class="buff">Choáng</span> từ ` +
    `<span class="time">${secs(E_MIN_STUN_MS)}</span> tới ` +
    `<span class="time">${secs(E_MAX_STUN_MS)} giây</span> — ` +
    `<span class="buff">bay càng xa, choáng càng lâu</span>.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_RANGE;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(E_RANGE, this.owner);

    const orb = new Xerath_E_Orb(this.owner);
    orb.heading = Math.atan2(aim.y, aim.x);
    orb.destination = createVector(
      this.owner.position.x + (aim.x / span) * reach,
      this.owner.position.y + (aim.y / span) * reach
    );
    this.game.objectManager.addObject(orb);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The orb. One body, and what the stun is worth depends on how far it got —
 * which is the whole reason this ability is aimed at empty ground as often as
 * at a champion.
 */
export class Xerath_E_Orb extends MissileSpellObject {
  speed = E_SPEED;
  size = 26;
  maxHitCount = 1;
  heading = 0;
  /** Where it started, so the hit can measure the flight rather than guess it. */
  private fromX = 0;
  private fromY = 0;
  /** What the stun was worth on the body it caught — read by a test and the art. */
  paidStunMs = 0;

  onAdded(): void {
    super.onAdded();
    this.fromX = this.position.x;
    this.fromY = this.position.y;
  }

  get travelled(): number {
    return Math.hypot(this.position.x - this.fromX, this.position.y - this.fromY);
  }

  onHit(victim: AttackableUnit): void {
    victim.takeDamage(E_DAMAGE, this.owner, 'MAGIC');
    this.paidStunMs = orbStunMs(this.travelled);
    victim.addBuff(new Stun(this.paidStunMs, this.owner, victim));
    this.game.objectManager.addObject(
      new Xerath_E_Burst(this.owner, victim.position.x, victim.position.y, this.paidStunMs)
    );
  }

  draw(): void {
    // How far it has come, said in the orb itself: it grows as it flies, which
    // is the one thing a player needs to read off it.
    const grown = 0.7 + 0.5 * Math.min(1, this.travelled / E_RANGE);

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noStroke();
    fill(STONE[0], STONE[1], STONE[2], 235);
    circle(0, 0, this.size * grown);
    fill(VIOLET[0], VIOLET[1], VIOLET[2], 240);
    circle(0, 0, this.size * grown * 0.7);
    fill(ARCANE[0], ARCANE[1], ARCANE[2], 245);
    circle(0, 0, this.size * grown * 0.38);
    // Four hard shards riding it, so it reads as a stone and not as a bubble.
    for (let i = 0; i < 4; i++) {
      push();
      rotate((Math.PI / 2) * i + this.travelled * 0.01);
      fill(ARCANE[0], ARCANE[1], ARCANE[2], 220);
      triangle(this.size * grown * 0.45, -3, this.size * grown * 0.75, 0, this.size * grown * 0.45, 3);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 30) * 2);
  }
}


/** The impact: a hard ring whose weight is the stun it actually paid. */
export class Xerath_E_Burst extends SpellObject {
  lifeTime = 300;
  age = 0;
  readonly stunMs: number;

  constructor(owner: AttackableUnit, atX: number, atY: number, stunMs: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.stunMs = stunMs;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const share = Math.max(0, Math.min(1, (this.stunMs - E_MIN_STUN_MS) / (E_MAX_STUN_MS - E_MIN_STUN_MS)));
    const reach = 28 + 26 * share;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(STONE[0], STONE[1], STONE[2], 230 * fade);
    strokeWeight(6 + 4 * share);
    circle(0, 0, reach * 2 * out);
    stroke(ARCANE[0], ARCANE[1], ARCANE[2], 245 * fade);
    strokeWeight(3);
    circle(0, 0, reach * 2 * out);

    // Spokes: one more for a longer stun, so the ramp is countable.
    const spokes = 4 + Math.round(share * 4);
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 235 * fade);
    strokeWeight(3);
    for (let i = 0; i < spokes; i++) {
      const spin = (Math.PI * 2 * i) / spokes;
      line(
        Math.cos(spin) * reach * 0.5 * out,
        Math.sin(spin) * reach * 0.5 * out,
        Math.cos(spin) * reach * out,
        Math.sin(spin) * reach * out
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(180);
  }
}
