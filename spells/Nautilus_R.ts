import type { AttackableUnit, CastContext, Rectangle, TargetingRequest } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Spell = api.Spell;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const MissileSpellObject = api.MissileSpellObject;
const Airborne = api.buffs.Airborne;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_RANGE = 450;

export const R_DAMAGE = 45;

export const R_KNOCKUP_MS = 1_200;



export const R_BLAST_RADIUS = 200;

/**
 * How far the charge travels between blasts, and how wide each one reaches.
 *
 * The ultimate used to be one 200-radius eruption at the end plus a
 * pass-through sweep that caught anything the hull touched. Both halves
 * landed at once and both were wide, so a team standing anywhere near the
 * line went up together — a single button that answered a whole fight.
 *
 * A blast every 90px along the path, each reaching 95, is the same total
 * distance covered and a very different thing to stand next to: the small
 * radius is what holds a blast to the one or two bodies actually on that
 * step, and the spacing is what makes walking *across* the line survivable
 * while standing *on* it is not.
 */
export const R_STEP_DISTANCE = 90;
export const R_STEP_RADIUS = 95;
/** What one step pays. Lower than the eruption: a step is a graze, not the hit. */
export const R_STEP_DAMAGE = 16;
export const R_STEP_KNOCKUP_MS = 650;

/** Pixels per frame — 450px in roughly 1.2s, slow enough that running matters. */
export const R_SPEED = 6.25;

export const R_WIDTH = 70;

export const R_RIM_MS = 640;

export const R_COLUMN_MS = 700;

export const R_COLUMN_REACH = 190;

export const R_JETS = 14;


const IRON: [number, number, number] = [120, 144, 156];

const RUST: [number, number, number] = [75, 101, 132];

const FOAM: [number, number, number] = [168, 230, 207];

const ABYSS: [number, number, number] = [30, 44, 66];


export default class Nautilus_R extends Spell {
  targetingMode = 'UNIT' as const;
  image = api.asset('spell_nautilus_r');
  name = 'Thủy Lôi Tầm Nhiệt (Nautilus_R)';
  description =
    `Thả một quả thủy lôi chạy ngầm dưới đất, đuổi theo mục tiêu đã chọn. Dọc đường ` +
    `nó nổ từng nhịp cách nhau ${R_STEP_DISTANCE}, mỗi vụ nổ chỉ với tới ${R_STEP_RADIUS}: ` +
    `${dmg(R_STEP_DAMAGE, 'MAGIC')} và hất tung ${secs(R_STEP_KNOCKUP_MS)} giây. ` +
    `Tới đích, nó nổ trong bán kính ${R_BLAST_RADIUS}: ${dmg(R_DAMAGE, 'MAGIC')} ` +
    `và hất tung ${secs(R_KNOCKUP_MS)} giây. Mỗi người chỉ trúng một lần.`;
  coolDown = 10_000;
  manaCost = 100;
  range = R_RANGE;

  get targetingRequest(): Readonly<TargetingRequest> {
    return { range: R_RANGE, targetTeam: 'ENEMY' };
  }

  onSpellCast(context?: CastContext): void {
    const target = context?.target as AttackableUnit | undefined;
    if (!target || target.isDead || target.toRemove) return;
    this.game.objectManager.addObject(new Nautilus_R_Object(this.owner, target));
  }
}


/**
 * The depth charge, travelling under the floor.
 *
 * Homing is hand-rolled rather than taken from `HomingMissileSpellObject` for one
 * reason the spec is explicit about: when the target dies mid-flight the charge
 * must *erupt where it is*, and both of that base's target-loss policies either
 * delete the object or fly it to a corpse's last coordinate and then delete it
 * without ever calling the arrival hook.
 *
 * Ground art — `zIndex = GROUND_Z_INDEX` — because the whole point of the travel is that it is
 * a telegraph the victim can read while standing on top of it.
 */
export class Nautilus_R_Object extends MissileSpellObject {
  zIndex = GROUND_Z_INDEX;
  speed = R_SPEED;
  size = R_WIDTH;
  maxHitCount = Infinity;
  removeOnArrive = false;

  target: AttackableUnit;
  age = 0;
  erupted = false;
  /** One pass per bystander, whatever the frame rate does to the collision query. */
  passed = new Set<AttackableUnit>();

