import type { AttackableUnit, CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { api } from '../packApi';

const withinRange = api.combat.Reach.withinRange;
const effectiveRange = api.combat.Reach.effectiveRange;
const canSee = api.combat.Vision.canSee;
const TargetResolver = api.combat.TargetResolver;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Rectangle = api.utils.Quadtree.Rectangle;
const dmg = api.text.dmg;
const heal = api.text.heal;

export const RANGE = 500;

export const DAMAGE = 26;

export const HEAL = 12;

export const COOLDOWN_MS = 5_000;

/** How long the drain streak takes to cross, so the heal reads as *paid for*. */
export const DRAIN_MS = 300;

const BLOOD: [number, number, number] = [168, 18, 30];

/**
 * Transfusion, cut down to the one sentence the brief actually asked for:
 * damage a target, heal Vladimir off it. That sentence is also the whole
 * reason this pack is getting a Vladimir at all — `stats.spellVamp` has no
 * spell using it yet, and the direct heal here is deliberately *not* it.
 * `Vladimir_W` is where the stat itself gets exercised; this ability's heal
 * is its own flat number so the character still has a reliable trade tool
 * on the (frequent) turns his pool is on cooldown.
 *
 * `docs/abilities/vladimir/q.json` layers a second resource on top of this —
 * "Crimson Rush": two casts arm a movement-speed surge, and casting a third
 * time during the surge consumes it for 85% bonus damage and a scaling bonus
 * heal off missing health. That is an entire second meter (a stack counter,
 * a decay clock, a colour-changing resource bar) in service of a bonus this
 * game's ~100-health pool has no room for — the "up to 220" bonus heal alone
 * is more than a full bar. Left out; the drain-and-heal identity survives
 * without it, and nothing downstream reads a Crimson Rush stack.
 */
export default class Vladimir_Q extends Spell {
  image = api.asset('spell_vladimir_q');
  name = 'Truyền Máu (Vladimir_Q)';
  description =
    `Rút máu mục tiêu trong <span>${RANGE}px</span>, gây ${dmg(DAMAGE, 'MAGIC')} ` +
    `và hồi ${heal(HEAL, ' máu')} cho Vladimir`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  range = RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isDrainTarget(candidate),
      getTargetInfo: candidate =>
        isDrainTarget(candidate)
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

  /** Shape lifted from `Soraka_W.ts`, the model the brief points at for a
   * `UNIT`-targeting cast: resolve a target ourselves when the input layer
   * (a bot, a controller stick) hands us a context with none picked yet. */
  press(context: CastContext): boolean {
    if (context.target !== undefined) return super.press(context);

    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  onSpellCast(context: CastContext): void {
    const target = context.target;
    if (!this.isValidTarget(target)) return;

    target.takeDamage(DAMAGE, this.owner, 'MAGIC');
    this.owner.takeHeal(HEAL, this.owner);

    this.game.objectManager.addObject(new Vladimir_Q_Drain(this.owner, target));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      isDrainTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}

const isDrainTarget = (target: unknown): target is AttackableUnit =>
  !!target &&
  typeof (target as AttackableUnit).takeDamage === 'function' &&
  !(target as AttackableUnit).isDead &&
  !(target as AttackableUnit).toRemove &&
  (target as AttackableUnit).targetable;

/**
 * The drain itself: a streak of blood pulled *from* the victim *toward*
 * Vladimir — the reverse of `Soraka_W_Beam`'s ribbon, which is the point.
 * Motion has to agree with the effect (`VFX_STANDARD.md`): this is a theft,
 * so everything in it travels inward, arriving as the flare that marks the
 * heal actually landing.
 */
export class Vladimir_Q_Drain extends SpellObject {
  target: AttackableUnit;
  age = 0;
  lifeTime = DRAIN_MS;

  /** Seeded once so the droplets travel at a fixed offset instead of
   * re-rolling (and flickering) every frame. */
  _offsets: number[] = [];

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.position = target.position.copy();
  }

  onAdded(): void {
    for (let i = 0; i < 8; i++) this._offsets.push(random(0, 1));
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // eased in: the pull starts slow and snaps toward Vladimir at the end
    const pull = t * t;
    const ax = this.target.position.x;
    const ay = this.target.position.y;
    const bx = this.owner.position.x;
    const by = this.owner.position.y;

    push();
    // the bite: a short-lived puncture flash on the victim, gone almost at once
    const bite = 1 - constrain(this.age / (this.lifeTime * 0.35), 0, 1);
    if (bite > 0) {
      noStroke();
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 200 * bite);
      circle(ax, ay, 14 * bite + 6);
      noFill();
      stroke(255, 80, 90, 220 * bite);
      strokeWeight(2);
      circle(ax, ay, 20 * bite + 10);
    }

    // the droplets, streaming from victim to Vladimir
    noStroke();
    for (const offset of this._offsets) {
      const u = constrain(offset + pull, 0, 1);
      const x = lerp(ax, bx, u);
      const y = lerp(ay, by, u);
      const fade = 1 - Math.abs(u - pull) * 2;
      fill(BLOOD[0], 30, 40, 220 * Math.max(0, fade));
      circle(x, y, 7 * (1 - u * 0.4));
    }

    // the drink: a small crimson glow blooms on Vladimir as the heal lands
    const arrival = constrain((t - 0.65) / 0.35, 0, 1);
    if (arrival > 0) {
      const size = (this.owner.animatedValues?.displaySize ?? 40) * 0.6 * (1 - arrival) + 10;
      noFill();
      stroke(120, 255, 150, 200 * (1 - arrival));
      strokeWeight(3);
      circle(bx, by, size + 20);
    }
    pop();
  }

  /** Spans the victim and Vladimir, not just its own centre — see
   * `VFX_STANDARD.md`'s "two traps `tsc` cannot catch". */
  getDisplayBoundingBox() {
    const ax = this.target.position.x;
    const ay = this.target.position.y;
    const bx = this.owner.position.x;
    const by = this.owner.position.y;
    const pad = 40;
    return new Rectangle({
      x: Math.min(ax, bx) - pad,
      y: Math.min(ay, by) - pad,
      w: Math.abs(bx - ax) + pad * 2,
      h: Math.abs(by - ay) + pad * 2,
      data: this,
    });
  }
}
