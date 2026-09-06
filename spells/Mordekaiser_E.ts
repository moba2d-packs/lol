import type { AttackableUnit } from '@moba2d/core/content/types';
import { feedDarkness } from './Mordekaiser_Q';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Dash = api.buffs.Dash;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const E_DAMAGE = 22;

export const E_RADIUS = 150;

/** The record's half-second between the claw appearing and it closing. */
export const E_DELAY_MS = 500;

/** How far in it drags whatever it caught. */
export const E_PULL = 120;

export const E_PULL_SPEED = 15;

export const E_CAST_RANGE = 340;

/** The always-on half: `docs/abilities/mordekaiser/e.json` grants him penetration. */
export const E_PENETRATION = 0.12;

export const E_MANA = 40;


const IRON: [number, number, number] = [72, 78, 88];

const VOID: [number, number, number] = [122, 60, 168];

const EMBER: [number, number, number] = [226, 92, 60];


/** Always on, and off the buff bar: the ability icon already says it is there. */
export class Mordekaiser_E_Passive extends StatAmp {
  name = 'Bàn Tay Chết Chóc';
  stackId = 'mordekaiser_e_passive';
  hudVisible = false;
  bonuses = { magicPenetration: { flatBonus: E_PENETRATION } };
}


export default class Mordekaiser_E extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'POINT' as const;
  image = api.asset('spell_mordekaiser_e');
  name = 'Bàn Tay Chết Chóc (Mordekaiser_E)';
  description =
    `Gọi một bàn tay lên mặt đất trong <span>${E_CAST_RANGE}px</span>. Sau ` +
    `<span class="time">${secs(E_DELAY_MS)} giây</span> nó siết lại, gây ` +
    `${dmg(E_DAMAGE, 'MAGIC')} và <span class="buff">kéo</span> mọi kẻ địch trong bán kính ` +
    `<span>${E_RADIUS}px</span> vào giữa. ` +
    `Nội tại: <span class="buff">xuyên kháng phép ${pct(E_PENETRATION)}%</span>.`;
  coolDown = 9_000;
  manaCost = E_MANA;
  range = E_CAST_RANGE;

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Mordekaiser_E_Passive)) return;
    this.owner.addBuff(new Mordekaiser_E_Passive(Infinity, this.owner, this.owner));
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(E_CAST_RANGE, this.owner)
    );
    this.game.objectManager.addObject(new Mordekaiser_E_Claw(this.owner, to.x, to.y));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The claw: it appears, waits, and then closes.
 *
 * The delay is the ability — it is the whole of the counter-play, and it is why
 * the fingers are drawn open on the real radius from the first frame rather
 * than appearing with the damage.
 */
export class Mordekaiser_E_Claw extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** True once it has closed. A claw pays out exactly once. */
  closed = false;
  private fadeMs = 0;
  readonly atX: number;
  readonly atY: number;
  readonly caught: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
  }

  update(): void {
    if (this.closed) {
      this.fadeMs += deltaTime;
      if (this.fadeMs >= 240) this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    if (this.age < E_DELAY_MS) return;
    this.closed = true;
    // A corpse's claw still closes: it is on the ground, not in his hand.
    this.close();
  }

  private close(): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: E_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      const body = victim.collisionRadius || 0;
      const away = Math.hypot(victim.position.x - this.atX, victim.position.y - this.atY);
      if (away > E_RADIUS + body) continue;

      victim.takeDamage(E_DAMAGE, this.owner, 'MAGIC');
      feedDarkness(this.owner, victim);
      this.caught.push({ x: victim.position.x, y: victim.position.y });

      if (away <= 1) continue;
      // A `Dash` on the victim, so cleanses, grounding and every other answer
      // to a displacement get to work on it — writing `victim.position` would
      // haul a champion who had just been made immune to exactly this.
      const pulled = Math.min(E_PULL, away);
      const drag = new Dash(700, this.owner, victim);
      drag.dashDestination = createVector(
        victim.position.x + ((this.atX - victim.position.x) / away) * pulled,
        victim.position.y + ((this.atY - victim.position.y) / away) * pulled
      );
      drag.dashSpeed = E_PULL_SPEED;
      drag.showTrail = false;
      victim.addBuff(drag);
    }
  }

  draw(): void {
    const winding = Math.min(1, this.age / E_DELAY_MS);
    const shut = this.closed ? Math.min(1, this.fadeMs / 240) : 0;
    const fade = this.closed ? 1 - shut : 1;
    const fingers = 5;

    push();
    translate(this.atX, this.atY);
    // The circle it will close on, from the first frame.
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 220 * fade);
    strokeWeight(5);
    circle(0, 0, E_RADIUS * 2);
    stroke(VOID[0], VOID[1], VOID[2], 235 * fade);
    strokeWeight(3);
    arc(0, 0, E_RADIUS * 2, E_RADIUS * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * winding);

    // Five fingers, open at the rim, folding inward as it closes.
    const grip = E_RADIUS * (this.closed ? 0.25 + 0.2 * shut : 1 - 0.2 * winding);
    strokeWeight(7);
    stroke(IRON[0], IRON[1], IRON[2], 235 * fade);
    for (let i = 0; i < fingers; i++) {
      const spin = (Math.PI * 2 * i) / fingers - Math.PI / 2;
      line(Math.cos(spin) * grip * 0.35, Math.sin(spin) * grip * 0.35, Math.cos(spin) * grip, Math.sin(spin) * grip);
    }
    strokeWeight(3);
    stroke(EMBER[0], EMBER[1], EMBER[2], 235 * fade);
    for (let i = 0; i < fingers; i++) {
      const spin = (Math.PI * 2 * i) / fingers - Math.PI / 2;
      line(Math.cos(spin) * grip * 0.4, Math.sin(spin) * grip * 0.4, Math.cos(spin) * grip, Math.sin(spin) * grip);
    }
    pop();

    // Where each body was dragged from.
    push();
    for (const mark of this.caught) {
      stroke(VOID[0], VOID[1], VOID[2], 220 * fade);
      strokeWeight(3);
      line(mark.x, mark.y, this.atX, this.atY);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((E_RADIUS + 40) * 2);
  }
}
