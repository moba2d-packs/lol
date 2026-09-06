import type { AttackableUnit, CastContext, CastSpec, Dash, TargetingRequest } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const TargetResolver = api.combat.TargetResolver;
const AttackableUnit = api.units.AttackableUnit;
const Airborne = api.buffs.Airborne;
const Dash = api.buffs.Dash;
const Spell = api.Spell;
const Rectangle = api.utils.Quadtree.Rectangle;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_RANGE = 450;

export const R_DAMAGE = 45;

export const R_KNOCKUP_MS = 1_300;

export const R_PASS_DAMAGE = 15;

export const R_PASS_KNOCKUP_MS = 500;

/** How close a body has to be to the charge to be knocked out of the way. */
export const R_PASS_RADIUS = 60;

/** The blast at the end of the charge, centred where she stopped. */
export const R_BLAST_RADIUS = 90;

export const R_DASH_SPEED = 14;

/** A ceiling, not a duration: the charge ends the frame it arrives. */
export const R_DASH_MAX_MS = 2_500;

/** She stops a fist's length short instead of standing inside the target. */
export const R_ARRIVAL_GAP = 45;

export const R_IMPACT_REACH = 120;


const BRASS: [number, number, number] = [225, 177, 44];

const HEXTECH: [number, number, number] = [0, 168, 255];


/**
 * The unstoppable charge.
 *
 * Two things make it an ultimate rather than a longer Q. It cannot be stopped:
 * the charge is `unstoppable`, which says "ignore the crowd control that would
 * end an ordinary dash, and refuse the displacement that would replace it" in
 * the dash's own words instead of opting out of the buff layer wholesale. And
 * it cannot be blocked by a body:
 * anything in the way is knocked aside and the charge keeps going, so the only
 * answer to it is not being where it lands.
 */
export default class Vi_R extends Spell {
  targetingMode = 'UNIT' as const;
  image = api.asset('spell_vi_r');
  name = 'Tả Xung Hữu Đột (Vi_R)';
  description = `Lao tới một mục tiêu và không gì cản được:
    ${dmg(R_DAMAGE, 'PHYSICAL')} và hất tung
    ${secs(R_KNOCKUP_MS)} giây khi tới. Kẻ địch trên đường bị gạt sang bên,
    chịu ${dmg(R_PASS_DAMAGE, 'PHYSICAL')}.`;
  coolDown = 10_000;
  manaCost = 100;
  range = R_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: R_RANGE,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => this.isValidTarget(candidate),
      getTargetInfo: candidate =>
        this.isValidTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  private isValidTarget(target?: unknown): target is AttackableUnit {
    return (
      target instanceof AttackableUnit &&
      !target.isDead &&
      !target.toRemove &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      withinRange(R_RANGE, this.owner, target)
    );
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) {
      if (!this.isValidTarget(context.target as AttackableUnit)) return false;
      return super.press(context);
    }

    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  onSpellCast(context?: CastContext): void {
    const target = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(target)) return;

    // One ledger for the whole ultimate: nobody takes both the pass-through and
    // the blast, and nobody takes either twice.
    const punched = new Set<AttackableUnit>();
    const launch = this.owner.position.copy();
    let lastSeen = target.position.copy();
    let landed = false;

    const charge = new Dash(R_DASH_MAX_MS, this.owner, this.owner);
    charge.dashSpeed = R_DASH_SPEED;
    charge.dashDestination = this.stopShortOf(lastSeen);
    charge.image = this.image;
    charge.showTrail = false;
    // Unstoppable, stated where a dash states it. `buffsToCheckCancel = []`
    // was the whole of it and covered only half the promise: it ignores the
    // crowd control that would end an ordinary dash, and says nothing about a
    // *displacement*, which is another `Dash` on the same stack and used to
    // replace this one outright. The card says "không gì cản được"; this is the
    // flag makes both halves true, and subsumes the emptied list: the interrupt
    // check it used to filter is not reached at all now, so the ultimate's own
    // knock-up still cannot end its own flight.
    charge.unstoppable = true;

