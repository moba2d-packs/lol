import type { AttackableUnit, Buff, CastContext, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Airborne = api.buffs.Airborne;
const BuffAddType = api.enums.BuffAddType;
const Charm = api.buffs.Charm;
const Fear = api.buffs.Fear;
const Root = api.buffs.Root;
const Slow = api.buffs.Slow;
const Stun = api.buffs.Stun;
const Taunt = api.buffs.Taunt;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


/** The record's 0.75s of standing still behind the blade. */
export const W_STANCE_MS = 700;

export const W_DAMAGE = 22;

export const W_RANGE = 300;

export const W_HALF_WIDTH = 35;

export const W_SLOW_PERCENT = 0.25;

export const W_SLOW_MS = 2_000;

/** If the parry turned away crowd control, the shock stuns instead of slowing. */
export const W_STUN_MS = 1_000;

export const W_MANA = 45;


const STEEL: [number, number, number] = [214, 220, 230];

const ROSE: [number, number, number] = [216, 88, 122];

const DUSK: [number, number, number] = [38, 30, 46];


/** Everything the stance turns away. Movement effects included — it is a parry. */
const IMMOBILISING = [Stun, Root, Airborne, Charm, Fear, Taunt, Slow];


/**
 * The stance: nothing gets through, and nothing sticks.
 *
 * Two seams do the work and both are core's own. `modifyIncomingDamage` answers
 * "what is this hit worth" with zero; `blocksIncoming` answers "does this buff
 * land at all" with no — the same hook `Dash.unstoppable` uses, which is what
 * makes debuff immunity expressible without a status flag of its own.
 */
export class Fiora_W_Parry extends BaseBuff {
  name = 'Phản Đòn';
  stackId = 'fiora_w_parry';
  description = 'Chặn toàn bộ sát thương và mọi hiệu ứng khống chế trong khoảnh khắc.';
  /** How many hostile control effects it turned away. One is enough for the stun. */
  negated = 0;

  modifyIncomingDamage(_damage: number, _attacker?: AttackableUnit, _type?: DamageType): number {
    return 0;
  }

  blocksIncoming(incoming: Buff): boolean {
    if (incoming === this) return false;
    // Her own buffs are not something to parry — the shock she is about to
    // throw arrives as one, and so does anything an ally hands her.
    if (incoming.sourceUnit === this.targetUnit) return false;
    if (!IMMOBILISING.some(Kind => incoming instanceof (Kind as never))) return false;
    this.negated += 1;
    return true;
  }
}


/**
 * Riposte — she stands still, takes nothing, and answers.
 *
 * The shock is fired from `onUpdate` rather than at the press, because the
 * stance is the ability: what she blocks during those seven hundred
 * milliseconds is what decides whether the answer slows or stuns.
 */
export default class Fiora_W extends Spell {
  static aiRoles =
    api.enums.SpellRole.Shield | api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_fiora_w');
  name = 'Phản Đòn (Fiora_W)';
  description =
    `Vào thế thủ <span class="time">${secs(W_STANCE_MS)} giây</span>: ` +
    `<span class="buff">miễn toàn bộ sát thương</span> và mọi hiệu ứng khống chế. ` +
    `Hết thế thủ, cô phóng một luồng kiếm khí xa <span>${W_RANGE}px</span> gây ` +
    `${dmg(W_DAMAGE, 'MAGIC')} và <span class="buff">Làm Chậm ${pct(W_SLOW_PERCENT)}%</span> ` +
    `trong <span class="time">${secs(W_SLOW_MS)} giây</span> — hoặc ` +
    `<span class="buff">Choáng ${secs(W_STUN_MS)} giây</span> nếu thế thủ đã đỡ được ` +
    `ít nhất một hiệu ứng khống chế.`;
  coolDown = 11_000;
  manaCost = W_MANA;
  range = W_RANGE;

  /** The stance standing right now, and the way the answer will go. */
  private parry: Fiora_W_Parry | null = null;
  private heading = 0;
  private stanceMs = 0;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    this.heading = Math.atan2(aim.y, aim.x);
    this.stanceMs = 0;

    const parry = new Fiora_W_Parry(W_STANCE_MS, this.owner, this.owner);
    parry.image = this.image;
    this.owner.addBuff(parry);
    this.parry = parry;

    this.game.objectManager.addObject(new Fiora_W_Stance(this.owner, this.heading, parry));
  }

  onUpdate(): void {
    if (!this.parry) return;
    this.stanceMs += deltaTime;
    if (this.stanceMs < W_STANCE_MS) return;

    const parry = this.parry;
    this.parry = null;
    // A corpse does not riposte. Being killed through the stance is impossible
    // by construction, but the scene can be torn down under it.
    if (this.owner.isDead) return;
    this.shock(parry.negated > 0);
  }

  /** The answer: a line, and everything standing in it. */
  private shock(stunning: boolean): void {
    const reach = effectiveRange(W_RANGE, this.owner);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + Math.cos(this.heading) * reach;
    const toY = fromY + Math.sin(this.heading) * reach;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: (fromX + toX) / 2, y: (fromY + toY) / 2, r: reach / 2 + W_HALF_WIDTH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > W_HALF_WIDTH + body) {
        continue;
      }
      struck.add(victim);
      victim.takeDamage(W_DAMAGE, this.owner, 'MAGIC');

      if (stunning) {
        victim.addBuff(new Stun(W_STUN_MS, this.owner, victim));
        continue;
      }
      // `RENEW_EXISTING`: `Slow` stacks ten deep by default, and this pack has
      // shipped a standstill that way before.
      const slow = new Slow(W_SLOW_MS, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = W_SLOW_PERCENT;
      victim.addBuff(slow);
    }

    this.game.objectManager.addObject(
      new Fiora_W_Shock(this.owner, fromX, fromY, this.heading, reach, stunning)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


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


/** The blade held up: a flat plate on the side she is guarding, and a clock. */
export class Fiora_W_Stance extends SpellObject {
  age = 0;
  readonly heading: number;
  private readonly parry: Fiora_W_Parry;

  constructor(owner: AttackableUnit, heading: number, parry: Fiora_W_Parry) {
    super(owner);
    this.position = owner.position.copy();
    this.heading = heading;
    this.parry = parry;
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= W_STANCE_MS || this.parry.toRemove) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, 1 - this.age / W_STANCE_MS);
    const caught = this.parry.negated > 0;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    // The blade, held across the way she is guarding.
    noStroke();
    fill(DUSK[0], DUSK[1], DUSK[2], 235);
    quad(24, -26, 34, -26, 34, 26, 24, 26);
    fill(caught ? ROSE[0] : STEEL[0], caught ? ROSE[1] : STEEL[1], caught ? ROSE[2] : STEEL[2], 245);
    quad(26, -22, 32, -22, 32, 22, 26, 22);

    // A ring counting the stance down, so the moment the answer comes is
    // something a player can read rather than guess.
    noFill();
    stroke(STEEL[0], STEEL[1], STEEL[2], 220);
    strokeWeight(3);
    arc(0, 0, 74, 74, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(180);
  }
}


/** The answer going out: a hard line, rose if it is carrying a stun. */
export class Fiora_W_Shock extends SpellObject {
  lifeTime = 260;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly stunning: boolean;

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    stunning: boolean
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.heading = heading;
    this.reach = reach;
    this.stunning = stunning;
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
    const [r, g, b] = this.stunning ? ROSE : STEEL;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(DUSK[0], DUSK[1], DUSK[2], 150 * fade);
    rect(0, -W_HALF_WIDTH, run, W_HALF_WIDTH * 2);
    noFill();
    stroke(r, g, b, 235 * fade);
    strokeWeight(3);
    rect(0, -W_HALF_WIDTH, run, W_HALF_WIDTH * 2);
    strokeWeight(5);
    line(0, 0, run, 0);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + W_HALF_WIDTH + 40) * 2);
  }
}
