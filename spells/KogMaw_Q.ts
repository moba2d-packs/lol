import type { AttackableUnit, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const StatAmp = api.buffs.StatAmp;
const VectorUtils = api.utils.VectorUtils;
const MissileSpellObject = api.MissileSpellObject;
const SpellObject = api.SpellObject;
const TrailSystem = api.helpers.TrailSystem;
const dmg = api.text.dmg;


export const Q_DAMAGE = 25;

export const Q_RANGE = 560;

export const Q_SPEED = 15;

export const Q_SIZE = 30;

export const Q_SHRED_PERCENT = 0.2;

export const Q_SHRED_MS = 4_000;

export const Q_COOLDOWN = 7_000;

export const Q_MANA_COST = 40;

export const Q_SHRED_STACK_ID = 'kogmaw_q_shred';

/**
 * The Void motif every Kog'Maw ability wears: sickly acid green for the
 * corrosive/on-hit theme, a violet core marking it as Void magic rather than
 * ordinary poison, and a near-black rim so the whole kit holds its silhouette
 * over pale terrain (`VFX_STANDARD.md`'s size-floor section). Declared once
 * here and imported by W/E/R so the four abilities read as one champion
 * instead of four unrelated palettes.
 */
export const VOID_ACID: readonly [number, number, number] = [150, 220, 70];

export const VOID_VIOLET: readonly [number, number, number] = [130, 60, 190];

export const VOID_DARK: readonly [number, number, number] = [30, 18, 42];


/**
 * Caustic Spittle — the poke that sets up the on-hit kit `KogMaw_W.ts` is
 * built around: whatever this hits, W chews through faster afterwards.
 *
 * `docs/abilities/kogmaw/q.json` is actually two abilities glued together —
 * a passive (bonus attack speed, always on) and an active (the spit and the
 * shred). Only the active is modelled in this file. This pack keeps a
 * champion's passive in its own `<Champion>_P.ts` slot (`spells/Amumu_P.ts`
 * is the precedent) rather than folding it into whichever numbered slot
 * happens to carry it in the source game, and this task's scope is exactly
 * the four numbered files — so a Kog'Maw passive is a follow-up file, not a
 * piece of Q.
 *
 * **`percentBonus`, not `percentBaseBonus`**, on the shred: the outer factor
 * of the stat formula (`((base + baseBonus) * (1 + percentBaseBonus) +
 * flatBonus) * (1 + percentBonus)`) covers base *and* items, while the inner
 * slot only ever sees base and its own bonus. A shred landed on the inner
 * slot ignores every point of armour or magic resist the victim actually
 * bought — the exact mistake `Renekton_E.ts`'s own header records shipping
 * once already in this pack, on the same stat.
 */
export default class KogMaw_Q extends Spell {
  image = api.asset('spell_kogmaw_q');
  name = 'Phun Axít (KogMaw_Q)';
  description =
    `Nhổ một búng đờm ăn mòn theo hướng chỉ định, gây ${dmg(Q_DAMAGE, 'MAGIC')}` +
    ` cho kẻ địch đầu tiên trúng chiêu và <span class="buff">giảm ${pct(Q_SHRED_PERCENT)}% giáp và kháng phép</span>` +
    ` của mục tiêu trong <span class="time">${secs(Q_SHRED_MS)} giây</span>.`;
  coolDown = Q_COOLDOWN;
  manaCost = Q_MANA_COST;
  range = Q_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: 180,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, Q_RANGE);
    const spit = new KogMaw_Q_Spit(this.owner);
    spit.destination = to;
    this.game.objectManager.addObject(spit);
  }
}


/** The glob in flight. Stops on its first hit — this is a poke, not a piercing shot (`KogMaw_E` pierces). */
export class KogMaw_Q_Spit extends MissileSpellObject {
  speed = Q_SPEED;
  size = Q_SIZE;
  maxHitCount = 1;
  visualWidth = Q_SIZE * 1.5;
  visualHeight = Q_SIZE * 0.85;

