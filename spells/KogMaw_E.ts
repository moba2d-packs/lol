import type { AttackableUnit, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';
import { VOID_ACID, VOID_DARK, VOID_VIOLET } from './KogMaw_Q';

const Spell = api.Spell;
const VectorUtils = api.utils.VectorUtils;
const MissileSpellObject = api.MissileSpellObject;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const BuffAddType = api.enums.BuffAddType;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const TrailSystem = api.helpers.TrailSystem;
const dmg = api.text.dmg;


export const E_DAMAGE = 20;

export const E_RANGE = 560;

export const E_SPEED = 11;

/** Collision diameter — a wide, wet gob, wider than Q's precise spit. */
export const E_WIDTH = 70;

export const E_COOLDOWN = 9_000;

export const E_MANA_COST = 45;

/** How often, in ms of flight, the missile drops a puddle behind it. */
export const E_OOZE_DROP_INTERVAL_MS = 130;

export const E_OOZE_RADIUS = 65;

export const E_OOZE_LIFETIME_MS = 3_000;

export const E_SLOW_PERCENT = 0.3;

/** How long one application of the slow rides a victim — refreshed every tick they stay inside. */
export const E_SLOW_MS = 500;

/** How often a standing victim's slow is refreshed, in ms. */
export const E_SLOW_TICK_MS = 150;

export const E_SLOW_STACK_ID = 'kogmaw_e_slow';


/**
 * Void Ooze — the lingering control tool of the kit: a wide bolt that pierces
 * (unlike Q, which stops on its first hit) and leaves a trail of slowing
 * ground behind it as it flies.
 *
 * `docs/abilities/kogmaw/e.json` has the missile deposit "a blob of ooze
 * every 125 units travelled"; this drops one on a fixed timer instead
 * (`E_OOZE_DROP_INTERVAL_MS`) rather than tracking distance travelled since
 * the last drop, because every other timed effect in this pack already reads
 * off `deltaTime` and a second distance-accumulator would be a second unit of
 * measurement for the same idea. At this missile's constant speed the two are
 * the same shot, just counted differently.
 *
 * The record's own damage does not scale with a victim's build the way Q's
 * shred is designed to be built around, so E stays a flat magic number,
 * sized as a lingering-utility ability rather than a burst one — the slow
 * field is the reason to land this, not the hit itself.
 */
export default class KogMaw_E extends Spell {
  image = api.asset('spell_kogmaw_e');
  name = 'Dung Dịch Hư Không (KogMaw_E)';
  description =
    `Phun một khối bùn Hư Không theo hướng chỉ định, xuyên qua mọi kẻ địch và gây` +
    ` ${dmg(E_DAMAGE, 'MAGIC')} cho mỗi kẻ trúng chiêu.` +
    ` Vệt bùn để lại tồn tại <span class="time">${secs(E_OOZE_LIFETIME_MS)} giây</span>,` +
    ` <span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span> kẻ địch đứng trong đó.`;
  coolDown = E_COOLDOWN;
  manaCost = E_MANA_COST;
  range = E_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: 250,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, E_RANGE);
    const ooze = new KogMaw_E_Ooze(this.owner);
    ooze.destination = to;
    this.game.objectManager.addObject(ooze);
  }
}


/** The bolt in flight. Pierces every enemy on its line (`MissileSpellObject.hitTargets` already hits each once). */
export class KogMaw_E_Ooze extends MissileSpellObject {
  speed = E_SPEED;
  size = E_WIDTH;
  maxHitCount = Infinity;
  visualWidth = E_WIDTH * 1.3;
  visualHeight = E_WIDTH * 0.85;

  age = 0;
  sinceDrop = 0;

  trailSystem = new TrailSystem({
    maxLength: 12,
    trailSize: this.size * 0.32,
    trailColor: '#96DC4633',
  });

