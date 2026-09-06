import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;
const BuffAddType = api.enums.BuffAddType;
const SpellObject = api.SpellObject;
const heal = api.text.heal;

/** Toxic chemical green, shared with Q's infection motif on purpose — same doctor, same drugs. */
const DOSE: [number, number, number] = [96, 224, 90];

/**
 * Ten seconds, not the ninety the record lists.
 *
 * Every ultimate in this pack sits at or under ten seconds — that is
 * `check-seams`' ceiling on an *ability*, and it is a statement about what a
 * match is here: ten minutes, no levels, and a rotation a player is meant to
 * come back around to. A ninety-second ultimate copied off the wiki would be
 * castable six times in a whole game beside ultimates castable sixty times.
 * The duration comes down with it, or a ten-second heal on a ten-second
 * cooldown is simply permanent.
 */
export const COOLDOWN_MS = 10_000;

export const DURATION_MS = 6_000;

export const REGEN_TICK_MS = 500;

export const REGEN_TICKS = DURATION_MS / REGEN_TICK_MS;

/** The record's own cadence: health regen paid out every half second. */
export const HEAL_PER_TICK = 5;

/** `HEAL_PER_TICK * REGEN_TICKS` — the top of the "ultimate 40-60" band this pack tunes to. */
export const HEAL_TOTAL = HEAL_PER_TICK * REGEN_TICKS;

export const MAX_HEALTH_BASE = 10;

/** Extra max health scaled by how much is already missing at the moment of cast. */
export const MAX_HEALTH_MISSING_SCALE = 20;

export const MOVE_SPEED_BONUS = 0.25;

/**
 * The counter-play hook the whole champion exists for: while the dose is
 * running, every heal that reaches Mundo — this one included — lands for 20%
 * more. `Buff.healCut`'s strongest live cut composes with this
 * multiplicatively (`combat/Healing.ts`), so a Vết Thương Sâu item bought
 * into this window is answering a real number, not a decorative one.
 */
export const HEALING_RECEIVED_BONUS = 0.2;

/**
 * Maximum Dosage.
 *
 * `takeHeal` is the only thing that puts health back — never hand-rolled
 * arithmetic — because it is the seam `healCut` and `healingReceived` both
 * apply through. Writing this heal any other way would make the biggest
 * sustain cooldown in the game invisible to the items sold specifically to
 * answer it.
 *
 * The record's rank-3 "5% more per nearby enemy champion" clause is dropped:
 * this pack does not model per-rank scaling for any ability (every spell here
 * is one flat tuning set, not five), so there is no "rank 3" for the clause to
 * key off. The missing-health scaling on the max-health bonus is kept — it
 * costs one read of `stats.health` at cast time and it is what makes the
 * ultimate a bigger swing exactly when Q and W's health costs have put him in
 * danger.
 */
