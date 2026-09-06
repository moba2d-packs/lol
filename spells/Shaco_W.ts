import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const VectorUtils = api.utils.VectorUtils;
const Spell = api.Spell;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const Pet = api.units.Pet;
const Fear = api.buffs.Fear;
const SpellObject = api.SpellObject;
const TrailSystem = api.helpers.TrailSystem;
const dmg = api.text.dmg;
const tint = api.text.tint;


export const ARM_TIME_MS = 1000;

export const LIFETIME_MS = 20000;

export const FEAR_RANGE = 80;

export const FEAR_DURATION_MS = 1000;

export const ATTACK_WINDOW_MS = 4000;

export const ATTACK_RANGE = 160;

export const ATTACK_DAMAGE = 7;

export const ATTACKS_PER_SECOND = 2;

export const BOX_HEALTH = 30;

/** Points on the jester's coil chain, drawn every frame it is triggered. */
const COIL_LINKS = 8;

/**
 * How much of a buried box is drawn — the same whisper this pack's other
 * hidden trap is drawn at. Enough that a player who already knows where it is
 * can pick it out; never enough to read at a glance in a fight.
 */
const HIDDEN_ALPHA = 25;


export default class Shaco_W extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_shaco_w');
  name = 'Hộp Hề Ma Quái (Shaco_W)';
  description =
    `Đặt một Hộp Hề Ma Quái, tàng hình sau <span class="time">${secs(ARM_TIME_MS)} giây</span> và tồn tại` +
    ` <span class="time">${secs(LIFETIME_MS)} giây</span>. Khi kẻ địch tới gần, hộp bật ra:` +
    ` <span class="buff">Hoảng Sợ</span> và nã ${tint('mọi kẻ địch xung quanh')} trong <span class="time">${secs(ATTACK_WINDOW_MS)} giây</span>,` +
    ` ${dmg(ATTACK_DAMAGE, 'MAGIC')} mỗi phát. Lúc tàng hình <span class="buff">không thể bị chọn</span>,` +
    ` nhưng khi đã bật ra thì ${tint('có thể bị phá')} (${BOX_HEALTH} máu)`;
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, 100);

    const box = new Shaco_W_Box({
      game: this.game,
      position: from,
      teamId: this.owner.teamId,
      ownerUnit: this.owner,
      lifeTimeMs: LIFETIME_MS,
      stationary: true,
      followsOwner: false,
      aggroRadius: ATTACK_RANGE,
      preset: {
        name: 'Hộp Hề Ma Quái',
        spells: [],
        attack: {
          damage: ATTACK_DAMAGE,
          attacksPerSecond: ATTACKS_PER_SECOND,
          range: ATTACK_RANGE,
        },
      },
    });
    box.slideTo = to;
    this.game.objectManager.addObject(box);
  }
}


/**
 * The box, as a unit.
 *
 * It used to be a `SpellObject` that ran its own attack loop and could not be
 * touched — an enemy walking into a Shaco box had no answer except to leave.
 * As a `Pet` it is a real body: it shows up in queries, it has 30 health, and
 * once it has popped out and started shooting, killing it is the answer.
 *
 * What it must *not* be is targetable while it is still hidden — a trap you
 * can right-click before it triggers is not a trap. `Pet.setHidden` pairs
 * `Invisible` with `Untargetable` for exactly this, and the reveal takes both
 * off in the same call the fear goes out in.
 */
export class Shaco_W_Box extends Pet {
  /** Where it is being lobbed to; it slides there over the arming second. */
  slideTo: p5.Vector | null = null;
  slideSpeed = 6;
  armed = false;
  triggered = false;
  /** Counts down between volleys once popped; at 0 the next tick fires. */
  attackCooldown = 0;

  constructor(options: ConstructorParameters<typeof Pet>[0]) {
    super(options);
    this.stats.maxHealth.baseValue = BOX_HEALTH;
    this.stats.health.baseValue = BOX_HEALTH;
  }

  /**
   * A phantom trap: enemies can shoot it and hit it with spells, but it never
   * shoves a champion off their path — walking over the box is free. Excluding
   * it from `UnitCollisionSystem` (which skips any unit whose collidesWithUnits
   * is false) is all it takes; the box still sits in every gameplay query.
   */
  get collidesWithUnits(): boolean {
    return false;
  }

  update(): void {
    // The slide happens before anything else so the box is at its resting spot
    // by the time it arms — a box that armed mid-flight would fear from the
    // wrong place.
    if (this.slideTo && this.position.dist(this.slideTo) > this.slideSpeed) {
      VectorUtils.moveVectorToVector(this.position, this.slideTo, this.slideSpeed);
    }

    super.update();
    if (this.toRemove || this.isDead) return;

    if (!this.armed && this.age >= ARM_TIME_MS) {
      this.armed = true;
      this.setHidden(true);
    }

    if (this.armed && !this.triggered) {
      this.checkTrigger();
      return;
    }
    if (this.triggered) this.fireVolley();
  }

