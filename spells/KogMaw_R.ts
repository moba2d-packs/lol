import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';
import { VOID_ACID, VOID_DARK, VOID_VIOLET } from './KogMaw_Q';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const BuffAddType = api.enums.BuffAddType;
const createReveal = api.buffs.createReveal;
const effectiveRange = api.combat.Reach.effectiveRange;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


/**
 * Reaches further than the usual 450-600px skillshot band this pack tunes
 * to. Living Artillery *is* Kog'Maw — a marksman who threatens from outside
 * turret range in the source game — so shrinking it to a normal ability's
 * reach would delete the one thing that makes this an ultimate rather than a
 * bigger Q. `docs/abilities/kogmaw/r.json`'s own 1300+ range is already the
 * most exaggerated number in the kit relative to its other three; keeping
 * that same relative exaggeration lands here instead of at Q's 560.
 */
export const R_RANGE = 750;

export const R_FLIGHT_MS = 850;

export const R_EFFECT_RADIUS = 85;

export const R_DAMAGE = 45;

/** At or below this share of max health, the shot deals its execute bonus instead of the graded one. */
export const R_EXECUTE_THRESHOLD = 0.4;

/** Missing-health share at which the graded bonus caps out. */
export const R_MISSING_HEALTH_CAP = 0.6;

/** The graded bonus's ceiling, applied at `R_MISSING_HEALTH_CAP` missing health. */
export const R_MAX_MISSING_HEALTH_BONUS = 0.5;

/** The flat bonus applied instead, once a target is at or below `R_EXECUTE_THRESHOLD`. */
export const R_EXECUTE_BONUS = 1.0;

export const R_REVEAL_MS = 2_000;

/** Purely cosmetic: how high the shell's drop animation starts from. */
export const R_DROP_HEIGHT = 260;

/**
 * Far below this pack's usual ~10s ultimate cadence on purpose — every other
 * ultimate in this roster is the fight-ending kind, and this one is not.
 * The record's own cooldown scales 2s down to 1s; this keeps that spirit
 * without matching every other R's file to a near-zero outlier, because the
 * *real* brake on this ability is the escalating cost below, exactly as it is
 * in the record — a low cooldown that never got expensive would just be
 * Q with extra steps.
 */
export const R_COOLDOWN_MS = 3_000;

/** How many casts within one window keep raising the price. */
export const R_MAX_STACKS = 9;

/** How long a stack survives without another cast before the price resets. */
export const R_STACK_DURATION_MS = 8_000;

export const R_BASE_MANA_COST = 20;

/**
 * Per stack. `R_BASE_MANA_COST` to `R_BASE_MANA_COST + R_STACK_MANA_COST *
 * R_MAX_STACKS` is 20 to 200 — the same 10x spread `docs/abilities/kogmaw/r.json`
 * states (40 to 400), rescaled to this pool's mana economy instead of copied.
 */
export const R_STACK_MANA_COST = 20;

export const R_STACK_ID = 'kogmaw_r_stacks';

export const R_REVEAL_STACK_ID = 'kogmaw_r_reveal';


/**
 * Living Artillery — a long-range snipe whose real limiter is its own
 * escalating cost, not its cooldown. `docs/abilities/kogmaw/r.json` is
 * explicit about the stacking rule ("generates a stack ... for 8 seconds,
 * refreshing on subsequent casts and stacking up to 9 times", each stack
 * adding to the mana cost), and it is modelled rather than skipped: it maps
 * directly onto this engine's existing `Buff.countedStacks` mechanism — the
 * same "one instance, a growing `stacks` counter, one shared duration that
 * refreshes per cast" shape `Veigar_Q.ts`'s `Veigar_Q_Power` already uses —
 * so there was no new engine seam to invent, only a buff whose `stacks`
 * `onUpdate()` reads back into `this.manaCost` every frame. Skipping it would
 * have left the signature trait of this ability (cast it often enough and it
 * starts refusing you) out of the one file whose whole brief is "decide
 * whether to model it".
 *
 * `this.manaCost` is a plain field, not a getter — `Lissandra_E.ts`'s own
 * header explains why a getter cannot shadow it (native class-field semantics
 * define an own property on the instance that a subclass accessor cannot see
 * through) — so it is reassigned imperatively instead, the same pattern that
 * file uses for its own dynamic cost.
 *
 * The missing-health bonus is real rather than simplified away: `stats.health`
 * and `stats.maxHealth` are ordinary public stats (`Garen_R.ts` already reads
 * them the same way for its own execute), so there was nothing this pack's
 * seams stood in the way of.
 */
