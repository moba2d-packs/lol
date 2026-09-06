import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Airborne = api.buffs.Airborne;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


/** `docs/abilities/aatrox/q.json`: three casts before the ability goes down. */
export const Q_CASTS = 3;

/** "If Aatrox does not recast the ability within 4 seconds … it goes on cooldown." */
export const Q_WINDOW_MS = 4_000;

/** The record's "1-second static cooldown between casts", kept whole. */
export const Q_GAP_MS = 1_000;

/**
 * What the ordinary edge of the swing does, one entry per cast.
 *
 * The record escalates by a flat 25% a cast (`10 / 12.5 / 15` at rank 1). Written
 * out rather than computed, because `12 * 1.25 * 1.25` is `18.75` and the
 * description would print a number with a binary tail in it — `tests/
 * spellNumberFormat.test.ts` is the scan that would catch it, and the honest
 * fix is to choose the three numbers rather than to round a formula in the
 * sentence and leave the damage un-rounded.
 */
export const Q_DAMAGE = [12, 15, 18];

/**
 * And what the **Sweetspot** does — the far edge of the blade, 75% more, and
 * the only part of the swing that knocks up. Same rounding argument as above:
 * these are `Q_DAMAGE` × 1.75, rounded once, here.
 */
export const Q_SWEET_DAMAGE = [21, 26, 32];

/** Record: 0.25s, and the whole reason to aim the far edge rather than the near one. */
export const Q_KNOCKUP_MS = 250;

/** First cast: a rectangle he stands on the back line of. */
export const Q_LANE_LENGTH = 240;

export const Q_LANE_HALF_WIDTH = 42;

/** …with the Sweetspot at the farthest edge of it. */
export const Q_LANE_SWEET_FROM = 160;

/** Second cast: a trapezoid opening away from him, starting slightly behind. */
export const Q_FAN_BEHIND = 50;

export const Q_FAN_FORWARD = 230;

export const Q_FAN_NEAR_HALF = 75;

export const Q_FAN_FAR_HALF = 125;

export const Q_FAN_SWEET_FROM = 160;

/** Third cast: a circle planted in front of him, with a smaller one inside it. */
export const Q_SLAM_OFFSET = 100;

export const Q_SLAM_RADIUS = 150;

export const Q_SLAM_SWEET_RADIUS = 90;

/** The farthest any of the three reaches — what the HUD ring draws. */
export const Q_RANGE = Math.max(Q_LANE_LENGTH, Q_FAN_FORWARD, Q_SLAM_OFFSET + Q_SLAM_RADIUS);


const DARK: [number, number, number] = [24, 14, 18];

const BLOOD: [number, number, number] = [186, 26, 44];

const EMBER: [number, number, number] = [255, 138, 120];


/**
 * Where a body stands relative to a swing: `along` the heading, `across` it.
 *
 * Every one of the three shapes is stated in these two numbers, which is what
 * keeps the hit test and the drawing agreeing — the picture below rotates into
 * the same frame and paints the same bounds.
 */
export function swingLocal(
  vx: number,
  vy: number,
  ox: number,
  oy: number,
  heading: number
): { along: number; across: number } {
  const dx = vx - ox;
  const dy = vy - oy;
  const facingX = Math.cos(heading);
  const facingY = Math.sin(heading);
  return { along: dx * facingX + dy * facingY, across: -dx * facingY + dy * facingX };
}

/** What one swing did to one body: nothing, the edge, or the Sweetspot. */
export type SwingHit = 'miss' | 'edge' | 'sweet';

/**
 * The three shapes, as one function, so a test can ask the geometry without
 * building a world. `body` is the victim's collision radius: a wide body
 * clipping the edge of the swing is cut by it, exactly as the record says
 * ("if any part of your gameplay radius is within the hitbox").
 */
