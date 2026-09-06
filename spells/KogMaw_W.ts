import type { AttackableUnit, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';
import { VOID_ACID, VOID_VIOLET } from './KogMaw_Q';

const Spell = api.Spell;
const StatAmp = api.buffs.StatAmp;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const W_DURATION_MS = 8_000;

export const W_BONUS_RANGE = 130;

export const W_ON_HIT_DAMAGE = 10;

export const W_COOLDOWN = 10_000;

export const W_MANA_COST = 40;

export const W_STACK_ID = 'kogmaw_w_barrage';


/**
 * Bio-Arcane Barrage — the pack's on-hit champion doing the thing the shop's
 * new on-hit shelf exists for: a timed window that adds ranged magic damage
 * to every basic attack.
 *
 * **One buff, not two.** `docs/abilities/kogmaw/w.json` describes a single
 * empowerment (bonus range *and* bonus on-hit damage, same 8s window), so
 * this grants both off one `StatAmp` subclass rather than a `StatAmp` for the
 * range plus a separate on-hit buff — one HUD row, one icon, one timer,
 * matching the one thing the record says is happening. `Vi_W.ts` is the
 * counter-example: its haste and its "window" are two rewards on two
 * different triggers, which is why *that* kit earns two rows.
 *
 * **The on-hit itself is `Item_Nashor.ts`'s exact shape** — a `Buff`
 * overriding `onHit(hit)`, dealing a flat magic number — because the brief
 * for this file pointed at it directly and because the real ability's own
 * scaling (a percentage of the *victim's* max health, plus AP, capped
 * against minions/monsters) has no seam to hang on in this pack: on-hit
 * reactions run through `combat/OnHit.ts`'s `applyOnHitEffects`, which is
 * never bracketed by the ability-attribution ambient `Amplification.ts`
 * reads (only a spell's own cast and a buff's tick/`onDamageTaken` are), so
 * an AP-scaled number here would not actually scale with AP without new
 * plumbing — and there is no `Minion`/`Monster` distinction exposed to a
 * pack the way `api.Monster` is, only `Monster`. Flat, rescaled to this
 * pool, is the honest version of what this engine can already do; it is
 * bigger than `Item_Nashor`'s permanent +7 because this is a champion
 * ability with a real cooldown gating it, not a purchase.
 */
export default class KogMaw_W extends Spell {
  /**
   * `Buff` alone, same shape as the one above: range and flat on-hit magic
   * damage, no shield.
   */
  static aiRoles = api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_kogmaw_w');
  name = 'Cao Xạ Ma Pháp (KogMaw_W)';
  description =
    `Kích hoạt trong <span class="time">${secs(W_DURATION_MS)} giây</span>:` +
    ` <span class="buff">+${W_BONUS_RANGE} tầm đánh</span> và mỗi đòn đánh thường gây thêm` +
    ` ${dmg(W_ON_HIT_DAMAGE, 'MAGIC')}.`;
  coolDown = W_COOLDOWN;
  manaCost = W_MANA_COST;

  onSpellCast(): void {
    const barrage = new KogMaw_W_Barrage(W_DURATION_MS, this.owner, this.owner);
    barrage.stackId = W_STACK_ID;
    barrage.image = this.image;
    this.owner.addBuff(barrage);

    // Six seconds of "your attacks are different now" needs to show on the
    // body itself, not just a buff-bar icon (VFX_STANDARD's "worn state is a
    // thin stroke" rule) — a thin pulsing ring that leaves when the buff does.
    const worn = new KogMaw_W_Glow(this.owner);
    worn.attachTo(this.owner, barrage);
    this.game.objectManager.addObject(worn);
  }
}


export class KogMaw_W_Barrage extends StatAmp {
  name = 'Pháo Kích Sinh Học';
  bonuses = { attackRange: { flatBonus: W_BONUS_RANGE } };

  onHit(hit: OnHitEvent): void {
    hit.victim.takeDamage(W_ON_HIT_DAMAGE, this.targetUnit, 'MAGIC', 'Pháo Kích Sinh Học');

    // A proc flash, capped to the item noise budget even though this is an
    // ability: it fires on every swing for 8 seconds, so anything bigger or
    // longer than a normal on-hit proc would bury the fight under itself.
    this.game.objectManager.addObject(new KogMaw_W_Proc(this.targetUnit, hit.victim.position.copy()));
  }
}


/** The worn state: a thin ring around Kog'Maw for as long as Barrage is armed. */
export class KogMaw_W_Glow extends SpellObject {
  age = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const half = (this.owner.animatedValues?.displaySize ?? 40) / 2;
    const pulse = 0.6 + 0.4 * Math.sin(this.age / 220);

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 150 * pulse);
    strokeWeight(2);
    circle(0, 0, half * 2 + 12);
    pop();
  }

  getDisplayBoundingBox() {
    const half = (this.owner.animatedValues?.displaySize ?? 40) / 2;
    return this.squareDisplayBoundingBox((half + 30) * 2);
  }
}


/** The proc: a quick violet-acid flash on the victim, one layer, gone in a fifth of a second. */
export class KogMaw_W_Proc extends SpellObject {
  lifeTime = 260;
  age = 0;

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const grow = 1 - (1 - t) * (1 - t);

    push();
    translate(this.position.x, this.position.y);

    blendMode(ADD);
    noStroke();
    fill(VOID_VIOLET[0], VOID_VIOLET[1], VOID_VIOLET[2], 160 * fade);
    circle(0, 0, 26 * grow + 8);
    blendMode(BLEND);

    noFill();
    stroke(VOID_ACID[0], VOID_ACID[1], VOID_ACID[2], 210 * fade);
    strokeWeight(2);
    circle(0, 0, 18 * grow + 6);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(70);
  }
}
