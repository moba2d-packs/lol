import type { AttackableUnit, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const SpellObject = api.SpellObject;
const Champion = api.units.Champion;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const VectorUtils = api.utils.VectorUtils;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;
const heal = api.text.heal;

export const CAST_RANGE = 550;

export const RADIUS = 200;

/** How long the mark sits before it bursts — kept at the record's own 4s;
 * duration is not a number this pack's ~100 HP rescale touches. */
export const MARK_DURATION_MS = 4_000;

/** Share of extra damage every hit a marked body takes carries, from anyone. */
export const AMP = 0.1;

export const BURST_DAMAGE = 45;

/** The record's own beat between the burst and the payout landing. */
export const HEAL_DELAY_MS = 400;

export const HEAL_FIRST_CHAMPION = 22;

/** ~40% of the first, matching the record's ratio for every champion beyond it. */
export const HEAL_PER_EXTRA_CHAMPION = 9;

export const COOLDOWN_MS = 10_000;

/** How long the burst ring and the heal's arrival glow linger before the
 * object cleans itself up. */
export const AFTERMATH_MS = 350;

/** The plague cloud's own growth, so the mark does not simply appear. */
export const FORM_MS = 220;

const PLAGUE: [number, number, number] = [150, 190, 40];

/**
 * Hemoplague. Mark a zone, let it cook for four seconds, then it bursts for
 * damage and pays Vladimir back — the brief's example for
 * `Buff.modifyIncomingDamage`, in the same shape `Amumu_P`'s curse already
 * uses in this pack: the amplification lives on the *victim*, because
 * anyone's damage has to be able to trigger it, not only Vladimir's own.
 *
 * One deliberate departure: the record's own notes call out that `TRUE`
 * damage escaping the amplification is a bug on the live game. There is no
 * reason to import a documented bug into new content, so this implements
 * the intended rule directly — `PHYSICAL` and `MAGIC` are amplified, `TRUE`
 * is not — rather than replicating the mistake for authenticity's sake.
 *
 * The heal only counts champions, exactly as the record specifies; a wave
 * caught in the same burst still takes the damage; it just is not what pays
 * for the health back.
 */
export default class Vladimir_R extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_vladimir_r');
  name = 'Ôn Dịch Máu (Vladimir_R)';
  description =
    `Gieo rắc ôn dịch tại vị trí chỉ định trong <span>${RADIUS}px</span>. Kẻ địch trúng phải bị nhiễm ` +
    `<span class="buff">Ôn Dịch</span> trong <span class="time">${secs(MARK_DURATION_MS)} giây</span>, ` +
    `nhận thêm <span class="buff">${pct(AMP)}% sát thương</span> từ mọi nguồn. Khi hết hạn, ôn dịch nổ tung, ` +
    `gây ${dmg(BURST_DAMAGE, 'MAGIC')} cho mục tiêu nhiễm và ` +
    `hồi ${heal(HEAL_FIRST_CHAMPION, ' máu')} cho Vladimir với mỗi tướng địch bị nhiễm ` +
    `(hồi ${heal(HEAL_PER_EXTRA_CHAMPION, ' máu')} từ tướng thứ hai trở đi)`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  range = CAST_RANGE;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, this.range);

    const plague = new Vladimir_R_Object(this.owner);
    plague.position = to;
    this.game.objectManager.addObject(plague);
  }

  drawPreview(): void {
    super.drawPreview(this.range);
  }
}

/**
 * The mark. Amplifies whatever lands on the body it rides, from anyone —
 * which is the whole reason this is a buff on the *victim* and not a stat on
 * Vladimir the way `Vladimir_W`'s spell vamp is.
 */
export class Vladimir_R_Mark extends Buff {
  name = 'Ôn Dịch';
  description =
    `Nhận thêm <span class="buff">${pct(AMP)}%</span> sát thương từ mọi nguồn; khi dấu tan,` +
    ` chịu ${dmg(BURST_DAMAGE, 'MAGIC')}.`;
  stackId = 'vladimir_r_mark';

  modifyIncomingDamage(
    damage: number,
    _attacker?: AttackableUnit,
    type?: DamageType
  ): number {
    if (type === 'TRUE') return damage;
    return damage * (1 + AMP);
  }

  /** A sickly pulse on the body itself — the ongoing "this one takes more"
   * state has to be visible on the victim for the whole 4 seconds, not only
   * in the instant the burst lands. */
  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    const pulse = (sin(frameCount / 10) + 1) / 2;
    push();
    noFill();
    stroke(PLAGUE[0], PLAGUE[1], PLAGUE[2], 120 + 70 * pulse);
    strokeWeight(2.5);
    circle(pos.x, pos.y, size + 10 + pulse * 8);
    pop();
  }
}

/**
 * The ground half: marks everyone in the zone once, at cast, then owns the
 * four-second clock, the burst, and the delayed payout. `victims` is a fixed
 * snapshot — the record marks whoever is caught at the moment of the cast,
 * not whoever happens to wander through later.
 */
export class Vladimir_R_Object extends SpellObject {
  radius = RADIUS;
  age = 0;
  healAge = 0;
  detonated = false;
  healed = false;
  victims: AttackableUnit[] = [];

