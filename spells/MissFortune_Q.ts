import type { AttackableUnit, Buff, CastContext, OnHitEvent } from '@moba2d/core/content/types';
import { shortenStrut } from './MissFortune_W';
import { api } from '../packApi';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const dmg = api.text.dmg;


/* ---------------------------------------------------------------- Love Tap

   Her passive is one mark that moves: hitting the body that already wears it
   is worth nothing extra, and hitting anyone else is worth a lot. It lives in
   this file because Q is the ability built around switching targets, and
   because `MissFortune_W` only needs the one exported call to take part.
   -------------------------------------------------------------------------- */

export const LOVE_TAP_DAMAGE = 12;

/** How long the mark sits on the last body she tapped. */
export const LOVE_TAP_MS = 4_000;


export const Q_DAMAGE = 20;

export const Q_BOUNCE_DAMAGE = 20;

export const Q_RANGE = 320;

export const Q_SPEED = 20;

/** How far past the first body the shot will look for a second. */
export const Q_BOUNCE_RANGE = 190;

export const Q_MANA = 35;


const CRIMSON: [number, number, number] = [206, 44, 62];

const GOLD: [number, number, number] = [232, 186, 96];

const LEATHER: [number, number, number] = [58, 36, 40];


/** The body she hit last. Hitting it again is an ordinary swing. */
export class MissFortune_LoveTap extends BaseBuff {
  name = 'Đánh Yêu';
  stackId = 'missfortune_lovetap';
  description = 'Đang mang dấu của Miss Fortune — đòn tiếp theo vào mục tiêu KHÁC mới được cộng thêm.';
}


export function loveTapOn(unit: AttackableUnit): MissFortune_LoveTap | undefined {
  for (const buff of unit.buffs as Buff[]) {
    if (buff instanceof MissFortune_LoveTap && !buff.toRemove) return buff;
  }
  return undefined;
}


/**
 * A swing landed. If it was a *new* body, it is worth extra and the mark moves
 * to it. Answers whether the tap paid, so a caller can tell.
 */
export function loveTap(mf: AttackableUnit, victim: AttackableUnit): boolean {
  if (victim.isDead) return false;
  if (loveTapOn(victim)) return false;

  // The mark is single: whoever had it loses it, which is what makes swapping
  // targets the thing she is paid for.
  for (const object of mf.game.objectManager.objects as AttackableUnit[]) {
    const worn = (object as AttackableUnit).buffs ? loveTapOn(object as AttackableUnit) : undefined;
    if (worn && worn.sourceUnit === mf) worn.deactivateBuff();
  }

  victim.takeDamage(LOVE_TAP_DAMAGE, mf, 'PHYSICAL');
  const mark = new MissFortune_LoveTap(LOVE_TAP_MS, mf, victim);
  mark.image = api.asset('spell_missfortune_i');
  victim.addBuff(mark);
  // The record pays Strut for a *new* mark, and only for a new one.
  shortenStrut(mf);
  mf.game.objectManager.addObject(
    new MissFortune_Q_Tap(mf, victim.position.x, victim.position.y)
  );
  return true;
}


/** Always on: every swing of hers asks the question. */
export class MissFortune_Q_Passive extends BaseBuff {
  name = 'Đánh Yêu';
  stackId = 'missfortune_lovetap_passive';
  hudVisible = false;
  description = `Đòn đánh thường vào mục tiêu chưa mang dấu gây thêm ${LOVE_TAP_DAMAGE} sát thương.`;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice; the tap is worth one.
    if (hit.echo) return;
    loveTap(this.targetUnit, hit.victim);
  }
}


/**
 * Double Up.
 *
 * **Aimed rather than target-locked.** The record fires at a unit and bounces
 * "to another enemy *behind them*", and behind is a direction — so the shot is
 * a line, the first body it meets is the primary, and the bounce looks past
 * that body along the same line. That keeps the one decision the ability has
 * (line them up) in the aiming rather than in a click.
 */
export default class MissFortune_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Poke;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_missfortune_q');
  name = 'Bắn Một Được Hai (MissFortune_Q)';
  description =
    `Bắn một phát xa <span>${Q_RANGE}px</span>: kẻ địch đầu tiên nhận ` +
    `${dmg(Q_DAMAGE, 'PHYSICAL')}, rồi viên đạn <span class="buff">nảy tiếp</span> sang một ` +
    `kẻ địch <span class="buff">đứng phía sau</span> trong <span>${Q_BOUNCE_RANGE}px</span>, ` +
    `gây ${dmg(Q_BOUNCE_DAMAGE, 'PHYSICAL')}. ` +
    `Nội tại <span class="buff">Đánh Yêu</span>: đòn đánh thường vào một mục tiêu ` +
    `<span class="buff">chưa mang dấu</span> gây thêm ${dmg(LOVE_TAP_DAMAGE, 'PHYSICAL')}.`;
  coolDown = 5_000;
  manaCost = Q_MANA;
  range = Q_RANGE;

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(MissFortune_Q_Passive)) return;
    this.owner.addBuff(new MissFortune_Q_Passive(Infinity, this.owner, this.owner));
  }

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(Q_RANGE, this.owner);

    const shot = new MissFortune_Q_Shot(this.owner);
    shot.heading = Math.atan2(aim.y, aim.x);
    shot.destination = createVector(
      this.owner.position.x + (aim.x / span) * reach,
      this.owner.position.y + (aim.y / span) * reach
    );
    this.game.objectManager.addObject(shot);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The shot. One body, then it looks past that body for a second one and pays
 * the bounce there — the bounce is resolved rather than flown, because the two
 * halves of this ability arrive together in the source game too.
 */
