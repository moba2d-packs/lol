import { describe, expect, it } from 'vitest';
import { data } from '../pack';

/**
 * The question `items.test.ts`'s per-stat bands cannot answer: **gold for
 * gold, does the ability path keep pace with the attack path?**
 *
 * The shop's two builds are measured the same way a player experiences them —
 * the best six items the table can sell each archetype, brute-forced rather
 * than hand-picked so a retuned item moves the answer by itself:
 *
 *   - the attack build's throughput is `(AD + on-hit) × E[crit] × attacks/s`,
 *     the exact chain `landBasicAttack` and `BasicAttackController` apply:
 *     swing = (attackDamage + onHitDamage), crits multiply the swing by the
 *     `critDamage` stat (base 1.75 in core — `CRIT_MULTIPLIER` — plus item
 *     points), `attacksPerSecond` *is* the `attackSpeed` stat;
 *   - the ability build's throughput multiplier is `(1 + ΣAP) × (1 + Σhaste/100)`:
 *     `Amplification.ts` multiplies every ability hit by `1 + abilityPower`,
 *     and a rotation's cadence is its cooldowns, which `Spell.reducedCooldown`
 *     shortens through `100 / (100 + haste)` — so casts per second is linear
 *     in the stat, with no cap for the model to clamp against.
 *
 * Both are stats-only floors: Sheen-line spellblades, Kraken/Guinsoo procs
 * and the other coded passives all favour the attack path further, and item
 * actives favour the ability path — neither side of that is a table read, so
 * neither is in this measurement. What is asserted is the *shape*: each
 * path's bonus-per-1000-gold, and the ratio between them, pinned to the band
 * measured on 2026-08-27 so a retune that silently breaks the parity this
 * shop was built for (`items.test.ts`'s own header: items must not buy the
 * right-click and nothing else) fails here with the numbers in the message.
 *
 * The attack baseline is the pack's own MARKSMAN profile — the archetype
 * whose whole output is the swing — and the ability multiplier needs no
 * baseline at all: amplification and CDR scale any kit linearly.
 */

type ItemStats = {
  attackDamage?: number;
  attackSpeed?: number;
  critChance?: number;
  critDamage?: number;
  onHitDamage?: number;
  abilityPower?: number;
  abilityHaste?: number;
};
type ItemDef = { id: string; name: string; cost: number; stats?: ItemStats };

const items: ItemDef[] = Object.values(data.items ?? {}) as ItemDef[];

/** Core's `CRIT_MULTIPLIER` (`Stats.ts`), restated — the pack cannot value-import core. */
const CRIT_BASE = 1.75;

/** The pack's own MARKSMAN tuning (`data.ts`'s role table). */
const BASE_AD = 10;
const BASE_APS = 1.65;
/** Core's `MAX_ATTACK_SPEED`, restated for the same reason `CRIT_BASE` is. */
const MAX_APS = 3;

const sum = (build: ItemDef[], key: keyof ItemStats): number =>
  build.reduce((total, item) => total + (item.stats?.[key] ?? 0), 0);

const autoDps = (build: ItemDef[]): number => {
  const swing = BASE_AD + sum(build, 'attackDamage') + sum(build, 'onHitDamage');
  const chance = Math.min(1, sum(build, 'critChance'));
  const expectedCrit = 1 + chance * (CRIT_BASE + sum(build, 'critDamage') - 1);
  // Attack speed is a **share of the base rate** (core's `PERCENT_OF_BASE`),
  // pooled additively and multiplying it once — so `0.25` on an item is +25%,
  // not a quarter of a swing a second, and the marksman's own 1.65 is what it
  // is a quarter of. `MAX_ATTACK_SPEED` is core's read clamp on the total.
  const rate = Math.min(MAX_APS, BASE_APS * (1 + sum(build, 'attackSpeed')));
  return swing * expectedCrit * rate;
};

/**
 * Casts per second is linear in haste (`1 + h/100`), which is the whole reason
 * core moved off the old fraction: under `1/(1-r)` the model had to clamp at a
 * cap, and every point near it was worth more than the last. Nothing is clamped
 * here now — the curve cannot run away.
 */
const kitMultiplier = (build: ItemDef[]): number =>
  (1 + sum(build, 'abilityPower')) * (1 + sum(build, 'abilityHaste') / 100);

/**
 * The best six for `score`, exhaustively. Only items granting a stat the
 * score reads are candidates — an item granting none can only displace one
 * that does — which keeps the enumeration in the hundreds.
 */
