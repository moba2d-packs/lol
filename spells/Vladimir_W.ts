import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;
const StatAmp = api.buffs.StatAmp;
const SpellObject = api.SpellObject;
const StatusFlags = api.enums.StatusFlags;
const BuffAddType = api.enums.BuffAddType;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;

export const POOL_DURATION_MS = 2_000;

export const POOL_RADIUS = 130;

export const TICK_INTERVAL_MS = 500;

export const TICK_DAMAGE = 8;

export const SLOW_PERCENT = 0.3;

/** Outlives one tick interval so the slow does not visibly flicker between
 * two ticks while a victim stands still in the pool. */
export const SLOW_LINGER_MS = TICK_INTERVAL_MS + 150;

/**
 * The stat this whole champion exists to exercise. Granted for the pool's
 * full duration, so every tick below pays for itself automatically through
 * `AttackableUnit.takeDamage`'s vamp funnel — nothing in this file computes
 * a heal number for it.
 */
export const SPELL_VAMP = 0.3;

/** The dive itself: a short burst of speed as he sinks in. */
export const SURGE_MS = 500;

export const SURGE_SPEED = 0.3;

export const COOLDOWN_MS = 10_000;

/** Rescaled from the record's 15% of max health. */
export const HEALTH_COST = 15;

/** How long the pool's rim takes to grow in — see VFX_STANDARD's "no instant
 * pop-in": the untargetable window is immediate, the *drawing* of it is not. */
export const FORM_MS = 180;

/**
 * Sanguine Pool. `docs/abilities/vladimir/w.json` calls it a self-heal *and*
 * a hard escape button in the same breath — 30% of the tick damage back as
 * health, on top of untargetable-and-ghosted for two seconds — which is
 * exactly the pairing the design brief asks this pack's whole reason for
 * Vladimir to show off: a `StatAmp` granting `stats.spellVamp` for the
 * window, so the heal is not a number this file invents but the same
 * automatic payout every other `MAGIC` hit in the game already earns once a
 * unit carries the stat. Q's heal is a flat number because Q is not the
 * point; this one is.
 *
 * Two deliberate departures from the record:
 *
 *   - **`PhasesUnits`, not `Ghosted`.** The record says "ghosted"; core's
 *     `Ghosted` flag also disables the wall push-out, which is fine for a
 *     dash that ends on a chosen point and wrong for two full seconds of
 *     player-directed movement — a body that can stand inside a wall for
 *     that long can walk out of the map. `PhasesUnits` is the flag this
 *     pack already reaches for on a *sustained* phase (`Janna_W`,
 *     `Nocturne_Q`), and it is enough: League's own pool never lets him
 *     cross terrain either, only bodies.
 *   - **One flat heal rate, not 30%/18% split by champion vs. minion.**
 *     `vampFraction` pays off the hit's damage *type*, not who is on the
 *     other end of it — adding that split back would mean bypassing the
 *     stat this ability exists to demonstrate and hand-rolling the heal
 *     after all. Uniform 30% is the champion rate; minions simply are not
 *     taxed the way the record charges them.
 *
 * Left out entirely: the exponentially-decaying speed curve (`StatAmp` is a
 * flat bonus for its duration, not a curve — a flat 500ms burst reads the
 * same at this game's pace) and the extra zero-damage tick the moment he
 * resurfaces (its only job on the wiki is triggering turret aggro on the
 * frame he becomes targetable again, which is not a mechanic this pack's
 * turrets need spelled out here).
 */
export default class Vladimir_W extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_vladimir_w');
  name = 'Hồ Máu (Vladimir_W)';
  description =
    `Chìm vào vũng máu trong <span class="time">${secs(POOL_DURATION_MS)} giây</span>, ` +
    `<span class="buff">không thể bị chọn</span> và không thể tấn công hay dùng phép, nhưng vẫn di chuyển được. ` +
    `Kẻ địch trong vũng bị ${dmg(TICK_DAMAGE, 'MAGIC')} mỗi ` +
    `${secs(TICK_INTERVAL_MS)}s và <span class="buff">chậm ${pct(SLOW_PERCENT)}%</span>. ` +
    `Trong lúc này Vladimir nhận <span class="buff">${pct(SPELL_VAMP)}% hút máu phép</span>`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  healthCost = HEALTH_COST;

  onSpellCast(): void {
    const state = new Vladimir_W_Pool(POOL_DURATION_MS, this.owner, this.owner);
    state.stackId = 'vladimir_w_pool';
    state.image = this.image;
    this.owner.addBuff(state);

    const vamp = new StatAmp(POOL_DURATION_MS, this.owner, this.owner);
    vamp.stackId = 'vladimir_w_vamp';
    vamp.name = 'Khát Máu';
    vamp.bonuses = { spellVamp: { baseBonus: SPELL_VAMP } };
    this.owner.addBuff(vamp);

    const surge = new StatAmp(SURGE_MS, this.owner, this.owner);
    surge.stackId = 'vladimir_w_surge';
    surge.name = 'Trồi Lên';
    surge.bonuses = { speed: { percentBaseBonus: SURGE_SPEED } };
    this.owner.addBuff(surge);

    // Anchored to `state`, the same way `Garen_W_Aegis` anchors to its
    // shield: the ticking-and-drawing object and the status-flag window end
    // together by construction, not by two durations that happen to agree
    // today.
    const pool = new Vladimir_W_Object(this.owner);
    pool.attachTo(this.owner, state);
    this.game.objectManager.addObject(pool);
  }
}

