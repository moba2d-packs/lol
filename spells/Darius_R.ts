import type { AttackableUnit, ExecuteFallback, ExecuteSpell } from '@moba2d/core/content/types';
import { HEMORRHAGE_MAX_STACKS, hemorrhageStacks } from './Darius_Q';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Spell = api.Spell;
const Champion = api.units.Champion;
const Dash = api.buffs.Dash;
const Fear = api.buffs.Fear;
const Rectangle = api.utils.Quadtree.Rectangle;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;
const tint = api.text.tint;
const dmgValue = api.text.dmgValue;


export const RANGE = 200;

export const BASE_DAMAGE = 35;

/** What each stack of Hemorrhage on the victim is worth to the blade. */
export const DAMAGE_PER_STACK = 5;

/** 35 + 5 × 5 = 60, the top of the ultimate band. */
export const MAX_DAMAGE = BASE_DAMAGE + DAMAGE_PER_STACK * HEMORRHAGE_MAX_STACKS;

export const LEAP_SPEED = 26;

/** He has to actually arrive; a leap stopped short is a reposition. */
export const STRIKE_RADIUS = 120;

export const FEAR_RADIUS = 320;

export const FEAR_MS = 2_500;


/**
 * Noxian Guillotine: the kill button, and it says so before you press it.
 *
 * Darius picks his own target through `combat/ExecuteTargeting`, which means
 * two things come free and cannot drift apart: the cast takes whoever actually
 * dies to it rather than whoever is nearest, and `ExecuteMarks` paints the ring
 * on that same body a frame before the key is pressed. `executeDamageAgainst`
 * is therefore the real formula, bleed stacks and all — an estimate here is a
 * promise the cast would not keep.
 */
export default class Darius_R extends Spell implements ExecuteSpell {
  /**
   * Told: it leaps to an execute target and deals true damage. Both halves —
   * the gap-close and the execute — are flags core refuses to infer or could
   * not see.
   */
  static aiRoles =
    api.enums.SpellRole.Dash |
    api.enums.SpellRole.Damage |
    api.enums.SpellRole.Burst;

  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = api.asset('spell_darius_r');
  name = 'Máy Chém Noxus (Darius_R)';
  description =
    `Nhảy tới kẻ địch trong <span>${RANGE}px</span> — <span class="buff">ưu tiên kẻ sẽ chết vì nhát này</span> —` +
    ` và bổ rìu xuống: ${dmg(BASE_DAMAGE, 'TRUE')},` +
    ` cộng thêm ${dmgValue(DAMAGE_PER_STACK, 'TRUE')} cho mỗi cấp ${tint('Chảy Máu')}` +
    ` (tối đa ${dmgValue(MAX_DAMAGE, 'TRUE')}).` +
    ` Nếu chém chết mục tiêu, chiêu cuối <span class="buff">hồi ngay lập tức</span>` +
    ` và lính quanh đó <span class="buff">Khiếp Sợ</span> trong <span class="time">${secs(FEAR_MS)} giây</span>`;
  coolDown = 10_000;
  manaCost = 60;

  range = RANGE;

  /** Nothing killable in range still means "jump on the healthiest-looking one"
   *  is wrong; the lowest bar is the one worth committing an ultimate to. */
  readonly executeFallback: ExecuteFallback = 'weakest';

  checkCastCondition(): boolean {
    return !!pickExecuteTarget(this) && Dash.CanDash(this.owner);
  }

