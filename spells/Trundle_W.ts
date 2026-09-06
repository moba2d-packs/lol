import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const VectorUtils = api.utils.VectorUtils;
const BuffAddType = api.enums.BuffAddType;
const StatAmp = api.buffs.StatAmp;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const SpellObject = api.SpellObject;


export const W_MAX_RANGE = 480;

export const W_RADIUS = 190;

export const W_DURATION_MS = 8_000;

/** How often the zone checks who is standing in it and re-applies the buff. */
export const W_TICK_MS = 250;

export const W_ATTACK_SPEED = 0.35;

export const W_MOVE_SPEED = 0.12;

/** Matches the record's own number exactly — no rescale needed for a percentage. */
export const W_HEALING_RECEIVED = 0.25;

/** Re-applied buff outlives one tick, so it never flickers off between them. */
const BUFF_REFRESH_MS = W_TICK_MS + 150;


/**
 * Frozen Domain. Unlike every armour/AD steal in this kit, this is a plain
 * home-field buff: Trundle drops the ice, and it rewards him for standing in
 * it — nothing here reads or writes an enemy's stats.
 *
 * The zone re-checks Trundle's position on a 250ms beat rather than every
 * frame (`Singed_W`'s model) and re-applies a short-lived `StatAmp` each time,
 * so stepping out simply lets the buff lapse instead of needing an explicit
 * "left the zone" event.
 */
export default class Trundle_W extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_trundle_w');
  name = 'Vương Quốc Băng Hàn (Trundle_W)';
  description =
    `Phủ băng lên khu vực bán kính <span>${W_RADIUS}px</span> trong <span class="time">${secs(W_DURATION_MS)} giây</span>.` +
    ` Khi đứng trong vùng băng, Trundle nhận <span class="buff">${pct(W_ATTACK_SPEED)}% tốc đánh</span>,` +
    ` <span class="buff">${pct(W_MOVE_SPEED)}% tốc chạy</span> và` +
    ` hồi máu nhận vào mạnh hơn <span class="buff">${pct(W_HEALING_RECEIVED)}%</span> từ mọi nguồn.`;
  coolDown = 10_000;
  manaCost = 40;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      W_MAX_RANGE
    );

    const zone = new Trundle_W_Object(this.owner);
    zone.position = to;
    this.game.objectManager.addObject(zone);
  }

  drawPreview(): void {
    super.drawPreview(W_MAX_RANGE);
  }
}


export class Trundle_W_Object extends SpellObject {
  image = api.asset('spell_trundle_w');
  position: p5.Vector = this.owner.position.copy();
  // Ground art: without this a plain SpellObject resolves above champions,
  // and a floor of ice drawn over Trundle's own feet reads as a bug.
  zIndex = GROUND_Z_INDEX;

  radius = W_RADIUS;
  lifeTime = W_DURATION_MS;
  age = 0;

  private sinceTick = W_TICK_MS; // bites on the very first frame
  /** Whether the last tick found Trundle standing in his own zone. */
  private occupied = false;

  /** Frost cracks radiating from the centre, seeded once so they hold still. */
  private cracks: { angle: number; length: number; kink: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < 14; i++) {
      this.cracks.push({
        angle: random(0, TWO_PI),
        length: random(0.55, 1),
        kink: random(-0.3, 0.3),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.sinceTick += deltaTime;
    if (this.sinceTick < W_TICK_MS) return;
    this.sinceTick -= W_TICK_MS;
    this.applyToOwnerIfInside();
  }

  private applyToOwnerIfInside(): void {
    const trundle = this.owner;
    this.occupied = false;
    if (!trundle || trundle.isDead || trundle.toRemove) return;
    if (p5.Vector.dist(trundle.position, this.position) > this.radius) return;

    this.occupied = true;
    const homeGround = new StatAmp(BUFF_REFRESH_MS, trundle, trundle);
    homeGround.name = 'Lãnh Địa Băng Giá';
    homeGround.stackId = 'trundle_w_home_ground';
    homeGround.image = this.image;
    homeGround.bonuses = {
      attackSpeed: { percentBaseBonus: W_ATTACK_SPEED },
      speed: { percentBaseBonus: W_MOVE_SPEED },
      healingReceived: { percentBonus: W_HEALING_RECEIVED },
    };
    // `StatAmp`'s default `STACKS_AND_CONTINUE` at `maxStacks = 1` already
    // replaces the previous instance cleanly on every re-application, which is
    // exactly the renew this zone needs — spelled out here rather than left
    // implicit because it is the one behaviour this whole file leans on.
    homeGround.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    trundle.addBuff(homeGround);
  }

  draw(): void {
    const t = this.age / this.lifeTime;
    const fade = t > 0.85 ? (1 - t) / 0.15 : 1;
    // grows out of the ground rather than appearing at full size
    const grow = Math.min(1, this.age / 260);
    // brighter and pulsing while Trundle is actually drawing the buff from it —
    // a state that is true right now, not an always-on glow.
    const active = this.occupied ? 0.85 + 0.15 * sin(this.age / 150) : 0.55;

    push();
    translate(this.position.x, this.position.y);

    noStroke();
    fill(150, 210, 245, 55 * fade * active);
    circle(0, 0, this.radius * 2 * grow);

    // the rink's edge: a hard rim so the boundary is never a guess
    noFill();
    stroke(210, 240, 255, 210 * fade * active);
    strokeWeight(4);
    circle(0, 0, this.radius * 2 * grow);
    stroke(90, 160, 210, 160 * fade);
    strokeWeight(2);
    circle(0, 0, this.radius * 2 * grow - 6);

    // frost cracks spreading from the centre, under everything standing on them
    stroke(225, 245, 255, 150 * fade * grow);
    strokeWeight(2);
    for (const crack of this.cracks) {
      const reach = this.radius * crack.length * grow;
      const midX = cos(crack.angle) * reach * 0.55;
      const midY = sin(crack.angle) * reach * 0.55;
      const endX = cos(crack.angle + crack.kink) * reach;
      const endY = sin(crack.angle + crack.kink) * reach;
      line(0, 0, midX, midY);
      line(midX, midY, endX, endY);
    }

    // drifting ice motes, thicker while the buff is actually live
    noStroke();
    const motes = this.occupied ? 10 : 5;
    for (let i = 0; i < motes; i++) {
      const a = (i / motes) * TWO_PI + this.age / 900;
      const d = this.radius * (0.3 + 0.6 * Math.abs(Math.sin(this.age / 700 + i)));
      fill(235, 250, 255, 200 * fade * active);
      circle(cos(a) * d, sin(a) * d, 5 + 3 * Math.sin(this.age / 260 + i));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(this.radius * 2);
  }
}