export class MissFortune_Q_Shot extends MissileSpellObject {
  speed = Q_SPEED;
  size = 22;
  maxHitCount = 1;
  /** The way it was fired, which is what "behind" means. */
  heading = 0;
  /** Where the bounce went, if anywhere — read by the picture and by a test. */
  bouncedTo: AttackableUnit | null = null;

  onHit(victim: AttackableUnit): void {
    victim.takeDamage(Q_DAMAGE, this.owner, 'PHYSICAL');

    const behind = this.nextBehind(victim);
    if (behind) {
      this.bouncedTo = behind;
      behind.takeDamage(Q_BOUNCE_DAMAGE, this.owner, 'PHYSICAL');
    }

    this.game.objectManager.addObject(
      new MissFortune_Q_Bounce(
        this.owner,
        victim.position.x,
        victim.position.y,
        behind?.position.x ?? null,
        behind?.position.y ?? null
      )
    );
  }

  /** The nearest body further down the line than `primary`, inside the bounce range. */
  nextBehind(primary: AttackableUnit): AttackableUnit | undefined {
    const forwardX = Math.cos(this.heading);
    const forwardY = Math.sin(this.heading);
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: primary.position.x, y: primary.position.y, r: Q_BOUNCE_RANGE }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    let best: AttackableUnit | undefined;
    let closest = Infinity;
    for (const candidate of candidates) {
      if (candidate === primary) continue;
      const along =
        (candidate.position.x - primary.position.x) * forwardX +
        (candidate.position.y - primary.position.y) * forwardY;
      // Strictly past the primary: a body beside her is not behind anything.
      if (along <= 0 || along >= closest) continue;
      closest = along;
      best = candidate;
    }
    return best;
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noStroke();
    // A slug: a flat capsule with a gold nose, nothing soft about it.
    fill(LEATHER[0], LEATHER[1], LEATHER[2], 240);
    rectMode(CENTER);
    rect(0, 0, 22, 9, 4);
    fill(GOLD[0], GOLD[1], GOLD[2], 245);
    triangle(9, -4, 18, 0, 9, 4);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 20) * 2);
  }
}


/** The pair of impacts, and the line the bounce took between them. */
export class MissFortune_Q_Bounce extends SpellObject {
  lifeTime = 280;
  age = 0;
  readonly atX: number;
  readonly atY: number;
  readonly toX: number | null;
  readonly toY: number | null;

  constructor(
    owner: AttackableUnit,
    atX: number,
    atY: number,
    toX: number | null,
    toY: number | null
  ) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
    this.toX = toX;
    this.toY = toY;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    noFill();
    stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 240 * fade);
    strokeWeight(4);
    circle(this.atX, this.atY, 34 * out);

    if (this.toX !== null && this.toY !== null) {
      // The bounce drawn as it travels, so the second body reads as *the same
      // bullet* rather than a second cast.
      const gx = this.atX + (this.toX - this.atX) * out;
      const gy = this.atY + (this.toY - this.atY) * out;
      stroke(GOLD[0], GOLD[1], GOLD[2], 235 * fade);
      strokeWeight(3);
      line(this.atX, this.atY, gx, gy);
      noStroke();
      fill(GOLD[0], GOLD[1], GOLD[2], 245 * fade);
      circle(gx, gy, 9);
      if (out > 0.95) {
        noFill();
        stroke(CRIMSON[0], CRIMSON[1], CRIMSON[2], 240 * fade);
        strokeWeight(4);
        circle(this.toX, this.toY, 30);
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_BOUNCE_RANGE + 60) * 2);
  }
}


/** One Love Tap landing: a small hard heart-less chevron pair, gold on crimson. */
export class MissFortune_Q_Tap extends SpellObject {
  lifeTime = 200;
  age = 0;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t;
    const lift = 14 * t;

    push();
    translate(this.position.x, this.position.y - lift);
    noStroke();
    fill(CRIMSON[0], CRIMSON[1], CRIMSON[2], 235 * fade);
    triangle(-10, 2, 0, -9, 10, 2);
    fill(GOLD[0], GOLD[1], GOLD[2], 245 * fade);
    triangle(-5, 1, 0, -5, 5, 1);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(90);
  }
}
