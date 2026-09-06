import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { Riven_R_Reforge } from './Riven_R';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Airborne = api.buffs.Airborne;
const Dash = api.buffs.Dash;
const StatsModifier = api.units.StatsModifier;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const Q_CHARGES = 3;

export const Q_WINDOW_MS = 4_000;

export const Q_STEP = 160;

/**
 * The third is a *leap*, not a longer dash, so it is shorter than the other two
 * and the slam it lands is what covers the ground instead. Anything she was
 * standing next to when she jumped is still inside `Q_SLAM_RADIUS` when she
 * comes down, which is the whole point of the number.
 */
export const Q_STEP_FINAL = 150;

export const Q_RADIUS = 150;

export const Q_ARC_DEG = 120;

/**
 * Half-width of the lane she opens on the way over.
 *
 * The fan alone was a fan at the *landing point*, and that is the whole reason
 * this ability read as unhittable: a body standing right in front of her was
 * behind the apex by the time the wedge existed, at 180° off its axis, so the
 * closer an enemy stood the more reliably Riven dashed straight through them
 * and hit nothing. Reported from a real match, twice. What she swings through
 * is now part of what she cuts.
 */
export const Q_SWEEP_RADIUS = 80;

export const Q_DAMAGE = 14;

export const Q_DAMAGE_FINAL = 18;

export const Q_KNOCKUP_MS = 500;

/** The third charge comes down in a circle, not a wedge — she lands on all of it. */
export const Q_SLAM_RADIUS = 190;

/** How far off the ground the leap carries her, in the renderer's height units. */
export const Q_LEAP_HEIGHT = 26;

export const Q_RANGE = Math.max(Q_STEP + Q_RADIUS, Q_STEP_FINAL + Q_SLAM_RADIUS);

/** R widens whichever swing it lands on. */
const EMPOWERED_SCALE = 1.16;


/**
 * Between charges she only pauses; the real cooldown waits for the third.
 *
 * `docs/abilities/riven/q.json`: "a 0.3125-second static cooldown between
 * casts". Ours was 260ms, which ran the three swings together into one blur.
 */
export const Q_CHARGE_GAP_MS = 313;

const Q_DASH_MS = 320;

const Q_DASH_SPEED = 15;

/** The leap hangs a little: slower than the ground dashes, over a shorter step. */
const Q_LEAP_SPEED = 11;



