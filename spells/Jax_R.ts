import type { AttackableUnit, Buff, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_DAMAGE = 44;

export const R_RADIUS = 200;

export const R_DURATION_MS = 6_000;

/** Armour from the first champion the swing catches… */
export const R_ARMOR = 20;

/** …and from each one after that. */
export const R_ARMOR_PER_EXTRA = 8;

/** `docs/abilities/jax/r.json`: magic resist is 60% of whatever armour it granted. */
export const R_MAGIC_RESIST_SHARE = 0.6;

/* ------------------------------------------------- Grandmaster-at-Arms passive

   Every second blow is heavier, and while the ultimate is up it is every blow.
   The counter lives on the spell rather than on the buff so the HUD badge under
   the R icon is the honest number.
   ---------------------------------------------------------------------------- */

export const R_PASSIVE_DAMAGE = 16;

/** Blows to charge the heavy one, and what that becomes while the form is up. */
export const R_PASSIVE_HITS = 2;

export const R_PASSIVE_HITS_UNLEASHED = 1;

export const R_MANA = 100;


const LAMP: [number, number, number] = [240, 196, 92];

const IRON: [number, number, number] = [66, 74, 88];

const VIOLET: [number, number, number] = [122, 92, 176];


/** The form: armour, magic resist, and the shorter fuse on the heavy blow. */
export class Jax_R_Grandmaster extends StatAmp {
  name = 'Bậc Thầy Vũ Khí';
  stackId = 'jax_r';
  /** Filled at cast: what it grants depends on how many champions the swing caught. */
  bonuses: InstanceType<typeof StatAmp>['bonuses'] = {};
}


/** Always on: his swings charge the heavy blow, and pay it when it is due. */
export class Jax_R_Counter extends BaseBuff {
  name = 'Bậc Thầy Vũ Khí';
  stackId = 'jax_r_counter';
  hudVisible = false;
  description = `Cứ ${R_PASSIVE_HITS} đòn đánh thường thì đòn sau nặng thêm ${R_PASSIVE_DAMAGE} sát thương phép.`;
  /** The ability keeping the count, so the HUD badge and this cannot disagree. */
  spell: Jax_R | null = null;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice; it charges nothing.
    if (hit.echo) return;
    this.spell?.landBlow(hit.victim);
  }
}