  onAfterMove(): void {
    this.age += deltaTime;
    this.sinceDrop += deltaTime;
    if (this.sinceDrop < E_OOZE_DROP_INTERVAL_MS) return;
    this.sinceDrop = 0;
    this.dropPuddle();
  }

  onArrive(): void {
    this.dropPuddle();
    if (this.trailSystem) this.trailSystem.toRemove = true;
  }

  private dropPuddle(): void {
    const puddle = new KogMaw_E_Puddle(this.owner);
    puddle.position = this.position.copy();
    this.game.objectManager.addObject(puddle);
  }

  onHit(enemy: AttackableUnit): void {
    enemy.takeDamage(E_DAMAGE, this.owner, 'MAGIC', 'Bùn Hư Không');
  }

  draw(): void {
    const heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const churn = Math.sin(this.age / 90) * 4;

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);

    noStroke();
    fill(VOID_DARK[0], VOID_DARK[1], VOID_DARK[2], 200);
    ellipse(0, 0, this.visualWidth + 8, this.visualHeight + 8 + churn);

    fill(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 225);
    ellipse(0, 0, this.visualWidth, this.visualHeight + churn);

    fill(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 170);
    ellipse(-this.visualWidth * 0.1, 0, this.visualWidth * 0.5, this.visualHeight * 0.5);

    pop();
  }

  getDisplayBoundingBox() {
    const r = Math.max(this.visualWidth, this.visualHeight) / 2 + 30;
    return this.squareDisplayBoundingBox(r * 2);
  }
}


/**
 * One puddle of the trail. Ground art (`GROUND_Z_INDEX`) — a flat pool a
 * champion stands in, not a rising cloud, so it must never resolve above the
 * bodies standing in it. Re-applies its slow on a short tick rather than
 * every frame, and `RENEW_EXISTING` so a victim who stays in two overlapping
 * puddles is not slowed twice as hard for it — one field, one slow.
 */
export class KogMaw_E_Puddle extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  radius = E_OOZE_RADIUS;
  visionRadius = 0;
  lifeTime = E_OOZE_LIFETIME_MS;
  age = 0;
  sinceTick = 0;
  seed = Math.random() * 1000;

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.sinceTick += deltaTime;
    if (this.sinceTick < E_SLOW_TICK_MS) return;
    this.sinceTick = 0;

    const inside = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of inside) {
      const gap = Math.hypot(
        victim.position.x - this.position.x,
        victim.position.y - this.position.y
      );
      if (gap > this.radius) continue;

      const slow = new Slow(E_SLOW_MS, this.owner, victim);
      slow.percent = E_SLOW_PERCENT;
      slow.stackId = E_SLOW_STACK_ID;
      slow.image = api.asset('spell_kogmaw_e');
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      victim.addBuff(slow);
    }
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // thins out over the last third — the only warning a player standing in
    // it gets that the slow is about to lift
    const fade = 1 - constrain((t - 0.66) / 0.34, 0, 1);
    const bubble = this.age / 260;

    push();
    translate(this.position.x, this.position.y);
    noStroke();

    fill(VOID_DARK[0], VOID_DARK[1], VOID_DARK[2], 120 * fade);
    circle(0, 0, this.radius * 2);

    fill(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 95 * fade);
    circle(0, 0, this.radius * 1.7);

    for (let i = 0; i < 5; i++) {
      const a = this.seed + i * 1.3;
      const d = this.radius * (0.25 + 0.5 * ((i + 1) / 5));
      const bob = (sin(bubble + i * 1.7) + 1) * 0.5;
      fill(VOID_ACID[0] + 40, VOID_ACID[1], VOID_ACID[2], 140 * fade * bob);
      circle(cos(a) * d, sin(a) * d, 6 + 5 * bob);
    }

    noFill();
    stroke(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 130 * fade);
    strokeWeight(2);
    circle(0, 0, this.radius * 1.85);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(this.radius * 2);
  }
}