/** Shortest distance from a point to the segment `a -> b`, ends included. */
function distanceToSegment(
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


const IRON: [number, number, number] = [30, 39, 46];

const RUNE: [number, number, number] = [0, 210, 168];

const RUNE_HOT: [number, number, number] = [150, 255, 228];


export default class Riven_Q extends Spell {
  image = api.asset('spell_riven_q');
  name = 'Tam Bộ Kiếm (Riven_Q)';
  description =
    `Lao ${Q_STEP} về phía trước, chém mọi kẻ địch <span class="buff">trên đường lướt</span> ` +
    `rồi bung một hình quạt ${Q_ARC_DEG}° bán kính ${Q_RADIUS} tại điểm đáp, ` +
    `gây ${dmg(Q_DAMAGE, 'PHYSICAL')}. Có ${Q_CHARGES} lần đánh trong ` +
    `${secs(Q_WINDOW_MS)} giây; nhát thứ ba <span class="buff">nhảy lên không</span> rồi bổ kiếm ` +
    `xuống đất, gây ${dmg(Q_DAMAGE_FINAL, 'PHYSICAL')} và hất tung mọi kẻ địch trong bán kính ` +
    `${Q_SLAM_RADIUS} quanh chỗ đáp.`;
  /**
   * Paid once, for **all three** swings — which is why it is not on the shelf
   * beside the other Qs.
   *
   * It was 3_500, the same as a single-cast Q like Yasuo's, and that is the
   * whole bug: three casts came out of one 3.5s cooldown, so Riven cast at
   * **2.6x the rate of every other champion in the pack** and the ability was
   * effectively always up. Reported as "spam chiêu liên tục luôn".
   *
   * 9s puts the combo at one cast per 3.2s, in the middle of this pack's Q
   * shelf (Zed and Nasus 3.0, Yasuo 3.5). Upstream charges 13s and this pack
   * runs at a median 0.83 of upstream on basic abilities, which would say 10.8
   * — but that ratio is measured on *single-cast* abilities, so applying it to
   * a three-cast one and then also asking for per-cast parity charges the same
   * discount twice. Parity is the honest anchor of the two; the fidelity
   * number is here so a later retune can argue with the choice rather than
   * rediscover it.
   *
   * It is also longer than `Q_WINDOW_MS`, so the combo always ends by being
   * spent rather than by timing out.
   */
  coolDown = 9_000;
  manaCost = 0;
  range = Q_RANGE;

  /** Charges left in the open combo. Refilled lazily, so the HUD badge is always honest. */
  charges = Q_CHARGES;
  /** ms since the FIRST cast of the open combo; -1 when no combo is open. */
  comboElapsedMs = -1;

  get stackCount(): number {
    return this.charges;
  }

  setStackCount(count: number): boolean {
    this.charges = Math.max(0, Math.min(Q_CHARGES, Math.floor(count)));
    return true;
  }

  /**
   * What this press will actually spend, refill included.
   *
   * `castSpec` and `onSpellCast` both need this and used to work it out
   * separately, which let them disagree: the spec is resolved *before* the cast
   * is committed, so it read the spent-out `charges = 0` and called the press
   * final, while `onSpellCast` refilled to three and played it as the first
   * swing. The press then paid the full cooldown for a first swing. It could
   * only happen while the cooldown was shorter than the combo window — 3.5s
   * against 4s, which is exactly what shipped — so it is unreachable at 9s and
   * is fixed here anyway, because the next person to retune the number should
   * not have to rediscover it.
   */
  private get comboLapsed(): boolean {
    return this.comboElapsedMs < 0 || this.comboElapsedMs >= Q_WINDOW_MS;
  }

  /**
   * **Nothing here may read live state.** `Spell.runtime` resolves this getter
   * exactly once, on the opening press, and freezes the result for the rest of
   * the match (`src/seams/castSpecFrozen.ts`).
   *
   * This used to return `isFinal ? this.coolDown : Q_CHARGE_GAP_MS`, which read
   * `charges` — and `charges` is 3 on the opening press, so the frozen answer
   * was **the 313ms gap, forever**. Every swing including the third paid the
   * gap, the real cooldown never once started, and Riven could Q without limit.
   * Reported from a real match as "Q xong đợi chưa tới nửa giây là Q đc tiếp,
   * vô hạn luôn". The number on the field was never the problem.
   *
   * So the spec states the real cooldown — a constant, and the honest one for
   * the HUD ring and the catalog — and `onSpellCast` shortens it by hand for
   * the first two swings, which is what `Ahri_R` does for the same three-dash
   * shape and why that one was never broken.
   */
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onUpdate(): void {
    if (this.comboElapsedMs < 0) return;
    this.comboElapsedMs += deltaTime;
    if (this.comboElapsedMs >= Q_WINDOW_MS) this.resetCombo();
  }

  resetCombo(): void {
    this.charges = Q_CHARGES;
    this.comboElapsedMs = -1;
  }

  onSpellCast(context: CastContext): void {
    if (this.comboLapsed || this.charges <= 0) {
      this.charges = Q_CHARGES;
      this.comboElapsedMs = 0;
    }

    const isFinal = this.charges <= 1;
    this.charges = Math.max(0, this.charges - 1);

    // The runtime starts the frozen spec's cooldown on release; this is what
    // makes the first two swings a pause instead of that. `reducedCooldown`
    // for the real one so ability haste still reaches it — the runtime applies
    // it through `cooldownDurationMs` and a hand-set value skips that hook.
    this.currentCooldown = isFinal ? this.reducedCooldown(this.coolDown) : Q_CHARGE_GAP_MS;

    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const forwardX = aim.x / span;
    const forwardY = aim.y / span;
    const step = isFinal ? Q_STEP_FINAL : Q_STEP;
    const arrivalX = this.owner.position.x + forwardX * step;
    const arrivalY = this.owner.position.y + forwardY * step;
    const heading = Math.atan2(forwardY, forwardX);
    const empowered = this.owner.hasBuff(Riven_R_Reforge);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;

    // The first two cut as they go; the third is in the air the whole way and
    // pays out when it lands.
    if (!isFinal) this.slash(fromX, fromY, arrivalX, arrivalY, heading, empowered);

    const dash = new Dash(Q_DASH_MS, this.owner, this.owner);
    dash.dashDestination = createVector(arrivalX, arrivalY);
    dash.dashSpeed = isFinal ? Q_LEAP_SPEED : Q_DASH_SPEED;
    // The crescent is the subject; a dash trail behind it would only fight with it.
    dash.showTrail = false;
    this.owner.addBuff(dash);

    if (isFinal) {
      const leap = new Riven_Q_Leap(
        this.owner,
        fromX,
        fromY,
        arrivalX,
        arrivalY,
        heading,
        empowered
      );
      // After `addBuff`, so the object holds the instance the unit actually ticks.
      leap.dash = dash;
      this.game.objectManager.addObject(leap);
    }
  }

  /**
   * One sweep per ground charge: the lane she cuts on the way over, and the fan
   * she opens where she lands. Its own `Set`, so the swings are independent and
   * a unit standing still can eat all of them.
   *
   * Both halves are resolved here, at cast, from where she is and where she is
   * about to be — not on arrival. The dash is ~180ms and a player who aimed
   * through a body should be paid for it whether or not that body walked a
   * step during the flight.
   */
  private slash(
    fromX: number,
    fromY: number,
    atX: number,
    atY: number,
    heading: number,
    empowered: boolean
  ): void {
    const damage = Q_DAMAGE;
    const scale = empowered ? EMPOWERED_SCALE : 1;
    // Scaled once, here, and handed to the drawing — the fan used to be drawn
    // 12% (and under R, 30%) wider than the one that actually cut.
    const radius = effectiveRange(Q_RADIUS * scale, this.owner);
    const sweep = effectiveRange(Q_SWEEP_RADIUS * scale, this.owner);
    const halfArc = (Q_ARC_DEG * Math.PI) / 360;
    const hit = new Set<AttackableUnit>();
    const cuts: { x: number; y: number }[] = [];

    // One query around the whole thing — the lane plus the fan past its end —
    // so the geometry below is the only thing deciding who was cut.
    const midX = (fromX + atX) / 2;
    const midY = (fromY + atY) / 2;
    const half = Math.hypot(atX - fromX, atY - fromY) / 2;
    // No vision filter: an area slash still lands on the champion standing in a bush.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: midX, y: midY, r: half + Math.max(radius, sweep) }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      const body = victim.collisionRadius || 0;

      // The lane: anything within a blade's width of the line she travelled,
      // capped at both ends, so a body she started next to is inside it.
      const alongLane =
        distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, atX, atY) <=
        sweep + body;

      let inFan = false;
      if (!alongLane) {
        const dx = victim.position.x - atX;
        const dy = victim.position.y - atY;
        const away = Math.hypot(dx, dy);
        if (away <= radius + body) {
          let offAxis = Math.atan2(dy, dx) - heading;
          while (offAxis > Math.PI) offAxis -= Math.PI * 2;
          while (offAxis < -Math.PI) offAxis += Math.PI * 2;
          // A wide body just outside the wedge edge is still cut by it; a body ON the
          // arrival point is inside whatever its heading says.
          const bodyArc = Math.atan2(body, Math.max(away, 1));
          inFan = Math.abs(offAxis) <= halfArc + bodyArc;
        }
      }

      if (!alongLane && !inFan) continue;

      hit.add(victim);
      victim.takeDamage(damage, this.owner, 'PHYSICAL');
      cuts.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new Riven_Q_Slash(this.owner, fromX, fromY, atX, atY, heading, radius, sweep, cuts)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * What a ground swing looks like, and it is two things because the swing is:
 * the **lane** she cut on the way over — a hard-edged capsule on exactly the
 * corridor the hit test uses — and the **fan** at the landing, black iron with
 * rune light bleeding out of the torn inner edge.
 *
 * Both are handed the radii the hit actually used, so nothing here is drawn a
 * size the damage did not have. The third charge does not come through here at
 * all: it is a leap, and `Riven_Q_Slam` is its picture.
 */
export class Riven_Q_Slash extends SpellObject {
  lifeTime = 300;
  age = 0;
  readonly fromX: number;
  readonly fromY: number;
  readonly heading: number;
  readonly radius: number;
  readonly sweep: number;
  readonly cuts: { x: number; y: number }[];
  /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
  tears: number[] = [];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    atX: number,
    atY: number,
    heading: number,
    radius: number,
    sweep: number,
    cuts: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(atX, atY);
    this.fromX = fromX;
    this.fromY = fromY;
    this.heading = heading;
    this.radius = radius;
    this.sweep = sweep;
    this.cuts = cuts;
  }

  onAdded(): void {
    for (let i = 0; i < 12; i++) this.tears.push(random(-1, 1));
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  get outerRadius(): number {
    return this.radius;
  }

  /** How far she travelled — the lane's length. */
  get laneLength(): number {
    return Math.hypot(this.position.x - this.fromX, this.position.y - this.fromY);
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    // one clock: the wedge sweeps open fast, then the whole thing fades
    const swept = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const halfArc = (Q_ARC_DEG * Math.PI) / 360;
    const from = this.heading - halfArc;
    const outer = this.radius;
    const inner = outer * 0.34;
    const steps = 14;
    const opened = halfArc * 2 * swept;

    push();
    // The lane, first and underneath: a capsule on the corridor the hit test
    // walks, wiping open along the direction of travel. Rounded ends because
    // the corridor is capped at both ends, not squared off.
    push();
    translate(this.fromX, this.fromY);
    rotate(this.heading);
    rectMode(CORNER);
    const lane = this.laneLength * swept;
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 130 * fade);
    rect(0, -this.sweep, lane, this.sweep * 2, this.sweep);
    noFill();
    stroke(RUNE[0], RUNE[1], RUNE[2], 165 * fade);
    strokeWeight(2);
    rect(0, -this.sweep, lane, this.sweep * 2, this.sweep);
    // the line of the blade down the middle of it
    stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 190 * fade);
    strokeWeight(3);
    line(0, 0, lane, 0);
    pop();

    noStroke();
    // black iron body of the slash
    fill(IRON[0], IRON[1], IRON[2], 200 * fade);
    beginShape();
    for (let i = 0; i <= steps; i++) {
      const spin = from + opened * (i / steps);
      vertex(this.position.x + Math.cos(spin) * outer, this.position.y + Math.sin(spin) * outer);
    }
    for (let i = steps; i >= 0; i--) {
      const spin = from + opened * (i / steps);
      const torn = this.tears.length > 0 ? this.tears[i % this.tears.length] : 0;
      const edge = inner + torn * 15;
      vertex(this.position.x + Math.cos(spin) * edge, this.position.y + Math.sin(spin) * edge);
    }
    endShape(CLOSE);

    // rune light bleeding out of the cracks, on the real hit radius
    noFill();
    stroke(RUNE[0], RUNE[1], RUNE[2], 235 * fade);
    strokeWeight(4);
    beginShape();
    for (let i = 0; i <= steps; i++) {
      const spin = from + opened * (i / steps);
      vertex(this.position.x + Math.cos(spin) * outer, this.position.y + Math.sin(spin) * outer);
    }
    endShape();

    // both edges of the wedge, so the fan reads as a fan and not as an arc
    stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 250 * fade);
    strokeWeight(3);
    for (const edge of [from, from + opened]) {
      line(
        this.position.x + Math.cos(edge) * inner,
        this.position.y + Math.sin(edge) * inner,
        this.position.x + Math.cos(edge) * outer,
        this.position.y + Math.sin(edge) * outer
      );
    }

    // the cut on each body that took it
    strokeWeight(3);
    for (const cut of this.cuts) {
      const reach = 15 * (0.4 + 0.6 * swept);
      stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 240 * fade);
      line(
        cut.x - Math.cos(this.heading + Math.PI / 3) * reach,
        cut.y - Math.sin(this.heading + Math.PI / 3) * reach,
        cut.x + Math.cos(this.heading + Math.PI / 3) * reach,
        cut.y + Math.sin(this.heading + Math.PI / 3) * reach
      );
      noFill();
      stroke(RUNE[0], RUNE[1], RUNE[2], 170 * fade);
      strokeWeight(2);
      circle(cut.x, cut.y, reach * 2.2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    // Centred on the landing point, so the box has to reach back over the lane
    // as well as out past the fan or the whole effect is culled early.
    return this.squareDisplayBoundingBox((this.radius + this.laneLength + 60) * 2);
  }
}


