import type { AttackableUnit, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const E_RADIUS = 190;

export const E_DURATION_MS = 2_000;

export const E_TICK_MS = 250;

export const E_TICK_DAMAGE = 4;

export const E_TICKS = Math.floor(E_DURATION_MS / E_TICK_MS);

export const E_TOTAL_DAMAGE = E_TICKS * E_TICK_DAMAGE;

export const E_SLOW_PERCENT = 0.4;

/** How far she can put it down. */
/**
 * **430, not 340.** Same report as Q and R: a zone she throws from 40 pixels
 * past her own auto range is a zone she has to walk into a fight to place. The
 * radius is untouched — the storm is the same size, she can just put it
 * somewhere useful from where she is standing.
 */
export const E_CAST_RANGE = 430;

export const E_MANA = 60;

/** The wind-up she plants for before the storm goes up. See `castSpec`. */
export const E_CAST_MS = 200;

/** How many slugs are in the air at once. */
export const E_DROPS = 16;

/**
 * How far above its landing point a slug starts, in screen pixels.
 *
 * This game is top-down and has no third axis, so height is *drawn* rather than
 * simulated: a falling thing is one drawn above where it will land, with a
 * ground mark under it. Zeus's bolt uses 280-300 for a lightning strike out of
 * the clouds; a pistol volley is thrown, not summoned, so it comes from much
 * lower.
 */
export const E_FALL_HEIGHT = 150;

/**
 * How far sideways a slug drifts per pixel of height — the lean that says the
 * bullets were *fired* over the target rather than dropped on it.
 *
 * One direction for all of them, not a random per-drop angle: rain reads as
 * rain because every drop falls the same way.
 */
export const E_FALL_LEAN = 0.28;

/** The same lean, as the angle the slug is drawn at. */
export const E_FALL_ANGLE = Math.atan(E_FALL_LEAN);


const CRIMSON: [number, number, number] = [206, 44, 62];

const GOLD: [number, number, number] = [232, 186, 96];

const LEATHER: [number, number, number] = [58, 36, 40];


export default class MissFortune_E extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Zone | api.enums.SpellRole.Cc;

  targetingMode = 'POINT' as const;
  image = api.asset('spell_missfortune_e');
  name = 'Mưa Đạn (MissFortune_E)';
  description =
    `Trút một trận mưa đạn xuống một điểm trong <span>${E_CAST_RANGE}px</span>, bán kính ` +
    `<span>${E_RADIUS}px</span>, kéo dài <span class="time">${secs(E_DURATION_MS)} giây</span>. ` +
    `Mỗi <span class="time">${secs(E_TICK_MS)} giây</span> gây ${dmg(E_TICK_DAMAGE, 'MAGIC')} ` +
    `(tổng ${dmg(E_TOTAL_DAMAGE, 'MAGIC')} nếu đứng yên trong đó) và ` +
    `<span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span> mọi kẻ địch bên trong.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_CAST_RANGE;

  /**
   * **A wind-up, so the cast is something her body does.**
   *
   * She used to throw this without breaking stride: a champion walking across
   * a lane sprouted a storm behind her with nothing on her own body to say a
   * cast had happened — reported as "chiêu vẫn xả đạn mà champ vẫn đi". A cast
   * time is the genre's answer and the source ability carries one of about the
   * same length; `Spell` holds the caster still for the whole of it, the way a
   * swing's wind-up holds an attacker.
   *
   * Two-tenths of a second: a beat somebody can see and read, well under the
   * quarter-second the source spends, because everything in this game is
   * faster than the source.
   *
   * `cooldown.startAt: 'release'` rather than `'start'`, so a cast interrupted
   * inside the wind-up does not bill her for a storm that never fell.
   */
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      castTimeMs: E_CAST_MS,
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(E_CAST_RANGE, this.owner)
    );
    this.game.objectManager.addObject(new MissFortune_E_Rain(this.owner, to.x, to.y));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The storm on the ground.
 *
 * Ground art: it is a place on the map that champions run through, and they
 * have to stay readable inside it. The slow is `RENEW_EXISTING` — this ticks
 * four times a second, and `Slow`'s default stacks ten deep, so a stacking
 * version of this exact shape is how a 40% slow becomes a root inside a second.
 */
export class MissFortune_E_Rain extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  ticksDone = 0;
  private tickMs = 0;
  readonly atX: number;
  readonly atY: number;
  /** Where the last volley landed, seeded per tick so the picture never re-rolls. */
  splashes: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  /**
   * Where each slug lands, seeded once.
   *
   * `sqrt` on the reach because a uniform random radius clumps every drop in
   * the middle of the circle; `jitter` is the few milliseconds of scatter that
   * keeps a volley from landing as a perfect grid.
   *
   * Rolled at construction rather than in `draw` for the reason every seeded
   * effect in this pack states: re-rolling per frame makes the rain crawl
   * instead of fall.
   */
  private readonly drops = Array.from({ length: E_DROPS }, () => {
    const angle = random(0, Math.PI * 2);
    const reach = E_RADIUS * Math.sqrt(random(0.02, 1));
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      jitter: random(0, 0.18),
    };
  });

  update(): void {
    this.age += deltaTime;
    this.tickMs += deltaTime;
    // Volleys first, expiry second: the storm *is* its volleys, and checking
    // the clock ahead of the tick loses the last one on any frame long enough
    // to carry both — which is exactly what a slow frame is.
    while (this.tickMs >= E_TICK_MS && this.ticksDone < E_TICKS) {
      this.tickMs -= E_TICK_MS;
      this.volley();
    }
    if (this.age >= E_DURATION_MS || this.ticksDone >= E_TICKS) this.toRemove = true;
  }

  /** One quarter-second of bullets: everything standing under it. */
  private volley(): void {
    this.ticksDone += 1;
    this.splashes = [];

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: E_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      if (Math.hypot(victim.position.x - this.atX, victim.position.y - this.atY) > E_RADIUS + body) {
        continue;
      }
      victim.takeDamage(E_TICK_DAMAGE, this.owner, 'MAGIC');
      const slow = new Slow(E_TICK_MS * 2, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = E_SLOW_PERCENT;
      victim.addBuff(slow);
      this.splashes.push({ x: victim.position.x, y: victim.position.y });
    }
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / E_DURATION_MS);
    const beat = (this.age % E_TICK_MS) / E_TICK_MS;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(LEATHER[0], LEATHER[1], LEATHER[2], 90);
    circle(0, 0, E_RADIUS * 2);
    noFill();
    stroke(LEATHER[0], LEATHER[1], LEATHER[2], 220);
    strokeWeight(6);
    circle(0, 0, E_RADIUS * 2);
    stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 240);
    strokeWeight(3);
    // The clock, as an arc, so the zone needs no number beside it.
    arc(0, 0, E_RADIUS * 2, E_RADIUS * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);

    // **The rain falls from above.** It used to crawl *outward* from the centre
    // on a rotating lattice, which is the one thing a bullet storm must not
    // look like — reported as "nhìn như đạn bay từ tâm ra chứ không phải rơi
    // từ trên trời xuống". This is the same 2.5D trick every falling thing in
    // this game uses: the drop is drawn in screen-space *up* from its landing
    // point, and only the ground art stays flat. See Zeus's bolt.
    rectMode(CENTER);
    for (const drop of this.drops) {
      // One volley, landing together on the tick the damage lands on, with a
      // few milliseconds of scatter so it reads as rain and not as a comb.
      const fall = (beat + drop.jitter) % 1;
      const above = E_FALL_HEIGHT * (1 - fall);
      const x = drop.x + E_FALL_LEAN * above;
      const y = drop.y - above;

      // The shadow: a flat mark on the ground that tightens as the slug nears
      // it. This is what actually sells the height — without it a slug drawn
      // above its landing point is just a slug somewhere else.
      noStroke();
      fill(LEATHER[0], LEATHER[1], LEATHER[2], 90 + 90 * fall);
      ellipse(drop.x, drop.y, 10 - 4 * fall, 4 - 1.5 * fall);

      // The slug, leaning the way it is falling.
      push();
      translate(x, y);
      rotate(E_FALL_ANGLE);
      stroke(LEATHER[0], LEATHER[1], LEATHER[2], 235);
      strokeWeight(2);
      fill(GOLD[0], GOLD[1], GOLD[2], 240);
      rect(0, 0, 5, 15, 2);
      pop();

      // …and the hit it leaves, for the first fifth of its next fall.
      if (fall < 0.2) {
        const splash = fall / 0.2;
        noFill();
        stroke(GOLD[0], GOLD[1], GOLD[2], 220 * (1 - splash));
        strokeWeight(2);
        ellipse(drop.x, drop.y, 6 + 16 * splash, 3 + 7 * splash);
      }
    }
    pop();

    // A hard tick-mark on every body it caught this volley.
    push();
    for (const splash of this.splashes) {
      noFill();
      stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 200);
      strokeWeight(2);
      circle(splash.x, splash.y, 20);
    }
    pop();
  }

  /**
   * **Not a centred square.** The slugs are drawn up to `E_FALL_HEIGHT` above
   * the circle and lean sideways as they fall, so a square around the storm's
   * own centre would let the display quadtree cull the rain the moment the
   * circle itself left the top of the camera — and the rain is the effect.
   *
   * `data: this` is not optional: the display quadtree reads `entry.data.zIndex`
   * back off this rectangle every frame.
   */
  getDisplayBoundingBox() {
    const pad = 40;
    const lean = E_FALL_HEIGHT * E_FALL_LEAN;
    return new Rectangle({
      x: this.atX - E_RADIUS - pad,
      y: this.atY - E_RADIUS - E_FALL_HEIGHT - pad,
      w: (E_RADIUS + pad) * 2 + lean,
      h: (E_RADIUS + pad) * 2 + E_FALL_HEIGHT,
      data: this,
    });
  }
}