export default class KogMaw_R extends Spell {
  image = api.asset('spell_kogmaw_r');
  name = 'Pháo Sinh Học (KogMaw_R)';
  description =
    `Bắn một quả cầu axit bay <span class="time">${secs(R_FLIGHT_MS)} giây</span> rồi rơi xuống điểm chỉ định,` +
    ` gây ${dmg(R_DAMAGE, 'MAGIC')} cho kẻ địch trong bán kính` +
    ` ${R_EFFECT_RADIUS} và <span class="buff">phát hiện</span> chúng trong` +
    ` <span class="time">${secs(R_REVEAL_MS)} giây</span>. Sát thương tăng dần tới` +
    ` <span class="buff">+${pct(R_MAX_MISSING_HEALTH_BONUS)}%</span> khi mục tiêu càng mất nhiều máu,` +
    ` hoặc <span class="buff">+${pct(R_EXECUTE_BONUS)}%</span> nếu mục tiêu dưới` +
    ` ${pct(R_EXECUTE_THRESHOLD)}% máu tối đa. Mỗi lần bắn cộng dồn một` +
    ` <span class="buff">chồng chi phí</span> trong <span class="time">${secs(R_STACK_DURATION_MS)} giây</span>,` +
    ` mỗi chồng làm chiêu này tốn thêm ${R_STACK_MANA_COST} năng lượng.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_BASE_MANA_COST;
  range = R_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      castTimeMs: 250,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  /** The ability icon's own stack badge — the same seam `Veigar_Q.stackCount` reads. */
  get stackCount(): number {
    return this.currentStacks;
  }

  /** Kept current every frame rather than only at press-time, so the tooltip never shows a stale price. */
  onUpdate(): void {
    this.manaCost = R_BASE_MANA_COST + R_STACK_MANA_COST * this.currentStacks;
  }

  onSpellCast(context?: CastContext): void {
    const at = this.landingPoint(context);
    this.game.objectManager.addObject(new KogMaw_R_Shell(this.owner, at));

    const stack = new KogMaw_R_Stacks(R_STACK_DURATION_MS, this.owner, this.owner);
    stack.stackId = R_STACK_ID;
    stack.image = this.image;
    this.owner.addBuff(stack);
  }

  private get currentStacks(): number {
    for (const buff of this.owner.buffs) {
      if (buff instanceof KogMaw_R_Stacks && !buff.toRemove) return buff.stacks;
    }
    return 0;
  }

  /** The cursor point, clamped to the cast range through Reach — same shape as `Ziggs_R.ts`. */
  private landingPoint(context?: CastContext): p5.Vector {
    const cursor = context ? context.cursorWorld : this.aimPoint;
    const dx = cursor.x - this.owner.position.x;
    const dy = cursor.y - this.owner.position.y;
    const reach = effectiveRange(this.range, this.owner);
    const away = Math.hypot(dx, dy);
    if (away <= reach || away < 1e-4) return createVector(cursor.x, cursor.y);
    return createVector(
      this.owner.position.x + (dx / away) * reach,
      this.owner.position.y + (dy / away) * reach
    );
  }
}


/**
 * The escalating price, counted. `countedStacks` means at most one live
 * instance ever exists on the owner — `AttackableUnit.addBuff` grows its
 * `stacks` and renews its duration on every subsequent cast instead of
 * pushing a second instance — so `KogMaw_R.currentStacks` never has to sum
 * across a list the way `Veigar_Q.stackCount` does for its permanent stacks;
 * there is only ever one entry to find, and it fully resets to nothing 8
 * seconds after the last cast. No world drawing: the HUD's own buff-icon row
 * already renders a stack count for any buff grouped by `stackId`, which is
 * the whole reason this needs no `draw()` of its own.
 */
export class KogMaw_R_Stacks extends Buff {
  name = 'Quá Nhiệt';
  description = `Mỗi chồng làm Đại Bác Sinh Học tốn thêm ${R_STACK_MANA_COST} năng lượng, hết sau ${secs(R_STACK_DURATION_MS)} giây không bắn.`;
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  countedStacks = true;
  maxStacks = R_MAX_STACKS;
}


/**
 * The shell itself: a windup shadow that grows to the true blast radius,
 * then a single hard-rimmed detonation (one zone, one rule — unlike Ziggs'
 * two-ring bomb, this ability has only one damage number to draw).
 */
export class KogMaw_R_Shell extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  radius = R_EFFECT_RADIUS;
  age = 0;
  detonated = false;
  scorches: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    if (this.scorches.length) return;
    for (let i = 0; i < 10; i++) {
      this.scorches.push({ angle: (i / 10) * TWO_PI + random(-0.2, 0.2), reach: random(0.7, 1) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (!this.detonated && this.age >= R_FLIGHT_MS) this.detonate();
  }

  private detonate(): void {
    this.detonated = true;

    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: R_EFFECT_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      const gap = Math.hypot(
        victim.position.x - this.position.x,
        victim.position.y - this.position.y
      );
      if (gap > R_EFFECT_RADIUS) continue;

      victim.takeDamage(this.damageFor(victim), this.owner, 'MAGIC', 'Đại Bác Sinh Học');

      victim.addBuff(
        createReveal({
          stackId: R_REVEAL_STACK_ID,
          durationMs: R_REVEAL_MS,
          source: this.owner,
          target: victim,
          visionRadius: R_EFFECT_RADIUS + 120,
          image: api.asset('spell_kogmaw_r'),
        })
      );
    }

    this.game.objectManager.addObject(new KogMaw_R_Blast(this.owner, this.position.copy()));
    this.toRemove = true;
  }

  /** `docs/abilities/kogmaw/r.json`'s missing-health ramp, plus its below-40%-health execute bonus. */
  private damageFor(target: AttackableUnit): number {
    const maxHp = target.stats.maxHealth.value;
    const hp = target.stats.health.value;
    if (maxHp <= 0) return R_DAMAGE;

    if (hp <= maxHp * R_EXECUTE_THRESHOLD) {
      return R_DAMAGE * (1 + R_EXECUTE_BONUS);
    }

    const missingFrac = 1 - hp / maxHp;
    const graded = Math.min(missingFrac / R_MISSING_HEALTH_CAP, 1) * R_MAX_MISSING_HEALTH_BONUS;
    return R_DAMAGE * (1 + graded);
  }

  draw(): void {
    const t = constrain(this.age / R_FLIGHT_MS, 0, 1);
    const swell = t * t;
    const fallen = t * t * t;

    push();
    // the growing shadow: how long is left, read off the floor
    noStroke();
    fill(VOID_DARK[0], VOID_DARK[1], VOID_DARK[2], 70 + 70 * t);
    circle(this.position.x, this.position.y, R_EFFECT_RADIUS * 2 * swell);

    // the true radius, from the first frame — where the hit lands is never a guess
    noFill();
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 70 + 140 * t);
    strokeWeight(2 + 1.5 * t);
    circle(this.position.x, this.position.y, R_EFFECT_RADIUS * 2);

    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 60 * t);
    strokeWeight(1);
    for (const scorch of this.scorches) {
      line(
        this.position.x + cos(scorch.angle) * R_EFFECT_RADIUS * 0.4,
        this.position.y + sin(scorch.angle) * R_EFFECT_RADIUS * 0.4,
        this.position.x + cos(scorch.angle) * R_EFFECT_RADIUS * scorch.reach,
        this.position.y + sin(scorch.angle) * R_EFFECT_RADIUS * scorch.reach
      );
    }

    // the globule dropping in
    const by = this.position.y - (1 - fallen) * R_DROP_HEIGHT;
    const shell = 16 + 16 * fallen;
    noStroke();
    fill(VOID_DARK[0], VOID_DARK[1], VOID_DARK[2], 235);
    circle(this.position.x, by, shell);
    fill(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 120);
    circle(this.position.x - shell * 0.2, by - shell * 0.2, shell * 0.45);
    noFill();
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 240);
    strokeWeight(3);
    circle(this.position.x, by, shell);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Math.max(this.radius, R_DROP_HEIGHT) + 40) * 2);
  }
}


/** The detonation flash: one filled zone, one hard rim, gone in half a second. */
export class KogMaw_R_Blast extends SpellObject {
  radius = R_EFFECT_RADIUS;
  lifeTime = 480;
  age = 0;
  shards: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    if (this.shards.length) return;
    for (let i = 0; i < 16; i++) {
      this.shards.push({ angle: (i / 16) * TWO_PI + random(-0.15, 0.15), reach: random(0.7, 1) });
    }
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
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 200 * fade);
    strokeWeight(2.5 * fade + 1);
    for (const shard of this.shards) {
      const outer = this.radius * shard.reach * opened;
      line(
        this.position.x + cos(shard.angle) * this.radius * 0.3,
        this.position.y + sin(shard.angle) * this.radius * 0.3,
        this.position.x + cos(shard.angle) * outer,
        this.position.y + sin(shard.angle) * outer
      );
    }
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 235 * fade);
    strokeWeight(4 * fade + 2);
    circle(this.position.x, this.position.y, this.radius * 2);

    noStroke();
    fill(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 190 * fade);
    circle(this.position.x, this.position.y, this.radius * 1.1 * opened);
    fill(240, 250, 230, 220 * fade * fade);
    circle(this.position.x, this.position.y, this.radius * 0.5 * opened);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