  /**
   * A single-target basic attack is the wrong shape for a trap: a box that pops
   * in the middle of a wave should punish the whole wave, not lock one body and
   * ignore the rest. So the box takes no `orderAttack` — findTarget stays null —
   * and drives its own barrage in `fireVolley` instead.
   */
  findTarget(): AttackableUnit | null {
    return null;
  }

  /**
   * One bolt at every enemy inside ATTACK_RANGE, on the attack clock. This is an
   * area effect, not an acquisition, so it is not vision-gated — the same rule
   * `checkTrigger`'s fear plays by: a body that stepped on the box in a bush
   * still eats the volley.
   */
  fireVolley(): void {
    this.attackCooldown -= deltaTime;
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 1000 / ATTACKS_PER_SECOND;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: ATTACK_RANGE }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
    }) as AttackableUnit[];

    for (const enemy of enemies) {
      const bolt = new Shaco_W_Bullet_Object(this);
      bolt.position = this.position.copy();
      bolt.targetEnemy = enemy;
      bolt.damage = ATTACK_DAMAGE;
      this.game.objectManager.addObject(bolt);
    }
  }

  /** Someone stepped on it: fear the room, come out of hiding, start the clock. */
  checkTrigger(): void {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: FEAR_RANGE }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
    }) as AttackableUnit[];
    if (enemies.length === 0) return;

    this.triggered = true;
    this.setHidden(false);
    // Its whole remaining life is the shooting window — the box is spent once
    // it has popped, whether or not the 20 seconds were up.
    this.lifeTimeMs = this.age + ATTACK_WINDOW_MS;

    for (const enemy of enemies) {
      const fear = new Fear(FEAR_DURATION_MS, this.ownerUnit, enemy);
      fear.sourcePosition = this.position.copy();
      enemy.addBuff(fear);
    }
  }

  /**
   * A jack-in-the-box, not a champion portrait: a lidded wind-up box while it
   * waits, the jester flung out on a coil once it pops.
   *
   * Nothing is drawn while it is hidden but a ghost of the crate itself — a
   * trap whose trigger radius the enemy can read is not a trap. Once it has
   * popped the box is a revealed unit shooting everything inside `ATTACK_RANGE`
   * for four seconds, and *that* reach is drawn: without it, "am I out of it
   * yet" has no answer on screen.
   */
  drawAvatar(): void {
    if (this.hidden) {
      // The buried crate, in silhouette. Everyone sees this much, which is the
      // same deal the other hidden trap in this pack offers — and the claim
      // that used to stand here, that "enemies see nothing at all because
      // `Stealthed` keeps the whole unit out of their render pass", was simply
      // false: `Stealthed` fades a body to alpha 20, it does not cull it.
      //
      // What actually gave the box away was never this picture but everything
      // painted around it — the health badge, the facing line, and above all
      // `Untargetable`'s three pulsing rings, which were drawn at a fixed
      // alpha and so stayed bright while the crate under them faded. A buried
      // box was a ring of light on an empty patch of ground. `Pet.draw` now
      // paints none of that while a summon is hidden, so this is the whole of
      // what a buried box looks like.
      push();
      translate(this.position.x, this.position.y);
      noStroke();
      fill(150, 40, 60, HIDDEN_ALPHA);
      rect(-14, -12, 28, 24, 4);
      fill(240, 200, 70, HIDDEN_ALPHA);
      rect(-14, 2, 28, 8, 0, 0, 3, 3);
      fill(120, 30, 50, HIDDEN_ALPHA);
      rect(-15, -16, 30, 6, 3);
      pop();
      return;
    }

    const bob = this.triggered ? 6 + 4 * Math.sin(this.age / 90) : 0;
    push();
    translate(this.position.x, this.position.y);

    // The barrage's reach, drawn only once the box has popped.
    if (this.triggered) {
      noFill();
      stroke(240, 200, 70, 120);
      strokeWeight(2);
      circle(0, 0, ATTACK_RANGE * 2);
    }

    // the crate body — jester red with a yellow front band and a diamond, so it
    // reads as a toy box rather than a plain barrel
    stroke(40, 20, 60);
    strokeWeight(2);
    fill(150, 40, 60);
    rect(-14, -12, 28, 24, 4);
    noStroke();
    fill(240, 200, 70);
    rect(-14, 2, 28, 8, 0, 0, 3, 3);
    fill(150, 40, 60);
    push();
    rotate(QUARTER_PI);
    rect(-4, 2, 8, 8);
    pop();

    if (!this.triggered) {
      // closed lid + a wind-up crank on the side
      stroke(40, 20, 60);
      strokeWeight(2);
      fill(120, 30, 50);
      rect(-15, -16, 30, 6, 3);
      stroke(70, 70, 82);
      strokeWeight(2);
      noFill();
      line(15, -7, 20, -7);
      line(20, -7, 20, -13);
      noStroke();
      fill(96, 96, 110);
      circle(20, -13, 5);
    } else {
      // lid flung open at the hinge, jester on a coil
      push();
      translate(-15, -16);
      rotate(-0.8);
      stroke(40, 20, 60);
      strokeWeight(2);
      fill(120, 30, 50);
      rect(0, -6, 30, 6, 3);
      pop();

      const headY = -18 - bob;
      stroke(225, 215, 120);
      strokeWeight(2);
      noFill();
      beginShape();
      for (let i = 0; i <= COIL_LINKS; i++) {
        const t = i / COIL_LINKS;
        vertex(Math.sin(t * 3 * TWO_PI) * 6, lerp(-10, headY + 7, t));
      }
      endShape();

      push();
      translate(0, headY);
      // two-point jester hat with bells
      stroke(40, 20, 60);
      strokeWeight(1.5);
      fill(70, 120, 200);
      triangle(-8, -3, -13, -13, -1, -7);
      triangle(8, -3, 13, -13, 1, -7);
      noStroke();
      fill(240, 220, 90);
      circle(-13, -13, 4);
      circle(13, -13, 4);
      // face
      stroke(40, 20, 60);
      strokeWeight(1.5);
      fill(245, 222, 194);
      circle(0, 0, 15);
      noStroke();
      fill(40, 20, 60);
      circle(-3, -1, 2.5);
      circle(3, -1, 2.5);
      fill(220, 70, 70);
      circle(0, 3, 3.5);
      pop();
    }

    pop();
  }

  getDisplayBoundingBox() {
    // Covers the crate, the jester at the top of its coil and the barrage ring
    // it paints once popped; the bolts it fires are their own SpellObjects with
    // their own boxes.
    return this.squareDisplayBoundingBox((ATTACK_RANGE + 20) * 2);
  }
}


