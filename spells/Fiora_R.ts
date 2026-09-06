import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  KillCredit,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { identifyVital, vitalOn } from './Fiora_Q';
import { api } from '../packApi';
import { secs } from '../text';

const AttackableUnitClass = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const EventType = api.enums.EventType;
const PredefinedFilters = api.combat.PredefinedFilters;
const TargetResolver = api.combat.TargetResolver;
const canSee = api.combat.Vision.canSee;
const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const heal = api.text.heal;


export const R_DURATION_MS = 6_000;

export const R_RANGE = 340;

/** The Victory Zone: where the challenged body fell, and how long it stays. */
export const R_ZONE_MS = 4_000;

export const R_ZONE_RADIUS = 200;

export const R_HEAL_PER_TICK = 6;

export const R_TICK_MS = 250;

export const R_MANA = 100;


const STEEL: [number, number, number] = [214, 220, 230];

const ROSE: [number, number, number] = [216, 88, 122];

const DUSK: [number, number, number] = [38, 30, 46];


/**
 * `EventType.ON_DIE`'s payload, narrowed to the two fields this reads.
 *
 * Core does not publish `UnitDeathEvent` through `@moba2d/core/content/types`,
 * and a pack may not reach past that door for it.
 */
interface DeathNotice {
  unit: AttackableUnit;
  credit: KillCredit;
}


export const isChallengeTarget = (target: unknown): target is AttackableUnit =>
  target instanceof AttackableUnitClass && target.targetable && !target.toRemove && !target.isDead;


/**
 * Grand Challenge — she names one body and every side of it is open.
 *
 * `Fiora_Q` owns the Vital machinery; this reaches in for two exported
 * functions, the same way `Riven_Q` reaches into `Riven_R` for its empowerment
 * flag. The ultimate is not a second Vital system, it is the ordinary one with
 * `allSides` turned on and no expiry to walk out of.
 */
