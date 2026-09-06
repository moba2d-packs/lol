import type { AttackableUnit, CastContext, DynamicWall } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const VectorUtils = api.utils.VectorUtils;
const SAT = api.utils.SAT;
const Circle = api.utils.Quadtree.Circle;
const hasFlag = api.utils.hasFlag;
const ActionState = api.enums.ActionState;
const BuffAddType = api.enums.BuffAddType;
const PredefinedFilters = api.combat.PredefinedFilters;
const Slow = api.buffs.Slow;
const Dash = api.buffs.Dash;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const slabVertices = api.terrain.slabVertices;


export const E_MAX_RANGE = 500;

export const E_WALL_LENGTH = 210;

export const E_WALL_THICKNESS = 46;

export const E_DURATION_MS = 5_000;

/** How far from the wall's centre the initial burst reaches. */
export const E_KNOCKBACK_RADIUS = 150;

/** How far a caught enemy is thrown, straight away from that centre. */
export const E_KNOCKBACK_DISTANCE = 120;

export const E_KNOCKBACK_MS = 280;

/** The slow aura extends past the wall's own footprint, on purpose. */
export const E_SLOW_RADIUS = 170;

export const E_SLOW_PERCENT = 0.4;

/** How often the aura re-checks who is standing in it. */
export const E_SLOW_REAPPLY_MS = 200;

/** How long the eruption's shove is painted for. Art only; the shove is instant. */
export const E_SHOVE_FLASH_MS = 300;

/** Both debuffs outlive one tick, so they never flicker off between them. */
const E_SLOW_BUFF_MS = E_SLOW_REAPPLY_MS + 200;

/** One frame at 60fps, for turning the knockback's duration into a per-frame step. */
const FRAME_MS = 16.67;


/**
 * Pillar of Ice: a genuinely solid wall (see `Anivia_W` for the wall itself,
 * which this reuses almost verbatim) plus two effects Crystallize does not
 * have — a one-time radial shove when it erupts, and a slow aura that
 * outlives that shove for as long as the pillar stands.
 *
 * The record's own notes draw the line this keeps: "displaces allied units
 * away from the area but does not render them airborne" is the *terrain* push
 * — the same SAT ejection every `DynamicWall` gets for free, and it already
 * catches both teams and Trundle himself. The 225-unit "knocks back units hit"
 * is a second, wider, one-shot effect, and it is enemies-only: an ally who
 * did not happen to be standing in the footprint has no ability-text reason
 * to be thrown across the lane by their own jungler's wall.
 */
export default class Trundle_E extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_trundle_e');
  name = 'Cột Băng (Trundle_E)';
  description =
    `Dựng một trụ băng chắn ngang hướng chỉ định, tồn tại <span class="time">${secs(E_DURATION_MS)} giây</span>.` +
    ` Trụ băng <b>đặc</b> — chặn đường đi thật sự — và khi vừa hiện ra sẽ` +
    ` <span class="buff">đẩy lùi</span> kẻ địch trong bán kính <span>${E_KNOCKBACK_RADIUS}px</span> quanh tâm.` +
    ` Trong suốt thời gian tồn tại, kẻ địch đứng gần trụ băng (bán kính <span>${E_SLOW_RADIUS}px</span>)` +
    ` bị <span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span>.`;
  coolDown = 10_000;
  manaCost = 60;

  range = E_MAX_RANGE;

  onSpellCast(context: CastContext): void {
    const { to } = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, E_MAX_RANGE);

    // Same trap `Anivia_W` documents: a wall centred close enough to overlap
    // its own caster ejects a body standing past the midplane to the *far*
    // face instead of the near one, because `_blockUnits` always resolves to
    // the nearest face and past the midplane that is the far one. Holding the
    // centre at least a half-thickness plus Trundle's own body radius away
    // keeps him outside the slab he just planted.
    const heading = this.firingDirection(context);
    const minimum = E_WALL_THICKNESS / 2 + this.owner.stats.size.value / 2;
    const dx = to.x - this.owner.position.x;
    const dy = to.y - this.owner.position.y;
    if (Math.hypot(dx, dy) < minimum) {
      to.set(
        this.owner.position.x + heading.x * minimum,
        this.owner.position.y + heading.y * minimum
      );
    }

    const wall = new Trundle_E_Object(this.owner);
    wall.position = to;
    wall.angle = VectorUtils.getAngle(this.owner.position, to) + HALF_PI;
    this.game.objectManager.addObject(wall);

    this.knockBack(to);
  }

  private knockBack(center: p5.Vector): void {
    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: center.x, y: center.y, r: E_KNOCKBACK_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    for (const enemy of caught as AttackableUnit[]) {
      // Directly away from the pillar's centre, measured from where the enemy
      // actually stands — the same "gap + push, then subtract the start" shape
      // `Vayne_E` uses, which is what keeps this correct even for someone
      // standing exactly on top of the centre (a zero-length line randomises).
      const gap = p5.Vector.dist(center, enemy.position);
      const { to: pushed } = VectorUtils.getVectorWithRange(
        center,
        enemy.position,
        gap + E_KNOCKBACK_DISTANCE
      );

      const shove = new Dash(E_KNOCKBACK_MS, this.owner, enemy);
      shove.dashDestination = pushed;
      shove.dashSpeed = Math.max(2, E_KNOCKBACK_DISTANCE / (E_KNOCKBACK_MS / FRAME_MS));
      shove.showTrail = false;
      // A knockback is a displacement, not a cast: nothing about being thrown
      // should cancel itself.
      shove.buffsToCheckCancel = [];
      enemy.addBuff(shove);
    }
  }

  drawPreview(): void {
    super.drawPreview(this.range);
  }
}


