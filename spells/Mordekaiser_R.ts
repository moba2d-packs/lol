import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { feedDarkness } from './Mordekaiser_Q';
import { api } from '../packApi';
import { pct, secs } from '../text';

const AttackableUnitClass = api.units.AttackableUnit;
const TargetResolver = api.combat.TargetResolver;
const canSee = api.combat.Vision.canSee;
const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const Dash = api.buffs.Dash;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;


export const R_DURATION_MS = 6_000;

export const R_RANGE = 320;

/** What he heals for, as a share of the target's own maximum health. */
export const R_HEAL_SHARE = 0.1;

/** What he takes off them — and puts on himself — of each stolen stat. */
export const R_STEAL_SHARE = 0.1;

/** How close he drags them: the duel is the ability. */
export const R_DRAG_TO = 70;

export const R_DRAG_SPEED = 16;

export const R_MANA = 100;


const IRON: [number, number, number] = [72, 78, 88];

const VOID: [number, number, number] = [122, 60, 168];

const EMBER: [number, number, number] = [226, 92, 60];


export const isDuelTarget = (target: unknown): target is AttackableUnit =>
  target instanceof AttackableUnitClass && target.targetable && !target.toRemove && !target.isDead;


/** What comes off the victim, as a share of what they had when it landed. */
export class Mordekaiser_R_Drained extends StatAmp {
  name = 'Bị Nuốt Linh Hồn';
  stackId = 'mordekaiser_r_drained';
  bonuses = {
    armor: { percentBonus: -R_STEAL_SHARE },
    magicResist: { percentBonus: -R_STEAL_SHARE },
    attackDamage: { percentBonus: -R_STEAL_SHARE },
  };
}


/** …and what goes on him. Points, snapshotted at the moment of the theft. */
export class Mordekaiser_R_Stolen extends StatAmp {
  name = 'Nuốt Linh Hồn';
  stackId = 'mordekaiser_r_stolen';
  bonuses: InstanceType<typeof StatAmp>['bonuses'] = {};
}


/**
 * Realm of Death — the duel, without the room.
 *
 * **The separate realm is not modelled, and this file is where that is
 * admitted.** Banishing two champions somewhere nobody else can reach means a
 * per-pair view of the world: fog, targeting and rendering all answering
 * "which realm are you in", and this engine has one map with one set of
 * neighbours. `Untargetable` is the nearest thing to hand and is the wrong
 * shape — it makes a unit untargetable by *everyone*, the duellist included,
 * which would end the duel rather than seal it.
 *
 * So what is kept is everything the realm was *for*: the target is dragged into
 * range of him, their soul is drained — resistances and attack damage off them
 * and onto him — and he heals for a share of the body he took it from. The
 * seven seconds alone with him is the part the engine cannot say.
 */