/**
 * The mechanical half: untargetable, ghosted-through-bodies, and locked out
 * of attacking and casting while he can still walk. `Silenced` denies
 * casting and `Disarmed` denies attacking (`StatusFlags.ts`'s own
 * `deniesCasting`/`deniesAttacking`); neither one appears in
 * `deniesMovement`, which is what leaves movement untouched.
 */
export class Vladimir_W_Pool extends Buff {
  name = 'Vũng Máu';
  statusFlagsToDisable = StatusFlags.Targetable;
  statusFlagsToEnable = StatusFlags.Silenced | StatusFlags.Disarmed | StatusFlags.PhasesUnits;
}

/**
 * The pool's ticking and its ground art. A dark, low-saturation blood pool —
 * VFX_STANDARD's "avoid both ends of value and saturation" — with a hard rim
 * traced at exactly `POOL_RADIUS`, the same circle `tick()` below queries, so
 * the edge on screen is the edge that actually matters.
 */
export class Vladimir_W_Object extends SpellObject {
  radius = POOL_RADIUS;
  age = 0;
  sinceTick = TICK_INTERVAL_MS; // ticks once immediately, matching the record

  /** Seeded once so the surface ripples drift instead of re-rolling every
   * frame (VFX_STANDARD: seed randomness in `onAdded()`, never in `draw()`). */
  _ripples: { angle: number; phase: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < 8; i++) {
      this._ripples.push({ angle: random(0, TWO_PI), phase: random(0, TWO_PI) });
    }
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.sinceTick < TICK_INTERVAL_MS) return;
    this.sinceTick -= TICK_INTERVAL_MS;
    this.tick();
  }

  private tick(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      // An area effect hits everyone it overlaps; the vision gate belongs to
      // spells that *pick* a unit (`Brand_W` makes the same call for the
      // same reason).
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      // No explicit label: `update()` already runs inside this object's own
      // `attributedTo` bracket (`ObjectManager.update()`), captured from the
      // casting spell at construction — the same reason `Brand_W_Object`
      // omits one on its own AoE hit.
      victim.takeDamage(TICK_DAMAGE, this.owner, 'MAGIC');

      const slow = new Slow(SLOW_LINGER_MS, this.owner, victim);
      slow.percent = SLOW_PERCENT;
      slow.stackId = 'vladimir_w_slow';
      // Re-ticked every 500ms on anyone still standing in the pool — without
      // this a body that never leaves stacks ten renewals deep the instant
      // the second tick lands (`Slow`'s own default add type).
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.image = api.asset('spell_vladimir_w');
      victim.addBuff(slow);
    }
  }

  draw(): void {
    const buff = this._anchorBuff;
    const elapsed = buff ? buff.timeElapsed : this.age;
    const total = buff && buff.duration ? buff.duration : POOL_DURATION_MS;
    const growIn = constrain(elapsed / FORM_MS, 0, 1);
    // eased out: the surface breaks fast, then settles
    const form = 1 - (1 - growIn) * (1 - growIn);
    const remaining = total > 0 ? constrain(1 - elapsed / total, 0, 1) : 1;
    // brightens for a beat right after each tick, so a landed hit shows on
    // the pool itself and not only as a number over the victim's head
    const tickPulse = 1 - constrain(this.sinceTick / 220, 0, 1);

    push();
    translate(this.position.x, this.position.y);

    noStroke();
    fill(70, 8, 12, 150 * form * (0.55 + 0.45 * remaining));
    circle(0, 0, this.radius * 2 * form);

    noFill();
    for (const ripple of this._ripples) {
      const spin = ripple.phase + this.age / 900;
      const rippleRadius = this.radius * form * (0.3 + 0.55 * ((sin(spin) + 1) / 2));
      stroke(150, 20, 26, 100 * form);
      strokeWeight(2);
      arc(0, 0, rippleRadius * 2, rippleRadius * 2, ripple.angle, ripple.angle + 1.3);
    }

    // hard rim on the exact radius the tick above queries
    noFill();
    stroke(35, 3, 5, 225 * form);
    strokeWeight(7);
    circle(0, 0, this.radius * 2 * form);
    stroke(215, 35, 48, 235 * form);
    strokeWeight(3);
    circle(0, 0, this.radius * 2 * form);

    if (tickPulse > 0) {
      stroke(255, 95, 105, 190 * tickPulse);
      strokeWeight(3 + 3 * tickPulse);
      circle(0, 0, this.radius * 2 * form * (0.72 + 0.28 * (1 - tickPulse)));
    }

    pop();
  }

  /** Paints a full `POOL_RADIUS` ring around Vladimir's own centre — past
   * `visionRadius`'s default zero-area box. */
  getDisplayBoundingBox() {
    const r = this.radius + 40;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
