import { api } from '../packApi';
import { secs } from '../text';

const Spell = api.Spell;
const StatAmp = api.buffs.StatAmp;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellObject = api.SpellObject;
const Rectangle = api.utils.Quadtree.Rectangle;
const dmg = api.text.dmg;

export const DURATION = 8000;

export const AURA_RADIUS = 200;

export const DAMAGE_PER_TICK = 3;

export const TICK_INTERVAL = 500;

export const BONUS_HEALTH = 40;


export default class Nasus_R extends Spell {
  /**
   * Told: a health-and-size steroid *and* a burning aura that damages
   * everyone inside its radius for the duration.
   */
  static aiRoles = api.enums.SpellRole.Buff | api.enums.SpellRole.Damage | api.enums.SpellRole.Zone;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_nasus_r');
  name = 'Cơn Thịnh Nộ Sa Mạc (Nasus_R)';
  description =
    `Hóa khổng lồ trong <span class="time">${secs(DURATION)} giây</span>:` +
    ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span> và thiêu đốt mọi kẻ địch trong <span>${AURA_RADIUS}px</span>` +
    ` ${dmg(DAMAGE_PER_TICK, 'MAGIC')} mỗi <span class="time">${secs(TICK_INTERVAL)} giây</span>`;
  coolDown = 10000;
  manaCost = 60;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'nasus_r_fury';
    amp.image = this.image;
    amp.name = 'Cơn Thịnh Nộ Sa Mạc';
    amp.bonuses = {
      maxHealth: { baseBonus: BONUS_HEALTH },
      size: { percentBaseBonus: 0.35 },
    };
    this.owner.addBuff(amp);

    // Granting the health is a heal, not a stat. `health` is a resource that
    // `takeDamage`/`takeHeal` move directly, so a modifier on it was never an
    // offset the way `maxHealth` is — and until Stats.update() stopped folding
    // its own read back into the base, `health: { baseBonus }` re-granted
    // itself every frame and made this ultimate literal immortality.
    //
    // After `addBuff`, so the larger maxHealth is already in place and the heal
    // is not clipped to the old ceiling.
    this.owner.takeHeal(BONUS_HEALTH, this.owner);

    const aura = new Nasus_R_Object(this.owner);
    // The storm is the buff's shadow: it ends when the buff does, wherever
    // Nasus happens to be standing by then.
    aura.attachTo(this.owner, amp);
    this.game.objectManager.addObject(aura);
  }
}


export class Nasus_R_Object extends SpellObject {
  radius = AURA_RADIUS;
  visionRadius = AURA_RADIUS;
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < TICK_INTERVAL) return;
    this.sinceTick -= TICK_INTERVAL;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE_PER_TICK, this.owner, 'MAGIC'));
  }

  draw() {
    const spin = this.age / 420;
    push();
    translate(this.owner.position.x, this.owner.position.y);

    // The ground that burns, stated at the radius that burns it — as a **band
    // at the edge, not a filled disc**.
    //
    // It was a disc for one day. A filled r=200 circle is 126k css pixels
    // blended every frame for the whole ultimate, which on a phone at DPR 3 is
    // 1.1M device pixels — over a third of the screen, for one aura, forever.
    // Fill area is what a mobile GPU actually pays and alpha does not reduce
    // it. The same trade was already made once here for the fountain's widest
    // disc: a band is cheaper *and* says where the effect stops, which a haze
    // never did. The three sandstorm arcs below carry the interior.
    noFill();
    stroke(255, 150, 50, 30 + 12 * Math.sin(this.age / 200));
    strokeWeight(this.radius * 0.22);
    circle(0, 0, this.radius * 2 - this.radius * 0.22);

    // A sandstorm reads as sweeping arcs, not as a ring of beads — the ring
    // is what every other aura in the game already is.
    noFill();
    for (let i = 0; i < 3; i++) {
      const a = spin + (i / 3) * TWO_PI;
      stroke(255, 190 - i * 20, 80, 170);
      strokeWeight(11 - i * 2.5);
      const d = this.radius * 2 * (0.94 - i * 0.16);
      arc(0, 0, d, d, a, a + 1.5);
    }

    // the edge of the storm, on the exact radius the tick uses
    stroke(255, 170, 60, 195);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    const pad = this.radius + 6;
    return new Rectangle({
      x: this.owner.position.x - pad,
      y: this.owner.position.y - pad,
      w: pad * 2,
      h: pad * 2,
      data: this,
    });
  }
}