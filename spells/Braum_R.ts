import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Airborne = api.buffs.Airborne;
const Slow = api.buffs.Slow;
const BuffAddType = api.enums.BuffAddType;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const R_DAMAGE = 46;

export const R_LENGTH = 340;

/** Half-width of the crack, and of the ice field it leaves behind. */
export const R_HALF_WIDTH = 45;

export const R_KNOCKUP_MS = 600;

/** The first body it reaches is thrown higher — the record scales it with distance. */
export const R_FIRST_KNOCKUP_MS = 1_000;

export const R_FIELD_MS = 3_000;

export const R_FIELD_SLOW = 0.4;

/** How often the ice field re-applies its slow to whatever is standing on it. */
export const R_FIELD_TICK_MS = 250;

/** How fast the crack runs out from him, in px a frame. */
export const R_TRAVEL_SPEED = 18;

export const R_MANA = 100;


const ICE: [number, number, number] = [126, 206, 235];

const DEEP: [number, number, number] = [24, 62, 96];

const STEEL: [number, number, number] = [188, 196, 205];


/** Shortest distance from a point to the segment `a -> b`, ends included. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}


export default class Braum_R extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Cc | api.enums.SpellRole.Zone;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_braum_r');
  name = 'Băng Địa Chấn (Braum_R)';
  description =
    `Đập khiên xuống đất, mở một khe nứt dài <span>${R_LENGTH}px</span> chạy về phía trước. ` +
    `Mọi kẻ địch trên đường nhận ${dmg(R_DAMAGE, 'MAGIC')} và bị <span class="buff">hất tung</span>; ` +
    `kẻ đầu tiên bị hất lâu hơn (<span class="time">${secs(R_FIRST_KNOCKUP_MS)}</span> so với ` +
    `<span class="time">${secs(R_KNOCKUP_MS)}</span> giây). ` +
    `Khe nứt để lại một dải băng <span class="time">${secs(R_FIELD_MS)} giây</span> ` +
    `<span class="buff">Làm Chậm ${pct(R_FIELD_SLOW)}%</span> mọi kẻ đứng trên đó.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_LENGTH;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const heading = Math.atan2(aim.y, aim.x);
    const reach = effectiveRange(R_LENGTH, this.owner);

    this.game.objectManager.addObject(
      new Braum_R_Fissure(
        this.owner,
        this.owner.position.x,
        this.owner.position.y,
        this.owner.position.x + (aim.x / span) * reach,
        this.owner.position.y + (aim.y / span) * reach,
        heading
      )
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The crack running out from his shield, and then the ice it leaves.
 *
 * One object for both halves rather than two, because they are the same line:
 * the field is exactly as long as the crack got, so a fissure stopped short by
 * the map edge leaves a short field and not a full one.
 *
 * It travels rather than resolving at once — that travel is the counter-play,
 * and a body it has not reached yet can still walk off the line.
 */