export class Shaco_W_Bullet_Object extends SpellObject {
  isMissile = true;
  position: p5.Vector = createVector();
  targetEnemy: any = null;
  speed = 10;
  damage = 7;
  hitEffectDuration = 300;
  timeSinceHit = 0;

  static PHASES = {
    MOVING: 0,
    HIT_EFFECT: 1,
  } as const;
  phase: (typeof Shaco_W_Bullet_Object.PHASES)[keyof typeof Shaco_W_Bullet_Object.PHASES] =
    Shaco_W_Bullet_Object.PHASES.MOVING;

  // for display
  lazerWidth = 5;
  lazerLength = 20;
  strokeColor: [number, number, number] = [255, 255, 0];
  fillColor: [number, number, number] = [255, 150, 0];

  trailSystem = new TrailSystem({
    trailColor: [...this.strokeColor, 50] as any,
    trailSize: this.lazerWidth,
    maxLength: 10,
  });

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
  }

  update() {
    // move phase
    if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
      if (this.position.dist(this.targetEnemy.position) > this.speed) {
        VectorUtils.moveVectorToVector(this.position, this.targetEnemy.position, this.speed);
        this.trailSystem.addTrail(this.position);
      } else {
        // hit target
        this.targetEnemy.takeDamage(this.damage, this.owner, 'MAGIC');
        this.phase = Shaco_W_Bullet_Object.PHASES.HIT_EFFECT;
      }
    }

    // hit effect phase
    else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
      this.timeSinceHit += deltaTime;
      if (this.timeSinceHit >= this.hitEffectDuration) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    push();

    // move phase
    if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
      const dir = VectorUtils.getDirectionVector(this.position, this.targetEnemy.position);
      strokeWeight(this.lazerWidth);
      stroke(...this.strokeColor);
      line(
        this.position.x - dir.x * this.lazerLength,
        this.position.y - dir.y * this.lazerLength,
        this.position.x,
        this.position.y
      );
    }

    // hit effect phase
    else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
      // draw circle around target
      const targetSize = this.targetEnemy.stats.size.value;
      const alpha = map(this.timeSinceHit, 0, this.hitEffectDuration, 150, 0);
      const size = map(this.timeSinceHit, 0, this.hitEffectDuration, targetSize, targetSize + 50);
      stroke(...this.strokeColor, alpha + 20);
      fill(...this.fillColor, alpha);
      circle(this.targetEnemy.position.x, this.targetEnemy.position.y, size);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(this.lazerLength * 2);
  }
}