  age = 0;

  trailSystem = new TrailSystem({
    maxLength: 8,
    trailSize: this.size * 0.35,
    trailColor: '#96DC4644',
  });

  onAfterMove(): void {
    this.age += deltaTime;
  }

  onHit(enemy: AttackableUnit): void {
    enemy.takeDamage(Q_DAMAGE, this.owner, 'MAGIC', 'Đờm Ăn Mòn');

    const shred = new StatAmp(Q_SHRED_MS, this.owner, enemy);
    shred.stackId = Q_SHRED_STACK_ID;
    shred.image = this.image;
    shred.name = 'Ăn Mòn';
    shred.bonuses = {
      armor: { percentBonus: -Q_SHRED_PERCENT },
      magicResist: { percentBonus: -Q_SHRED_PERCENT },
    };
    enemy.addBuff(shred);

    this.game.objectManager.addObject(new KogMaw_Q_Splash(this.owner, enemy.position.copy()));
  }

  draw(): void {
    const heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const wobble = Math.sin(this.age / 70) * 3;

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);

    // dark rim first, so the glob keeps a silhouette over pale ground or water
    noStroke();
    fill(VOID_DARK[0], VOID_DARK[1], VOID_DARK[2], 210);
    ellipse(0, wobble * 0.2, this.visualWidth + 6, this.visualHeight + 6);

    // the corrosive body: sickly acid green, never the physical amber this
    // engine's combat text already spends on physical damage
    fill(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 235);
    ellipse(0, wobble * 0.2, this.visualWidth, this.visualHeight);

    // a violet core marks it as Void magic rather than ordinary poison
    fill(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 190);
    ellipse(this.visualWidth * 0.1, wobble * 0.2, this.visualWidth * 0.42, this.visualHeight * 0.55);

    // a drip trailing the glob so the travel direction reads at a glance
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 150);
    strokeWeight(2);
    line(-this.visualWidth * 0.5, 0, -this.visualWidth * 1.15, wobble * 0.5);

    pop();
  }

  getDisplayBoundingBox() {
    const r = Math.max(this.visualWidth, this.visualHeight) / 2 + 30;
    return this.squareDisplayBoundingBox(r * 2);
  }
}


/**
 * The impact, on the victim. A corrosive splash plus a cracked ring split
 * amber/cyan — one colour per resistance broken — so "both defences just
 * dropped" is legible without opening the buff bar (VFX_STANDARD's "every
 * zone that behaves differently must look different", applied to two stats
 * instead of two areas).
 */
export class KogMaw_Q_Splash extends SpellObject {
  lifeTime = 420;
  age = 0;
  radius = 46;
  private drops: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    if (this.drops.length) return;
    for (let i = 0; i < 7; i++) {
      this.drops.push({ angle: random(0, TWO_PI), reach: random(0.5, 1) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const opened = 1 - (1 - t) * (1 - t);

    push();
    translate(this.position.x, this.position.y);

    blendMode(ADD);
    noStroke();
    fill(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 110 * fade);
    circle(0, 0, this.radius * 1.3 * opened);
    blendMode(BLEND);

    for (const drop of this.drops) {
      const reach = this.radius * drop.reach * opened;
      fill(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 200 * fade);
      circle(cos(drop.angle) * reach, sin(drop.angle) * reach, 5 * fade + 2);
    }

    // the shred itself: half amber (armour), half cyan (magic resist)
    noFill();
    stroke(214, 178, 82, 210 * fade);
    strokeWeight(2.5 * fade + 1);
    arc(0, 0, this.radius * 1.15, this.radius * 1.15, -HALF_PI, HALF_PI);
    stroke(120, 224, 234, 210 * fade);
    arc(0, 0, this.radius * 1.15, this.radius * 1.15, HALF_PI, PI + HALF_PI);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 30) * 2);
  }
}
