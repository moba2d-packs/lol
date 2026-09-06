import type { AttackableUnit, CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_DURATION_MS = 2_500;

export const R_WAVE_MS = 250;

export const R_WAVE_DAMAGE = 5;

export const R_WAVES = Math.floor(R_DURATION_MS / R_WAVE_MS);

export const R_TOTAL_DAMAGE = R_WAVES * R_WAVE_DAMAGE;

export const R_LENGTH = 380;

export const R_ARC_DEG = 44;

/** Six bullets a wave — the record's number, and what the picture draws. */
export const R_BULLETS = 6;

export const R_MANA = 100;


const CRIMSON: [number, number, number] = [206, 44, 62];

const GOLD: [number, number, number] = [232, 186, 96];

const LEATHER: [number, number, number] = [58, 36, 40];


/**
 * Bullet Time — a real channel, and the one in this pack that stops when she
 * moves.
 *
 * `SpellForm.CHANNELED` is reserved for exactly this: the form that breaks on
 * the caster's *own* movement. Lucian's ultimate deliberately is not one —
 * his record says he may still walk — and putting the two side by side is what
 * makes each of them mean something.
 *
 * The waves come through `onChannelTick`, so the runtime owns the clock: an
 * interrupt stops the ability by stopping the ticks rather than by anything in
 * this file noticing.
 */
export default class MissFortune_R extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Burst;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_missfortune_r');
  name = 'Bão Đạn (MissFortune_R)';
  description =
    `Đứng yên nã <span>${R_WAVES}</span> loạt đạn hình quạt ${R_ARC_DEG}° xa ` +
    `<span>${R_LENGTH}px</span> trong <span class="time">${secs(R_DURATION_MS)} giây</span>. ` +
    `Mỗi loạt gây ${dmg(R_WAVE_DAMAGE, 'PHYSICAL')} cho mọi kẻ địch trong quạt — tổng cộng ` +
    `${dmg(R_TOTAL_DAMAGE, 'PHYSICAL')} nếu đứng trong đó suốt. ` +
    `<span class="buff">Di chuyển, choáng hay câm lặng đều ngắt kênh niệm.</span>`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_LENGTH;

  /** Which way she is firing, frozen at the press. */
  heading = 0;
  /** How many waves have gone out — the picture and a test both read this. */
  wavesFired = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      channel: { durationMs: R_DURATION_MS, tickEveryMs: R_WAVE_MS },
      interrupts: SpellForm.CHANNELED,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onCastStart(context: CastContext): void {
    const aim = this.firingDirection(context);
    this.heading = Math.atan2(aim.y, aim.x);
    this.wavesFired = 0;
  }

  onChannelTick(): void {
    if (this.owner.isDead) return;
    this.wavesFired += 1;
    this.fireWave();
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    // Nothing to unwind: the ability *is* its waves, and a cancelled channel
    // simply stops firing them. Stated so the next reader does not go looking.
  }

  /** One wave: the whole wedge, everything standing in it. */
  private fireWave(): void {
    const reach = effectiveRange(R_LENGTH, this.owner);
    const halfArc = (R_ARC_DEG * Math.PI) / 360;
    const atX = this.owner.position.x;
    const atY = this.owner.position.y;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: atX, y: atY, r: reach }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck: { x: number; y: number }[] = [];
    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      const dx = victim.position.x - atX;
      const dy = victim.position.y - atY;
      const away = Math.hypot(dx, dy);
      if (away > reach + body) continue;

      let offAxis = Math.atan2(dy, dx) - this.heading;
      while (offAxis > Math.PI) offAxis -= Math.PI * 2;
      while (offAxis < -Math.PI) offAxis += Math.PI * 2;
      // A wide body clipping the edge of the wedge is inside it; a body on top
      // of her is inside whatever its heading says.
      const bodyArc = Math.atan2(body, Math.max(away, 1));
      if (Math.abs(offAxis) > halfArc + bodyArc) continue;

      victim.takeDamage(R_WAVE_DAMAGE, this.owner, 'PHYSICAL');
      struck.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new MissFortune_R_Wave(this.owner, atX, atY, this.heading, reach, struck)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** One wave: six hard slugs fanning out, and a mark on what they caught. */
export class MissFortune_R_Wave extends SpellObject {
  lifeTime = 300;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly struck: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    atX: number,
    atY: number,
    heading: number,
    reach: number,
    struck: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(atX, atY);
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
    const halfArc = (R_ARC_DEG * Math.PI) / 360;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // The wedge, faint, so the shape a player has to stand out of is legible
    // from the first wave rather than inferred from where the slugs went.
    noStroke();
    fill(LEATHER[0], LEATHER[1], LEATHER[2], 60 * fade);
    beginShape();
    vertex(0, 0);
    for (let i = 0; i <= 10; i++) {
      const spin = -halfArc + (halfArc * 2 * i) / 10;
      vertex(Math.cos(spin) * this.reach, Math.sin(spin) * this.reach);
    }
    endShape(CLOSE);

    rectMode(CENTER);
    for (let i = 0; i < R_BULLETS; i++) {
      const spin = -halfArc + (halfArc * 2 * i) / (R_BULLETS - 1);
      const gone = this.reach * flown;
      push();
      rotate(spin);
      fill(LEATHER[0], LEATHER[1], LEATHER[2], 235 * fade);
      rect(gone, 0, 16, 6, 3);
      fill(GOLD[0], GOLD[1], GOLD[2], 245 * fade);
      triangle(gone + 5, -3, gone + 12, 0, gone + 5, 3);
      pop();
    }
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 225 * fade);
      strokeWeight(3);
      circle(mark.x, mark.y, 22 * (0.5 + 0.5 * flown));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 40) * 2);
  }
}