export default class Jax_R extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Buff | api.enums.SpellRole.Ultimate;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_jax_r');
  name = 'Bậc Thầy Vũ Khí (Jax_R)';
  description =
    `Quật cây đèn quanh mình bán kính <span>${R_RADIUS}px</span>, gây ${dmg(R_DAMAGE, 'MAGIC')}. ` +
    `Mỗi tướng địch trúng đòn cho Jax <span class="buff">+${R_ARMOR} giáp</span> ` +
    `(thêm <span>${R_ARMOR_PER_EXTRA}</span> mỗi tướng nữa) và ` +
    `<span class="buff">kháng phép bằng ${pct(R_MAGIC_RESIST_SHARE)}%</span> chỗ giáp đó, ` +
    `trong <span class="time">${secs(R_DURATION_MS)} giây</span>. ` +
    `Nội tại: cứ <span>${R_PASSIVE_HITS}</span> đòn đánh thường thì đòn kế tiếp gây thêm ` +
    `${dmg(R_PASSIVE_DAMAGE, 'MAGIC')} — chỉ cần <span>${R_PASSIVE_HITS_UNLEASHED}</span> ` +
    `khi đang trong hình thái này.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_RADIUS;

  /** Blows landed since the last heavy one. */
  charge = 0;

  get stackCount(): number {
    return this.charge;
  }

  setStackCount(count: number): boolean {
    this.charge = Math.max(0, Math.min(this.hitsNeeded, Math.floor(count)));
    return true;
  }

  /** Two ordinarily, one while the form is up. */
  get hitsNeeded(): number {
    return this.unleashed ? R_PASSIVE_HITS_UNLEASHED : R_PASSIVE_HITS;
  }

  get unleashed(): boolean {
    for (const buff of this.owner?.buffs ?? ([] as Buff[])) {
      if (buff instanceof Jax_R_Grandmaster && !buff.toRemove) return true;
    }
    return false;
  }

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Jax_R_Counter)) return;
    const counter = new Jax_R_Counter(Infinity, this.owner, this.owner);
    counter.spell = this;
    this.owner.addBuff(counter);
  }

  /** One swing landed. The heavy blow is paid on the one that fills the count. */
  landBlow(victim: AttackableUnit): void {
    if (victim.isDead) return;
    this.charge += 1;
    if (this.charge < this.hitsNeeded) return;
    this.charge = 0;
    victim.takeDamage(R_PASSIVE_DAMAGE, this.owner, 'MAGIC');
    this.game.objectManager.addObject(
      new Jax_R_Heavy(this.owner, victim.position.x, victim.position.y)
    );
  }

  onSpellCast(): void {
    const radius = effectiveRange(R_RADIUS, this.owner);
    const struck: { x: number; y: number }[] = [];

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const hit = new Set<AttackableUnit>();
    let champions = 0;
    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      hit.add(victim);
      victim.takeDamage(R_DAMAGE, this.owner, 'MAGIC');
      // The record pays only for champions caught: a swing through a creep wave
      // is a swing through a creep wave.
      if (victim.killCredit === 'champion') champions += 1;
      struck.push({ x: victim.position.x, y: victim.position.y });
    }

    const armor = champions > 0 ? R_ARMOR + R_ARMOR_PER_EXTRA * (champions - 1) : 0;
    const form = new Jax_R_Grandmaster(R_DURATION_MS, this.owner, this.owner);
    form.image = this.image;
    form.bonuses = {
      armor: { flatBonus: armor },
      magicResist: { flatBonus: Math.round(armor * R_MAGIC_RESIST_SHARE) },
    };
    this.owner.addBuff(form);

    this.game.objectManager.addObject(new Jax_R_Sweep(this.owner, radius, struck));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** The heavy blow landing: a flat wedge driven into the body it found. */
export class Jax_R_Heavy extends SpellObject {
  lifeTime = 240;
  age = 0;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(VIOLET[0], VIOLET[1], VIOLET[2], 210 * fade);
    // A hexagon rather than a ring: the lamp's own shape, coming down.
    beginShape();
    for (let i = 0; i < 6; i++) {
      const spin = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      const reach = 30 * out;
      vertex(Math.cos(spin) * reach, Math.sin(spin) * reach);
    }
    endShape(CLOSE);
    fill(LAMP[0], LAMP[1], LAMP[2], 240 * fade);
    circle(0, 0, 16 * (1 - 0.4 * t));
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(120);
  }
}


/** The lantern going round: one hard ring on the real radius, once. */
export class Jax_R_Sweep extends SpellObject {
  lifeTime = 420;
  age = 0;
  readonly radius: number;
  readonly struck: { x: number; y: number }[];

  constructor(owner: AttackableUnit, radius: number, struck: { x: number; y: number }[]) {
    super(owner);
    this.position = owner.position.copy();
    this.radius = radius;
    this.struck = struck;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const swept = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 230 * fade);
    strokeWeight(9);
    circle(0, 0, this.radius * 2);
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 235 * fade);
    strokeWeight(4);
    circle(0, 0, this.radius * 2);

    // The lamp itself, carried once round the ring.
    const lead = -Math.PI / 2 + Math.PI * 2 * swept;
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 240 * fade);
    rectMode(CENTER);
    push();
    translate(Math.cos(lead) * this.radius, Math.sin(lead) * this.radius);
    rotate(lead);
    rect(0, 0, 22, 26, 4);
    fill(LAMP[0], LAMP[1], LAMP[2], 245 * fade);
    rect(0, 0, 11, 15, 2);
    pop();

    for (const mark of this.struck) {
      stroke(LAMP[0], LAMP[1], LAMP[2], 235 * fade);
      strokeWeight(3);
      noFill();
      circle(mark.x - this.position.x, mark.y - this.position.y, 26 * (0.5 + 0.5 * swept));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