/**
 * The wall itself. Physically identical machinery to `Anivia_W_Object` — same
 * SAT slab, same push-out, same `DynamicWall` contract — because a second,
 * independently-written wall is a second place for that trap to reappear.
 * What is Trundle's own is the aura ticking underneath it and the shape it is
 * drawn as.
 */
export class Trundle_E_Object extends SpellObject implements DynamicWall {
  image = api.asset('spell_trundle_e');
  position = this.owner.position.copy();
  angle = 0;
  length = E_WALL_LENGTH;
  thickness = E_WALL_THICKNESS;

  lifeTime = E_DURATION_MS;
  age = 0;
  growth = 0;
  sinceSlow = E_SLOW_REAPPLY_MS; // bites on the very first frame

  _satPolygon: any = null;
  _satCircle: any = null;
  _satResponse: any = null;

  _getSATPolygon() {
    if (this._satPolygon) return this._satPolygon;

    const halfLength = this.length / 2;
    const halfThickness = this.thickness / 2;
    const polygon = new SAT.Polygon(new SAT.Vector(this.position.x, this.position.y), [
      new SAT.Vector(-halfLength, -halfThickness),
      new SAT.Vector(halfLength, -halfThickness),
      new SAT.Vector(halfLength, halfThickness),
      new SAT.Vector(-halfLength, halfThickness),
    ]);
    polygon.setAngle(this.angle);

    this._satPolygon = polygon;
    this._satCircle = new SAT.Circle(new SAT.Vector(0, 0), 1);
    this._satResponse = new SAT.Response();
    return this._satPolygon;
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.growth = lerp(this.growth, 1, 0.25);
    this._blockUnits();

    this.sinceSlow += deltaTime;
    if (this.sinceSlow >= E_SLOW_REAPPLY_MS) {
      this.sinceSlow -= E_SLOW_REAPPLY_MS;
      this._slowNearby();
    }
  }