  executeCandidates(): AttackableUnit[] {
    return this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];
  }

  executeDamageAgainst(target: AttackableUnit): number {
    return BASE_DAMAGE + DAMAGE_PER_STACK * hemorrhageStacks(target);
  }

  onSpellCast(): void {
    const target = pickExecuteTarget(this);
    if (!target) return;

    // Stops just short of the body; the collision system would shove him back
    // out of it anyway, and the axe needs somewhere to fall.
    const restingPoint = () =>
      target.position
        .copy()
        .sub(this.owner.position)
        .setMag(Math.max(0, this.owner.position.dist(target.position) - 45))
        .add(this.owner.position);

    const leap = new Dash(1_200, this.owner, this.owner);
    leap.image = this.image;
    leap.dashDestination = restingPoint();
    leap.dashSpeed = LEAP_SPEED;
    leap.cancelable = false;
    // `onDashUpdate`, never `onUpdate`: the step lives on Dash's prototype and
    // an instance assignment would delete the leap.
    leap.onDashUpdate = () => {
      if (target.isDead || target.toRemove) return;
      leap.dashDestination = restingPoint();
    };

    // Both ends wired before `addBuff`, because a grounded Darius has his dash
    // deactivated inside that very call.
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      this.chop(target);
    };
    leap.onReachedDestination = land;
    leap.addDeactivateListener(land);

    this.owner.addBuff(leap);
  }

  /** The blade comes down. Everything about this ability happens here. */
  private chop(target: AttackableUnit): void {
    const damage = this.executeDamageAgainst(target);

    const blade = new Darius_R_Object(this.owner);
    blade.landingPoint = target.position.copy();
    blade.damage = damage;
    this.game.objectManager.addObject(blade);

    // He can be stopped short — grounded on the way, or the target simply ran.
    if (target.isDead || target.toRemove) return;
    if (this.owner.position.dist(target.position) > STRIKE_RADIUS) return;

    // Alive one line above, so `isDead` below is this hit and nothing else.
    // `takeDamage` is synchronous, which is what makes that readable at all.
    target.takeDamage(damage, this.owner, 'TRUE');
    if (!target.isDead) return;

    blade.executed = true;
    // A head taken resets the axe — the whole reason to hold it for a kill.
    this.resetCoolDown();
    this.terrify(blade);
  }

  /**
   * Everything nearby that is not a champion breaks and runs.
   *
   * The blade is handed the same centre and radius it routs from, because the
   * rout is an area and an area nobody can see is one nobody can play around:
   * a rout that catches a whole wave and a rout that catches one minion look
   * identical otherwise.
   */
  private terrify(blade: Darius_R_Object): void {
    const origin = this.owner.position.copy();
    blade.fearOrigin = origin;

    const witnesses = this.game.objectManager.queryObjects({
      area: new Circle({
        x: origin.x,
        y: origin.y,
        r: FEAR_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const witness of witnesses) {
      // Champions do not rout; this is a wave-clearing and jungle effect.
      if (witness instanceof Champion) continue;
      // Keeps `Fear`'s own icon — like `Stun`, it is drawn on the victim rather
      // than only in the HUD. See the note in `Renekton_W.ts`.
      const panic = new Fear(FEAR_MS, this.owner, witness);
      panic.sourcePosition = this.owner.position.copy();
      witness.addBuff(panic);
    }
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


export const CHOP_LIFETIME_MS = 520;

/** The blade falls out of the sky over this fraction of the effect's life. */
const FALL_RATIO = 0.35;

const SPATTER_COUNT = 16;


/**
 * The guillotine: one enormous axe dropping vertically onto the body.
 *
 * Deliberately a fall, not a sweep — Q is the sweep, and the two must not read
 * as the same ability. The blade starts high above the victim and lands on the
 * frame the damage was already applied, so the drop is the read on "did it
 * connect", and the executed flag turns the impact from red to white.
 */
export class Darius_R_Object extends SpellObject {
  landingPoint: p5.Vector = this.owner.position.copy();
  damage = BASE_DAMAGE;
  executed = false;
  age = 0;

  /** Where the rout went out from, once one has. Null until the head comes off. */
  fearOrigin: p5.Vector | null = null;

  /** The radius that routed, so the wave is painted on it rather than near it. */
  fearRadius = FEAR_RADIUS;

  /** How far above the body the blade starts. */
  fallHeight = 260;

  spatter: { angle: number; speed: number; size: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < SPATTER_COUNT; i++) {
      this.spatter.push({
        angle: random(0, TWO_PI),
        speed: random(0.6, 2.4),
        size: random(3, 10),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= CHOP_LIFETIME_MS) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / CHOP_LIFETIME_MS, 0, 1);
    const falling = t < FALL_RATIO;
    // wind-in on the way down: it accelerates into the body
    const drop = falling ? (t / FALL_RATIO) * (t / FALL_RATIO) : 1;
    const after = falling ? 0 : (t - FALL_RATIO) / (1 - FALL_RATIO);
    const fade = 1 - after;

    push();
    translate(this.landingPoint.x, this.landingPoint.y);

    // the shadow the blade casts, tightening as it comes down
    noStroke();
    fill(20, 5, 8, 90 + 90 * drop);
    ellipse(0, 6, 90 - 40 * drop, 26 - 12 * drop);

    if (falling) {
      // the axe, hanging point-down and dropping
      push();
      translate(0, -this.fallHeight * (1 - drop));
      // haft
      stroke(96, 62, 40);
      strokeWeight(9);
      line(0, -96, 0, -18);
      // the head — a broad crescent, edge downward
      noStroke();
      fill(214, 220, 232);
      arc(0, -14, 108, 74, 0, PI, PIE);
      fill(168, 26, 28);
      arc(0, -14, 62, 40, 0, PI, PIE);
      // a hard white line on the edge itself, so the moment of contact reads
      stroke(255, 255, 255, 230);
      strokeWeight(3);
      noFill();
      arc(0, -14, 108, 74, 0.15, PI - 0.15);
      pop();
      pop();
      return;
    }

    // the landing: a ring of blood thrown out, white when the head came off
    const [r, g, b] = this.executed ? [255, 245, 235] : [190, 30, 32];
    noFill();
    stroke(r, g, b, 240 * fade);
    strokeWeight(6 * fade + 1);
    circle(0, 0, 40 + 160 * after);
    stroke(r, g, b, 150 * fade);
    strokeWeight(2);
    circle(0, 0, 20 + 110 * after);

    noStroke();
    for (const fleck of this.spatter) {
      const d = fleck.speed * 90 * after;
      fill(r, g, b, 230 * fade);
      circle(cos(fleck.angle) * d, sin(fleck.angle) * d, fleck.size * fade + 1);
    }

    // The rout going out from Darius himself: a wave that races to the radius
    // that actually broke the wave and then holds there while it fades, so the
    // size of the rout can be read off the ground after it has passed.
    if (this.fearOrigin) {
      const raced = constrain(after / 0.45, 0, 1);
      const wave = 1 - (1 - raced) * (1 - raced);
      push();
      translate(this.fearOrigin.x - this.landingPoint.x, this.fearOrigin.y - this.landingPoint.y);
      noFill();
      stroke(214, 92, 62, 210 * fade);
      strokeWeight(2.5);
      circle(0, 0, this.fearRadius * 2 * wave);
      pop();
    }

    // an execution leaves a vertical column of light where the body was
    if (!this.executed) {
      pop();
      return;
    }
    stroke(255, 250, 240, 200 * fade);
    strokeWeight(10 * fade + 2);
    line(0, 0, 0, -220 * (0.4 + after));
    pop();
  }

  getDisplayBoundingBox() {
    // covers the blade's whole fall, which starts well above the landing point,
    // and the rout, which goes out from Darius rather than from the body
    const r = Math.max(this.fallHeight + 120, this.fearRadius + STRIKE_RADIUS);
    return new Rectangle({
      x: this.landingPoint.x - r,
      y: this.landingPoint.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}