  onAdded(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      // A ground zone hits everyone it covers; picking a unit is a different
      // spell's job (`Brand_W` makes the same call, for the same reason).
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      const mark = new Vladimir_R_Mark(MARK_DURATION_MS, this.owner, victim);
      mark.image = api.asset('spell_vladimir_r');
      victim.addBuff(mark);
    }
    this.victims = found;
  }

  update(): void {
    this.age += deltaTime;

    if (!this.detonated && this.age >= MARK_DURATION_MS) {
      this.detonated = true;
      this._burst();
    }

    if (this.detonated && !this.healed) {
      this.healAge += deltaTime;
      if (this.healAge >= HEAL_DELAY_MS) {
        this.healed = true;
        this._payout();
      }
    }

    if (this.healed && this.healAge >= HEAL_DELAY_MS + AFTERMATH_MS) this.toRemove = true;
  }

  private _burst(): void {
    for (const victim of this.victims) {
      if (victim.isDead || victim.toRemove) continue;
      victim.takeDamage(BURST_DAMAGE, this.owner, 'MAGIC');
    }
  }

  private _payout(): void {
    let champions = 0;
    for (const victim of this.victims) {
      if (victim instanceof Champion) champions++;
    }
    if (champions === 0) return;
    const heal = HEAL_FIRST_CHAMPION + HEAL_PER_EXTRA_CHAMPION * (champions - 1);
    this.owner.takeHeal(heal, this.owner);
  }

  draw(): void {
    const growIn = constrain(this.age / FORM_MS, 0, 1);
    const form = 1 - (1 - growIn) * (1 - growIn);
    // brightens through the back half of the mark, so the burst reads as a
    // threat building rather than a surprise
    const dread = this.detonated ? 1 : constrain(this.age / MARK_DURATION_MS, 0, 1);
    const burstFade = this.detonated
      ? 1 - constrain(this.healAge / AFTERMATH_MS, 0, 1)
      : 0;

    push();
    translate(this.position.x, this.position.y);

    if (!this.detonated) {
      noStroke();
      fill(30, 40, 10, 90 * form * (0.5 + 0.5 * dread));
      circle(0, 0, this.radius * 2 * form);

      noFill();
      for (let i = 0; i < 6; i++) {
        const spin = (frameCount / 140) * (i % 2 === 0 ? 1 : -1) + i;
        const r = this.radius * form * (0.3 + 0.6 * ((i + 1) / 6));
        stroke(PLAGUE[0], PLAGUE[1], PLAGUE[2], (70 + 60 * dread) * form);
        strokeWeight(2 + dread);
        arc(0, 0, r * 2, r * 2, spin, spin + 2.1);
      }

      // hard rim on the exact radius the burst will use
      stroke(20, 26, 6, 220 * form);
      strokeWeight(6);
      circle(0, 0, this.radius * 2 * form);
      stroke(PLAGUE[0], PLAGUE[1], PLAGUE[2], (150 + 90 * dread) * form);
      strokeWeight(2.5);
      circle(0, 0, this.radius * 2 * form);
    } else if (burstFade > 0) {
      // The detonation: a ring racing outward and stopping dead on the radius
      // that burst, with the rim still lit under it. It used to sweep 30% past
      // the zone — the plague only ever touches bodies marked at cast, but the
      // ring is the last thing on screen and it was drawing the wrong circle.
      noFill();
      stroke(20, 26, 6, 200 * burstFade);
      strokeWeight(6);
      circle(0, 0, this.radius * 2);
      stroke(235, 255, 170, 230 * burstFade);
      strokeWeight(5 + 10 * (1 - burstFade));
      circle(0, 0, this.radius * 2 * (0.55 + 0.45 * (1 - burstFade)));
    }

    pop();

    // the payout: a small glow on Vladimir himself, wherever he is now
    if (this.healed) {
      const arrival = 1 - constrain((this.healAge - HEAL_DELAY_MS) / AFTERMATH_MS, 0, 1);
      if (arrival > 0) {
        push();
        translate(this.owner.position.x, this.owner.position.y);
        noFill();
        stroke(120, 255, 150, 210 * arrival);
        strokeWeight(3);
        circle(0, 0, (this.owner.animatedValues?.displaySize ?? 40) * 0.5 * (1 - arrival) + 26);
        pop();
      }
    }
  }

  /** Covers both the ground zone (which never moves) and wherever Vladimir
   * is standing when the delayed heal glow plays on him — the two are not
   * the same point once he has had four seconds to walk away. */
  getDisplayBoundingBox() {
    const pad = this.radius + 40;
    const gx = this.position.x;
    const gy = this.position.y;
    const ox = this.owner.position.x;
    const oy = this.owner.position.y;
    const ownerPad = 60;
    const minX = Math.min(gx - pad, ox - ownerPad);
    const minY = Math.min(gy - pad, oy - ownerPad);
    const maxX = Math.max(gx + pad, ox + ownerPad);
    const maxY = Math.max(gy + pad, oy + ownerPad);
    return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
  }
}