/**
 * The third charge in the air: the hop itself, the shadow under it, the ring
 * telling everyone where it is about to come down, and the slam it pays out
 * with when it lands.
 *
 * Deliberately not `attachTo(owner)`: an attached object drops the frame its
 * anchor dies, and this one has to take the lift back off on exactly that
 * frame. Same reason `Sakura_R_Leap` is built this way. Ground art, so `zIndex`
 * is `GROUND_Z_INDEX` — the shadow and the ring belong under everyone's feet,
 * and an un-overridden `SpellObject` would sit over them.
 */
export class Riven_Q_Leap extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  /** The dash carrying her. When it is gone, she has arrived — however it ended. */
  dash: InstanceType<typeof Dash> | null = null;

  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly heading: number;
  readonly empowered: boolean;

  landed = false;
  /** Whether the height bonus is still applied. `removeModifier` twice shrinks her. */
  private lifted = false;
  private lift = new StatsModifier();
  private fadeMs = 0;

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    heading: number,
    empowered: boolean
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.heading = heading;
    this.empowered = empowered;
  }

  /** Guarded, because `addModifier` folds the number in and a second call doubles it. */
  onAdded(): void {
    if (this.lifted || this.landed) return;
    // Set once and removed once: mutating the modifier per frame would drift the
    // stat instead of animating it. The renderer's own lerp on
    // `animatedValues.height` is what makes the rise and the drop smooth.
    this.lift.height.baseBonus = Q_LEAP_HEIGHT;
    this.owner.stats.addModifier(this.lift);
    this.lifted = true;
  }

  /** The slam's real radius — the ring drawn while she is up there is this one. */
  get slamRadius(): number {
    return effectiveRange(Q_SLAM_RADIUS * (this.empowered ? EMPOWERED_SCALE : 1), this.owner);
  }

  /** 0 at the take-off point, 1 at the destination. */
  get progress(): number {
    const total = Math.hypot(this.toX - this.fromX, this.toY - this.fromY);
    if (total <= 0) return 1;
    const gone = Math.hypot(this.owner.position.x - this.fromX, this.owner.position.y - this.fromY);
    return Math.max(0, Math.min(1, gone / total));
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (!this.landed) {
      // The dash is the clock. Arriving, being knocked out of it and simply
      // running out all end here, so every ending reads the same.
      if (!this.dash || this.dash.toRemove) this.land();
      return;
    }

    this.fadeMs += deltaTime;
    if (this.fadeMs >= 160) this.toRemove = true;
  }

  /**
   * Cleanup only, never the payout. Being dropped is not landing: a scene
   * teardown removes every object, and a slam fired from there would spawn
   * damage into a match that is over.
   */
  onRemoved(): void {
    this.release();
  }

  /** Idempotent: `removeModifier` twice would shrink her by the lift. */
  private release(): void {
    if (!this.lifted) return;
    this.owner.stats.removeModifier(this.lift);
    this.lifted = false;
  }

  /** Idempotent: a cancelled dash and a normal arrival can share a frame. */
  private land(): void {
    this.release();
    if (this.landed) return;
    this.landed = true;
    // A corpse does not finish the swing. The dash ends when she dies, and
    // that ending arrives here looking exactly like an arrival.
    if (!this.owner.isDead) this.slam();
  }

  /**
   * The sword coming down. A circle, not a wedge — she is directly above the
   * middle of it, and this is the cast the card promises a knock-up on.
   */
  private slam(): void {
    const radius = this.slamRadius;
    const atX = this.owner.position.x;
    const atY = this.owner.position.y;
    const cuts: { x: number; y: number }[] = [];

    // No vision filter: an area slam still lands on the champion standing in a bush.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: atX, y: atY, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const away = Math.hypot(victim.position.x - atX, victim.position.y - atY);
      if (away > radius + (victim.collisionRadius || 0)) continue;
      struck.add(victim);
      victim.takeDamage(Q_DAMAGE_FINAL, this.owner, 'PHYSICAL');
      victim.addBuff(new Airborne(Q_KNOCKUP_MS, this.owner, victim));
      cuts.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new Riven_Q_Slam(this.owner, atX, atY, this.heading, radius, cuts)
    );
    this.game.objectManager.addObject(new Riven_Q_GroundCrack(this.owner, atX, atY, radius));
  }

  draw(): void {
    const t = this.landed ? 1 : this.progress;
    const fade = this.landed ? Math.max(0, 1 - this.fadeMs / 160) : 1;
    const radius = this.slamRadius;

    push();
    // Where it is coming down, from the first frame, so bystanders can walk out.
    noFill();
    stroke(RUNE[0], RUNE[1], RUNE[2], 150 * fade);
    strokeWeight(3);
    const segments = 26;
    for (let i = 0; i < segments; i += 2) {
      const from = (Math.PI * 2 * i) / segments;
      arc(this.toX, this.toY, radius * 2, radius * 2, from, from + (Math.PI * 2) / segments);
    }

    // The shadow: it shrinks as she rises and comes back as she falls, which is
    // the only thing in a top-down frame that says "off the ground" on its own.
    const airborne = Math.sin(t * Math.PI);
    noStroke();
    fill(0, 0, 0, (110 - 55 * airborne) * fade);
    const shadow = this.owner.animatedValues.size * (1 - 0.35 * airborne);
    ellipse(this.position.x, this.position.y, shadow, shadow * 0.55);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_SLAM_RADIUS + Q_STEP_FINAL + 60) * 2);
  }
}


