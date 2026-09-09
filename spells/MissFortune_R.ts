import type { AttackableUnit, CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const R_DURATION_MS = 2_500;

export const R_WAVE_MS = 250;

export const R_WAVE_DAMAGE = 5;

export const R_WAVES = Math.floor(R_DURATION_MS / R_WAVE_MS);

export const R_TOTAL_DAMAGE = R_WAVES * R_WAVE_DAMAGE;

/**
 * How far the fan reaches.
 *
 * **520, not 380.** Her auto-attack reaches 300 (`ATTACK.MARKSMAN` in
 * `data.ts`), so the old cone out-ranged her own right-click by a quarter and
 * the ultimate she stands still for read as a slightly longer punch — reported
 * as "tầm nó vừa ngắn vừa khó thấy hiệu ứng". At 520 it is 1.7× her reach,
 * which is the shape the ability is for: she plants herself out of the fight
 * and covers a piece of the map with it. In band with the other ultimates that
 * paint a lane of ground in this pack (Draven, Irelia, Xerath all sit at 520).
 *
 * The per-wave damage is untouched: a longer cone catches more people, it does
 * not hit any of them harder.
 */
export const R_LENGTH = 520;

export const R_ARC_DEG = 44;

/** Six bullets a wave — the record's number, and what the picture draws. */
export const R_BULLETS = 9;

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

  /** The cone held on screen for the whole channel. See `MissFortune_R_Field`. */
  field: MissFortune_R_Field | null = null;

  onCastStart(context: CastContext): void {
    const aim = this.firingDirection(context);
    this.heading = Math.atan2(aim.y, aim.x);
    this.wavesFired = 0;

    this.field = new MissFortune_R_Field(
      this.owner,
      this.heading,
      effectiveRange(R_LENGTH, this.owner)
    );
    this.game.objectManager.addObject(this.field);
  }

  onChannelTick(): void {
    if (this.owner.isDead) return;
    this.wavesFired += 1;
    this.fireWave();
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    // The waves need no unwinding — the ability *is* its waves, and a cancelled
    // channel simply stops firing them. The cone on the ground does: it is a
    // promise about where the next wave is going, and one left painted over a
    // channel somebody interrupted is a lie about a barrage that is not coming.
    if (this.field) this.field.toRemove = true;
    this.field = null;
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


/**
 * The cone, held for the whole barrage.
 *
 * ## Why this object exists
 *
 * The shape used to be painted by each wave and faded inside 300ms, at an
 * alpha of 60 — so the one thing a player on either side needs to know, *where
 * the bullets are going*, blinked ten times across one channel and was never
 * once at full strength. "Khó thấy hiệu ứng" was the report, and this is the
 * half of it that is not the reach.
 *
 * Held steady instead: one fill, one hard outline, for as long as she is
 * firing. That is also **cheaper** than what it replaces — two overlapping
 * per-wave wedges were being blended at any moment (waves land every 250ms and
 * lived 300ms), where this is one.
 *
 * ## Flat, and outlined rather than washed
 *
 * No glow and no blur anywhere in this game. The fill is deliberately weak and
 * the *edge* is what carries the shape: two lines down the sides and an arc
 * across the mouth, at full alpha. An edge is legible over any ground the map
 * has; a wash is not.
 *
 * Ground art, so it draws under the bodies standing in it — a champion in the
 * cone must stay readable, which is the whole reason they are looking at it.
 */
export class MissFortune_R_Field extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;

  constructor(
    owner: AttackableUnit,
    readonly heading: number,
    readonly reach: number
  ) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.age += deltaTime;
    // The channel's own length is the ceiling; an interrupt takes it off
    // earlier through `MissFortune_R.onCancel`, and a death takes it off here.
    if (this.age >= R_DURATION_MS || this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    // She is rooted while firing, but a displacement is not a move order — the
    // cone belongs on her body wherever the body ends up.
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const halfArc = (R_ARC_DEG * Math.PI) / 360;
    // It opens over the first tenth of a second rather than appearing at full
    // width, so the press has a beat of its own.
    const opening = Math.min(1, this.age / 100);
    const reach = this.reach * opening;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    noStroke();
    fill(LEATHER[0], LEATHER[1], LEATHER[2], 70);
    beginShape();
    vertex(0, 0);
    for (let i = 0; i <= 12; i++) {
      const spin = -halfArc + (halfArc * 2 * i) / 12;
      vertex(Math.cos(spin) * reach, Math.sin(spin) * reach);
    }
    endShape(CLOSE);

    // The edge, which is what actually says "stand out of here".
    noFill();
    stroke(GOLD[0], GOLD[1], GOLD[2], 215);
    strokeWeight(3);
    line(0, 0, Math.cos(-halfArc) * reach, Math.sin(-halfArc) * reach);
    line(0, 0, Math.cos(halfArc) * reach, Math.sin(halfArc) * reach);
    arc(0, 0, reach * 2, reach * 2, -halfArc, halfArc);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 40) * 2);
  }
}


/** One wave: nine hard slugs fanning out, and a mark on what they caught. */
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

    // **The wedge is not drawn here.** It used to be, at an alpha of 60 and a
    // 300ms fade, so the shape a player had to stand out of flickered in and
    // out ten times across one channel and was never on screen at full
    // strength. `MissFortune_R_Field` holds it steady for the whole barrage
    // instead; this object is the barrage.

    // The muzzle: a hard flare at her hip on the frame the wave leaves, so the
    // rhythm of the channel is readable from her body as well as from the
    // slugs.
    noStroke();
    const flare = Math.max(0, 1 - t * 3);
    if (flare > 0) {
      fill(GOLD[0], GOLD[1], GOLD[2], 245 * flare);
      triangle(6, -9 * flare, 34 * flare, 0, 6, 9 * flare);
    }

    rectMode(CENTER);
    for (let i = 0; i < R_BULLETS; i++) {
      const spin = -halfArc + (halfArc * 2 * i) / (R_BULLETS - 1);
      // Staggered by a tenth of the flight so the volley reads as a spray
      // rather than as a rigid comb; the slug at each edge still starts at the
      // hip, so the shape of the fan is never in doubt.
      const stagger = 1 - 0.1 * ((i * 5) % R_BULLETS) / R_BULLETS;
      const gone = this.reach * flown * stagger;
      push();
      rotate(spin);
      // Bigger than they were, and with a bright core: at 520 a 16x6 slug is
      // three pixels of contrast on a lane of ground.
      fill(LEATHER[0], LEATHER[1], LEATHER[2], 240 * fade);
      rect(gone, 0, 24, 8, 3);
      fill(GOLD[0], GOLD[1], GOLD[2], 250 * fade);
      rect(gone + 2, 0, 14, 4, 2);
      triangle(gone + 9, -4, gone + 18, 0, gone + 9, 4);
      pop();
    }
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 235 * fade);
      strokeWeight(4);
      circle(mark.x, mark.y, 30 * (0.5 + 0.5 * flown));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 40) * 2);
  }
}
