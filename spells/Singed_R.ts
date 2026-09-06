import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const StatAmp = api.buffs.StatAmp;
const SpellObject = api.SpellObject;
const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;

export const DURATION = 9000;

/**
 * The tag Poison Trail reads to know the ultimate is up.
 *
 * `docs/abilities/singed/r.json`: "During this time, Poison Trail additionally
 * applies Grievous Wounds". The poison is Q's, so the two have to agree on one
 * string — exported here, imported there, never typed twice.
 */
export const SINGED_R_STACK_ID = 'singed_r';

/**
 * What the poison takes off a heal while the potion is up, and for how long.
 *
 * Declared here rather than in `Singed_Q.ts` even though the poison is Q's:
 * the wound is *this* ability's contribution, and Q already imports from here
 * for `isInsanityPotionUp`. Putting them the other way round would make the
 * two files import each other, and a cycle between modules that both declare
 * spell classes is a load-order bug waiting for the day one of them grows a
 * top-level `api` read.
 */
export const POISON_WOUND_PERCENT = 0.4;

export const POISON_WOUND_MS = 1_000;

/**
 * Is Insanity Potion up on this unit?
 *
 * A stack-id walk rather than `hasBuff(SomeClass)`, for the reason
 * `Renekton_R.isEnraged` is written the same way: the ultimate hangs a plain
 * `StatAmp`, and `hasBuff(StatAmp)` would answer true for *any* stat buff in
 * the game — a Singed under a friendly speed shrine would poison as though his
 * ultimate were running.
 */
export function isInsanityPotionUp(unit: AttackableUnit | null | undefined): boolean {
  if (!unit) return false;
  for (const buff of unit.buffs) {
    if (buff.stackId === SINGED_R_STACK_ID && !buff.toRemove) return true;
  }
  return false;
}

export const BONUS_HEALTH = 50;

export const SPEED_PERCENT = 0.3;

/**
 * The stat the potion is *for*, and the one this pack shipped without.
 *
 * `docs/abilities/singed/r.json` lists what Insanity Potion grants and ability
 * power is first on the list; ours granted health, speed and attack damage —
 * three stats that do nothing for the poison trail, which is where nearly all
 * of Singed's damage lives. So the ultimate of a damage-over-time champion was
 * the one cast that did not touch his damage over time.
 *
 * `abilityPower` is a **fraction** in this engine (core's
 * `combat/Amplification.ts`), so 0.6 is +60% on every ability he owns, for the
 * nine seconds it is up. Sized at roughly one mid-shelf item out of a six-item
 * ceiling of 7.9 — enough that the trail is a different ability while it burns,
 * short of a second build.
 *
 * It is also the half a tank Singed can never buy, which is the point: the
 * ultimate is where a champion who spends his gold on health gets to scale.
 */
export const ABILITY_POWER = 0.6;


/** He drinks it before anything happens — the flask empties, then the gas comes. */
export const CHUG_MS = 420;

/** How long the burst off the drained flask lasts. */
export const BURST_MS = 520;

/** Points around the boiling outline. Enough to wobble, few enough to stay a shape. */
export const BOIL_SEGMENTS = 26;

export const BUBBLE_INTERVAL_MS = 170;

export const BUBBLE_MAX = 16;

export const BUBBLE_MS = 1100;

export const GAS_INTERVAL_MS = 120;

export const BOUNDING_MARGIN = 130;

