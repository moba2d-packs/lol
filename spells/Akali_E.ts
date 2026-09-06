import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Dash = api.buffs.Dash;
const TrueSight = api.buffs.TrueSight;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const dmg = api.text.dmg;


/** How far the flip carries her backwards, away from where she is aiming. */
export const E_FLIP_BACK = 90;

export const E_FLIP_MS = 220;

export const E_FLIP_SPEED = 14;

export const E_SHURIKEN_DAMAGE = 12;

/** What the recast is worth — the record splits this ability 1:2 and so does this. */
export const E_DASH_DAMAGE = 22;

export const E_RANGE = 320;

export const E_SHURIKEN_SPEED = 16;

/** How long the mark stays on whatever the shuriken found. */
export const E_MARK_MS = 3_000;

export const E_DASH_SPEED = 20;

/** Close enough to have arrived, whatever the marked body did on the way. */
export const E_ARRIVE_RADIUS = 40;

export const E_MANA = 35;


const SHADOW: [number, number, number] = [18, 26, 30];

const JADE: [number, number, number] = [46, 214, 160];

const NEON: [number, number, number] = [236, 64, 122];


/** What the shuriken leaves behind: a body she can come back to. */
export class Akali_E_Mark extends TrueSight {
  name = 'Dấu Phi Tiêu';
  stackId = 'akali_e_mark';
}


/**
 * Shuriken Flip — she jumps back, throws, and the throw buys the right to come
 * straight back in.
 *
 * The two halves are one `RECAST` activation rather than two spells, which is
 * what makes the recast window a real cost: the mark lasts `E_MARK_MS` and the
 * cooldown does not start until the activation ends, so sitting on the recast
 * is sitting on the ability.
 */
export default class Akali_E extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Dash | api.enums.SpellRole.Burst;

  /** Spent late rather than instantly: the flip is worth nothing if she comes back at once. */
  static aiRecastAfterMs = 900;

  image = api.asset('spell_akali_e');
  name = 'Phóng Phi Tiêu (Akali_E)';
  description =
    `Nhảy lùi <span>${E_FLIP_BACK}px</span> rồi phóng một phi tiêu xa <span>${E_RANGE}px</span>, ` +
    `gây ${dmg(E_SHURIKEN_DAMAGE, 'MAGIC')} cho kẻ địch đầu tiên và <span class="buff">đánh dấu</span> ` +
    `nó trong <span class="time">${secs(E_MARK_MS)} giây</span>. ` +
    `<b>Bấm lại</b> để lao thẳng tới mục tiêu đã đánh dấu, gây thêm ` +
    `${dmg(E_DASH_DAMAGE, 'MAGIC')} khi tới nơi.`;
  coolDown = 9_000;
  manaCost = E_MANA;
  range = E_RANGE;

  /** Whatever the shuriken found, until the mark lapses or it dies. */
  marked: AttackableUnit | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: E_MARK_MS },
      // She keeps walking and fighting while the mark is up; only real crowd
      // control takes the second half away.
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(context: CastContext): void {
    this.marked = null;

    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const forwardX = aim.x / span;
    const forwardY = aim.y / span;

    // The flip is backwards, away from the throw — that is the whole reason
    // this ability is a disengage as well as a poke.
    if (Dash.CanDash(this.owner)) {
      const flip = new Dash(E_FLIP_MS, this.owner, this.owner);
      flip.dashDestination = createVector(
        this.owner.position.x - forwardX * E_FLIP_BACK,
        this.owner.position.y - forwardY * E_FLIP_BACK
      );
      flip.dashSpeed = E_FLIP_SPEED;
      flip.showTrail = false;
      this.owner.addBuff(flip);
    }

    const shuriken = new Akali_E_Shuriken(this.owner);
    shuriken.spell = this;
    shuriken.destination = createVector(
      this.owner.position.x + forwardX * E_RANGE,
      this.owner.position.y + forwardY * E_RANGE
    );
    this.game.objectManager.addObject(shuriken);
  }

  /** Called by the shuriken when it finds a body. */
  mark(victim: AttackableUnit): void {
    this.marked = victim;
    const mark = new Akali_E_Mark(E_MARK_MS, this.owner, victim);
    mark.image = this.image;
    victim.addBuff(mark);
  }

  onRecast(): void {
    const target = this.marked;
    this.marked = null;
    if (!target || target.isDead || !Dash.CanDash(this.owner)) return;

    let paid = false;
    const dash = new Dash(2_000, this.owner, this.owner);
    dash.dashDestination = createVector(target.position.x, target.position.y);
    dash.dashSpeed = E_DASH_SPEED;
    dash.showTrail = false;
    // `onDashUpdate`, never `dash.onUpdate = …`: assigning the instance's own
    // update replaces the dash's movement instead of hooking it, and she plays
    // the whole ability standing still.
    dash.onDashUpdate = () => {
      if (paid) return;
      if (target.isDead) {
        dash.deactivateBuff();
        return;
      }
      dash.dashDestination?.set(target.position.x, target.position.y);
      const gap = Math.hypot(
        this.owner.position.x - target.position.x,
        this.owner.position.y - target.position.y
      );
      if (gap > E_ARRIVE_RADIUS) return;
      paid = true;
      target.takeDamage(E_DASH_DAMAGE, this.owner, 'MAGIC');
      this.game.objectManager.addObject(
        new Akali_E_Arrival(this.owner, target.position.x, target.position.y)
      );
      dash.deactivateBuff();
    };
    this.owner.addBuff(dash);
  }

  onComplete(): void {
    this.marked = null;
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/** The throw: one body, and then it is spent. */
export class Akali_E_Shuriken extends MissileSpellObject {
  speed = E_SHURIKEN_SPEED;
  size = 22;
  maxHitCount = 1;
  /** Set by the cast, so the hit can hand the mark back to the ability. */
  spell: Akali_E | null = null;
  /** Turns as it flies, and the angle is seeded here rather than in `draw`. */
  spin = 0;

  onHit(victim: AttackableUnit): void {
    victim.takeDamage(E_SHURIKEN_DAMAGE, this.owner, 'MAGIC');
    this.spell?.mark(victim);
  }

  onAfterMove(): void {
    this.spin += deltaTime * 0.02;
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.spin);
    noStroke();
    // A four-pointed star: flat plates, hard edges, no blur anywhere.
    for (let i = 0; i < 4; i++) {
      push();
      rotate((Math.PI / 2) * i);
      fill(SHADOW[0], SHADOW[1], SHADOW[2], 235);
      triangle(0, -5, 15, 0, 0, 5);
      fill(JADE[0], JADE[1], JADE[2], 235);
      triangle(0, -2, 11, 0, 0, 2);
      pop();
    }
    fill(NEON[0], NEON[1], NEON[2], 240);
    circle(0, 0, 6);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 20) * 2);
  }
}


/** Where the recast lands: a hard ring and four blades closing on the point. */
export class Akali_E_Arrival extends SpellObject {
  lifeTime = 260;
  age = 0;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const closing = 1 - t;
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(NEON[0], NEON[1], NEON[2], 240 * fade);
    strokeWeight(4);
    circle(0, 0, 44 * (0.4 + 0.6 * t));

    stroke(JADE[0], JADE[1], JADE[2], 235 * fade);
    strokeWeight(3);
    for (let i = 0; i < 4; i++) {
      const heading = (Math.PI / 2) * i + Math.PI / 4;
      const far = 46 * closing + 12;
      line(
        Math.cos(heading) * far,
        Math.sin(heading) * far,
        Math.cos(heading) * (far - 16),
        Math.sin(heading) * (far - 16)
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(140);
  }
}