const bestSix = (
  keys: (keyof ItemStats)[],
  score: (build: ItemDef[]) => number
): { build: ItemDef[]; score: number; gold: number } => {
  const candidates = items.filter(item => keys.some(key => (item.stats?.[key] ?? 0) > 0));
  let best: ItemDef[] = [];
  let bestScore = -Infinity;
  const pick: ItemDef[] = [];
  const walk = (from: number): void => {
    if (pick.length === 6 || from === candidates.length) {
      const value = score(pick);
      if (value > bestScore) {
        bestScore = value;
        best = pick.slice();
      }
      if (pick.length === 6) return;
    }
    for (let i = from; i < candidates.length; i++) {
      pick.push(candidates[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return { build: best, score: bestScore, gold: best.reduce((g, item) => g + item.cost, 0) };
};

describe('gold-for-gold, the two builds this shop sells', () => {
  const attack = bestSix(
    ['attackDamage', 'attackSpeed', 'critChance', 'critDamage', 'onHitDamage'],
    autoDps
  );
  const ability = bestSix(['abilityPower', 'abilityHaste'], kitMultiplier);

  const attackMultiplier = attack.score / (BASE_AD * BASE_APS);
  const abilityMultiplier = ability.score;
  // Bonus (multiplier above 1.0) bought per 1000 gold — the marginal value of
  // walking each path, which is what makes builds of different total cost
  // comparable at all.
  const attackPer1000 = ((attackMultiplier - 1) / attack.gold) * 1000;
  const abilityPer1000 = ((abilityMultiplier - 1) / ability.gold) * 1000;
  const ratio = attackPer1000 / abilityPer1000;

  it('reports the measurement', () => {
    const name = (build: ItemDef[]) => build.map(item => item.name).join(', ');
    // eslint-disable-next-line no-console
    console.log(
      [
        '── balance report (stats-only floors) ──',
        `attack build  (${attack.gold}g): ${name(attack.build)}`,
        `  ${attackMultiplier.toFixed(2)}x marksman auto DPS — +${attackPer1000.toFixed(2)}x per 1000g`,
        `ability build (${ability.gold}g): ${name(ability.build)}`,
        `  ${abilityMultiplier.toFixed(2)}x kit throughput — +${abilityPer1000.toFixed(2)}x per 1000g`,
        `attack : ability value ratio = ${ratio.toFixed(2)}`,
      ].join('\n')
    );
    expect(attack.build).toHaveLength(6);
    expect(ability.build).toHaveLength(6);
  });

  it('keeps the two paths inside the rebalanced band', () => {
    // First measured 2026-08-27 at ratio 6.02: attack 20.23x for 8600g
    // against ability 4.27x for 8800g — gold in the attack path bought six
    // times the throughput, because crit, attack damage and attack speed
    // multiply each other while ability power only adds, and the old "full
    // build ≈ 5.7x damage, 1.5x rate" note predated the crit line entirely.
    //
    // The 2026-08-28 rebalance raised the six ability items' fractions to a
    // best-six sum of 7.9 (`items.test.ts` pins the table), which measured:
    // attack 20.23x for 8600g (+2.24x/1000g), ability 11.87x for 8800g
    // (+1.23x/1000g), **ratio 1.81** — the deliberate target band of 1.5-2,
    // slightly attack-favoured on stats because the attack path's on-hit
    // passives are not in this floor while the ability path's item actives
    // are not either, and the two roughly wash.
    //
    // **That 1.81 went stale and nobody noticed.** Every attack shelf added
    // after it moved this number and none of them re-read it: by 2026-09-06
    // the measurement was **2.062** — attack 27.26x for 9650g (+2.72x/1000g)
    // against ability 12.48x for 8700g (+1.32x/1000g) — which is 0.038 from
    // the `< 2.1` line below, on a test that was green every single run. The
    // band did the job it was written for and the *comment* was the part
    // that failed, which is worth saying out loud: a number in prose beside
    // an assertion is documentation, and documentation rots.
    //
    // The mage/lethality shelf of 2026-09-06 was sized against that
    // measurement rather than against the note: five of its rows sell
    // ability power and seven sell ability haste, and not one of its attack
    // rows is strong enough to enter the best attack six (which is
    // byte-identical before and after). It measures **1.82** — attack
    // 27.26x for 9650g (+2.72x/1000g), ability 15.12x for 9450g
    // (+1.49x/1000g) — back on the band's own target.
    //
    // If you are reading this after adding a shelf: re-run it and update
    // these three figures. That is the maintenance this comment costs, and
    // the alternative is what happened above.
    expect(
      ratio,
      `attack:ability per-gold ratio drifted to ${ratio.toFixed(2)}`
    ).toBeGreaterThan(1.5);
    expect(ratio, `attack:ability per-gold ratio drifted to ${ratio.toFixed(2)}`).toBeLessThan(2.1);
  });
});
