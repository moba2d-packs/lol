import { api } from '../packApi';
import { pct, secs } from '../text';

const BuffAddType = api.enums.BuffAddType
const Spell = api.Spell;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const HealCut = api.buffs.HealCut;
const dmg = api.text.dmg;

export const MAX_RANGE = 500;

export const RADIUS = 180;

export const IMPACT_DAMAGE = 24;

export const DURATION = 3000;

export const SLOW_PERCENT = 0.45;

/** The desecration: what it takes off every heal, and for how long after the tick. */
export const WOUND_PERCENT = 0.4;

export const WOUND_MS = 3_000;

export const FALL_TIME = 400;


/** Hail of Arrows: a volley that lands, then a patch of ground nobody wants to stand on. */
export default class Varus_E extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_varus_e');
  name = 'Mưa Tên (Varus_E)';
  description =
    `Bắn một loạt tên xuống vị trí chỉ định: ${dmg(IMPACT_DAMAGE, 'PHYSICAL')} khi chạm đất,` +
    ` sau đó vùng đất bị <span class="buff">Làm Chậm ${pct(SLOW_PERCENT)}%</span> trong` +
    ` <span class="time">${secs(DURATION)} giây</span> và dính` +
    ` <span class="buff">Vết Thương Sâu ${pct(WOUND_PERCENT)}%</span>`;
  coolDown = 9000;
  manaCost = 30;

  maxRange = MAX_RANGE;

  onSpellCast() {
    const aim = this.aimPoint;
    const landing = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    const volley = new Varus_E_Object(this.owner);
    volley.position = landing;
    this.game.objectManager.addObject(volley);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}


export class Varus_E_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = FALL_TIME + DURATION;
  age = 0;
  sinceTick = 0;
  landed = false;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.age < FALL_TIME) return;

    const enemies = () =>
      this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

    if (!this.landed) {
      this.landed = true;
      enemies().forEach((enemy: any) => enemy.takeDamage(IMPACT_DAMAGE, this.owner, 'PHYSICAL'));
      return;
    }

    this.sinceTick += deltaTime;
    if (this.sinceTick < 400) return;
    this.sinceTick -= 400;
    enemies().forEach((enemy: any) => {
      const slow = new Slow(700, this.owner, enemy);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = SLOW_PERCENT;
      enemy.addBuff(slow);
      // "slowing enemies within and inflicting them with Grievous Wounds"
      // (`docs/abilities/varus/e.json`). The slow was implemented and the
      // wound was not, because core had no such thing until 1.13 — it does
      // now, and this is the ability the source game gives it to.
      const wound = new HealCut(WOUND_MS, this.owner, enemy);
      wound.healCut = WOUND_PERCENT;
      enemy.addBuff(wound);
    });
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);

    if (!this.landed) {
      // the volley in the air: shafts dropping onto the circle they will fill.
      // They used to sweep *inward* from 1.8x the radius, which told the player
      // the patch reached half again as far as it does — the arrows now fall
      // from above onto points inside the ring, so the only thing claiming a
      // reach is the ring itself.
      const t = this.age / FALL_TIME;
      noFill();
      stroke(200, 170, 255, 200);
      strokeWeight(3);
      circle(0, 0, this.radius * 2);
      stroke(220, 200, 255, 240);
      strokeWeight(2);
      const drop = (1 - t) * 150;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TWO_PI;
        const d = this.radius * (0.3 + (0.58 * ((i * 5) % 7)) / 6);
        const x = cos(a) * d;
        const y = sin(a) * d - drop;
        line(x, y, x, y + 26);
      }
      pop();
      return;
    }

    // arrows standing in the ground, thinning as the patch expires
    const left = 1 - (this.age - FALL_TIME) / DURATION;
    noStroke();
    fill(120, 80, 170, 40 * left);
    circle(0, 0, this.radius * 2);
    stroke(210, 190, 255, 200 * left);
    strokeWeight(2);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TWO_PI + i;
      const d = this.radius * (0.25 + (0.7 * ((i * 7) % 10)) / 10);
      const x = cos(a) * d;
      const y = sin(a) * d;
      line(x, y, x + 4, y - 14);
    }
    pop();
  }

  /** Tall rather than square: the volley is still 150px above the ring when it
   * starts, and the box is what decides whether any of it is drawn at all. */
  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius - 20,
      y: this.position.y - this.radius - 180,
      w: this.radius * 2 + 40,
      h: this.radius * 2 + 220,
      data: this,
    });
  }
}