  _blockUnits() {
    const polygon = this._getSATPolygon();
    const circle = this._satCircle;
    const response = this._satResponse;

    const units = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this._boundingRadius() }),
      // terrain: stops both teams, allies and Trundle himself alike
      filters: [PredefinedFilters.type(AttackableUnit), PredefinedFilters.excludeDead],
    });

    for (const unit of units) {
      if (hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED)) continue;

      response.clear();
      circle.pos.x = unit.position.x;
      circle.pos.y = unit.position.y;
      circle.r = unit.stats.size.value / 2;

      if (SAT.testPolygonCircle(polygon, circle, response)) {
        unit.position.x += response.overlapV.x;
        unit.position.y += response.overlapV.y;
        unit.onCollideWall?.();
      }
    }
  }

  /** The lingering half of the kit: a slow aura, enemies only, RENEW_EXISTING. */
  _slowNearby() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: E_SLOW_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    for (const enemy of enemies as AttackableUnit[]) {
      // A slow re-applied every tick MUST renew rather than stack — `Slow`
      // defaults to stacking ten deep, which on a beat this fast turns "40%
      // slow" into a dead stop within a second. `Singed_W` is the other model.
      const chill = new Slow(E_SLOW_BUFF_MS, this.owner, enemy);
      chill.percent = E_SLOW_PERCENT;
      chill.image = this.image;
      chill.buffAddType = BuffAddType.RENEW_EXISTING;
      enemy.addBuff(chill);
    }
  }

  _boundingRadius() {
    const wallRadius = Math.sqrt(this.length * this.length + this.thickness * this.thickness) / 2;
    return Math.max(wallRadius + 60, E_SLOW_RADIUS + 40);
  }

  get blocksMovement(): boolean {
    return !this.toRemove;
  }

  wallVertices() {
    return slabVertices(this.position, this.angle, this.length, this.thickness);
  }

  draw() {
    const fade =
      this.age > this.lifeTime - 500 ? map(this.age, this.lifeTime - 500, this.lifeTime, 1, 0) : 1;
    const halfLength = (this.length / 2) * this.growth;
    const halfThickness = (this.thickness / 2) * this.growth;

    push();
    translate(this.position.x, this.position.y);

    // the slow aura: a soft frost ring reaching past the wall's own footprint,
    // drawn as its own distinct region so "the wall blocks" and "the ground
    // slows" never read as the same rule
    noStroke();
    fill(140, 195, 235, 30 * fade);
    circle(0, 0, E_SLOW_RADIUS * 2 * this.growth);
    noFill();
    stroke(150, 205, 240, 90 * fade);
    strokeWeight(2);
    circle(0, 0, E_SLOW_RADIUS * 2 * this.growth);

    // The eruption's shove, which is a different rule from the aura standing
    // around it: a one-shot throw, spent on the frame the pillar arrived. A
    // wave races out to exactly the radius that threw people and holds there
    // while it fades, so the two zones are never read as one.
    if (this.age < E_SHOVE_FLASH_MS) {
      const spent = constrain(this.age / E_SHOVE_FLASH_MS, 0, 1);
      const raced = constrain(spent / 0.55, 0, 1);
      const wave = 1 - (1 - raced) * (1 - raced);
      stroke(225, 245, 255, 235 * (1 - spent));
      strokeWeight(4 * (1 - spent) + 1);
      circle(0, 0, E_KNOCKBACK_RADIUS * 2 * wave);
    }

    rotate(this.angle);

    // Jagged, hand-hewn crystal spikes rather than Anivia's smooth frosted
    // slab: the two ice walls in this pack must not read as the same prop.
    // Trundle's is a troll's crude pillar, not conjured artistry.
    const shards = 7;
    noStroke();
    fill(120, 175, 210, 235 * fade);
    for (let i = 0; i < shards; i++) {
      const x = -halfLength + ((i + 0.5) / shards) * halfLength * 2;
      const w = (halfLength * 2) / shards / 2;
      const jag = (i % 2 === 0 ? 1 : 0.6) * halfThickness;
      triangle(x - w * 0.9, -halfThickness * 0.2, x + w * 0.9, -halfThickness * 0.2, x, -halfThickness - jag);
    }

    // the pillar's core body, wide and blunt
    rectMode(CENTER);
    strokeWeight(3);
    stroke(35, 70, 95, 235 * fade);
    fill(95, 150, 185, 235 * fade);
    rect(0, halfThickness * 0.3, halfLength * 2, halfThickness * 1.4, 4);

    // dark cracks through the body — this pillar looks broken-off, not carved
    stroke(30, 55, 75, 200 * fade);
    strokeWeight(2);
    for (let i = 1; i < shards; i++) {
      const x = -halfLength + (i / shards) * halfLength * 2;
      line(x, -halfThickness * 0.1, x + (i % 2 === 0 ? 6 : -6), halfThickness * 0.9);
    }

    // a cold highlight down the ridge
    noStroke();
    fill(230, 245, 255, 150 * fade);
    rect(0, -halfThickness * 0.15, halfLength * 1.7, halfThickness * 0.3);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this._boundingRadius();
    return this.squareDisplayBoundingBox(r * 2);
  }
}