export default class DrMundo_R extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_drmundo_r');
  name = 'Suýt Quá Liều (DrMundo_R)';
  description =
    `Tự tiêm hóa chất trong <span class="time">${secs(DURATION_MS)} giây</span>: hồi tổng cộng ` +
    `${heal(HEAL_TOTAL, ' máu')}, tăng <span class="buff">+${MAX_HEALTH_BASE}-${MAX_HEALTH_BASE + MAX_HEALTH_MISSING_SCALE} máu tối đa</span> ` +
    `(theo lượng máu đã mất), <span class="buff">+${pct(MOVE_SPEED_BONUS)}% tốc chạy</span>, và ` +
    `<span class="buff">+${pct(HEALING_RECEIVED_BONUS)}% hiệu quả hồi máu nhận vào</span>.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  onSpellCast(): void {
    const max = this.owner.stats.maxHealth.value;
    const missing = max > 0 ? 1 - this.owner.stats.health.value / max : 0;
    const maxHealthBonus = MAX_HEALTH_BASE + MAX_HEALTH_MISSING_SCALE * constrain(missing, 0, 1);

    const amp = new StatAmp(DURATION_MS, this.owner, this.owner);
    amp.stackId = 'drmundo_r_dosage';
    amp.image = this.image;
    amp.name = 'Liều Cực Mạnh';
    amp.bonuses = {
      maxHealth: { baseBonus: maxHealthBonus },
      speed: { percentBaseBonus: MOVE_SPEED_BONUS },
      healingReceived: { baseBonus: HEALING_RECEIVED_BONUS },
    };
    this.owner.addBuff(amp);

    const regen = new DrMundo_R_Regen(DURATION_MS, this.owner, this.owner);
    regen.stackId = 'drmundo_r_regen';
    regen.image = this.image;
    this.owner.addBuff(regen);

    const surge = new DrMundo_R_Object(this.owner);
    surge.attachTo(this.owner, amp);
    this.game.objectManager.addObject(surge);
  }
}

/** The heal, ticked through `takeHeal` so nothing in this file bypasses the heal-cut seam. */
export class DrMundo_R_Regen extends Buff {
  name = 'Liều Cực Mạnh';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  private tickTimer = 0;

  onCreate(): void {
    this.description ??=
      `Hồi ${heal(HEAL_PER_TICK, ' máu')} mỗi ${secs(REGEN_TICK_MS)} giây ` +
      `trong <span class="time">${secs(DURATION_MS)} giây</span> (hồi tổng ${heal(HEAL_TOTAL, ' máu')}).`;
  }

  onUpdate(): void {
    this.tickTimer += deltaTime;
    while (this.tickTimer >= REGEN_TICK_MS) {
      this.tickTimer -= REGEN_TICK_MS;
      // A dead target simply does not heal — `takeHeal` already refuses it —
      // so there is nothing here to special-case.
      this.targetUnit.takeHeal(HEAL_PER_TICK, this.sourceUnit);
    }
  }
}

/**
 * The dose made visible: veins lit from inside, pulsing on a fast heartbeat —
 * faster than Warwick's hunt, because this is adrenaline, not a stalk — plus
 * a windup at the injection itself so the buff never just appears at full
 * strength on frame one.
 */
export class DrMundo_R_Object extends SpellObject {
  age = 0;
  private static readonly INJECT_MS = 260;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const buff = this._anchorBuff;
    const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
    const size = this.owner.animatedValues.displaySize;
    const r = size / 2;
    const inject = constrain(this.age / DrMundo_R_Object.INJECT_MS, 0, 1);
    // fast, ragged pulse — this is a heart racing on chemicals, not a stalking beat
    const pulse = 0.5 + 0.5 * sin(this.age / 90);

    push();
    translate(this.position.x, this.position.y);

    // veins standing out under the skin: short jittering ticks around the rim
    stroke(DOSE[0], DOSE[1], DOSE[2], (120 + 100 * pulse) * inject);
    strokeWeight(2);
    for (let i = 0; i < 10; i++) {
      const a = (TWO_PI * i) / 10;
      const jitter = sin(this.age / 70 + i) * 3;
      const r0 = r * 0.55;
      const r1 = r * (0.95 + 0.05 * pulse) + jitter;
      line(cos(a) * r0, sin(a) * r0, cos(a) * r1, sin(a) * r1);
    }

    // the swelling itself: a soft green rim, thicker on the beat
    noFill();
    stroke(DOSE[0], DOSE[1], DOSE[2], 200 * inject);
    strokeWeight((4 + 3 * pulse) * inject);
    circle(0, 0, size * 1.1 + 6 * pulse);

    // the injection flash, once, at the moment the dose lands
    if (inject < 1) {
      const flash = 1 - inject;
      noFill();
      stroke(220, 255, 210, 235 * flash);
      strokeWeight(6 * flash + 1);
      circle(0, 0, size * 0.6 + size * 0.9 * inject);
      noStroke();
      fill(DOSE[0], DOSE[1], DOSE[2], 200 * flash);
      circle(0, -r * 0.8, 10 * flash + 3);
    }

    // how long the dose has left
    noFill();
    stroke(30, 60, 30, 120);
    strokeWeight(4);
    circle(0, 0, size * 1.7);
    stroke(150, 255, 140, 235);
    strokeWeight(4);
    arc(0, 0, size * 1.7, size * 1.7, -HALF_PI, -HALF_PI + TWO_PI * left);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.owner.animatedValues.displaySize / 2 + 60;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