export function swingHit(
  cast: number,
  along: number,
  across: number,
  body = 0
): SwingHit {
  if (cast === 0) {
    if (Math.abs(across) > Q_LANE_HALF_WIDTH + body) return 'miss';
    if (along < -body || along > Q_LANE_LENGTH + body) return 'miss';
    return along >= Q_LANE_SWEET_FROM ? 'sweet' : 'edge';
  }

  if (cast === 1) {
    if (along < -Q_FAN_BEHIND - body || along > Q_FAN_FORWARD + body) return 'miss';
    // The trapezoid widens evenly from the back line to the front one.
    const opened =
      (Math.min(Math.max(along, -Q_FAN_BEHIND), Q_FAN_FORWARD) + Q_FAN_BEHIND) /
      (Q_FAN_BEHIND + Q_FAN_FORWARD);
    const halfWidth = Q_FAN_NEAR_HALF + (Q_FAN_FAR_HALF - Q_FAN_NEAR_HALF) * opened;
    if (Math.abs(across) > halfWidth + body) return 'miss';
    return along >= Q_FAN_SWEET_FROM ? 'sweet' : 'edge';
  }

  const away = Math.hypot(along - Q_SLAM_OFFSET, across);
  if (away > Q_SLAM_RADIUS + body) return 'miss';
  return away <= Q_SLAM_SWEET_RADIUS ? 'sweet' : 'edge';
}


/**
 * The Darkin Blade — three swings off one cooldown, each a different shape.
 *
 * The three-cast bookkeeping is `Riven_Q`'s, deliberately and down to the
 * comments, because the trap it is shaped around is not Riven's: `Spell.runtime`
 * resolves `castSpec` **once**, on the opening press, and freezes it. A spec
 * that answered "which swing is this" from live state would answer for the
 * opening press for the rest of the match, and the real cooldown would never
 * once start. So the spec states the true cooldown — a constant, and the honest
 * one for the HUD ring — and `onSpellCast` shortens it by hand for the first
 * two swings.
 */