  /** Where the last crater went, so the next one is a step further on. */
  private lastBlastAt: p5.Vector;
  /** Seeded once in onAdded — clods of displaced earth, not a per-frame reroll. */
  clods: { along: number; offset: number }[] = [];

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.destination = target.position.copy();
    this.lastBlastAt = this.position.copy();
  }

  onAdded(): void {
    super.onAdded();
    for (let i = 0; i < 9; i++) {
      this.clods.push({ along: random(0.1, 1), offset: random(-16, 16) });
    }
  }

  update(): void {
    if (this.toRemove) return;
    if (!this.target.targetable || this.target.toRemove) {
      // Nothing left to chase — a corpse, or somebody who went untargetable
      // mid-flight. It goes off under its own feet rather than following a
      // last known coordinate, and hits whoever is actually standing there.
      //
      // This is the dodge: cast R, and the target answers with a pool or a
      // stasis. Reported as the charge landing anyway, because the only guard
      // here was `isDead` and being untargetable is not being dead.
      this.erupt(this.position.copy(), null);
      return;
    }
    this.age += deltaTime;
    super.update();
  }

  onBeforeMove(): void {
    this.destination = this.target.position.copy();
    this.blastAlongTheWay();
  }

  /**
   * One small blast per `R_STEP_DISTANCE` of travel.
   *
   * Measured on distance rather than on a timer so the spacing is a property
   * of the *line* a player can see and step over, not of how long the charge
   * happened to take — the charge chases a moving target, so a timed version
   * would bunch its blasts up whenever the target ran toward it.
   */
  private blastAlongTheWay(): void {
    while (this.position.dist(this.lastBlastAt) >= R_STEP_DISTANCE) {
      // Walk the marker forward a step at a time rather than snapping it to
      // the current position: a frame long enough to cover two steps must
      // leave two craters, or a fast charge quietly skips holes in its line.
      const step = p5.Vector.sub(this.position, this.lastBlastAt).setMag(R_STEP_DISTANCE);
      this.lastBlastAt = p5.Vector.add(this.lastBlastAt, step);
      this.blastAt(this.lastBlastAt.copy(), R_STEP_RADIUS, R_STEP_DAMAGE, R_STEP_KNOCKUP_MS);
    }
  }

  /** Everything a blast does to the bodies standing in it, wherever it is. */
  private blastAt(at: p5.Vector, radius: number, damage: number, knockupMs: number): void {
    // The rim is handed the same `radius` the query below uses. It used to draw
    // `R_BLAST_RADIUS` whatever it was given, so each of the five-odd steps
    // along the path painted a 200 ring over a blast that only reached 95 —
    // four times the area, announced every 90px of travel.
    this.game.objectManager.addObject(new Nautilus_R_Rim(this.owner, at.copy(), radius));

    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: at.x, y: at.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of caught) {
      if (this.passed.has(victim)) continue;
      // One body is lifted once by one charge, however many craters it
      // stands in — the steps are a line to cross, not a grinder.
      this.passed.add(victim);
      victim.takeDamage(damage, this.owner, 'MAGIC');
      victim.addBuff(new Airborne(knockupMs, this.owner, victim));
    }
  }

  protected hasArrived(_previousPosition: p5.Vector, position: p5.Vector): boolean {
    return position.dist(this.target.position) <= this.target.collisionRadius + this.size / 2;
  }

  protected shouldStopAfterArrival(): boolean {
    return true;
  }

  onArrive(): void {
    this.erupt(this.target.position.copy(), this.target);
  }

  /**
   * Nothing. The hull used to sweep whatever it touched for
   * `R_PASS_DAMAGE`, which caught a whole team along the line at once — the
   * blasts in `blastAlongTheWay` are what replaced it, and letting both run
   * would hit everything twice.
   */
  onHit(_enemy: AttackableUnit): void {}

  private erupt(at: p5.Vector, victim: AttackableUnit | null): void {
    if (this.erupted) return;
    this.erupted = true;
    this.toRemove = true;

    this.game.objectManager.addObject(new Nautilus_R_Eruption(this.owner, at.copy()));

    // The named target is hit by name — but only if it is still there to be
    // hit. `targetable` is the whole of that question and it already folds in
    // `isDead`; a charge in flight against somebody who dives out of reach
    // (a pool, a stasis) arrives and erupts on nobody, which is the point of
    // spending the escape on it.
    if (victim?.targetable && !victim.toRemove && !this.passed.has(victim)) {
      this.passed.add(victim);
      victim.takeDamage(R_DAMAGE, this.owner, 'MAGIC');
      victim.addBuff(new Airborne(R_KNOCKUP_MS, this.owner, victim));
    }

    // And everyone standing in the crater, through the same door every step
    // used — `canTakeDamageFromTeam` is where "may this be hit" is decided.
    this.blastAt(at, R_BLAST_RADIUS, R_DAMAGE, R_KNOCKUP_MS);
  }

  draw(): void {
    const heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const swell = 0.78 + 0.22 * sin(this.age / 110);

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);
    // The water shadow bulging along the floor.
    noStroke();
    fill(ABYSS[0], ABYSS[1], ABYSS[2], 120);
    ellipse(0, 0, this.size * 1.5 * swell, this.size * 0.95 * swell);
    // Earth heaped over it in a ridge.
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 210);
    strokeWeight(4);
    arc(0, 5, this.size * 1.15, this.size * 0.72, PI, TWO_PI);
    stroke(RUST[0], RUST[1], RUST[2], 190);
    strokeWeight(2);
    arc(0, 5, this.size * 0.72, this.size * 0.45, PI, TWO_PI);
    // Clods thrown off the back of the ridge.
    stroke(FOAM[0], FOAM[1], FOAM[2], 160);
    strokeWeight(3);
    for (const clod of this.clods) {
      const back = -this.size * 0.5 * clod.along;
      line(back, clod.offset * 0.4, back - 6, clod.offset * 0.7);
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((this.size + 24) * 2);
  }
}