    charge.onDashUpdate = () => {
      if (this.stillReachable(target)) {
        lastSeen = target.position.copy();
        charge.dashDestination = this.stopShortOf(lastSeen);
      }
      this.knockAside(punched, target);
    };

    // Arrival and expiry are the same landing, so it lives on the one hook that
    // runs exactly once either way.
    charge.onDeactivate = () => {
      if (landed) return;
      landed = true;
      this.land(punched, target);
    };

    this.owner.addBuff(charge);
    this.game.objectManager.addObject(new Vi_R_Streak(this.owner, launch, charge, target));
  }

  /** A point a fist short of the body, so she arrives beside it rather than in it. */
  private stopShortOf(at: p5.Vector): p5.Vector {
    const dx = at.x - this.owner.position.x;
    const dy = at.y - this.owner.position.y;
    const span = Math.hypot(dx, dy);
    if (span <= R_ARRIVAL_GAP) return createVector(this.owner.position.x, this.owner.position.y);
    const keep = (span - R_ARRIVAL_GAP) / span;
    return createVector(this.owner.position.x + dx * keep, this.owner.position.y + dy * keep);
  }

  private stillReachable(target: AttackableUnit): boolean {
    return !target.isDead && !target.toRemove && target.targetable;
  }

  /**
   * Bodies she runs through. A collision, not an acquisition — an area sweep of
   * the ground she has just covered, so it does not narrow to a chosen unit and
   * the fog has no say in what her shoulder hits.
   */
  private knockAside(punched: Set<AttackableUnit>, target: AttackableUnit): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(R_PASS_RADIUS, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const aimX = target.position.x - this.owner.position.x;
    const aimY = target.position.y - this.owner.position.y;
    const aimLen = Math.hypot(aimX, aimY) || 1;
    const fwdX = aimX / aimLen;
    const fwdY = aimY / aimLen;

    for (const victim of found) {
      if (victim === this.owner || victim === target) continue;
      if (punched.has(victim) || victim.isDead || victim.toRemove) continue;
      punched.add(victim);
      victim.takeDamage(R_PASS_DAMAGE, this.owner, 'PHYSICAL');

      // Determine left or right perpendicular shove
      const toVictimX = victim.position.x - this.owner.position.x;
      const toVictimY = victim.position.y - this.owner.position.y;
      const cross = -fwdY * toVictimX + fwdX * toVictimY;
      const sign = cross >= 0 ? 1 : -1;
      const perpX = -fwdY * sign;
      const perpY = fwdX * sign;

      // Push victim aside with Dash and Airborne
      const shove = new Dash(R_PASS_KNOCKUP_MS, this.owner, victim);
      const pushDist = 75;
      shove.dashDestination = createVector(
        victim.position.x + perpX * pushDist,
        victim.position.y + perpY * pushDist
      );
      shove.dashSpeed = 12;
      shove.showTrail = false;
      shove.buffsToCheckCancel = [];
      victim.markDisplaced();
      victim.addBuff(shove);
      victim.addBuff(new Airborne(R_PASS_KNOCKUP_MS, this.owner, victim));
    }
  }

  /**
   * The blast and slam, centred where she actually stopped.
   */
  private land(punched: Set<AttackableUnit>, target: AttackableUnit): void {
    const at = this.owner.position.copy();
    // Measured once and handed to the slam below, so the rim on screen and the
    // circle that knocked people down cannot drift apart.
    const blastRadius = effectiveRange(R_BLAST_RADIUS, this.owner);
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: at.x,
        y: at.y,
        r: blastRadius,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const dead = target.toRemove || target.isDead;
    if (!dead) {
      punched.add(target);
      target.takeDamage(R_DAMAGE, this.owner, 'PHYSICAL');
      const knockup = new Airborne(R_KNOCKUP_MS, this.owner, target);
      knockup.height = 95;
      target.addBuff(knockup);
    }

    for (const victim of found) {
      if (punched.has(victim) || victim.isDead || victim.toRemove) continue;
      punched.add(victim);
      victim.takeDamage(R_PASS_DAMAGE, this.owner, 'PHYSICAL');
      victim.addBuff(new Airborne(R_PASS_KNOCKUP_MS, this.owner, victim));
    }

    const aim = { x: target.position.x - this.launchPoint(at).x, y: target.position.y - this.launchPoint(at).y };
    const heading = Math.atan2(aim.y, aim.x);
    const slam = new Vi_R_Impact(this.owner, at, heading);
    slam.blastRadius = blastRadius;
    this.game.objectManager.addObject(slam);
  }

  private launchPoint(fallback: p5.Vector): p5.Vector {
    return this.owner.previousPosition ?? fallback;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The line of steam and brass she drags behind her, widening as the charge
 * covers ground, and the dynamic lock-on tether laser connecting Vi to her victim.
 */
export class Vi_R_Streak extends SpellObject {
  age = 0;
  private readonly launch: p5.Vector;
  private readonly target: AttackableUnit;
  private readonly pad = 120;

  constructor(owner: AttackableUnit, launch: p5.Vector, charge: Dash, target: AttackableUnit) {
    super(owner);
    this.launch = launch;
    this.target = target;
    this.position = owner.position.copy();
    this.attachTo(owner, charge);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const spanX = this.position.x - this.launch.x;
    const spanY = this.position.y - this.launch.y;
    const flown = Math.hypot(spanX, spanY);
    const pulse = 0.75 + 0.25 * sin(this.age / 90);

    push();
    if (flown >= 1) {
      const heading = Math.atan2(spanY, spanX);
      push();
      translate(this.launch.x, this.launch.y);
      rotate(heading);
      noStroke();
      // The ground she has swept. Anything within R_PASS_RADIUS of her is
      // thrown aside as she goes, so the band is drawn at that half-width
      // rather than as the fifteen-pixel ribbon it used to be — the shove
      // reached four times further than the picture that promised it.
      const pass = effectiveRange(R_PASS_RADIUS, this.owner);
      fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 34 * pulse);
      quad(0, -pass, flown, -pass, flown, pass, 0, pass);
      // The brass core stays narrow: it is the direction, not the reach.
      fill(BRASS[0], BRASS[1], BRASS[2], 200 * pulse);
      quad(0, -2, flown, -6, flown, 6, 0, 2);
      stroke(255, 255, 255, 150 * pulse);
      strokeWeight(2);
      line(flown * 0.55, -3, flown, 0);
      line(flown * 0.55, 3, flown, 0);
      // The disc she is clearing right now — the rounded nose of that band.
      noFill();
      stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 150 * pulse);
      strokeWeight(2);
      circle(flown, 0, pass * 2);
      pop();
    }

    // Active lock-on tether line connecting Vi to her locked target
    if (this.target && !this.target.isDead && !this.target.toRemove) {
      const tx = this.target.position.x;
      const ty = this.target.position.y;
      const vx = this.position.x;
      const vy = this.position.y;

      // Hextech energy tether beam
      stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 180 * pulse);
      strokeWeight(3.5);
      line(vx, vy, tx, ty);
      stroke(255, 255, 255, 240 * pulse);
      strokeWeight(1.5);
      line(vx, vy, tx, ty);

      // Lock-on target reticle brackets around target
      const size = (this.target.animatedValues?.displaySize ?? 40) * 0.7 + 8;
      const bracketLen = 10;
      push();
      translate(tx, ty);
      noFill();
      stroke(BRASS[0], BRASS[1], BRASS[2], 230 * pulse);
      strokeWeight(2.5);
      // 4 corner brackets
      // top-left
      line(-size, -size, -size + bracketLen, -size);
      line(-size, -size, -size, -size + bracketLen);
      // top-right
      line(size, -size, size - bracketLen, -size);
      line(size, -size, size, -size + bracketLen);
      // bottom-left
      line(-size, size, -size + bracketLen, size);
      line(-size, size, -size, size - bracketLen);
      // bottom-right
      line(size, size, size - bracketLen, size);
      line(size, size, size, size - bracketLen);

      // Inner pulsating lock pip
      fill(255, 60, 60, 200 * pulse);
      noStroke();
      circle(0, 0, 6 * pulse);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    const targetX = this.target?.position?.x ?? this.position.x;
    const targetY = this.target?.position?.y ?? this.position.y;
    const minX = Math.min(this.launch.x, this.position.x, targetX) - this.pad;
    const maxX = Math.max(this.launch.x, this.position.x, targetX) + this.pad;
    const minY = Math.min(this.launch.y, this.position.y, targetY) - this.pad;
    const maxY = Math.max(this.launch.y, this.position.y, targetY) + this.pad;
    return new Rectangle({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      data: this,
    });
  }
}


