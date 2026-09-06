import type {
  AttackableUnit,
  CancelReason,
  CastContext,
  CastSpec,
  Slow as SlowBuff,
} from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const CastBar = api.vfx.CastBar;
const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
const ChargeRangeTelegraph = api.vfx.ChargeRangeTelegraph;
const VfxGroup = api.vfx.VfxGroup;
const dmg = api.text.dmg;


export const Q_MIN_RANGE = 240;

export const Q_MAX_RANGE = 470;

/** How long the charge takes to reach full reach. */
export const Q_CHARGE_MS = 1_200;

/** …and how long the button may be held before the runtime gives up on it. */
export const Q_MAX_CHARGE_MS = 2_500;

export const Q_DAMAGE = 26;

export const Q_HALF_WIDTH = 34;

export const Q_SELF_SLOW = 0.3;

/**
 * What a charge that never fires costs.
 *
 * The record refunds half the *mana*; this refunds half the *cooldown*
 * instead. `Spell.changeResource(this.owner.stats.mana, …)` is the only way to
 * hand mana back and it names `stats.mana`, which the `mana-spend` seam bans
 * from `spells/` — the one file in this pack that does it is grandfathered
 * debt, not a pattern to copy. Half a cooldown is the same promise ("a charge
 * you abandoned is not a whole cast") in the currency this pack can state.
 */
export const Q_CANCEL_REFUND = 0.5;

export const Q_MANA = 50;


const STONE: [number, number, number] = [46, 42, 62];

const ARCANE: [number, number, number] = [96, 170, 246];

const VIOLET: [number, number, number] = [168, 120, 246];


/** Shortest distance from a point to the segment `a -> b`, ends included. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}


/** `Q_MIN_RANGE` at no charge, `Q_MAX_RANGE` at `Q_CHARGE_MS` and past it. */
export function pulseRange(chargeMs: number): number {
  const held = Math.max(0, Math.min(1, chargeMs / Q_CHARGE_MS));
  return Q_MIN_RANGE + (Q_MAX_RANGE - Q_MIN_RANGE) * held;
}


/**
 * The charge's own picture: a bar over his head and a ring that grows with the
 * reach he has bought. Every closure here reads the spell live, on the frame it
 * draws — which is exactly why it lives out here rather than inside `castSpec`.
 */
function chargeTelegraph(spell: Xerath_Q): (context: CastContext) => InstanceType<typeof VfxGroup> {
  return context =>
    new VfxGroup([
      new CastBar(
        context,
        () => Math.min(1, spell.chargeMs / Q_CHARGE_MS),
        undefined,
        () => unitCastBarAnchor(spell.owner)
      ),
      new ChargeRangeTelegraph(
        () => spell.owner.position,
        () => spell.aimDirection,
        () => spell.currentRange,
        () => Math.min(1, spell.chargeMs / Q_CHARGE_MS)
      ),
    ]);
}


