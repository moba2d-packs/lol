import type { AttackableUnit, CastContext, Spell as SpellType } from '@moba2d/core/content/types';
import { primeLightslinger } from './Lucian_Q';
import { api } from '../packApi';
import { secs } from '../text';

const Dash = api.buffs.Dash;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;


export const E_DASH = 175;

export const E_DASH_SPEED = 20;

export const E_DASH_MS = 400;

/** What one landed Lightslinger shot takes off the dash… */
export const E_REFUND_MS = 1_000;

/** …and what it is worth against a champion. The record doubles it. */
export const E_REFUND_CHAMPION_MS = 2_000;

export const E_MANA = 20;


const LIGHT: [number, number, number] = [255, 232, 170];

const GOLD: [number, number, number] = [226, 168, 60];

const DARK: [number, number, number] = [40, 34, 44];


/**
 * A Lightslinger shot landed: take a slice off the dash.
 *
 * The rule lives here rather than in `Lucian_Q` because it is *this* ability's
 * passive — the Q file only reports that a shot hit and what it hit. Finding
 * the spell on the owner is how a pack reaches a sibling ability (`Ezreal_Q`
 * does the same for its own refund), and it is deliberately a no-op for a
 * Lucian who has not taken this ability at all.
 */
export function shortenPursuit(lucian: AttackableUnit, onChampion: boolean): void {
  const spells = (lucian as { spells?: SpellType[] }).spells;
  const off = onChampion ? E_REFUND_CHAMPION_MS : E_REFUND_MS;
  for (const spell of spells ?? []) {
    if (!(spell instanceof Lucian_E)) continue;
    spell.currentCooldown = Math.max(0, spell.currentCooldown - off);
  }
}


export default class Lucian_E extends Spell {
  static aiRoles = api.enums.SpellRole.Dash;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_lucian_e');
  name = 'Truy Cùng Diệt Tận (Lucian_E)';
  description =
    `<span class="buff">Lướt</span> <span>${E_DASH}px</span> theo hướng chỉ định. ` +
    `Nội tại: mỗi phát <span class="buff">Xạ Thủ Ánh Sáng</span> trúng đích rút ngắn hồi chiêu ` +
    `<span class="time">${secs(E_REFUND_MS)} giây</span>, gấp đôi thành ` +
    `<span class="time">${secs(E_REFUND_CHAMPION_MS)} giây</span> nếu trúng tướng.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_DASH;

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(context: CastContext): void {
    primeLightslinger(this.owner);

    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const toX = this.owner.position.x + (aim.x / span) * E_DASH;
    const toY = this.owner.position.y + (aim.y / span) * E_DASH;

    const dash = new Dash(E_DASH_MS, this.owner, this.owner);
    dash.dashDestination = createVector(toX, toY);
    dash.dashSpeed = E_DASH_SPEED;
    // The step below is the picture; the generic dash trail would fight it.
    dash.showTrail = false;
    this.owner.addBuff(dash);

    this.game.objectManager.addObject(
      new Lucian_E_Step(this.owner, this.owner.position.x, this.owner.position.y, toX, toY)
    );
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/**
 * What the step leaves on the ground: a row of hard footfalls along the line he
 * covered, fading from the back.
 *
 * Ground art — it is behind him by the time it is drawn, and belongs under the
 * feet of anyone standing on it.
 */
export class Lucian_E_Step extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 300;
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
    const steps = Math.max(2, Math.round(span / 34));

    push();
    translate(this.fromX, this.fromY);
    rotate(heading);
    noStroke();
    for (let i = 0; i <= steps; i++) {
      // The back of the trail goes first, so the shape reads as movement rather
      // than as a stripe that fades evenly.
      const share = i / steps;
      const left = Math.max(0, Math.min(1, (fade * 1.6) - (1 - share) * 0.6));
      if (left <= 0) continue;
      const at = span * share;
      const side = i % 2 === 0 ? -8 : 8;
      fill(DARK[0], DARK[1], DARK[2], 190 * left);
      rectMode(CENTER);
      rect(at, side, 16, 7, 2);
      fill(GOLD[0], GOLD[1], GOLD[2], 220 * left);
      rect(at, side, 9, 3, 1);
    }
    // The leading edge, where he arrived.
    noFill();
    stroke(LIGHT[0], LIGHT[1], LIGHT[2], 230 * fade);
    strokeWeight(3);
    line(span, -14, span, 14);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((E_DASH + 60) * 2);
  }
}