export default class Aatrox_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  image = api.asset('spell_aatrox_q');
  name = 'Quỷ Kiếm Darkin (Aatrox_Q)';
  description =
    `Bổ đại kiếm ${Q_CASTS} lần trong <span class="time">${secs(Q_WINDOW_MS)} giây</span>: ` +
    `một <span class="buff">đường thẳng</span>, một <span class="buff">hình quạt</span> rộng, ` +
    `rồi một <span class="buff">vòng tròn</span> đập xuống phía trước. ` +
    `Gây ${dmg(Q_DAMAGE[0], 'PHYSICAL')} → ${dmg(Q_DAMAGE[1], 'PHYSICAL')} → ` +
    `${dmg(Q_DAMAGE[2], 'PHYSICAL')} ở rìa lưỡi kiếm. ` +
    `Kẻ địch đứng đúng <span class="buff">Điểm Hiểm</span> — mép ngoài của nhát chém — ` +
    `nhận ${dmg(Q_SWEET_DAMAGE[0], 'PHYSICAL')} → ${dmg(Q_SWEET_DAMAGE[1], 'PHYSICAL')} → ` +
    `${dmg(Q_SWEET_DAMAGE[2], 'PHYSICAL')} và bị <span class="buff">hất tung</span>.`;
  /**
   * Paid once, for all three swings, which is why it is not on the shelf beside
   * the other Qs: two `Q_GAP_MS` pauses plus this is one cast every 3.7s, in the
   * band the rest of the roster's basics sit in. Longer than `Q_WINDOW_MS`, so
   * the combo always ends by being spent rather than by timing out.
   */
  coolDown = 9_000;
  manaCost = 0;
  range = Q_RANGE;

  /** Swings left in the open combo. Refilled lazily, so the HUD badge is honest. */
  swingsLeft = Q_CASTS;
  /** ms since the first cast of the open combo; -1 when no combo is open. */
  comboElapsedMs = -1;

  get stackCount(): number {
    return this.swingsLeft;
  }

  setStackCount(count: number): boolean {
    this.swingsLeft = Math.max(0, Math.min(Q_CASTS, Math.floor(count)));
    return true;
  }

  private get comboLapsed(): boolean {
    return this.comboElapsedMs < 0 || this.comboElapsedMs >= Q_WINDOW_MS;
  }

  /** **Nothing here may read live state** — see the class header. */
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onUpdate(): void {
    if (this.comboElapsedMs < 0) return;
    this.comboElapsedMs += deltaTime;
    if (this.comboElapsedMs >= Q_WINDOW_MS) this.resetCombo();
  }

  resetCombo(): void {
    this.swingsLeft = Q_CASTS;
    this.comboElapsedMs = -1;
  }

  onSpellCast(context: CastContext): void {
    if (this.comboLapsed || this.swingsLeft <= 0) {
      this.swingsLeft = Q_CASTS;
      this.comboElapsedMs = 0;
    }

    const cast = Q_CASTS - this.swingsLeft;
    const isFinal = this.swingsLeft <= 1;
    this.swingsLeft = Math.max(0, this.swingsLeft - 1);

    // The runtime starts the frozen spec's cooldown on release; this is what
    // makes the first two swings a pause instead of that. `reducedCooldown` for
    // the real one, so ability haste still reaches it.
    this.currentCooldown = isFinal ? this.reducedCooldown(this.coolDown) : Q_GAP_MS;

    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);
    this.swing(cast, heading);
  }

  /**
   * One swing, resolved where he stands. The greatsword is not a projectile and
   * has no flight: what is inside the shape when the blade comes round is what
   * it cuts.
   */
  private swing(cast: number, heading: number): void {
    const atX = this.owner.position.x;
    const atY = this.owner.position.y;
    const reach = effectiveRange(Q_RANGE, this.owner);
    const edges: { x: number; y: number }[] = [];
    const sweets: { x: number; y: number }[] = [];

    // No vision filter: a swept blade still lands on the champion in the bush.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: atX, y: atY, r: reach + Q_FAN_FAR_HALF }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const { along, across } = swingLocal(
        victim.position.x,
        victim.position.y,
        atX,
        atY,
        heading
      );
      const landed = swingHit(cast, along, across, victim.collisionRadius || 0);
      if (landed === 'miss') continue;

      struck.add(victim);
      if (landed === 'sweet') {
        victim.takeDamage(Q_SWEET_DAMAGE[cast], this.owner, 'PHYSICAL');
        victim.addBuff(new Airborne(Q_KNOCKUP_MS, this.owner, victim));
        sweets.push({ x: victim.position.x, y: victim.position.y });
      } else {
        victim.takeDamage(Q_DAMAGE[cast], this.owner, 'PHYSICAL');
        edges.push({ x: victim.position.x, y: victim.position.y });
      }
    }

    this.game.objectManager.addObject(
      new Aatrox_Q_Swing(this.owner, cast, atX, atY, heading, edges, sweets)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The greatsword coming round, drawn in the swing's own frame.
 *
 * Three shapes, one object, because they are one ability and the eye should
 * read them as three phrases of it: the same black iron body, the same crimson
 * rim, the same brighter band marking the Sweetspot — moved, not restyled.
 * Ground art, so `zIndex` is `GROUND_Z_INDEX`: an un-overridden `SpellObject`
 * would paint the swing over the feet of everyone standing in it.
 */
export class Aatrox_Q_Swing extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 320;
  age = 0;
  readonly cast: number;
  readonly heading: number;
  readonly edges: { x: number; y: number }[];
  readonly sweets: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    cast: number,
    atX: number,
    atY: number,
    heading: number,
    edges: { x: number; y: number }[],
    sweets: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(atX, atY);
    this.cast = cast;
    this.heading = heading;
    this.edges = edges;
    this.sweets = sweets;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    // One clock: the blade sweeps out fast, then the whole thing fades.
    const swept = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noStroke();
    fill(DARK[0], DARK[1], DARK[2], 190 * fade);

    if (this.cast === 0) {
      const reached = Q_LANE_LENGTH * swept;
      rectMode(CORNER);
      rect(0, -Q_LANE_HALF_WIDTH, reached, Q_LANE_HALF_WIDTH * 2);
      // The Sweetspot band, brighter, on exactly the numbers the hit test used.
      if (reached > Q_LANE_SWEET_FROM) {
        fill(BLOOD[0], BLOOD[1], BLOOD[2], 165 * fade);
        rect(
          Q_LANE_SWEET_FROM,
          -Q_LANE_HALF_WIDTH,
          reached - Q_LANE_SWEET_FROM,
          Q_LANE_HALF_WIDTH * 2
        );
      }
      noFill();
      stroke(EMBER[0], EMBER[1], EMBER[2], 235 * fade);
      strokeWeight(3);
      rect(0, -Q_LANE_HALF_WIDTH, reached, Q_LANE_HALF_WIDTH * 2);
    } else if (this.cast === 1) {
      const front = -Q_FAN_BEHIND + (Q_FAN_BEHIND + Q_FAN_FORWARD) * swept;
      const opened = (front + Q_FAN_BEHIND) / (Q_FAN_BEHIND + Q_FAN_FORWARD);
      const half = Q_FAN_NEAR_HALF + (Q_FAN_FAR_HALF - Q_FAN_NEAR_HALF) * opened;
      quad(-Q_FAN_BEHIND, -Q_FAN_NEAR_HALF, front, -half, front, half, -Q_FAN_BEHIND, Q_FAN_NEAR_HALF);
      if (front > Q_FAN_SWEET_FROM) {
        const nearHalf =
          Q_FAN_NEAR_HALF +
          ((Q_FAN_FAR_HALF - Q_FAN_NEAR_HALF) * (Q_FAN_SWEET_FROM + Q_FAN_BEHIND)) /
            (Q_FAN_BEHIND + Q_FAN_FORWARD);
        fill(BLOOD[0], BLOOD[1], BLOOD[2], 165 * fade);
        quad(
          Q_FAN_SWEET_FROM,
          -nearHalf,
          front,
          -half,
          front,
          half,
          Q_FAN_SWEET_FROM,
          nearHalf
        );
      }
      noFill();
      stroke(EMBER[0], EMBER[1], EMBER[2], 235 * fade);
      strokeWeight(3);
      quad(-Q_FAN_BEHIND, -Q_FAN_NEAR_HALF, front, -half, front, half, -Q_FAN_BEHIND, Q_FAN_NEAR_HALF);
    } else {
      const grown = Q_SLAM_RADIUS * (0.45 + 0.55 * swept);
      circle(Q_SLAM_OFFSET, 0, grown * 2);
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 175 * fade);
      circle(Q_SLAM_OFFSET, 0, Math.min(grown, Q_SLAM_SWEET_RADIUS) * 2);
      noFill();
      stroke(EMBER[0], EMBER[1], EMBER[2], 235 * fade);
      strokeWeight(4);
      circle(Q_SLAM_OFFSET, 0, grown * 2);
      strokeWeight(2);
      circle(Q_SLAM_OFFSET, 0, Q_SLAM_SWEET_RADIUS * 2);
    }
    pop();

    // The cut on each body that took it — a short bar across the blade's line,
    // twice as long for a Sweetspot, which is the only difference a player
    // needs to see to learn where the edge is.
    push();
    for (const [marks, reach] of [
      [this.edges, 14] as const,
      [this.sweets, 26] as const,
    ]) {
      for (const mark of marks) {
        stroke(EMBER[0], EMBER[1], EMBER[2], 240 * fade);
        strokeWeight(3);
        const acrossX = Math.cos(this.heading + Math.PI / 2) * reach;
        const acrossY = Math.sin(this.heading + Math.PI / 2) * reach;
        line(mark.x - acrossX, mark.y - acrossY, mark.x + acrossX, mark.y + acrossY);
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_RANGE + Q_FAN_FAR_HALF + 40) * 2);
  }
}