export default class Xerath_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Poke;

  /** Held to full reach and no longer: the last second of the window buys nothing. */
  static aiChargeReleaseAtMs = Q_CHARGE_MS;

  image = api.asset('spell_xerath_q');
  name = 'Xung Kích Năng Lượng (Xerath_Q)';
  description =
    `<b>Giữ</b> để nạp năng lượng — <span class="buff">tự làm chậm ${pct(Q_SELF_SLOW)}%</span> ` +
    `trong lúc nạp — rồi thả ra một luồng sáng <span class="buff">xuyên qua mọi kẻ địch</span>, ` +
    `gây ${dmg(Q_DAMAGE, 'MAGIC')}. Nạp đủ <span class="time">${secs(Q_CHARGE_MS)} giây</span> ` +
    `kéo tầm từ <span>${Q_MIN_RANGE}px</span> lên <span>${Q_MAX_RANGE}px</span>. ` +
    `Nạp mà không bắn thì <span class="buff">hoàn lại ${pct(Q_CANCEL_REFUND)}% hồi chiêu</span>.`;
  coolDown = 7_000;
  manaCost = Q_MANA;
  range = Q_MAX_RANGE;

  /** How long the button has been down. Read by the telegraph and by the release. */
  chargeMs = 0;
  private aimContext?: CastContext;
  private chargeSlow?: SlowBuff;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'HOLD_RELEASE',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: Q_MAX_CHARGE_MS, releaseAtMax: false },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      // He walks (slowly) while he charges; crowd control is what takes the
      // shot away.
      interrupts: SpellForm.AIMED,
      // Built by a function outside this getter, and that is not style.
      // `castSpec` is resolved once and frozen (`src/seams/castSpecFrozen.ts`),
      // and the `castspec-frozen` seam reads every `this.<field>` inside the
      // getter's body — arrow functions included, because it cannot tell a
      // closure that runs later from a value read now. Handing the whole
      // telegraph off keeps the getter provably constant and the seam quiet
      // without a grandfathered exemption.
      vfx: { castLoop: chargeTelegraph(this) },
    };
  }

  get currentRange(): number {
    return pulseRange(this.chargeMs);
  }

  hold(context: CastContext): boolean {
    this.aimContext = context;
    return super.hold(context);
  }

  release(context: CastContext): boolean {
    this.aimContext = context;
    return super.release(context);
  }

  onCastStart(context: CastContext): void {
    this.chargeMs = 0;
    this.aimContext = context;
    const slow = new Slow(Q_MAX_CHARGE_MS, this.owner, this.owner);
    slow.stackId = 'xerath_q_charge_slow';
    slow.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    slow.percent = Q_SELF_SLOW;
    slow.image = this.image;
    this.owner.addBuff(slow);
    this.chargeSlow = slow;
  }

  onChargeUpdate(_context: CastContext, elapsedMs: number): void {
    this.chargeMs = elapsedMs;
  }

  onRelease(context: CastContext): void {
    this.dropChargeSlow();

    const aim = this.firingDirection(this.aimContext ?? context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(this.currentRange, this.owner);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + (aim.x / span) * reach;
    const toY = fromY + (aim.y / span) * reach;
    const struck: { x: number; y: number }[] = [];

    // No vision filter: a beam through a bush still burns whoever is in it.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (fromX + toX) / 2,
        y: (fromY + toY) / 2,
        r: reach / 2 + Q_HALF_WIDTH + 20,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const hit = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > Q_HALF_WIDTH + body) {
        continue;
      }
      hit.add(victim);
      victim.takeDamage(Q_DAMAGE, this.owner, 'MAGIC');
      struck.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new Xerath_Q_Beam(this.owner, fromX, fromY, Math.atan2(aim.y, aim.x), reach, struck)
    );
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.dropChargeSlow();
    // Half back, however the charge died — cancelled by hand, run out of
    // window, or taken off him by crowd control. See `Q_CANCEL_REFUND`.
    this.currentCooldown = Math.max(0, this.currentCooldown * (1 - Q_CANCEL_REFUND));
  }

  /** Idempotent: a release and a cancel can arrive on the same frame. */
  private dropChargeSlow(): void {
    if (!this.chargeSlow) return;
    if (!this.chargeSlow.toRemove) this.chargeSlow.deactivateBuff();
    this.chargeSlow = undefined;
  }

  get aimDirection(): { x: number; y: number } {
    const aim = this.aimContext;
    if (!aim) return { x: 1, y: 0 };
    const direction = this.firingDirection(aim);
    const span = Math.hypot(direction.x, direction.y) || 1;
    return { x: direction.x / span, y: direction.y / span };
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The pulse: a flat bar of arcane light on exactly the corridor the hit test
 * walked, with hard runic ticks along it rather than a bloom.
 */
export class Xerath_Q_Beam extends SpellObject {
  lifeTime = 320;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly struck: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    struck: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.heading = heading;
    this.reach = reach;
    this.struck = struck;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const drawn = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const run = this.reach * drawn;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(STONE[0], STONE[1], STONE[2], 150 * fade);
    rect(0, -Q_HALF_WIDTH, run, Q_HALF_WIDTH * 2);
    fill(VIOLET[0], VIOLET[1], VIOLET[2], 180 * fade);
    rect(0, -Q_HALF_WIDTH * 0.55, run, Q_HALF_WIDTH * 1.1);
    fill(ARCANE[0], ARCANE[1], ARCANE[2], 245 * fade);
    rect(0, -5, run, 10);

    // Runic ticks along the beam on a fixed lattice, so the length is countable
    // and nothing flickers between frames.
    const ticks = Math.max(1, Math.floor(run / 48));
    noFill();
    stroke(ARCANE[0], ARCANE[1], ARCANE[2], 230 * fade);
    strokeWeight(3);
    for (let i = 1; i <= ticks; i++) {
      const at = (run * i) / ticks;
      line(at, -Q_HALF_WIDTH, at, Q_HALF_WIDTH);
    }
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(VIOLET[0], VIOLET[1], VIOLET[2], 240 * fade);
      strokeWeight(3);
      rectMode(CENTER);
      // A square, so a pierced body cannot be mistaken for one of the many
      // rings this game already draws.
      rect(mark.x, mark.y, 26, 26);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + Q_HALF_WIDTH + 40) * 2);
  }
}