export default class Fiora_R extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Heal;

  image = api.asset('spell_fiora_r');
  name = 'Đại Thử Thách (Fiora_R)';
  description =
    `Thách đấu một tướng địch trong <span class="time">${secs(R_DURATION_MS)} giây</span>: ` +
    `<span class="buff">cả bốn Điểm Yếu</span> của nó mở ra cùng lúc, nên đánh từ hướng nào ` +
    `cũng kích hoạt. Nếu nó chết khi còn đang bị thách đấu, chỗ nó ngã xuống mọc lên một ` +
    `<span class="buff">Vùng Khải Hoàn</span> rộng <span>${R_ZONE_RADIUS}px</span> hồi ` +
    `${heal(R_HEAL_PER_TICK, ' máu')} mỗi <span class="time">${secs(R_TICK_MS)} giây</span> ` +
    `cho Fiora và đồng minh trong <span class="time">${secs(R_ZONE_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_RANGE;

  /** Who is challenged, until the duration runs out or they die. */
  challenged: AttackableUnit | null = null;
  private challengeMs = 0;
  private stopWatching?: () => void;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  /**
   * `targetTeam: 'ENEMY'`, stated rather than defaulted. Omitted it defaults to
   * `'ANY'`, and with the cursor on empty ground the nearest-target fallback
   * resolves *Fiora* — four abilities shipped in this pack that way, each of
   * them casting its own ultimate on its own caster.
   */
  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isChallengeTarget(candidate),
      getTargetInfo: candidate =>
        isChallengeTarget(candidate)
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

  onSpellCast(context: CastContext): void {
    const target = context.target;
    if (!isChallengeTarget(target)) return;

    this.challenged = target;
    this.challengeMs = 0;

    // The ordinary Vital, with every side open and nothing to walk out of.
    const opened = vitalOn(target) ?? identifyVital(this.owner, target, 0);
    opened.allSides = true;
    opened.duration = R_DURATION_MS;
    opened.renewBuff();

    this.game.objectManager.addObject(new Fiora_R_Challenge(this.owner, target));
    this.watchForTheKill();
  }

  onUpdate(): void {
    if (!this.challenged) return;
    this.challengeMs += deltaTime;
    if (this.challengeMs >= R_DURATION_MS) this.endChallenge();
  }

  /**
   * The zone is paid on the challenged body's **death**, whoever killed it —
   * the record asks that Fiora has triggered a Vital, and by this point every
   * side has been open for the whole duel.
   */
  private watchForTheKill(): void {
    this.stopWatching?.();
    this.stopWatching = this.game.eventManager.on(EventType.ON_DIE, (event: DeathNotice) => {
      if (!this.challenged || event.unit !== this.challenged) return;
      const fell = this.challenged;
      this.endChallenge();
      this.game.objectManager.addObject(
        new Fiora_R_Victory(this.owner, fell.position.x, fell.position.y)
      );
    });
  }

  /** Idempotent: the duel can end by timing out, by a death, or by a teardown. */
  private endChallenge(): void {
    this.challenged = null;
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  onRemoved(): void {
    this.endChallenge();
    super.onRemoved();
  }

  deactivate(): void {
    this.endChallenge();
    super.deactivate();
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      isChallengeTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}


/** The mark of the duel: four open quarters drawn round the challenged body. */
export class Fiora_R_Challenge extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  readonly target: AttackableUnit;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.position = target.position.copy();
  }

  update(): void {
    this.position.set(this.target.position.x, this.target.position.y);
    this.age += deltaTime;
    if (this.age >= R_DURATION_MS || this.target.isDead) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / R_DURATION_MS);
    const radius = 32;

    push();
    translate(this.position.x, this.position.y);
    // Four quarters with hard gaps between them — the whole body is open, and
    // the gaps are what say so rather than one unbroken ring.
    noFill();
    for (let i = 0; i < 4; i++) {
      const from = (Math.PI / 2) * i + 0.12;
      const to = (Math.PI / 2) * (i + 1) - 0.12;
      stroke(DUSK[0], DUSK[1], DUSK[2], 220);
      strokeWeight(8);
      arc(0, 0, radius * 2, radius * 2, from, to);
      stroke(ROSE[0], ROSE[1], ROSE[2], 245);
      strokeWeight(4);
      arc(0, 0, radius * 2, radius * 2, from, to);
    }
    // …and the duel's own clock outside them.
    stroke(STEEL[0], STEEL[1], STEEL[2], 190);
    strokeWeight(3);
    arc(0, 0, radius * 2.7, radius * 2.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(160);
  }
}


/**
 * The Victory Zone: where the duel ended, healing whoever stands in it.
 *
 * Ground art, so allies running into it are drawn over it. It heals on a tick
 * rather than once, which is what makes standing in it a decision.
 */
export class Fiora_R_Victory extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  private tickMs = 0;
  readonly atX: number;
  readonly atY: number;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= R_ZONE_MS) {
      this.toRemove = true;
      return;
    }
    this.tickMs += deltaTime;
    while (this.tickMs >= R_TICK_MS) {
      this.tickMs -= R_TICK_MS;
      this.mend();
    }
  }

  /** Everyone on her side standing on it, Fiora included. */
  private mend(): void {
    const standing = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: R_ZONE_RADIUS }),
      filters: [
        PredefinedFilters.type(AttackableUnitClass),
        PredefinedFilters.teamId(this.owner.teamId),
        PredefinedFilters.excludeDead,
      ],
    }) as AttackableUnit[];

    for (const ally of standing) {
      ally.takeHeal(R_HEAL_PER_TICK, this.owner);
    }
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / R_ZONE_MS);
    const pulse = (this.age % R_TICK_MS) / R_TICK_MS;

    push();
    translate(this.atX, this.atY);
    noStroke();
    fill(ROSE[0], ROSE[1], ROSE[2], 55);
    circle(0, 0, R_ZONE_RADIUS * 2);
    noFill();
    stroke(DUSK[0], DUSK[1], DUSK[2], 220);
    strokeWeight(6);
    circle(0, 0, R_ZONE_RADIUS * 2);
    stroke(ROSE[0], ROSE[1], ROSE[2], 240);
    strokeWeight(3);
    arc(
      0,
      0,
      R_ZONE_RADIUS * 2,
      R_ZONE_RADIUS * 2,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * left
    );
    // One hard ring per tick, walking outward: the heal is a rhythm and the
    // picture says so without a single soft edge.
    stroke(STEEL[0], STEEL[1], STEEL[2], 200);
    strokeWeight(2);
    circle(0, 0, R_ZONE_RADIUS * 2 * pulse);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_ZONE_RADIUS + 40) * 2);
  }
}
