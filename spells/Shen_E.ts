import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Spell = api.Spell;
const Dash = api.buffs.Dash;
const Taunt = api.buffs.Taunt;
const Champion = api.units.Champion;
const SpellObject = api.SpellObject;
const AoePulse = api.AoePulse;
const Circle = api.utils.Quadtree.Circle;
const QuadtreeRectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const sweepToWall = api.terrain.sweepToWall;
const dmg = api.text.dmg;

/**
 * Vô Ảnh Bộ — the reason this champion is in the pack.
 *
 * `Taunt` is the odd one out among the crowd-control buffs and the only one
 * that fits an engage tank: a stun, a root, a charm and a fear all take
 * `CAN_MOVE` away, so the victim stands still and the fight pauses. A taunt
 * takes only `CAN_CAST`, and spends the two permissions it leaves alone on
 * *Shen* — the victim walks at him and swings at him, which is what makes this
 * the one control effect that starts a fight rather than freezing one.
 *
 * The dash hooks `onDashUpdate`, never `onUpdate`. `Dash` puts its own
 * movement in `Dash.prototype.onUpdate`, so assigning to the instance does not
 * hook the frame, it replaces it — the step, the arrival check and the
 * interrupt check all disappear and Shen plays the whole ability standing
 * still. Three champions have shipped with that bug.
 */

export const DASH_DAMAGE = 24;

export const TAUNT_DURATION_MS = 1_400;

export const DASH_DISTANCE = 320;

export const COOLDOWN_MS = 9_000;

export const MANA_COST = 35;

/** How wide his shoulder is going past — what "passes through" means in pixels. */
export const SWEEP_RADIUS = 42;

const DASH_SPEED = 14;

const DAMAGE_LABEL = 'Vô Ảnh Bộ';


export default class Shen_E extends Spell {
  image = api.asset('spell_shen_e');
  name = 'Vô Ảnh Bộ (Shen_E)';
  description =
    `Shen lướt <span class="buff">${DASH_DISTANCE}</span> về phía con trỏ, gây` +
    ` ${dmg(DASH_DAMAGE, 'PHYSICAL')} lên mọi tướng địch` +
    ` mà anh đi xuyên qua (mỗi mục tiêu chỉ một lần) và <span class="debuff">Khiêu Khích</span>` +
    ` chúng trong <span class="buff">${secs(TAUNT_DURATION_MS)} giây</span>:` +
    ` mục tiêu buộc phải đuổi theo và đánh thường vào Shen — vẫn chạy và đánh được,` +
    ` nhưng không dùng được chiêu thức.`;
  coolDown = COOLDOWN_MS;
  manaCost = MANA_COST;

  range = DASH_DISTANCE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  /** Ask before billing: a grounded or immobile Shen must not pay for nothing. */
  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

    // A dash that ends inside a wall is a dash that ends nowhere; the sweep
    // hands back the last clear point along the same line.
    const contact = sweepToWall(
      this.game,
      this.owner.position.x,
      this.owner.position.y,
      to.x,
      to.y,
      this.owner.collisionRadius
    );
    if (contact) to.set(contact.x, contact.y);

    const from = this.owner.position.copy();
    // A sweep hits each body at most once, and the set has to outlive the frame.
    const struck = new Set<AttackableUnit>();

    const dash = new Dash(0, this.owner, this.owner);
    dash.dashDestination = to;
    dash.dashSpeed = DASH_SPEED;
    // The path is drawn by `Shen_E_Trail` below — one clear layer, not two.
    dash.showTrail = false;
    dash.onDashUpdate = () => this.cutThrough(struck);
    this.owner.addBuff(dash);

