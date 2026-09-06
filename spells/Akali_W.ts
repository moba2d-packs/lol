import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Invisible = api.buffs.Invisible;
const Speedup = api.buffs.Speedup;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;


/** How far in front of her the bomb goes off — the record's "fixed distance away". */
export const W_OFFSET = 120;

export const W_RADIUS = 150;

export const W_DURATION_MS = 5_000;

export const W_SPEED_PERCENT = 0.35;

export const W_SPEED_MS = 2_000;

/**
 * How long the smoke refuses to hide her again after she has acted.
 *
 * Core already ends a stealth the moment its owner attacks or casts
 * (`combat/StealthBreak.ts`), so the shroud does not have to notice the action
 * — it notices that **its own cloak is gone** while she is still standing
 * inside, and takes that as the action. That is one rule instead of two event
 * subscriptions, and it cannot disagree with core about what counts as acting.
 */
export const W_BREAK_MS = 1_000;

/**
 * The cloak is re-hung every frame she is inside, so it needs a duration only
 * long enough to survive to the next one. Short, deliberately: if the shroud
 * object dies, so does the invisibility, without anything having to clean up.
 */
export const W_CLOAK_MS = 200;

export const W_MANA = 40;


const SHADOW: [number, number, number] = [18, 26, 30];

const JADE: [number, number, number] = [46, 214, 160];


export default class Akali_W extends Spell {
  static aiRoles = api.enums.SpellRole.Zone | api.enums.SpellRole.Buff | api.enums.SpellRole.Escape;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_akali_w');
  name = 'Bom Khói (Akali_W)';
  description =
    `Ném bom khói ra trước <span>${W_OFFSET}px</span>, dựng một màn sương bán kính ` +
    `<span>${W_RADIUS}px</span> tồn tại <span class="time">${secs(W_DURATION_MS)} giây</span>. ` +
    `Đứng trong sương, Akali <span class="buff">Tàng Hình</span>; đánh hoặc tung chiêu sẽ ` +
    `lộ diện và sương không giấu lại trong <span class="time">${secs(W_BREAK_MS)} giây</span>. ` +
    `Khi đặt, cô còn nhận <span class="buff">+${pct(W_SPEED_PERCENT)}% tốc chạy</span> trong ` +
    `<span class="time">${secs(W_SPEED_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = W_MANA;
  range = W_OFFSET + W_RADIUS;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const atX = this.owner.position.x + (aim.x / span) * W_OFFSET;
    const atY = this.owner.position.y + (aim.y / span) * W_OFFSET;

    const haste = new Speedup(W_SPEED_MS, this.owner, this.owner);
    haste.stackId = 'akali_w_haste';
    haste.image = this.image;
    haste.percent = W_SPEED_PERCENT;
    this.owner.addBuff(haste);

    this.game.objectManager.addObject(new Akali_W_Shroud(this.owner, atX, atY));
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/**
 * The smoke on the ground, and the only thing that knows whether Akali is in it.
 *
 * Ground art: the circle is a place on the map, and a champion standing at its
 * edge belongs over it. It is deliberately **not** attached to her — the whole
 * ability is that the smoke stays where it was thrown and she can leave it.
 */
export class Akali_W_Shroud extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** Counts down while the shroud refuses to hide her again. */
  breakMsLeft = 0;
  /** The cloak this shroud hung, so it can tell "torn off" from "never hung". */
  private cloak: InstanceType<typeof Invisible> | null = null;
  readonly atX: number;
  readonly atY: number;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  /** Whether the owner is standing inside the smoke right now. */
  get sheltering(): boolean {
    if (this.owner.isDead) return false;
    return Math.hypot(this.owner.position.x - this.atX, this.owner.position.y - this.atY) <= W_RADIUS;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= W_DURATION_MS) {
      this.drop();
      this.toRemove = true;
      return;
    }

    if (this.breakMsLeft > 0) this.breakMsLeft = Math.max(0, this.breakMsLeft - deltaTime);

    // She acted: core tore the cloak off (`combat/StealthBreak.ts`) while she
    // was still standing in the smoke, so the smoke will not hang another one
    // for a moment. Only a cloak *this* object hung counts — a stealth from
    // somewhere else ending is not her leaving cover.
    if (this.cloak && this.cloak.toRemove) {
      this.cloak = null;
      if (this.sheltering) this.breakMsLeft = W_BREAK_MS;
    }

    if (!this.sheltering) {
      this.drop();
      return;
    }
    if (this.breakMsLeft > 0) return;

    // Re-hung every frame rather than granted once: the cloak has to end the
    // instant she steps out, and a five-second buff would follow her out of it.
    if (!this.cloak || this.cloak.toRemove) {
      this.cloak = new Invisible(W_CLOAK_MS, this.owner, this.owner);
      this.cloak.image = api.asset('spell_akali_w');
      this.owner.addBuff(this.cloak);
    } else {
      this.cloak.timeElapsed = 0;
    }
  }

  onRemoved(): void {
    this.drop();
  }

  /** Idempotent: stepping out and the smoke expiring can share a frame. */
  private drop(): void {
    if (!this.cloak) return;
    if (!this.cloak.toRemove) this.cloak.deactivateBuff();
    this.cloak = null;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / W_DURATION_MS);
    // It billows out over the first fifth of a second and then simply sits there.
    const grown = Math.min(1, this.age / 200);
    const radius = W_RADIUS * grown;
    const hiding = this.sheltering && this.breakMsLeft <= 0;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(SHADOW[0], SHADOW[1], SHADOW[2], 130);
    circle(0, 0, radius * 2);

    // The rim, and the countdown on it: the arc runs as far round as the
    // shroud has left, so the clock is the shape rather than a number beside it.
    noFill();
    stroke(SHADOW[0], SHADOW[1], SHADOW[2], 220);
    strokeWeight(6);
    circle(0, 0, radius * 2);
    stroke(JADE[0], JADE[1], JADE[2], hiding ? 240 : 120);
    strokeWeight(3);
    arc(0, 0, radius * 2, radius * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);

    // Flat lobes of smoke rather than a blur: six overlapping discs on a fixed
    // ring, so the shape reads as billowing without a single soft edge.
    noStroke();
    fill(SHADOW[0], SHADOW[1], SHADOW[2], 150);
    for (let i = 0; i < 6; i++) {
      const spin = (Math.PI * 2 * i) / 6;
      circle(Math.cos(spin) * radius * 0.55, Math.sin(spin) * radius * 0.55, radius * 0.85);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((W_RADIUS + 40) * 2);
  }
}