/** Cosmetic-only ceiling; the buff ending or Singed dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1500;


export default class Singed_R extends Spell {
  /**
   * `Buff` alone: a transformation granting health, speed and attack damage,
   * which also empowers his trail. No damage or crowd control of its own.
   * The heal on entry fills the ceiling it raised; it is not a button to
   * press when low.
   */
  static aiRoles = api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_singed_r');
  name = 'Thuốc Hóa Điên (Singed_R)';
  description =
    `Uống thuốc trong <span class="time">${secs(DURATION)} giây</span>:` +
    ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span>, <span class="buff">+${pct(SPEED_PERCENT)}% tốc chạy</span>` +
    `, <span class="buff">+6 sát thương đánh thường</span>` +
    ` và <span class="buff">+${pct(ABILITY_POWER)}% sát thương phép</span>.` +
    ` Trong lúc đó, vệt độc còn đặt <span class="buff">Vết Thương Sâu ${pct(POISON_WOUND_PERCENT)}%</span> lên kẻ dính độc`;
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = SINGED_R_STACK_ID;
    amp.image = this.image;
    amp.name = 'Thuốc Điên';
    amp.bonuses = {
      maxHealth: { baseBonus: BONUS_HEALTH },
      speed: { percentBaseBonus: SPEED_PERCENT },
      attackDamage: { baseBonus: 6 },
      abilityPower: { baseBonus: ABILITY_POWER },
    };
    this.owner.addBuff(amp);

    // Granting the health is a heal, not a stat. `health` is a resource that
    // `takeDamage`/`takeHeal` move directly, so a modifier on it was never an
    // offset the way `maxHealth` is — and until Stats.update() stopped folding
    // its own read back into the base, `health: { baseBonus }` re-granted
    // itself every frame and made this ultimate literal immortality.
    //
    // After `addBuff`, so the larger maxHealth is already in place and the heal
    // is not clipped to the old ceiling.
    this.owner.takeHeal(BONUS_HEALTH, this.owner);

    // Nine seconds of +50 health and +30% move speed is the longest self-buff in
    // the game, and chasing a Singed who drank it is a losing proposition. That
    // has to be obvious on sight, so he boils: acid green, and deliberately not
    // the violet his Q poison uses, because the two do very different things.
    const brew = new Singed_R_Object(this.owner);
    brew.attachTo(this.owner, amp);
    this.game.objectManager.addObject(brew);
  }
}


interface Bubble {
  /** Offset from Singed, in body radii; bubbles rise in place, not outward. */
  x: number;
  y: number;
  size: number;
  rise: number;
  wobble: number;
  age: number;
}


/**
 * Insanity Potion, running hot. The silhouette is the whole read: a *boiling*
 * outline, one that visibly seethes rather than a clean ring, so a Singed under
 * it is recognisable from across the map even when the avatar is a grey dot in
 * the fog. Nothing else in the game has an unstable edge.
 */
export class Singed_R_Object extends SpellObject {
  age = 0;

  _bubbles: Bubble[] = [];
  _bubbleTimer = 0;
  _gasTimer = 0;
  _seed = 0;

  particleSystem = PredefinedParticleSystems.smoke([118, 214, 72], 0.9, 2.2);

  onAdded() {
    this.game.objectManager.addObject(this.particleSystem);
    // Gas is fed on a clock; an empty frame between puffs must not delete the
    // system, so it is drained in onRemoved() instead.
    this.particleSystem.autoRemoveIfEmpty = false;
    this._seed = random(1000);
  }

  onRemoved() {
    this.particleSystem.autoRemoveIfEmpty = true;
  }

  _gas(count: number) {
    const pos = this.owner.position;
    const r = this.owner.animatedValues.displaySize / 2;
    for (let i = 0; i < count; i++) {
      const a = random(TWO_PI);
      this.particleSystem.addParticle({
        x: pos.x + cos(a) * random(r * 0.5, r * 1.4),
        y: pos.y + sin(a) * random(r * 0.5, r * 1.4),
        size: random(14, 30),
        opacity: random(50, 110),
      });
    }
  }

  update() {
    if (this.dropIfAttachmentLost()) return;

    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (this.age >= HARD_STOP_MS) {
      this.toRemove = true;
      return;
    }

    // Nothing boils until the flask is actually empty. The chug is the windup.
    if (this.age < CHUG_MS) return;

    const r = this.owner.animatedValues.displaySize / 2;

    this._gasTimer += deltaTime;
    if (this._gasTimer >= GAS_INTERVAL_MS) {
      this._gasTimer = 0;
      this._gas(1);
    }

    this._bubbleTimer += deltaTime;
    if (this._bubbleTimer >= BUBBLE_INTERVAL_MS && this._bubbles.length < BUBBLE_MAX) {
      this._bubbleTimer = 0;
      this._bubbles.push({
        x: random(-r * 1.1, r * 1.1),
        y: r * 0.7,
        size: random(5, 13),
        rise: random(0.35, 0.8),
        wobble: random(TWO_PI),
        age: 0,
      });
    }

    let i = 0;
    while (i < this._bubbles.length) {
      const bubble = this._bubbles[i];
      bubble.age += deltaTime;
      bubble.y -= bubble.rise;
      bubble.x += sin(bubble.age / 140 + bubble.wobble) * 0.5;
      if (bubble.age >= BUBBLE_MS) this._bubbles.splice(i, 1);
      else i++;
    }
  }

  /** The seething outline, traced once per stroke pass at a given phase offset. */
  _traceBoil(radius: number, phase: number, amplitude: number) {
    beginShape();
    for (let i = 0; i < BOIL_SEGMENTS; i++) {
      const a = (TWO_PI * i) / BOIL_SEGMENTS;
      // two incommensurate waves, so the edge never settles into a pattern
      const wobble =
        sin(a * 3 + phase) * amplitude + sin(a * 5 - phase * 0.7 + this._seed) * amplitude * 0.6;
      vertex(cos(a) * (radius + wobble), sin(a) * (radius + wobble));
    }
    endShape(CLOSE);
  }

  draw() {
    const size = this.owner.animatedValues.displaySize;
    const r = size / 2;
    const buff = this._anchorBuff;
    const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
    const chug = constrain(this.age / CHUG_MS, 0, 1);
    // the brew comes up to the boil rather than switching on
    const boil = constrain((this.age - CHUG_MS) / 600, 0, 1);
    const phase = this.age / 260;

    push();
    translate(this.position.x, this.position.y);

    if (boil > 0) {
      // The pool of gas he is standing in, and the seething edge on it.
      noStroke();
      fill(70, 170, 40, 46 * boil);
      this._traceBoil(size * 0.82, phase, 7 * boil);
      noFill();
      stroke(24, 74, 16, 210 * boil);
      strokeWeight(7);
      this._traceBoil(size * 0.82, phase, 7 * boil);
      stroke(158, 246, 76, 235 * boil);
      strokeWeight(3);
      this._traceBoil(size * 0.82, phase, 7 * boil);
      // a second, faster edge inside it: two boils at different rates is what
      // separates "chemical reaction" from "wobbly circle"
      stroke(206, 255, 130, 150 * boil);
      strokeWeight(2);
      this._traceBoil(size * 0.6, -phase * 1.6, 5 * boil);
    }

    // Bubbles rising off him and bursting at the top of their run.
    for (const bubble of this._bubbles) {
      const t = bubble.age / BUBBLE_MS;
      const pop01 = constrain((t - 0.78) / 0.22, 0, 1);
      if (pop01 <= 0) {
        noStroke();
        fill(120, 226, 66, 150);
        circle(bubble.x, bubble.y, bubble.size);
        fill(226, 255, 168, 200);
        circle(bubble.x - bubble.size * 0.2, bubble.y - bubble.size * 0.2, bubble.size * 0.35);
      } else {
        noFill();
        stroke(178, 248, 104, 200 * (1 - pop01));
        strokeWeight(2);
        circle(bubble.x, bubble.y, bubble.size * (1 + pop01 * 1.8));
      }
    }

    // How much of the brew is left, in the same acid green.
    noFill();
    stroke(30, 76, 20, 120);
    strokeWeight(4);
    circle(0, 0, size * 1.85);
    stroke(166, 250, 84, 235);
    strokeWeight(4);
    arc(0, 0, size * 1.85, size * 1.85, -HALF_PI, -HALF_PI + TWO_PI * left);

    // The chug. The flask tips up, the level drops, and only when it is dry does
    // the gas come — no drink, no buff, in that order and visibly.
    if (chug < 1) {
      push();
      translate(r * 0.85, -r * 0.75);
      rotate(lerp(0.35, -1.25, chug));
      const bodyW = 13;
      const bodyH = 20;
      // glass
      noStroke();
      fill(214, 240, 226, 190);
      beginShape();
      vertex(-bodyW / 2, -bodyH / 2);
      vertex(bodyW / 2, -bodyH / 2);
      vertex(bodyW / 2, bodyH / 2);
      vertex(-bodyW / 2, bodyH / 2);
      endShape(CLOSE);
      // what is left in it, draining from the top down
      const fill01 = 1 - chug;
      fill(126, 232, 70, 240);
      beginShape();
      vertex(-bodyW / 2 + 2, bodyH / 2 - bodyH * fill01 + 2);
      vertex(bodyW / 2 - 2, bodyH / 2 - bodyH * fill01 + 2);
      vertex(bodyW / 2 - 2, bodyH / 2 - 2);
      vertex(-bodyW / 2 + 2, bodyH / 2 - 2);
      endShape(CLOSE);
      // neck
      stroke(214, 240, 226, 220);
      strokeWeight(5);
      line(0, -bodyH / 2, 0, -bodyH / 2 - 8);
      pop();
    }

    // The flask hits the ground and lets go all at once.
    if (this.age >= CHUG_MS && this.age < CHUG_MS + BURST_MS) {
      const t = (this.age - CHUG_MS) / BURST_MS;
      const fade = 1 - t;
      noFill();
      stroke(96, 208, 52, 225 * fade);
      strokeWeight(10 * fade + 2);
      circle(0, 0, size + 200 * t);
      stroke(212, 255, 140, 200 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, size + 138 * t);
      const flash = 1 - constrain(t / 0.28, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(226, 255, 170, 200 * flash);
        circle(0, 0, size * 0.95 * flash + 14);
      }
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
    return this.squareDisplayBoundingBox(r * 2);
  }
}