/**
 * The impact of the third charge: the shock ring on the real damage radius, the
 * blade planted where it came down, and the cut on every body it caught.
 */
export class Riven_Q_Slam extends SpellObject {
  lifeTime = 380;
  age = 0;
  readonly heading: number;
  readonly radius: number;
  readonly cuts: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    atX: number,
    atY: number,
    heading: number,
    radius: number,
    cuts: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(atX, atY);
    this.heading = heading;
    this.radius = radius;
    this.cuts = cuts;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const ring = this.radius * out;

    push();
    // the ground going out from under it
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 120 * fade * (1 - out));
    circle(this.position.x, this.position.y, ring * 2);

    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 220 * fade);
    strokeWeight(8);
    circle(this.position.x, this.position.y, ring * 2);
    stroke(RUNE[0], RUNE[1], RUNE[2], 240 * fade);
    strokeWeight(4);
    circle(this.position.x, this.position.y, ring * 2);

    // the blade itself, driven into the ground along the way she was facing —
    // short and thick, because it is pointing down, not across
    const bite = this.radius * 0.42 * (0.5 + 0.5 * out);
    stroke(IRON[0], IRON[1], IRON[2], 235 * fade);
    strokeWeight(13);
    line(
      this.position.x,
      this.position.y,
      this.position.x + Math.cos(this.heading) * bite,
      this.position.y + Math.sin(this.heading) * bite
    );
    stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 250 * fade);
    strokeWeight(5);
    line(
      this.position.x,
      this.position.y,
      this.position.x + Math.cos(this.heading) * bite,
      this.position.y + Math.sin(this.heading) * bite
    );

    // the cut on each body that took it
    for (const cut of this.cuts) {
      const reach = 24 * (0.4 + 0.6 * out);
      stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 240 * fade);
      strokeWeight(3);
      line(
        cut.x - Math.cos(this.heading + Math.PI / 3) * reach,
        cut.y - Math.sin(this.heading + Math.PI / 3) * reach,
        cut.x + Math.cos(this.heading + Math.PI / 3) * reach,
        cut.y + Math.sin(this.heading + Math.PI / 3) * reach
      );
      stroke(RUNE[0], RUNE[1], RUNE[2], 170 * fade);
      strokeWeight(2);
      circle(cut.x, cut.y, reach * 2.2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 60) * 2);
  }
}


