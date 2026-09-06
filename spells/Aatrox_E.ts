import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct } from '../text';

const Dash = api.buffs.Dash;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;


/**
 * The passive half: `docs/abilities/aatrox/e.json` heals him for a share of
 * the damage he deals.
 *
 * Granted as `omnivamp` rather than computed in this file, which is the whole
 * point of writing it at all: core pays vamp out of `takeDamage` itself
 * (`combat/Vamp.ts`), so every point of it is a heal — visible to Vết Thương
 * Sâu, to `healingReceived`, to the death recap. A file that added health back
 * by hand would look identical on the health bar and be silently immune to the
 * entire counter-play shelf.
 */
export const E_OMNIVAMP = 0.16;

export const E_DASH_DISTANCE = 170;

export const E_DASH_SPEED = 17;

export const E_DASH_MS = 400;

export const E_MANA = 20;


const IRON: [number, number, number] = [46, 32, 34];

const BLOOD: [number, number, number] = [186, 26, 44];

const EMBER: [number, number, number] = [255, 138, 120];


/** Always on, and off the buff bar: the ability icon already says it is there. */
export class Aatrox_E_Passive extends StatAmp {
  name = 'Máu Của Kẻ Bị Nguyền';
  stackId = 'aatrox_e_passive';
  hudVisible = false;
  bonuses = { omnivamp: { baseBonus: E_OMNIVAMP } };
}


export default class Aatrox_E extends Spell {
  static aiRoles = api.enums.SpellRole.Dash;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_aatrox_e');
  name = 'Bộ Pháp Hắc Ám (Aatrox_E)';
  description =
    `<span class="buff">Lướt</span> <span>${E_DASH_DISTANCE}px</span> theo hướng chỉ định. ` +
    `Nội tại: mọi sát thương Aatrox gây ra <span class="buff">hồi lại ${pct(E_OMNIVAMP)}%</span> ` +
    `thành máu cho chính hắn.`;
  /**
   * Short, because it is the escape hatch the rest of the kit is built around:
   * the record lets Umbral Dash be cast *during* his other abilities without
   * cancelling them, and a long cooldown on it would turn every Q into a
   * commitment rather than a swing he can walk out of.
   */
  coolDown = 6_000;
  manaCost = E_MANA;
  range = E_DASH_DISTANCE;

  onUpdate(): void {
    this.maintainPassive();
  }

  /** Armed once per life and left alone — a second copy would double the vamp. */
  private maintainPassive(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Aatrox_E_Passive)) return;
    this.owner.addBuff(new Aatrox_E_Passive(Infinity, this.owner, this.owner));
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const toX = this.owner.position.x + (aim.x / span) * E_DASH_DISTANCE;
    const toY = this.owner.position.y + (aim.y / span) * E_DASH_DISTANCE;

    const dash = new Dash(E_DASH_MS, this.owner, this.owner);
    dash.dashDestination = createVector(toX, toY);
    dash.dashSpeed = E_DASH_SPEED;
    // The smear below is the subject; the generic dash trail would only fight it.
    dash.showTrail = false;
    this.owner.addBuff(dash);

    this.game.objectManager.addObject(
      new Aatrox_E_Smear(this.owner, this.owner.position.x, this.owner.position.y, toX, toY)
    );
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/**
 * What the dash leaves on the ground: a flat wedge narrowing back towards where
 * he pushed off, with a hard crimson rim on the leading edge.
 *
 * Ground art, so `zIndex` is `GROUND_Z_INDEX` — a smear he has already left is
 * behind him and belongs under everyone's feet.
 */
export class Aatrox_E_Smear extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 280;
  age = 0;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;

  constructor(owner: AttackableUnit, fromX: number, fromY: number, toX: number, toY: number) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t;
    const span = Math.hypot(this.toX - this.fromX, this.toY - this.fromY);
    const heading = Math.atan2(this.toY - this.fromY, this.toX - this.fromX);

    push();
    translate(this.fromX, this.fromY);
    rotate(heading);
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 170 * fade);
    // A wedge, widest at the leading edge: the shape of something that arrived
    // rather than something that is standing there.
    quad(0, -5, span, -22, span, 22, 0, 5);
    fill(BLOOD[0], BLOOD[1], BLOOD[2], 150 * fade);
    quad(span * 0.45, -4, span, -13, span, 13, span * 0.45, 4);
    noFill();
    stroke(EMBER[0], EMBER[1], EMBER[2], 230 * fade);
    strokeWeight(3);
    line(span, -22, span, 22);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((E_DASH_DISTANCE + 60) * 2);
  }
}
