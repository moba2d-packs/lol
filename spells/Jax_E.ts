import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const SpellForm = api.enums.SpellForm;
const Stun = api.buffs.Stun;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;


export const E_STANCE_MS = 1_600;

/** The record's "can be recast after 1 second", and it fires itself at the end. */
export const E_RECAST_GAP_MS = 800;

export const E_RADIUS = 190;

export const E_BASE_DAMAGE = 20;

/** Each blow turned aside adds this share, and the ramp stops here. */
export const E_PER_DODGE = 0.2;

export const E_MAX_DODGES = 5;

export const E_STUN_MS = 800;

/** What a spell landing during the stance is worth. Blows are turned aside whole. */
export const E_SPELL_REDUCTION = 0.25;

export const E_MANA = 50;


const LAMP: [number, number, number] = [240, 196, 92];

const IRON: [number, number, number] = [66, 74, 88];

const VIOLET: [number, number, number] = [122, 92, 176];


/** `E_BASE_DAMAGE` at nothing dodged, doubled at `E_MAX_DODGES`. */
export function counterDamage(dodges: number): number {
  const held = Math.max(0, Math.min(E_MAX_DODGES, dodges));
  return Math.round(E_BASE_DAMAGE * (1 + E_PER_DODGE * held));
}


/**
 * Evasion: blows turned aside, spells merely blunted.
 *
 * **The record dodges *basic attacks* and this dodges *physical damage*, and
 * the difference is an engine gap rather than a design choice.**
 * `Buff.modifyIncomingDamage` is handed the amount, the attacker and the damage
 * type — not the `source` string `landBasicAttack` passes one argument further
 * along — so nothing on the victim's side can tell a swing from a physical
 * ability. Type is the one axis available, and it lands close: `landBasicAttack`
 * is the only thing in the engine that types damage `PHYSICAL` on its own, so
 * the rule reads at the table exactly as the card does — he turns the blows
 * aside and shrugs off the spells — while quietly also turning aside a physical
 * ability. Naming that here is cheaper than a listener that could only ever
 * count a hit *after* it had already landed.
 */
export class Jax_E_Evasion extends BaseBuff {
  name = 'Phản Công';
  stackId = 'jax_e';
  description = `Gạt mọi đòn vật lý và giảm ${pct(E_SPELL_REDUCTION)}% sát thương phép.`;
  /** How many blows it has turned aside. The counter's damage is built from this. */
  dodges = 0;

  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit, type?: DamageType): number {
    if (type === 'PHYSICAL') {
      this.dodges += 1;
      return 0;
    }
    return damage * (1 - E_SPELL_REDUCTION);
  }
}


/**
 * Counter Strike — he stands still, and then everything around him pays for it.
 *
 * A `RECAST` activation with `recastDelayMs`, so the early press is refused by
 * the runtime rather than by a hand-rolled clock; and `onUpdate` fires the
 * counter itself at the end of the stance, because the record says it "does so
 * automatically after the duration" and a player who forgets should still get
 * the ability.
 */
export default class Jax_E extends Spell {
  static aiRoles =
    api.enums.SpellRole.Shield | api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  static aiRecastAfterMs = E_RECAST_GAP_MS + 200;

