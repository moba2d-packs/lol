import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const AttackableUnitClass = api.units.AttackableUnit;
const TargetResolver = api.combat.TargetResolver;
const canSee = api.combat.Vision.canSee;
const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const Dash = api.buffs.Dash;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;


/** What both of them gain — armour and magic resist, the same number. */
export const W_RESIST = 25;

export const W_DURATION_MS = 3_000;

/**
 * The self-cast is worth more, exactly as the record has it: on himself the
 * bonus scales three times as hard, because standing in front of somebody is
 * the ability and he is the one taking the hit.
 */
export const W_SELF_BONUS = 12;

export const W_RANGE = 320;

export const W_DASH_SPEED = 18;

/** How far short of the ally he stops — in front of them, not on top of them. */
export const W_STANDOFF = 45;

export const W_MANA = 40;


const ICE: [number, number, number] = [126, 206, 235];

const DEEP: [number, number, number] = [24, 62, 96];

const STEEL: [number, number, number] = [188, 196, 205];


/** The bulwark: one buff, two resistances, so the row cannot half-expire. */
export class Braum_W_Bulwark extends StatAmp {
  name = 'Nấp Sau Ta';
  stackId = 'braum_w';
  bonuses = {
    armor: { flatBonus: W_RESIST },
    magicResist: { flatBonus: W_RESIST },
  };
}


/** Braum's own share, which the record makes larger than the ally's. */
export class Braum_W_Bulwark_Self extends StatAmp {
  name = 'Nấp Sau Ta';
  stackId = 'braum_w_self';
  bonuses = {
    armor: { flatBonus: W_RESIST + W_SELF_BONUS },
    magicResist: { flatBonus: W_RESIST + W_SELF_BONUS },
  };
}


export const isShieldTarget = (target: unknown): target is AttackableUnit =>
  target instanceof AttackableUnitClass && target.targetable && !target.toRemove && !target.isDead;


/**
 * Stand Behind Me — he puts his body where the ally's was going to be.
 *
 * `targetTeam: 'ALLY'` and nothing else: the four abilities that shipped in this
 * pack aiming at `'ANY'` all resolved *their own caster* when the cursor sat on
 * empty ground. Here that would be almost invisible — the self-cast is a real
 * branch of this ability — which is exactly why it is stated rather than left
 * to the default.
 */
export default class Braum_W extends Spell {
  static aiRoles = api.enums.SpellRole.Shield | api.enums.SpellRole.Buff;

  image = api.asset('spell_braum_w');
  name = 'Nấp Sau Ta (Braum_W)';
  description =
    `Lao tới đứng chắn trước một <span class="buff">đồng minh</span>, cho cả hai ` +
    `<span class="buff">+${W_RESIST} giáp và +${W_RESIST} kháng phép</span> trong ` +
    `<span class="time">${secs(W_DURATION_MS)} giây</span>. ` +
    `Tự dùng lên chính mình thì Braum nhận <span class="buff">+${W_RESIST + W_SELF_BONUS}</span> ` +
    `mỗi loại thay vì <span>${W_RESIST}</span>.`;
  coolDown = 9_000;
  manaCost = W_MANA;
  range = W_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ALLY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isShieldTarget(candidate),
      getTargetInfo: candidate =>
        isShieldTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) return super.press(context);
    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  onUpdate(): void {
    if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
      this.cancel('TARGET_INVALID');
    }
  }

  onSpellCast(context: CastContext): void {
    const ally = context.target;
    if (!isShieldTarget(ally)) return;

    this.owner.addBuff(new Braum_W_Bulwark_Self(W_DURATION_MS, this.owner, this.owner));

    if (ally === this.owner) {
      this.game.objectManager.addObject(new Braum_W_Guard(this.owner, this.owner));
      return;
    }

    ally.addBuff(new Braum_W_Bulwark(W_DURATION_MS, this.owner, ally));

    // He puts himself *in front of* the ally, on the line from the ally to the
    // nearest threat — which is the whole ability. With nothing to face, he
    // simply stands beside them.
    if (Dash.CanDash(this.owner)) {
      const facing = this.threatHeadingFor(ally);
      const dash = new Dash(1_200, this.owner, this.owner);
      dash.dashDestination = createVector(
        ally.position.x + Math.cos(facing) * W_STANDOFF,
        ally.position.y + Math.sin(facing) * W_STANDOFF
      );
      dash.dashSpeed = W_DASH_SPEED;
      dash.showTrail = false;
      this.owner.addBuff(dash);
    }

    this.game.objectManager.addObject(new Braum_W_Guard(this.owner, ally));
  }

  /**
   * Which way the ally most needs a body. The nearest enemy if there is one;
   * otherwise back the way Braum came, so he still ends up between the ally and
   * wherever the fight was.
   */
  threatHeadingFor(ally: AttackableUnit): number {
    let nearest: AttackableUnit | undefined;
    let closest = Infinity;
    for (const candidate of this.game.objectManager.objects as AttackableUnit[]) {
      if (!isShieldTarget(candidate) || candidate.teamId === this.owner.teamId) continue;
      const gap = Math.hypot(
        candidate.position.x - ally.position.x,
        candidate.position.y - ally.position.y
      );
      if (gap >= closest) continue;
      closest = gap;
      nearest = candidate;
    }

    const towardX = (nearest ?? this.owner).position.x - ally.position.x;
    const towardY = (nearest ?? this.owner).position.y - ally.position.y;
    if (towardX === 0 && towardY === 0) return 0;
    return Math.atan2(towardY, towardX);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      isShieldTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId === this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}


/**
 * The plates going up on whoever was covered: a hard hexagonal shell that
 * settles onto the body and holds.
 *
 * Attached to the ally rather than left on the ground — this one really does
 * follow the body, because the buff it draws does too.
 */
export class Braum_W_Guard extends SpellObject {
  lifeTime = W_DURATION_MS;
  age = 0;
  readonly ally: AttackableUnit;

  constructor(owner: AttackableUnit, ally: AttackableUnit) {
    super(owner);
    this.ally = ally;
    this.position = ally.position.copy();
  }

  update(): void {
    this.position.set(this.ally.position.x, this.ally.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime || this.ally.isDead) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const settled = Math.min(1, this.age / 160);
    const fade = 1 - t * t * t;
    const radius = (this.ally.animatedValues?.displaySize ?? 40) * 0.75;
    const grown = radius * (1.6 - 0.6 * settled);

    push();
    translate(this.position.x, this.position.y);
    // A hexagon, because it is a shield and not a bubble.
    noFill();
    stroke(DEEP[0], DEEP[1], DEEP[2], 220 * fade);
    strokeWeight(6);
    beginShape();
    for (let i = 0; i < 6; i++) {
      const spin = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      vertex(Math.cos(spin) * grown, Math.sin(spin) * grown);
    }
    endShape(CLOSE);
    stroke(ICE[0], ICE[1], ICE[2], 235 * fade);
    strokeWeight(3);
    beginShape();
    for (let i = 0; i < 6; i++) {
      const spin = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      vertex(Math.cos(spin) * grown, Math.sin(spin) * grown);
    }
    endShape(CLOSE);

    // Three plates on the leading face, so the shell reads as armour rather
    // than as an outline.
    noStroke();
    fill(STEEL[0], STEEL[1], STEEL[2], 120 * fade);
    for (let i = 0; i < 3; i++) {
      const spin = (Math.PI * 2 * i) / 3 + Math.PI / 6;
      push();
      rotate(spin);
      rectMode(CENTER);
      rect(grown * 0.72, 0, grown * 0.4, grown * 0.24, 2);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(180);
  }
}
