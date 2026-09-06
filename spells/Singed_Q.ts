import { api } from '../packApi';
import { secs } from '../text';
import { isInsanityPotionUp, POISON_WOUND_MS, POISON_WOUND_PERCENT } from './Singed_R';

const Spell = api.Spell;
const Rectangle = api.utils.Quadtree.Rectangle;
const SpellObject = api.SpellObject;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const DamageOverTime = api.buffs.DamageOverTime;
const HealCut = api.buffs.HealCut;
const tint = api.text.tint;

export const DURATION = 6000;

export const CLOUD_RADIUS = 90;

export const CLOUD_LIFETIME = 1800;

export const DROP_INTERVAL = 220;

export const POISON_PER_TICK = 3;


export default class Singed_Q extends Spell {
  /**
   * Told: a trail of poison dropped behind him. A placed effect, no crowd
   * control.
   */
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Zone;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_singed_q');
  name = 'Phun Khói Độc (Singed_Q)';
  description =
    `Rải khí độc phía sau trong <span class="time">${secs(DURATION)} giây</span>. Kẻ địch đi qua vệt độc bị` +
    ` ${tint(`nhiễm độc ${POISON_PER_TICK} sát thương phép`, 'MAGIC')} mỗi nhịp`;
  coolDown = 10000;
  manaCost = 30;

  onSpellCast() {
    this.game.objectManager.addObject(new Singed_Q_Trail(this.owner));
  }
}


/** The emitter, not the gas: it walks with Singed and drops clouds behind him. */
export class Singed_Q_Trail extends SpellObject {
  lifeTime = DURATION;
  age = 0;
  sinceDrop = DROP_INTERVAL;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    this.sinceDrop += deltaTime;
    if (this.age >= this.lifeTime || this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    if (this.sinceDrop < DROP_INTERVAL) return;
    this.sinceDrop = 0;

    const cloud = new Singed_Q_Cloud(this.owner);
    cloud.position = this.owner.position.copy();
    this.game.objectManager.addObject(cloud);
  }

  draw() {}

  getDisplayBoundingBox() {
    return new Rectangle({ x: this.position.x, y: this.position.y, w: 1, h: 1, data: this });
  }
}


export class Singed_Q_Cloud extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = CLOUD_RADIUS;
  visionRadius = CLOUD_RADIUS;
  lifeTime = CLOUD_LIFETIME;
  age = 0;
  sinceTick = 0;
  seed = Math.random() * 1000;

  update() {
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < 400) return;
    this.sinceTick -= 400;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => {
      const poison = new DamageOverTime(1200, this.owner, enemy);
      poison.stackId = 'singed_q_poison';
      poison.name = 'Độc Dược';
      poison.damagePerTick = POISON_PER_TICK;
      poison.tickInterval = 400;
      poison.flameColor = [200, 140, 255];
      poison.emberColor = [70, 30, 120];
      enemy.addBuff(poison);

      // Insanity Potion turns the trail from damage into an answer to a
      // healer: while it is up, the poison wounds as well as burns
      // (`docs/abilities/singed/r.json`). Refreshed by every drop, so it lasts
      // as long as they keep standing in the gas and a beat past the last one.
      if (!isInsanityPotionUp(this.owner)) return;
      const wound = new HealCut(POISON_WOUND_MS, this.owner, enemy);
      wound.healCut = POISON_WOUND_PERCENT;
      enemy.addBuff(wound);
    });
  }

  draw() {
    const t = this.age / this.lifeTime;
    const fade = 1 - t;
    push();
    translate(this.position.x, this.position.y);

    // The gas covers the circle it poisons. `this.radius` is the query radius,
    // so the fill, the puffs and the rim all come off that one number and none
    // of them can drift from what the tick actually catches — the old cloud was
    // painted at just over half of it and poisoned a body standing well clear
    // of any visible gas.
    noStroke();
    fill(148, 100, 205, 44 * fade);
    circle(0, 0, this.radius * 2);

    // Rolling gas, as strokes rather than as more discs.
    //
    // These were four filled circles sitting *inside* the body above — they
    // could not reach past its edge, so every pixel of them was drawn twice and
    // told the player nothing the body had not. That is **53% of this cloud's
    // fill**, and the trail keeps eight clouds alive at a time (1800ms of life,
    // one dropped every 220ms), so the whole thing was blending 1.34x the area
    // of a phone screen every frame for one champion. Fill area is what a
    // mobile GPU pays; alpha does not reduce it, and only area does.
    //
    // An arc costs its perimeter instead, which is the same swirl for a
    // fortieth of the pixels.
    noFill();
    stroke(185, 140, 235, 70 * fade);
    strokeWeight(3);
    for (let i = 0; i < 3; i++) {
      const a = this.seed + i * 2.1 + this.age / 600;
      const d = this.radius * (0.9 + 0.22 * i);
      arc(0, 0, d, d, a, a + 1.7);
    }

    // the hard edge: where the poison stops
    noFill();
    stroke(120, 70, 180, 185 * fade);
    strokeWeight(2.5);
    circle(0, 0, this.radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 4) * 2);
  }
}