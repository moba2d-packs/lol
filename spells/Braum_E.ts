import type { AttackableUnit, CastContext, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const BaseBuff = api.buffs.Buff;
const Speedup = api.buffs.Speedup;
const Spell = api.Spell;
const SpellObject = api.SpellObject;


export const E_DURATION_MS = 3_000;

/** What a hit arriving through the shield is worth after it. */
export const E_REDUCTION = 0.5;

/**
 * The arc he actually covers, in degrees. Wide enough to be a wall and narrow
 * enough to be a *direction* — the ability is a choice about where to stand,
 * and a shield that covered everything would not be one.
 */
export const E_ARC_DEG = 130;

/** How far out the barrier catches projectiles. */
export const E_REACH = 130;

export const E_SPEED_PERCENT = 0.1;

export const E_MANA = 40;


const ICE: [number, number, number] = [126, 206, 235];

const DEEP: [number, number, number] = [24, 62, 96];

const STEEL: [number, number, number] = [188, 196, 205];


/** Whether `heading` (radians) falls inside a `spread`-wide arc centred on `facing`. */
export function coveredBy(facing: number, heading: number, spreadDeg = E_ARC_DEG): boolean {
  let offAxis = heading - facing;
  while (offAxis > Math.PI) offAxis -= Math.PI * 2;
  while (offAxis < -Math.PI) offAxis += Math.PI * 2;
  return Math.abs(offAxis) <= (spreadDeg * Math.PI) / 360;
}


/**
 * The raised shield, as a buff, because what it does is change what damage
 * arriving from one side is worth — and `modifyIncomingDamage` is the one seam
 * that sees every hit whatever dealt it.
 *
 * A bare `Buff`: it sets no status flag and grants no stat, so core has nothing
 * to derive a sentence from and this writes its own.
 */
export class Braum_E_Wall extends BaseBuff {
  name = 'Tối Kiên Cường';
  stackId = 'braum_e';
  description = `Chặn đòn đầu tiên từ phía trước và giảm ${pct(E_REDUCTION)}% sát thương còn lại.`;
  /** Which way the shield is pointing, in radians. Set at cast. */
  facing = 0;
  /** The record blocks the *first* champion hit outright; this is that one. */
  firstBlockSpent = false;

  modifyIncomingDamage(damage: number, attacker?: AttackableUnit, _type?: DamageType): number {
    if (!attacker) return damage;
    const heading = Math.atan2(
      attacker.position.y - this.targetUnit.position.y,
      attacker.position.x - this.targetUnit.position.x
    );
    // Behind the shield is behind the shield: a hit from the open side is worth
    // exactly what it was, which is the counter-play the ability is priced on.
    if (!coveredBy(this.facing, heading)) return damage;

    if (!this.firstBlockSpent) {
      this.firstBlockSpent = true;
      return 0;
    }
    return damage * (1 - E_REDUCTION);
  }
}


export default class Braum_E extends Spell {
  static aiRoles = api.enums.SpellRole.Shield | api.enums.SpellRole.Buff;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_braum_e');
  name = 'Tối Kiên Cường (Braum_E)';
  description =
    `Dựng khiên về hướng chỉ định trong <span class="time">${secs(E_DURATION_MS)} giây</span>. ` +
    `Đòn <span class="buff">đầu tiên</span> tới từ phía đó bị chặn hoàn toàn, mọi đòn sau đó ` +
    `bị <span class="buff">giảm ${pct(E_REDUCTION)}% sát thương</span>, và mọi ` +
    `<span class="buff">đạn bay</span> đâm vào khiên đều vỡ. ` +
    `Braum còn nhận <span class="buff">+${pct(E_SPEED_PERCENT)}% tốc chạy</span> khi giương khiên.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_REACH;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const facing = Math.atan2(aim.y, aim.x);

    const wall = new Braum_E_Wall(E_DURATION_MS, this.owner, this.owner);
    wall.facing = facing;
    wall.image = this.image;
    this.owner.addBuff(wall);

    const haste = new Speedup(E_DURATION_MS, this.owner, this.owner);
    haste.stackId = 'braum_e_haste';
    haste.image = this.image;
    haste.percent = E_SPEED_PERCENT;
    this.owner.addBuff(haste);

    this.game.objectManager.addObject(new Braum_E_Barrier(this.owner, facing, wall));
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/**
 * The barrier itself — the picture, and the thing that eats projectiles.
 *
 * The interception lives on the object rather than on the buff because it is
 * about the *world*: a missile is a game object crossing a piece of ground, and
 * nothing about a buff on Braum can see one. It sweeps every frame, so a bolt
 * that would pass through between two frames is caught on whichever side of the
 * shield it is on when the sweep runs.
 */
export class Braum_E_Barrier extends SpellObject {
  age = 0;
  readonly facing: number;
  private readonly wall: Braum_E_Wall;
  /** How many bolts it has broken, so the picture can flash when one lands. */
  broken = 0;
  private brokenAtMs = -1;

  constructor(owner: AttackableUnit, facing: number, wall: Braum_E_Wall) {
    super(owner);
    this.position = owner.position.copy();
    this.facing = facing;
    this.wall = wall;
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    // The buff is the clock: whatever ends the shield ends the barrier, including
    // a cleanse or the owner dying.
    if (this.age >= E_DURATION_MS || this.wall.toRemove || this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    this.intercept();
  }

  /** Break every hostile bolt standing inside the arc this frame. */
  private intercept(): void {
    for (const object of this.game.objectManager.objects as AttackableUnit[]) {
      const missile = object as unknown as {
        isMissile?: boolean;
        toRemove?: boolean;
        owner?: { teamId?: string };
        position?: { x: number; y: number };
      };
      if (!missile.isMissile || missile.toRemove) continue;
      if (!missile.position || missile.owner?.teamId === this.owner.teamId) continue;

      const gap = Math.hypot(
        missile.position.x - this.position.x,
        missile.position.y - this.position.y
      );
      if (gap > E_REACH) continue;
      const heading = Math.atan2(
        missile.position.y - this.position.y,
        missile.position.x - this.position.x
      );
      if (!coveredBy(this.facing, heading)) continue;

      missile.toRemove = true;
      this.broken += 1;
      this.brokenAtMs = this.age;
    }
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / E_DURATION_MS);
    const halfArc = (E_ARC_DEG * Math.PI) / 360;
    // A bolt breaking on it lights the plate for a moment, then it is iron again.
    const struck =
      this.brokenAtMs >= 0 ? Math.max(0, 1 - (this.age - this.brokenAtMs) / 220) : 0;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.facing);

    // The plate: a thick arc on exactly the radius the interception uses.
    noFill();
    stroke(DEEP[0], DEEP[1], DEEP[2], 235);
    strokeWeight(14);
    arc(0, 0, E_REACH * 2, E_REACH * 2, -halfArc, halfArc);
    stroke(STEEL[0], STEEL[1], STEEL[2], 200 + 55 * struck);
    strokeWeight(7);
    arc(0, 0, E_REACH * 2, E_REACH * 2, -halfArc, halfArc);
    stroke(ICE[0], ICE[1], ICE[2], 235);
    strokeWeight(3);
    arc(0, 0, E_REACH * 2, E_REACH * 2, -halfArc * left, halfArc * left);

    // The two edges, so the covered wedge reads as a wedge rather than a band.
    strokeWeight(3);
    stroke(DEEP[0], DEEP[1], DEEP[2], 210);
    for (const edge of [-halfArc, halfArc]) {
      line(0, 0, Math.cos(edge) * E_REACH, Math.sin(edge) * E_REACH);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((E_REACH + 40) * 2);
  }
}
