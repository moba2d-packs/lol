import type { AttackableUnit, KillCredit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const EventType = api.enums.EventType;
const Fear = api.buffs.Fear;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;


export const R_DURATION_MS = 6_000;

/**
 * What a champion takedown buys back, and the ceiling it buys back towards.
 *
 * The record refreshes to the *original* length rather than adding on top of
 * whatever is left, which is the difference between "a reward for winning a
 * fight" and "a snowball that never ends" — so this is a floor on the
 * remainder, not a sum.
 */
export const R_TAKEDOWN_EXTENSION_MS = 3_000;

export const R_ATTACK_DAMAGE_PERCENT = 0.3;

export const R_HEALING_RECEIVED = 0.5;

/** Where the bonus move speed starts, before it begins draining away. */
export const R_SPEED_PERCENT = 0.4;

/** How often the speed bonus decays, and by what share of whatever is left. */
export const R_DECAY_TICK_MS = 250;

export const R_DECAY_PER_TICK = 0.1;

export const R_FEAR_RADIUS = 250;

export const R_FEAR_MS = 2_000;

export const R_MANA = 60;


/**
 * `EventType.ON_DIE`'s payload, named structurally.
 *
 * Core does not publish `UnitDeathEvent` through `@moba2d/core/content/types`
 * and a pack may not reach past that door for it, so this states the three
 * fields this ability actually reads. It is a *narrowing* of core's shape, not
 * a second definition of it: adding a field there cannot break this, and
 * renaming one of these three would fail the compile here, which is the only
 * direction that matters.
 */
interface DeathNotice {
  credit: KillCredit;
  killer?: AttackableUnit;
  creditedTo?: AttackableUnit;
}


const DARK: [number, number, number] = [24, 14, 18];

const BLOOD: [number, number, number] = [186, 26, 44];

const EMBER: [number, number, number] = [255, 138, 120];


/**
 * The whole ultimate as one buff row rather than three.
 *
 * A `StatAmp` per effect would put three countdowns on the buff bar for one
 * press, and they would come off at three slightly different moments the first
 * time anything refreshed one of them. The speed decay is the only moving part,
 * so it is the only thing that rebuilds the modifier — off the unit, changed,
 * back on, because `addModifier` folds a number in and mutating one already
 * applied would drift the stat instead of animating it.
 */
export class Aatrox_R_Unleashed extends StatAmp {
  name = 'Chiến Binh Tận Thế';
  stackId = 'aatrox_r';
  /** Where the speed bonus is now. Starts full and drains towards nothing. */
  speedPercent = R_SPEED_PERCENT;
  private decayMs = 0;

  bonuses = {
    attackDamage: { percentBaseBonus: R_ATTACK_DAMAGE_PERCENT },
    healingReceived: { baseBonus: R_HEALING_RECEIVED },
    speed: { percentBaseBonus: R_SPEED_PERCENT },
  };

  onUpdate(): void {
    this.decayMs += deltaTime;
    while (this.decayMs >= R_DECAY_TICK_MS) {
      this.decayMs -= R_DECAY_TICK_MS;
      this.speedPercent *= 1 - R_DECAY_PER_TICK;
      this.targetUnit.stats.removeModifier(this.statsModifier);
      this.statsModifier.speed.percentBaseBonus = this.speedPercent;
      this.targetUnit.stats.addModifier(this.statsModifier);
    }
  }
}


/**
 * World Ender — no damage of its own, and that is the point: it is the window
 * in which the rest of the kit hurts.
 *
 * `docs/abilities/aatrox/r.json` gives it three halves and a reward. The three
 * halves ride one buff above; the reward is the takedown listener below, which
 * is the only part of this file with a clock of its own.
 */
export default class Aatrox_R extends Spell {
  static aiRoles =
    api.enums.SpellRole.Buff | api.enums.SpellRole.Cc | api.enums.SpellRole.Ultimate;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_aatrox_r');
  name = 'Chiến Binh Tận Thế (Aatrox_R)';
  description =
    `Aatrox cởi bỏ hình hài phàm tục trong <span class="time">${secs(R_DURATION_MS)} giây</span>: ` +
    `<span class="buff">+${pct(R_ATTACK_DAMAGE_PERCENT)}% sát thương đánh thường</span>, ` +
    `<span class="buff">+${pct(R_HEALING_RECEIVED)}% hồi máu nhận vào</span>, và ` +
    `<span class="buff">+${pct(R_SPEED_PERCENT)}% tốc chạy</span> tụt dần ` +
    `${pct(R_DECAY_PER_TICK)}% mỗi <span class="time">${secs(R_DECAY_TICK_MS)} giây</span>. ` +
    `Lính và quái trong bán kính <span>${R_FEAR_RADIUS}px</span> bỏ chạy ` +
    `<span class="time">${secs(R_FEAR_MS)} giây</span>. Mỗi lần hạ gục tướng địch, ` +
    `thời gian còn lại được đẩy lại lên <span class="time">${secs(R_TAKEDOWN_EXTENSION_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = R_MANA;

  /** Live only while the form is up; nothing is listening the rest of the match. */
  private stopWatching?: () => void;

  onSpellCast(): void {
    const unleashed = new Aatrox_R_Unleashed(R_DURATION_MS, this.owner, this.owner);
    unleashed.image = this.image;
    this.owner.addBuff(unleashed);

    this.scatter();
    this.game.objectManager.addObject(new Aatrox_R_Bloom(this.owner));
    this.watchForTakedowns();
  }

  /**
   * Everything small enough to run does. Champions are deliberately untouched:
   * the record fears "enemy minions and monsters", and a fear that also caught
   * champions would make this a five-man crowd-control ultimate rather than a
   * duellist's transformation.
   */
  private scatter(): void {
    const radius = effectiveRange(R_FEAR_RADIUS, this.owner);
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (victim.killCredit === 'champion') continue;
      const flee = new Fear(R_FEAR_MS, this.owner, victim);
      flee.sourcePosition = this.owner.position.copy();
      victim.addBuff(flee);
    }
  }

  /**
   * A champion takedown pushes the remaining time back up.
   *
   * `creditedTo ?? killer`, in that order, because the two are different
   * questions: a champion finished off by a turret while Aatrox was hitting
   * them is *booked* to Aatrox, and the record pays a takedown, not a last hit.
   */
  private watchForTakedowns(): void {
    this.stopWatching?.();
    this.stopWatching = this.game.eventManager.on(EventType.ON_DIE, (event: DeathNotice) => {
      if (event.credit !== 'champion') return;
      if ((event.creditedTo ?? event.killer) !== this.owner) return;
      this.extend();
    });
  }

  /** Idempotent in the sense that matters: it can only ever push time forward. */
  private extend(): void {
    for (const buff of this.owner.buffs) {
      if (!(buff instanceof Aatrox_R_Unleashed) || buff.toRemove) continue;
      buff.timeElapsed = Math.min(
        buff.timeElapsed,
        Math.max(0, R_DURATION_MS - R_TAKEDOWN_EXTENSION_MS)
      );
    }
  }

  onUpdate(): void {
    if (!this.stopWatching) return;
    // The listener outliving the form would keep extending a buff that is no
    // longer there, once per kill, for the rest of the match.
    if (!this.owner.hasBuff(Aatrox_R_Unleashed)) {
      this.stopWatching();
      this.stopWatching = undefined;
    }
  }

  onRemoved(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.onRemoved();
  }

  deactivate(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.deactivate();
  }
}


/**
 * The moment the wings come out: a hard-edged ring going out on exactly the
 * radius the fear used, and four blade-shaped shards thrown out with it.
 *
 * Ground art — everything it says is about the circle on the floor, and a
 * champion standing at the edge of that circle should be drawn over it, not
 * under it.
 */
export class Aatrox_R_Bloom extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 520;
  age = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const ring = R_FEAR_RADIUS * out;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(DARK[0], DARK[1], DARK[2], 90 * fade * (1 - out));
    circle(0, 0, ring * 2);

    noFill();
    stroke(DARK[0], DARK[1], DARK[2], 220 * fade);
    strokeWeight(9);
    circle(0, 0, ring * 2);
    stroke(BLOOD[0], BLOOD[1], BLOOD[2], 240 * fade);
    strokeWeight(4);
    circle(0, 0, ring * 2);

    // Four blades thrown out with it — the wings, stated as shapes rather than
    // as a glow, and turned so no two land on an axis.
    noStroke();
    for (let i = 0; i < 4; i++) {
      const heading = (Math.PI * 2 * i) / 4 + Math.PI / 4;
      const reach = ring * 0.82;
      push();
      rotate(heading);
      fill(DARK[0], DARK[1], DARK[2], 210 * fade);
      triangle(reach * 0.3, -16, reach, 0, reach * 0.3, 16);
      fill(EMBER[0], EMBER[1], EMBER[2], 225 * fade);
      triangle(reach * 0.55, -6, reach, 0, reach * 0.55, 6);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_FEAR_RADIUS + 60) * 2);
  }
}