  image = api.asset('spell_jax_e');
  name = 'Phản Công (Jax_E)';
  description =
    `Vào thế né trong <span class="time">${secs(E_STANCE_MS)} giây</span>: ` +
    `<span class="buff">gạt sạch mọi đòn vật lý</span> và giảm ` +
    `<span class="buff">${pct(E_SPELL_REDUCTION)}% sát thương phép</span>. ` +
    `Sau <span class="time">${secs(E_RECAST_GAP_MS)} giây</span> có thể <b>bấm lại</b> ` +
    `(hoặc để nó tự nổ khi hết giờ) để quật đèn quanh mình bán kính ` +
    `<span>${E_RADIUS}px</span>, gây từ ${dmgValue(E_BASE_DAMAGE, 'MAGIC')} lên tới ` +
    `${dmg(counterDamage(E_MAX_DODGES), 'MAGIC')} tuỳ số đòn đã gạt, và ` +
    `<span class="buff">Choáng ${secs(E_STUN_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_RADIUS;

  /** The stance standing right now, or nothing. */
  private evasion: Jax_E_Evasion | null = null;
  private stanceMs = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: E_STANCE_MS, recastDelayMs: E_RECAST_GAP_MS },
      // He walks and fights through it; crowd control is what takes it away.
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(): void {
    this.stanceMs = 0;
    const evasion = new Jax_E_Evasion(E_STANCE_MS, this.owner, this.owner);
    evasion.image = this.image;
    this.owner.addBuff(evasion);
    this.evasion = evasion;
    this.game.objectManager.addObject(new Jax_E_Guard(this.owner, evasion));
  }

  onUpdate(): void {
    if (!this.evasion) return;
    this.stanceMs += deltaTime;
    if (this.stanceMs < E_STANCE_MS) return;
    // "…and does so automatically after the duration."
    this.counter();
  }

  onRecast(): void {
    this.counter();
  }

  onComplete(): void {
    this.evasion = null;
  }

  /** Idempotent: the recast and the stance running out can share a frame. */
  private counter(): void {
    const evasion = this.evasion;
    if (!evasion) return;
    this.evasion = null;
    if (!evasion.toRemove) evasion.deactivateBuff();
    if (this.owner.isDead) return;

    const damage = counterDamage(evasion.dodges);
    const radius = effectiveRange(E_RADIUS, this.owner);
    const struck: { x: number; y: number }[] = [];

    // No vision filter: a lantern swung round him lands on the champion in the
    // bush he is standing in.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const hit = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      hit.add(victim);
      victim.takeDamage(damage, this.owner, 'MAGIC');
      victim.addBuff(new Stun(E_STUN_MS, this.owner, victim));
      struck.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new Jax_E_Counter(this.owner, radius, evasion.dodges, struck)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** The stance: plates spinning round him, one more for each blow turned aside. */
export class Jax_E_Guard extends SpellObject {
  age = 0;
  private readonly evasion: Jax_E_Evasion;

  constructor(owner: AttackableUnit, evasion: Jax_E_Evasion) {
    super(owner);
    this.position = owner.position.copy();
    this.evasion = evasion;
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= E_STANCE_MS || this.evasion.toRemove || this.owner.isDead) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / E_STANCE_MS);
    const radius = (this.owner.animatedValues?.displaySize ?? 40) * 0.9;
    // One plate per turned-aside blow, above a floor of three, so the ramp is
    // visible from outside the fight rather than only in the number it pays.
    const plates = Math.min(3 + this.evasion.dodges, 3 + E_MAX_DODGES);

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    for (let i = 0; i < plates; i++) {
      const spin = (Math.PI * 2 * i) / plates + this.age * 0.006;
      push();
      rotate(spin);
      fill(IRON[0], IRON[1], IRON[2], 235);
      rectMode(CENTER);
      rect(radius, 0, 16, 8, 2);
      fill(VIOLET[0], VIOLET[1], VIOLET[2], 230);
      rect(radius, 0, 9, 4, 1);
      pop();
    }
    // The countdown to the counter, drawn as an arc so it needs no number.
    noFill();
    stroke(LAMP[0], LAMP[1], LAMP[2], 220);
    strokeWeight(3);
    arc(0, 0, radius * 2.5, radius * 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(200);
  }
}


/** The counter: a hard ring on the real radius, and a mark on every body caught. */
export class Jax_E_Counter extends SpellObject {
  lifeTime = 340;
  age = 0;
  readonly radius: number;
  readonly dodges: number;
  readonly struck: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    radius: number,
    dodges: number,
    struck: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = owner.position.copy();
    this.radius = radius;
    this.dodges = dodges;
    this.struck = struck;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const ring = this.radius * out;
    // Heavier the more it turned aside, so the size of the answer is visible.
    const weight = 6 + this.dodges;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 235 * fade);
    strokeWeight(weight);
    circle(0, 0, ring * 2);
    stroke(LAMP[0], LAMP[1], LAMP[2], 245 * fade);
    strokeWeight(3);
    circle(0, 0, ring * 2);

    // The arc of the swing itself, sweeping round the ring once.
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], 240 * fade);
    strokeWeight(6);
    const lead = -Math.PI / 2 + Math.PI * 2 * out;
    arc(0, 0, ring * 2, ring * 2, lead - 0.7, lead);
    pop();

    push();
    for (const mark of this.struck) {
      stroke(LAMP[0], LAMP[1], LAMP[2], 240 * fade);
      strokeWeight(4);
      const reach = 16 * (0.5 + 0.5 * out);
      line(mark.x - reach, mark.y, mark.x + reach, mark.y);
      line(mark.x, mark.y - reach, mark.x, mark.y + reach);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