export class Braum_R_Fissure extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** How far the crack has run. Grows until it reaches the end of the line. */
  reached = 0;
  /** True once the crack has stopped and the field has started its own clock. */
  settled = false;
  fieldMs = 0;
  private tickMs = 0;
  /** Whether the first body has already been thrown higher than the rest. */
  firstHitSpent = false;

  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly heading: number;
  private readonly struck = new Set<AttackableUnit>();

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    heading: number
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.heading = heading;
  }

  get span(): number {
    return Math.hypot(this.toX - this.fromX, this.toY - this.fromY);
  }

  /** The far end of the crack as it stands this frame. */
  get tipX(): number {
    return this.fromX + Math.cos(this.heading) * this.reached;
  }

  get tipY(): number {
    return this.fromY + Math.sin(this.heading) * this.reached;
  }

  update(): void {
    if (!this.settled) {
      const before = this.reached;
      this.reached = Math.min(this.span, this.reached + R_TRAVEL_SPEED);
      this.crack(before, this.reached);
      if (this.reached >= this.span) this.settled = true;
      return;
    }

    this.fieldMs += deltaTime;
    if (this.fieldMs >= R_FIELD_MS) {
      this.toRemove = true;
      return;
    }

    this.tickMs += deltaTime;
    while (this.tickMs >= R_FIELD_TICK_MS) {
      this.tickMs -= R_FIELD_TICK_MS;
      this.chill();
    }
  }

  /** Everything the crack passed over between `from` and `to` along the line. */
  private crack(from: number, to: number): void {
    const aX = this.fromX + Math.cos(this.heading) * from;
    const aY = this.fromY + Math.sin(this.heading) * from;
    const bX = this.fromX + Math.cos(this.heading) * to;
    const bY = this.fromY + Math.sin(this.heading) * to;

    // No vision filter: the ground opening under a champion in a bush still
    // opens under them.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (aX + bX) / 2,
        y: (aY + bY) / 2,
        r: (to - from) / 2 + R_HALF_WIDTH + 40,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (this.struck.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, aX, aY, bX, bY) > R_HALF_WIDTH + body) {
        continue;
      }

      this.struck.add(victim);
      victim.takeDamage(R_DAMAGE, this.owner, 'MAGIC');
      const held = this.firstHitSpent ? R_KNOCKUP_MS : R_FIRST_KNOCKUP_MS;
      this.firstHitSpent = true;
      victim.addBuff(new Airborne(held, this.owner, victim));
    }
  }

  /** The field's own job: whatever is standing on the ice, every quarter second. */
  private chill(): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (this.fromX + this.toX) / 2,
        y: (this.fromY + this.toY) / 2,
        r: this.span / 2 + R_HALF_WIDTH + 40,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      if (
        distanceToSegment(
          victim.position.x,
          victim.position.y,
          this.fromX,
          this.fromY,
          this.toX,
          this.toY
        ) >
        R_HALF_WIDTH + body
      ) {
        continue;
      }
      // `RENEW_EXISTING` is load-bearing here and nowhere more so: this runs
      // four times a second for three seconds, and `Slow`'s default stacks ten
      // deep — a 40% slow re-applied per tick becomes a root inside one second.
      const slow = new Slow(R_FIELD_TICK_MS * 2, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = R_FIELD_SLOW;
      victim.addBuff(slow);
    }
  }

  draw(): void {
    const fade = this.settled ? Math.max(0, 1 - this.fieldMs / R_FIELD_MS) : 1;

    push();
    translate(this.fromX, this.fromY);
    rotate(this.heading);
    rectMode(CORNER);

    // The ice on the ground: a flat slab exactly as long as the crack has run.
    noStroke();
    fill(DEEP[0], DEEP[1], DEEP[2], 120 * fade);
    rect(0, -R_HALF_WIDTH, this.reached, R_HALF_WIDTH * 2);
    noFill();
    stroke(ICE[0], ICE[1], ICE[2], 220 * fade);
    strokeWeight(3);
    rect(0, -R_HALF_WIDTH, this.reached, R_HALF_WIDTH * 2);

    // Shards standing up out of it, on a fixed lattice so nothing flickers.
    noStroke();
    const shards = Math.max(1, Math.floor(this.reached / 46));
    for (let i = 0; i < shards; i++) {
      const at = ((i + 0.5) * this.reached) / shards;
      const lean = i % 2 === 0 ? -1 : 1;
      fill(STEEL[0], STEEL[1], STEEL[2], 200 * fade);
      triangle(at - 10, lean * 8, at + 10, lean * 8, at, lean * (R_HALF_WIDTH - 4));
      fill(ICE[0], ICE[1], ICE[2], 225 * fade);
      triangle(at - 5, lean * 8, at + 5, lean * 8, at, lean * (R_HALF_WIDTH - 12));
    }

    // The leading edge, while it is still running.
    if (!this.settled) {
      stroke(255, 255, 255, 235);
      strokeWeight(5);
      line(this.reached, -R_HALF_WIDTH, this.reached, R_HALF_WIDTH);
    }
    pop();
  }

  getDisplayBoundingBox() {
    // Centred on the origin of the crack, so the box has to cover the whole run.
    return this.squareDisplayBoundingBox((this.span + R_HALF_WIDTH + 40) * 2);
  }
}