export default class Mordekaiser_R extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Buff | api.enums.SpellRole.Ultimate;

  image = api.asset('spell_mordekaiser_r');
  name = 'Vương Quốc Tử Vong (Mordekaiser_R)';
  description =
    `Chọn một tướng địch trong <span>${R_RANGE}px</span> và <span class="buff">lôi nó về</span> ` +
    `sát mình. Trong <span class="time">${secs(R_DURATION_MS)} giây</span>, ` +
    `<span class="buff">${pct(R_STEAL_SHARE)}% giáp, kháng phép và sát thương đánh thường</span> ` +
    `của nó chuyển sang Mordekaiser, và hắn ` +
    `<span class="buff">hồi ${pct(R_HEAL_SHARE)}% máu tối đa của nó</span> ngay lập tức.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_RANGE;

  /** Who is being drained right now, or nothing. */
  duelling: AttackableUnit | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  /**
   * `targetTeam: 'ENEMY'`, stated rather than defaulted: omitted it is `'ANY'`,
   * and with the cursor on empty ground the nearest-target fallback resolves
   * *Mordekaiser* — which would drain his own soul and heal him for a tenth of
   * his own health. Four abilities shipped that shape in this pack before
   * anyone noticed.
   */
  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isDuelTarget(candidate),
      getTargetInfo: candidate =>
        isDuelTarget(candidate)
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
    const victim = context.target;
    if (!isDuelTarget(victim)) return;

    this.duelling = victim;

    // Read before anything is applied: what he takes is a share of what they
    // had, and taking it changes what they have.
    const armour = victim.stats.armor.value;
    const magicResist = victim.stats.magicResist.value;
    const attackDamage = victim.stats.attackDamage.value;

    victim.addBuff(new Mordekaiser_R_Drained(R_DURATION_MS, this.owner, victim));

    const stolen = new Mordekaiser_R_Stolen(R_DURATION_MS, this.owner, this.owner);
    stolen.image = this.image;
    stolen.bonuses = {
      armor: { flatBonus: armour * R_STEAL_SHARE },
      magicResist: { flatBonus: magicResist * R_STEAL_SHARE },
      attackDamage: { flatBonus: attackDamage * R_STEAL_SHARE },
    };
    this.owner.addBuff(stolen);

    // Through `takeHeal`, so Vết Thương Sâu and every other wound reach it.
    this.owner.takeHeal(
      Math.round(victim.stats.maxHealth.value * R_HEAL_SHARE),
      this.owner
    );

    feedDarkness(this.owner, victim);
    this.drag(victim);
    this.game.objectManager.addObject(new Mordekaiser_R_Circle(this.owner, victim));
  }

  /** Hauled to him, as a `Dash` on them, so every answer to a displacement works. */
  private drag(victim: AttackableUnit): void {
    const away = Math.hypot(
      victim.position.x - this.owner.position.x,
      victim.position.y - this.owner.position.y
    );
    if (away <= R_DRAG_TO) return;

    const drag = new Dash(1_500, this.owner, victim);
    drag.dashDestination = createVector(
      this.owner.position.x + ((victim.position.x - this.owner.position.x) / away) * R_DRAG_TO,
      this.owner.position.y + ((victim.position.y - this.owner.position.y) / away) * R_DRAG_TO
    );
    drag.dashSpeed = R_DRAG_SPEED;
    drag.showTrail = false;
    victim.addBuff(drag);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      isDuelTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}


/**
 * The ring the duel is fought in: a hard circle round the pair, and a chain of
 * plates running from him to them so it is obvious who is being drained.
 *
 * Ground art — two champions have to stay readable inside it, which is the
 * whole point of drawing a duel at all.
 */
export class Mordekaiser_R_Circle extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  readonly victim: AttackableUnit;

  constructor(owner: AttackableUnit, victim: AttackableUnit) {
    super(owner);
    this.victim = victim;
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= R_DURATION_MS || this.owner.isDead || this.victim.isDead) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / R_DURATION_MS);
    const midX = (this.position.x + this.victim.position.x) / 2;
    const midY = (this.position.y + this.victim.position.y) / 2;
    const span = Math.hypot(
      this.victim.position.x - this.position.x,
      this.victim.position.y - this.position.y
    );
    const radius = Math.max(120, span / 2 + 60);

    push();
    translate(midX, midY);
    noStroke();
    fill(VOID[0], VOID[1], VOID[2], 40);
    circle(0, 0, radius * 2);
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 230);
    strokeWeight(7);
    circle(0, 0, radius * 2);
    stroke(VOID[0], VOID[1], VOID[2], 240);
    strokeWeight(3);
    arc(0, 0, radius * 2, radius * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    pop();

    // The chain: plates laid along the line between them, so which way the soul
    // is running is visible from outside the circle.
    push();
    const heading = Math.atan2(
      this.victim.position.y - this.position.y,
      this.victim.position.x - this.position.x
    );
    translate(this.position.x, this.position.y);
    rotate(heading);
    rectMode(CENTER);
    noStroke();
    const links = Math.max(1, Math.round(span / 26));
    for (let i = 1; i <= links; i++) {
      const at = (span * i) / links;
      fill(IRON[0], IRON[1], IRON[2], 235);
      rect(at, 0, 14, 8, 2);
      fill(EMBER[0], EMBER[1], EMBER[2], 220);
      rect(at, 0, 7, 4, 1);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_RANGE + 120) * 2);
  }
}