/**
 * The blast radius, drawn on the ground where it actually landed.
 *
 * The radius comes in through the constructor rather than being read off a
 * module constant: one charge lays down two different sizes of blast, and the
 * only way the rim cannot drift from the circle that hurt is to be given it.
 */
export class Nautilus_R_Rim extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = R_RIM_MS;
  age = 0;
  radius: number;

  constructor(owner: AttackableUnit, at: p5.Vector, radius: number) {
    super(owner);
    this.position = at;
    this.radius = radius;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    push();
    noFill();
    stroke(FOAM[0], FOAM[1], FOAM[2], 200 * fade);
    strokeWeight(6 * fade + 1);
    circle(this.position.x, this.position.y, this.radius * 2 * opened);
    // The hard rim on the radius that really hit, not on the wash.
    stroke(RUST[0], RUST[1], RUST[2], 190 * fade + 30);
    strokeWeight(3);
    circle(this.position.x, this.position.y, this.radius * 2);
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((this.radius + 14) * 2);
  }
}


/** The column, standing on the victim. Above the ground, unlike the mound. */
export class Nautilus_R_Eruption extends SpellObject {
  lifeTime = R_COLUMN_MS;
  age = 0;
  /** Seeded once in onAdded — jets that reroll every frame are static, not water. */
  jets: { angle: number; reach: number; tall: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    for (let i = 0; i < R_JETS; i++) {
      this.jets.push({
        angle: random(0, TWO_PI),
        reach: random(16, 84),
        tall: random(70, R_COLUMN_REACH),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const risen = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    // The trunk of the column.
    noFill();
    stroke(FOAM[0], FOAM[1], FOAM[2], 230 * fade);
    strokeWeight(14 * fade + 3);
    line(0, 0, 0, -R_COLUMN_REACH * risen);
    stroke(IRON[0], IRON[1], IRON[2], 170 * fade);
    strokeWeight(6);
    line(0, 0, 0, -R_COLUMN_REACH * risen * 0.7);
    // The jets thrown off it, each falling back on its own arc.
    strokeWeight(3);
    for (const jet of this.jets) {
      const out = cos(jet.angle) * jet.reach * risen;
      const drift = sin(jet.angle) * jet.reach * 0.35 * risen;
      stroke(FOAM[0], FOAM[1], FOAM[2], 190 * fade);
      line(0, -8, out, drift - jet.tall * risen);
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((R_COLUMN_REACH + 20) * 2);
  }
}