/** The wedge and slam that lands on the target: uppercut lift, brass crater, hextech shockwave. */
export class Vi_R_Impact extends SpellObject {
  lifeTime = 650;
  age = 0;
  radius = R_IMPACT_REACH;
  /** The circle that actually knocked people down; the spell writes the real one. */
  blastRadius = R_BLAST_RADIUS;
  heading: number;
  private fractures: { spread: number; length: number; kink: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector, heading: number) {
    super(owner);
    this.position = at;
    this.heading = heading;
  }

  onAdded(): void {
    for (let i = 0; i < 14; i++) {
      this.fractures.push({
        spread: random(-2.2, 2.2),
        length: random(0.6, 1.2),
        kink: random(-0.35, 0.35),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);

    // Phase 1 (0..0.38): Rising Hextech Uppercut
    // Phase 2 (0.38..1.0): Earth-shattering Slam Crater
    const isUppercut = t < 0.38;
    const slamProgress = constrain((t - 0.38) / 0.62, 0, 1);
    const slamOpen = 1 - (1 - slamProgress) * (1 - slamProgress);

    push();
    translate(this.position.x, this.position.y);

    if (isUppercut) {
      const upT = t / 0.38;
      const liftY = -Math.sin(upT * Math.PI * 0.5) * 80;

      // Hextech rising pillar & sparks
      noStroke();
      fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 180 * (1 - upT * 0.4));
      ellipse(0, liftY, 50, 90);
      fill(255, 255, 255, 230);
      ellipse(0, liftY, 26, 50);

      // Rising speed streaks
      stroke(BRASS[0], BRASS[1], BRASS[2], 220);
      strokeWeight(3);
      for (let s = -1; s <= 1; s += 2) {
        line(s * 18, 0, s * 22, liftY);
      }
    } else {
      // Massive ground crater slam
      rotate(this.heading);

      // 1. Hextech shockwave ring, stopping on the blast's own radius. It used
      //    to run out to 1.5x the crack reach — half again past anything the
      //    slam touched — so the ring taught the wrong distance every cast.
      noFill();
      stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 230 * (1 - slamProgress));
      strokeWeight(5 * (1 - slamProgress) + 2);
      circle(0, 0, this.blastRadius * 2 * slamOpen);

      // 2. Heavy brass crater cracks
      stroke(BRASS[0], BRASS[1], BRASS[2], 250 * (1 - slamProgress));
      strokeWeight(4 * (1 - slamProgress) + 1.5);
      for (const fracture of this.fractures) {
        const reach = this.radius * fracture.length * slamOpen;
        const bend = fracture.spread + fracture.kink * slamOpen;
        line(
          Math.cos(fracture.spread) * 12,
          Math.sin(fracture.spread) * 12,
          Math.cos(bend) * reach,
          Math.sin(bend) * reach
        );
      }

      // 3. Central white-hot impact core
      noStroke();
      fill(255, 255, 255, 240 * (1 - slamProgress * 1.5));
      circle(0, 0, 36 * (1 - slamProgress * 0.5));
    }

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 60) * 2);
  }
}