/**
 * What the slam leaves behind: cracks running out from the point the blade went
 * in, in every direction, because a body coming down on a sword does not crack
 * the ground in a line.
 *
 * Ground art, so zIndex is `GROUND_Z_INDEX`: an un-overridden `SpellObject`
 * subclass would otherwise resolve to `SPELL_EFFECT_Z_INDEX`, over the feet of
 * everyone standing on it.
 */
export class Riven_Q_GroundCrack extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 620;
  age = 0;
  /** The slam's real radius, so the cracks run exactly as far as it reached. */
  readonly radius: number;
  /** Seeded once in onAdded: the crack must not re-shatter every frame. */
  cracks: { heading: number; length: number; forkAt: number; forkLean: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number, radius: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.radius = radius;
  }

  onAdded(): void {
    const spokes = 9;
    for (let i = 0; i < spokes; i++) {
      this.cracks.push({
        heading: (Math.PI * 2 * i) / spokes + random(-0.18, 0.18),
        length: 0.55 + random(0, 0.45),
        forkAt: 0.45 + random(0, 0.3),
        forkLean: random(-0.9, 0.9),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const split = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    for (const crack of this.cracks) {
      const reach = this.radius * crack.length * split;
      const tipX = this.position.x + Math.cos(crack.heading) * reach;
      const tipY = this.position.y + Math.sin(crack.heading) * reach;

      stroke(IRON[0], IRON[1], IRON[2], 220 * fade);
      strokeWeight(6);
      line(this.position.x, this.position.y, tipX, tipY);
      stroke(RUNE[0], RUNE[1], RUNE[2], 225 * fade);
      strokeWeight(2.5);
      line(this.position.x, this.position.y, tipX, tipY);

      const rootX = this.position.x + Math.cos(crack.heading) * reach * crack.forkAt;
      const rootY = this.position.y + Math.sin(crack.heading) * reach * crack.forkAt;
      const branch = crack.heading + crack.forkLean;
      const grown = reach * 0.3;
      stroke(RUNE[0], RUNE[1], RUNE[2], 185 * fade);
      strokeWeight(2);
      line(rootX, rootY, rootX + Math.cos(branch) * grown, rootY + Math.sin(branch) * grown);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 50) * 2);
  }
}