    this.game.objectManager.addObject(new Shen_E_Trail(this.owner, from, to));
  }

  /**
   * Everything his shoulder clears this frame. Champions only: a taunt on a
   * minion wave is a wave that walks into a tower, and monsters and wards are
   * not what an engage is aimed at.
   */
  cutThrough(struck: Set<AttackableUnit>): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: SWEEP_RADIUS,
      }),
      filters: [
        PredefinedFilters.type(Champion),
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
      ],
    }) as AttackableUnit[];

    for (const target of found) {
      if (struck.has(target)) continue;
      struck.add(target);

      target.takeDamage(DASH_DAMAGE, this.owner, 'PHYSICAL', DAMAGE_LABEL);
      // After the damage: a target this just killed is already dead, and
      // `addBuff` refuses rather than leaving a taunt on a corpse.
      target.addBuff(new Taunt(TAUNT_DURATION_MS, this.owner, target));

      const impact = new AoePulse(this.owner);
      impact.position = target.position.copy();
      impact.radius = 34;
      impact.lifeTime = 280;
      impact.color = [230, 150, 95];
      impact.fillAlpha = 34;
      this.game.objectManager.addObject(impact);
    }
  }
}


/**
 * The shadow he leaves behind: a handful of dark silhouettes strung along the
 * line he actually travelled, each one thinning out on its own stagger so the
 * path reads as a sequence of steps rather than as a smear.
 *
 * A `SpellObject` rather than caster-drawn VFX, because it spans the whole dash
 * and `Champion.draw()` is skipped the moment Shen is culled or fogged — which
 * is precisely when the other team most needs to see where he went.
 */
export class Shen_E_Trail extends SpellObject {
  from: p5.Vector;
  to: p5.Vector;
  age = 0;
  lifeTime = 430;

  /** Where each silhouette sits along the line, seeded once. */
  _steps: number[] = [];

  constructor(owner: AttackableUnit, from: p5.Vector, to: p5.Vector) {
    super(owner);
    this.from = from;
    this.to = to;
    this.position = from.copy();
  }

  onAdded(): void {
    for (let i = 0; i < 5; i++) this._steps.push(0.1 + (i / 4) * 0.8);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const width = this.owner.animatedValues?.displaySize ?? 40;
    const dx = this.to.x - this.from.x;
    const dy = this.to.y - this.from.y;

    push();

    // The corridor his shoulder clears. A champion whose centre falls inside
    // this band is cut and taunted, and the silhouettes below are a body-width
    // narrower than that — they say where he went, not how wide he went.
    const normal = Math.atan2(dy, dx) + HALF_PI;
    const nx = Math.cos(normal) * SWEEP_RADIUS;
    const ny = Math.sin(normal) * SWEEP_RADIUS;
    noFill();
    stroke(120, 160, 215, 95 * (1 - t));
    strokeWeight(1.5);
    line(this.from.x + nx, this.from.y + ny, this.to.x + nx, this.to.y + ny);
    line(this.from.x - nx, this.from.y - ny, this.to.x - nx, this.to.y - ny);

    noStroke();
    for (let i = 0; i < this._steps.length; i++) {
      const along = this._steps[i];
      // Each silhouette fades on its own stagger, oldest first.
      const faded = constrain((t - along * 0.25) / 0.75, 0, 1);
      if (faded >= 1) continue;
      const alpha = 165 * (1 - faded) * (1 - faded);
      const x = this.from.x + dx * along;
      const y = this.from.y + dy * along;
      fill(35, 40, 70, alpha);
      circle(x, y, width * (0.9 - along * 0.25));
      fill(120, 160, 215, alpha * 0.5);
      circle(x, y, width * (0.42 - along * 0.1));
    }
    pop();
  }

  /** Drawn from where he left to where he landed, so the box has to hold both. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 60;
    return new QuadtreeRectangle({
      x: Math.min(this.from.x, this.to.x) - pad,
      y: Math.min(this.from.y, this.to.y) - pad,
      w: Math.abs(this.to.x - this.from.x) + pad * 2,
      h: Math.abs(this.to.y - this.from.y) + pad * 2,
      data: this,
    });
  }
}
