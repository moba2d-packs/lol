import type {
  ChampionAttack,
  ChampionDefence,
  ChampionEntry,
  ContentPackData,
  ItemDef,
  MonsterDef,
  SpellDisplayData,
} from '@moba2d/core/content/ContentPack';
import type { SpellCatalogId as PackSpellCatalogId } from './generated/spellCatalog';
import { spellCatalog } from './generated/spellCatalog';
import {
  championRecordStats,
  type ChampionRecordStats,
} from './generated/championRecordStats';
import { summonersRift } from './maps/summonersRift';
import { twistedTreeline } from './maps/twistedTreeline';

/** `'BasicAttack'` is core's id, not this pack's own — slot 0 of every kit below names it. */
type RosterSpellId = PackSpellCatalogId | 'BasicAttack';

/**
 * This pack's own basic-attack role taxonomy — bruiser, marksman, and the
 * rest. It used to be core's (`src/game/config/spellCatalog.ts`'s
 * `ATTACK`), duplicated into this file so the roster below could reference
 * it without a pack file reaching into core (the `pack-core-boundary` seam
 * refuses that outside the three type-only specifiers it allows). That
 * duplication was a fix-round finding: core's copy had no consumer left in
 * `src/` (only `tests/game/combat/AttackProfiles.test.ts` read it), so the
 * six numbers a match actually ships were the *unguarded* copy and the
 * *guarded* one was dead — exactly the drift `mana-spend-seam.test.ts`'s
 * own rule warns about, just for a tuning table instead of a spend path.
 * `ATTACK` now lives here, once, exported so `tests/packs/riot/attackProfiles.test.ts`
 * guards the copy a match actually plays with. A role taxonomy is the
 * roster's vocabulary, not the engine's — `DEFAULT_CHAMPION_ATTACK`
 * (`@/game/gameObject/attackableUnits/Champion`), the fallback for a
 * champion with no profile at all, is core's, and stays there; it is a
 * mechanism, not content.
 */
/**
 * `boltUnitsPerSecond` is the basic-attack missile speed, ranged roles only —
 * melee swings carry none. The per-champion overrides on the roster below are
 * **the live wiki's own missile speeds at half scale, rounded to 25** (this
 * canvas halves the source game's distances and walk speeds the same way):
 * Graves' 3800 becomes 1900, Caitlyn's 2500 becomes 1250, Varus' 2000 becomes
 * 1000, Soraka's 1000 becomes 500. The role numbers here are only the
 * fallback for a champion the wiki lists no missile for (a form-swapping gun,
 * an attack the source game applies instantly) and for future rows nobody has
 * looked up yet. `tests/attackProfiles.test.ts` pins the mapping.
 */
/**
 * **`range` is measured against the tower, not against taste.**
 *
 * The three ranged roles used to reach 410 and 385, which put the roster's
 * longest reach — Caitlyn, at 491 once placement had spread her — *past* a
 * turret's own 430. A marksman could stand outside a tower and take it down
 * with nothing able to answer, which is not a balance complaint: it removes
 * the structure the whole map is built around.
 *
 * The band that was wrong is visible from three numbers this pack does not
 * own. Core's `DEFAULT_CHAMPION_ATTACK.range` is **300**, its caster minion
 * reaches **280** and its cannon **300** — everything else on the field
 * already sat in the source game's proportion to a 430 tower, and only this
 * table had drifted, by 37%.
 *
 * So the roles are placed off the tower: the source game's turret reaches 775
 * and its longest champion 650, a ratio of **1.19**, and after placement
 * spreads the roster the longest reach here lands at 359 against 430 — the
 * same 1.19, arrived at from the other end. `championPlacement.test.ts` holds
 * the invariant itself ("no champion out-ranges a tower") rather than these
 * numbers, because the invariant is the part that must survive re-tuning.
 *
 * What follows from it and is *not* a bug: a caster minion (280) out-ranges
 * Vladimir (234) and trades evenly with a mid-band mage. That is exactly the
 * source game's own arrangement — 550 against Vladimir's 450 — and it is why
 * a short-range mage has to walk into the wave to farm.
 */
export const ATTACK = {
  MARKSMAN: { damage: 10, attacksPerSecond: 1.65, range: 300, boltUnitsPerSecond: 1200 },
  MAGE: { damage: 12, attacksPerSecond: 1.05, range: 282, boltUnitsPerSecond: 800 },
  SUPPORT: { damage: 10, attacksPerSecond: 1.0, range: 282, boltUnitsPerSecond: 800 },
  ASSASSIN: { damage: 15, attacksPerSecond: 1.25, range: 130 },
  BRUISER: { damage: 17, attacksPerSecond: 1.1, range: 130 },
  TANK: { damage: 15, attacksPerSecond: 0.95, range: 125 },
} as const;

/** Every role in this pack's taxonomy, in the order a picker should show them. */
export type Role = keyof typeof ATTACK;

/**
 * The other half of a role: how much punishment it takes.
 *
 * The twin of `ATTACK`, and it did not exist for most of this project's life —
 * so every champion above, from the tank to the marksman, was **100 health
 * with no resistances**, which is less health than a minion's 140. A bruiser
 * and a marksman were the same body, and the only thing that made a champion
 * feel different in a fight was its kit.
 *
 * That was survivable while nothing could be bought. It stopped being when the
 * shop grew: a full attack build here reaches about **298 damage a second**
 * against a pool core's own comment says was sized for roughly 15, and the
 * best tank build in this shop died to one marksman in 2.5 seconds.
 *
 * ## Why the resistances carry this and the health pool barely moves
 *
 * Health is one number and armour is a multiplier over it, and they are not
 * interchangeable for the 39 abilities in this pack that restore or shield a
 * **flat amount**. A 40-point shield behind 100 armour is worth 80 effective
 * points — the same multiplier the pool itself gets, so every one of those 39
 * abilities keeps its worth exactly. Raising the pool to 260 instead would
 * leave that shield worth 40 against a body two and a half times bigger, and
 * nothing in core could compensate; the fix would be 39 edits.
 *
 * Resistances also cannot run away. `100 / (100 + r)` is asymptotic, so no
 * amount of armour is ever immunity — 300 armour is four times effective
 * health and 600 is seven, never infinite. A health pool is linear and has no
 * such brake.
 *
 * ## The numbers
 *
 * Tuned so a full tank build survives a full marksman build for about four to
 * five seconds rather than two and a half — long enough to open a fight, eat a
 * rotation and get out, while two attackers still bring it down in about two.
 * `tests/roleProfiles.test.ts` holds that target.
 */
export const DEFENCE = {
  MARKSMAN: { health: 125, healthRegen: 0.06, armor: 15, magicResist: 15 },
  MAGE: { health: 135, healthRegen: 0.06, armor: 15, magicResist: 22 },
  SUPPORT: { health: 150, healthRegen: 0.07, armor: 28, magicResist: 30 },
  ASSASSIN: { health: 145, healthRegen: 0.06, armor: 22, magicResist: 18 },
  BRUISER: { health: 190, healthRegen: 0.08, armor: 40, magicResist: 28 },
  TANK: { health: 220, healthRegen: 0.09, armor: 55, magicResist: 45 },
} as const;

/** What a player sees when picking a role for a hand-built kit. */
export const ROLE_NAME: Record<Role, string> = {
  MARKSMAN: 'Xạ Thủ',
  MAGE: 'Pháp Sư',
  SUPPORT: 'Hỗ Trợ',
  ASSASSIN: 'Sát Thủ',
  BRUISER: 'Đấu Sĩ',
  TANK: 'Đỡ Đòn',
};

/**
 * Which role a roster row picked, read back off the `ATTACK` numbers it copied.
 *
 * Derived rather than declared as a `role:` field on all 59 rows, and that is
 * the point rather than a shortcut: a row already names its role by taking one
 * of exactly six profiles, so reading the second half back from the same
 * choice makes an attack profile and a durability profile **impossible to
 * disagree**. A row that said `attack: ATTACK.TANK, defence: DEFENCE.MAGE`
 * would type-check and ship.
 *
 * Matched on `damage`/`attacksPerSecond`/`range` rather than on object
 * identity, because a third of the roster spreads its role and overrides one
 * field — `{ ...ATTACK.MAGE, boltUnitsPerSecond: 875 }`, the live wiki's own
 * missile speeds. Identity missed every one of those and left them bodiless;
 * `roleProfiles.test.ts` caught it on the first run. Those three fields are
 * what a role *is*; the bolt speed is a per-champion flourish on top.
 */
const roleShapes = (Object.keys(ATTACK) as Role[]).map(role => ({ role, shape: ATTACK[role] }));

export const roleOfAttack = (attack: unknown): Role | undefined => {
  const profile = attack as { damage?: number; attacksPerSecond?: number; range?: number };
  if (!profile) return undefined;
  return roleShapes.find(
    ({ shape }) =>
      shape.damage === profile.damage &&
      shape.attacksPerSecond === profile.attacksPerSecond &&
      shape.range === profile.range
  )?.role;
};

/**
 * The roster — every champion this pack ships, as data. Moved verbatim out
 * of `src/game/config/spellCatalog.ts`'s `CHAMPION_KITS` (batch 4 task 7):
 * same 59 rows, same order, same ids, same tuning. Only the surrounding
 * scaffolding changed — this is real pack content now, not a table core
 * happened to still be holding for an adapter to read.
 */
const ROSTER: {
  name: string;
  // A plain string, not core's generated `AssetKey` union: batch 4 task 4
  // moved every champion portrait out of core's `assets/` and into this
  // pack's own `assets/` tree, so core's manifest no longer knows any
  // `'champ_*'` key.
  image: string | null;
  spells: RosterSpellId[];
  /**
   * A spell armed once per life rather than bound to a key — see
   * `ChampionEntry.passive`. Separate from `spells` because that array is the
   * kit's slot layout and a passive has no slot; `validate.ts` refuses an id
   * that appears in both.
   */
  passive?: PackSpellCatalogId;
  attack?: ChampionAttack;
  /** See `ChampionEntry.summonerShelf`'s own doc comment. Set on exactly one row, below. */
  summonerShelf?: boolean;
}[] = [
  // First, and a shelf of its own rather than a line on the summoner spell
  // shelf: it belongs to no champion and it is not a summoner spell, it is the
  // attack every champion already has. It is also the way back — a player who
  // swaps slot 0 out for something else and wants `A` to attack again needs to
  // find this, and hunting for it at the bottom of the Phép Bổ Trợ list would
  // make that a one-way door in practice.
  {
    name: 'Đánh Thường',
    image: 'spell_basic_attack',
    spells: ['BasicAttack'],
  },
  {
    name: 'Phép Bổ Trợ',
    image: null,
    spells: ['Flash', 'Ghost', 'Heal', 'Ignite', 'StealthWard'],
    summonerShelf: true,
  },
  {
    name: 'Yasuo',
    attack: ATTACK.BRUISER,
    image: 'champ_yasuo',

    spells: ['Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'],
  },
  {
    name: 'Shaco',
    attack: ATTACK.ASSASSIN,
    image: 'champ_shaco',

    spells: ['Shaco_Q', 'Shaco_W', 'Shaco_E', 'Shaco_R'],
  },
  {
    name: 'Aatrox',
    attack: ATTACK.BRUISER,
    image: 'champ_aatrox',

    spells: ['Aatrox_Q', 'Aatrox_W', 'Aatrox_E', 'Aatrox_R'],
  },
  {
    name: 'Akali',
    attack: ATTACK.ASSASSIN,
    image: 'champ_akali',

    spells: ['Akali_Q', 'Akali_W', 'Akali_E', 'Akali_R'],
  },
  {
    name: 'Braum',
    attack: ATTACK.TANK,
    image: 'champ_braum',

    spells: ['Braum_Q', 'Braum_W', 'Braum_E', 'Braum_R'],
  },
  {
    name: 'Draven',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1500 },
    image: 'champ_draven',

    spells: ['Draven_Q', 'Draven_W', 'Draven_E', 'Draven_R'],
  },
  {
    name: 'Fiora',
    attack: ATTACK.BRUISER,
    image: 'champ_fiora',

    spells: ['Fiora_Q', 'Fiora_W', 'Fiora_E', 'Fiora_R'],
  },
  {
    name: 'Jax',
    attack: ATTACK.BRUISER,
    image: 'champ_jax',

    spells: ['Jax_Q', 'Jax_W', 'Jax_E', 'Jax_R'],
  },
  {
    name: 'Lucian',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1800 },
    image: 'champ_lucian',

    spells: ['Lucian_Q', 'Lucian_W', 'Lucian_E', 'Lucian_R'],
  },
  {
    name: 'Miss Fortune',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1400 },
    image: 'champ_missfortune',

    spells: ['MissFortune_Q', 'MissFortune_W', 'MissFortune_E', 'MissFortune_R'],
  },
  {
    name: 'Mordekaiser',
    attack: ATTACK.BRUISER,
    image: 'champ_mordekaiser',

    spells: ['Mordekaiser_Q', 'Mordekaiser_W', 'Mordekaiser_E', 'Mordekaiser_R'],
  },
  {
    name: 'Xerath',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 1400 },
    image: 'champ_xerath',

    spells: ['Xerath_Q', 'Xerath_W', 'Xerath_E', 'Xerath_R'],
  },
  {
    name: 'Ahri',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 875 },
    image: 'champ_ahri',

    spells: ['Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R'],
  },
  {
    name: 'Lee Sin',
    attack: ATTACK.BRUISER,
    image: 'champ_leesin',

    spells: ['LeeSin_Q', 'LeeSin_W', 'LeeSin_E', 'LeeSin_R'],
  },
  {
    name: 'Blitzcrank',
    attack: ATTACK.TANK,
    image: 'champ_blitzcrank',

    spells: ['Blitzcrank_Q', 'Blitzcrank_W', 'Blitzcrank_E', 'Blitzcrank_R'],
  },
  {
    name: 'Lux',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 800 },
    image: 'champ_lux',

    spells: ['Lux_Q', 'Lux_W', 'Lux_E', 'Lux_R'],
  },
  {
    name: 'Ashe',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1250 },
    image: 'champ_ashe',

    spells: ['Ashe_Q', 'Ashe_W', 'Ashe_E', 'Ashe_R'],
  },
  {
    name: "Cho'Gath",
    attack: ATTACK.BRUISER,
    image: 'champ_chogath',

    spells: ['ChoGath_Q', 'ChoGath_W', 'ChoGath_E', 'ChoGath_R'],
  },
  {
    name: 'Leblanc',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 850 },
    image: 'champ_leblanc',

    spells: ['Leblanc_Q', 'Leblanc_W', 'Leblanc_E', 'Leblanc_R'],
  },
  {
    name: 'Malphite',
    attack: ATTACK.TANK,
    image: 'champ_malphite',

    spells: ['Malphite_Q', 'Malphite_W', 'Malphite_E', 'Malphite_R'],
  },
  {
    name: 'Olaf',
    attack: ATTACK.BRUISER,
    image: 'champ_olaf',

    spells: ['Olaf_Q', 'Olaf_W', 'Olaf_E', 'Olaf_R'],
  },
  {
    name: 'Teemo',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 750 },
    image: 'champ_teemo',

    spells: ['Teemo_Q', 'Teemo_W', 'Teemo_E', 'Teemo_R'],
  },
  {
    name: 'Veigar',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_veigar',

    spells: ['Veigar_Q', 'Veigar_W', 'Veigar_E', 'Veigar_R'],
  },
  {
    name: 'Zed',
    attack: ATTACK.ASSASSIN,
    image: 'champ_zed',

    spells: ['Zed_Q', 'Zed_W', 'Zed_E', 'Zed_R'],
  },
  {
    name: 'Graves',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1900 },
    image: 'champ_graves',

    spells: ['Graves_Q', 'Graves_W', 'Graves_E', 'Graves_R'],
  },
  {
    name: 'Anivia',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 800 },
    image: 'champ_anivia',

    spells: ['Anivia_Q', 'Anivia_W', 'Anivia_E', 'Anivia_R'],
  },
  {
    name: 'Varus',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1000 },
    image: 'champ_varus',

    spells: ['Varus_Q', 'Varus_W', 'Varus_E', 'Varus_R'],
  },
  {
    name: 'Pantheon',
    attack: ATTACK.BRUISER,
    image: 'champ_pantheon',

    spells: ['Pantheon_Q', 'Pantheon_W', 'Pantheon_E', 'Pantheon_R'],
  },
  {
    name: 'Thresh',
    // Role default: the wiki lists 0 — the source game applies his swing
    // instantly, which this engine's bolt cannot be, so the role's own lob
    // stands in.
    attack: ATTACK.SUPPORT,
    image: 'champ_thresh',

    spells: ['Thresh_Q', 'Thresh_W', 'Thresh_E', 'Thresh_R'],
  },
  {
    name: 'Rammus',
    attack: ATTACK.TANK,
    image: 'champ_rammus',

    spells: ['Rammus_Q', 'Rammus_W', 'Rammus_E', 'Rammus_R'],
  },
  {
    name: 'Morgana',
    attack: { ...ATTACK.SUPPORT, boltUnitsPerSecond: 800 },
    image: 'champ_morgana',

    spells: ['Morgana_Q', 'Morgana_W', 'Morgana_E', 'Morgana_R'],
  },
  {
    name: 'Janna',
    attack: { ...ATTACK.SUPPORT, boltUnitsPerSecond: 900 },
    image: 'champ_janna',

    spells: ['Janna_Q', 'Janna_W', 'Janna_E', 'Janna_R'],
  },
  {
    name: 'Alistar',
    attack: ATTACK.TANK,
    image: 'champ_alistar',

    spells: ['Alistar_Q', 'Alistar_W', 'Alistar_E', 'Alistar_R'],
  },
  {
    name: 'Nocturne',
    attack: ATTACK.ASSASSIN,
    image: 'champ_nocturne',

    spells: ['Nocturne_Q', 'Nocturne_W', 'Nocturne_E', 'Nocturne_R'],
  },
  {
    name: 'Twitch',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1250 },
    image: 'champ_twitch',

    spells: ['Twitch_Q', 'Twitch_W', 'Twitch_E', 'Twitch_R'],
  },
  {
    name: 'Amumu',
    attack: ATTACK.TANK,
    image: 'champ_amumu',

    // The first champion `passive` in this pack. It is a field of its own and
    // deliberately not a fifth entry in `spells` — that array is the kit's
    // slot layout, the thing a loadout editor rearranges, and a passive has
    // no key to press and no slot to be moved into. `validate.ts` refuses an
    // id that appears in both.
    passive: 'Amumu_P',
    spells: ['Amumu_Q', 'Amumu_W', 'Amumu_E', 'Amumu_R'],
  },
  {
    name: 'Vladimir',
    attack: ATTACK.MAGE,
    image: 'champ_vladimir',

    spells: ['Vladimir_Q', 'Vladimir_W', 'Vladimir_E', 'Vladimir_R'],
  },
  {
    name: 'Dr. Mundo',
    attack: ATTACK.BRUISER,
    image: 'champ_drmundo',

    spells: ['DrMundo_Q', 'DrMundo_W', 'DrMundo_E', 'DrMundo_R'],
  },
  {
    name: 'Trundle',
    attack: ATTACK.BRUISER,
    image: 'champ_trundle',

    spells: ['Trundle_Q', 'Trundle_W', 'Trundle_E', 'Trundle_R'],
  },
  {
    name: "Kog'Maw",
    // The longest reach on the roster, which is the whole champion: his own R
    // reaches 750 where the pack's skillshot band stops at 600.
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1000 },
    image: 'champ_kogmaw',

    spells: ['KogMaw_Q', 'KogMaw_W', 'KogMaw_E', 'KogMaw_R'],
  },
  {
    name: 'Warwick',
    attack: ATTACK.BRUISER,
    image: 'champ_warwick',

    spells: ['Warwick_Q', 'Warwick_W', 'Warwick_E', 'Warwick_R'],
  },
  {
    name: 'Singed',
    attack: ATTACK.BRUISER,
    image: 'champ_singed',

    spells: ['Singed_Q', 'Singed_W', 'Singed_E', 'Singed_R'],
  },
  {
    name: 'Cassiopeia',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_cassiopeia',

    spells: ['Cassiopeia_Q', 'Cassiopeia_W', 'Cassiopeia_E', 'Cassiopeia_R'],
  },
  {
    name: 'Fizz',
    attack: ATTACK.ASSASSIN,
    image: 'champ_fizz',

    spells: ['Fizz_Q', 'Fizz_W', 'Fizz_E', 'Fizz_R'],
  },
  {
    name: 'Annie',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_annie',

    spells: ['Annie_Q', 'Annie_W', 'Annie_E', 'Annie_R'],
  },
  {
    name: 'Garen',
    attack: ATTACK.BRUISER,
    image: 'champ_garen',

    spells: ['Garen_Q', 'Garen_W', 'Garen_E', 'Garen_R'],
  },
  {
    name: 'Jinx',
    // Role default: the wiki lists no missile speed for a gun that swaps
    // forms mid-fight (N/A) — see the ATTACK table's own comment.
    attack: ATTACK.MARKSMAN,
    image: 'champ_jinx',

    spells: ['Jinx_Q', 'Jinx_W', 'Jinx_E', 'Jinx_R'],
  },
  {
    name: 'Nasus',
    attack: ATTACK.BRUISER,
    image: 'champ_nasus',

    spells: ['Nasus_Q', 'Nasus_W', 'Nasus_E', 'Nasus_R'],
  },
  {
    name: 'Ekko',
    attack: ATTACK.ASSASSIN,
    image: 'champ_ekko',

    spells: ['Ekko_Q', 'Ekko_W', 'Ekko_E', 'Ekko_R'],
  },
  {
    name: 'Jarvan IV',
    attack: ATTACK.BRUISER,
    image: 'champ_jarvaniv',

    spells: ['JarvanIV_Q', 'JarvanIV_W', 'JarvanIV_E', 'JarvanIV_R'],
  },
  {
    name: 'Camille',
    attack: ATTACK.ASSASSIN,
    image: 'champ_camille',

    spells: ['Camille_Q', 'Camille_W', 'Camille_E', 'Camille_R'],
  },
  {
    name: 'Darius',
    attack: ATTACK.BRUISER,
    image: 'champ_darius',

    spells: ['Darius_Q', 'Darius_W', 'Darius_E', 'Darius_R'],
  },
  {
    name: 'Renekton',
    attack: ATTACK.BRUISER,
    image: 'champ_renekton',

    spells: ['Renekton_Q', 'Renekton_W', 'Renekton_E', 'Renekton_R'],
  },
  {
    name: 'Xin Zhao',
    attack: ATTACK.BRUISER,
    image: 'champ_xinzhao',

    spells: ['XinZhao_Q', 'XinZhao_W', 'XinZhao_E', 'XinZhao_R'],
  },
  {
    name: 'Tryndamere',
    attack: ATTACK.BRUISER,
    image: 'champ_tryndamere',

    spells: ['Tryndamere_Q', 'Tryndamere_W', 'Tryndamere_E', 'Tryndamere_R'],
  },
  {
    name: 'Master Yi',
    attack: ATTACK.ASSASSIN,
    image: 'champ_masteryi',

    spells: ['MasterYi_Q', 'MasterYi_W', 'MasterYi_E', 'MasterYi_R'],
  },
  {
    name: 'Malzahar',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 1000 },
    image: 'champ_malzahar',

    spells: ['Malzahar_Q', 'Malzahar_W', 'Malzahar_E', 'Malzahar_R'],
  },
  {
    name: 'Ezreal',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1000 },
    image: 'champ_ezreal',

    spells: ['Ezreal_Q', 'Ezreal_W', 'Ezreal_E', 'Ezreal_R'],
  },
  {
    name: 'Caitlyn',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1250 },
    image: 'champ_caitlyn',

    spells: ['Caitlyn_Q', 'Caitlyn_W', 'Caitlyn_E', 'Caitlyn_R'],
  },
  {
    name: 'Soraka',
    attack: { ...ATTACK.SUPPORT, boltUnitsPerSecond: 500 },
    image: 'champ_soraka',

    spells: ['Soraka_Q', 'Soraka_W', 'Soraka_E', 'Soraka_R'],
  },
  {
    name: 'Brand',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 1000 },
    image: 'champ_brand',

    spells: ['Brand_Q', 'Brand_W', 'Brand_E', 'Brand_R'],
  },
  {
    name: 'Katarina',
    attack: ATTACK.ASSASSIN,
    image: 'champ_katarina',

    spells: ['Katarina_Q', 'Katarina_W', 'Katarina_E', 'Katarina_R'],
  },
  {
    name: 'Vayne',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1000 },
    image: 'champ_vayne',

    spells: ['Vayne_Q', 'Vayne_W', 'Vayne_E', 'Vayne_R'],
  },
  {
    name: 'Riven',
    attack: ATTACK.BRUISER,
    image: 'champ_riven',

    spells: ['Riven_Q', 'Riven_W', 'Riven_E', 'Riven_R'],
  },
  {
    name: 'Sett',
    attack: ATTACK.BRUISER,
    image: 'champ_sett',

    spells: ['Sett_Q', 'Sett_W', 'Sett_E', 'Sett_R'],
  },
  {
    name: 'Jhin',
    attack: { ...ATTACK.MARKSMAN, boltUnitsPerSecond: 1300 },
    image: 'champ_jhin',

    spells: ['Jhin_Q', 'Jhin_W', 'Jhin_E', 'Jhin_R'],
  },
  {
    name: 'Nautilus',
    attack: ATTACK.TANK,
    image: 'champ_nautilus',

    spells: ['Nautilus_Q', 'Nautilus_W', 'Nautilus_E', 'Nautilus_R'],
  },
  {
    name: 'Diana',
    attack: ATTACK.ASSASSIN,
    image: 'champ_diana',

    spells: ['Diana_Q', 'Diana_W', 'Diana_E', 'Diana_R'],
  },
  {
    name: 'Vi',
    attack: ATTACK.BRUISER,
    image: 'champ_vi',

    spells: ['Vi_Q', 'Vi_W', 'Vi_E', 'Vi_R'],
  },
  {
    name: 'Syndra',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 900 },
    image: 'champ_syndra',

    spells: ['Syndra_Q', 'Syndra_W', 'Syndra_E', 'Syndra_R'],
  },
  {
    name: 'Ziggs',
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_ziggs',

    spells: ['Ziggs_Q', 'Ziggs_W', 'Ziggs_E', 'Ziggs_R'],
  },
  {
    name: 'Irelia',
    attack: ATTACK.BRUISER,
    image: 'champ_irelia',

    spells: ['Irelia_Q', 'Irelia_W', 'Irelia_E', 'Irelia_R'],
  },
  {
    name: 'Shen',
    // Melee, `rangetype: 'Melee'` and `range: 125` in his own imported record
    // (`docs/abilities/shen/champion.json`), `herotype: 'Tank'` — the archetype
    // reads straight off the record rather than off anyone's impression.
    attack: ATTACK.TANK,
    image: 'champ_shen',

    spells: ['Shen_Q', 'Shen_W', 'Shen_E', 'Shen_R'],
  },
  {
    name: 'Lissandra',
    // The wiki lists 2200; halved and rounded to 25 like every other override
    // on this table — see the ATTACK block's own comment.
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 1100 },
    image: 'champ_lissandra',

    spells: ['Lissandra_Q', 'Lissandra_W', 'Lissandra_E', 'Lissandra_R'],
  },
  {
    name: 'Pyke',
    // `rangetype: 'Melee'`, `range: 150`, `alttype: 'Assassin'`.
    attack: ATTACK.ASSASSIN,
    image: 'champ_pyke',

    spells: ['Pyke_Q', 'Pyke_W', 'Pyke_E', 'Pyke_R'],
  },
  {
    name: 'Orianna',
    // The wiki lists 1500, halved to 750.
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_orianna',

    spells: ['Orianna_Q', 'Orianna_W', 'Orianna_E', 'Orianna_R'],
  },
  {
    name: 'Twisted Fate',
    // `herotype: 'Mage'` with `alttype: 'Marksman'`, and MAGE is the honest
    // read of the half this kit ships: his damage is the cards, not the swing.
    // Missile speed 1500 on the wiki, halved to 750.
    attack: { ...ATTACK.MAGE, boltUnitsPerSecond: 750 },
    image: 'champ_twistedfate',

    spells: ['TwistedFate_Q', 'TwistedFate_W', 'TwistedFate_E', 'TwistedFate_R'],
  },
];

/**
 * Every champion this pack ships, as the registry's own `ChampionEntry`
 * shape. `id` is the champion's *name* (`'Yasuo'`, not a generated key) —
 * batch 2's own compatibility promise: a `PregameConfig.championName`
 * persisted before this pack existed already held that string, and
 * `preset.ts`'s `planLoadout` still looks a stored loadout up by name. This
 * pack changing shape must never change what that string resolves to.
 */
/**
 * **Where a champion sits inside its role.**
 *
 * Six role profiles gave sixty-nine champions six bodies, which is a roster
 * where Caitlyn out-ranges Vladimir by twenty-five pixels and Tryndamere is
 * exactly as tough as Riven. The source game's own numbers for all of them are
 * already in this repository — `npm run ability:import` has been pulling them
 * the whole time and nothing read them — so this is placement, not invention.
 *
 * ## Why it modulates the role instead of replacing it
 *
 * The obvious move is to copy the record's numbers onto the champion, and it
 * is measurably wrong. Across the 67 records here the source game's spread is
 * *narrower* than this pack's own: base health 1.27x against this roster's
 * 1.76x, magic resist 1.27x against 3.0x, move speed 1.09x. Their variety
 * lives in eighteen levels of per-level growth and in six-item builds, and
 * this game has neither — so importing the level-1 slice would make every
 * champion **more** alike, not less.
 *
 * What transfers is the *ordering*: which mage is the tanky one, which
 * marksman reaches furthest. So each stat is scaled by the champion's share of
 * its own role's mean, which leaves every role's mean exactly where the
 * designer put it and spreads the champions inside it.
 *
 * ## The clamp
 *
 * A record is upstream data this pack does not control; a re-import that
 * changed a number by an order of magnitude would otherwise silently ship a
 * champion with a 900-pixel reach. The band is wide enough that no current
 * record comes near it, which is the point — it is a rail, not a tuning knob.
 *
 * ## What is deliberately *not* placed
 *
 * `boltUnitsPerSecond` — a third of the roster overrides it by hand with the
 * wiki's own missile speeds at half scale, and that is per-champion tuning
 * somebody already did. And `speed`: the source game spreads move speed 1.09x
 * across the whole roster, so placing it would be arithmetic that changes
 * nothing a player could feel.
 */
const PLACEMENT_CLAMP = { min: 0.75, max: 1.3 } as const;

/**
 * The line core draws between a swing and a bolt, restated.
 *
 * `combat/BasicAttack.ts`'s `MELEE_RANGE_THRESHOLD` is 140: at or under it an
 * attack is a swing, over it core delivers a *projectile* and reads
 * `boltUnitsPerSecond` for its flight. So this is not a matter of taste — a
 * melee champion placed at 153 stops being melee, and fires a missile with no
 * speed. `attackProfiles.test.ts` caught precisely that on the first run of
 * this placement, with Garen, Darius, Trundle and Yasuo over the line.
 *
 * Restated rather than imported because this is the data half of the pack: it
 * must stay reachable from a menu screen without dragging the match into that
 * chunk (`itemStats.ts` in core makes the same argument about itself). The
 * copy is two below the real threshold so a rounding step cannot land on it,
 * and `attackProfiles.test.ts` is what stops the two drifting apart.
 */
const MELEE_RANGE_CEILING = 138;

/**
 * How a roster row finds its record, tolerating case and punctuation drift.
 *
 * Exported because a test has to ask the same question — "does this champion
 * have a record?" — and asking it a second way is how `Leblanc` here and
 * `LeBlanc` in the wiki data quietly become two champions, one of them placed
 * and one of them not.
 */
export const recordKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '');

const RECORD_BY_NAME = new Map(
  Object.entries(championRecordStats).map(([name, stats]) => [recordKey(name), stats] as const)
);

const recordFor = (name: string): ChampionRecordStats | undefined =>
  RECORD_BY_NAME.get(recordKey(name));

/** Every role's mean of one record field, over the champions actually in that role. */
const roleMeans = (): Map<Role, ChampionRecordStats> => {
  const totals = new Map<Role, { sum: ChampionRecordStats; count: number }>();
  for (const kit of ROSTER) {
    const role = kit.attack ? roleOfAttack(kit.attack) : undefined;
    const record = recordFor(kit.name);
    if (!role || !record) continue;
    const entry = totals.get(role) ?? {
      sum: { hp: 0, armor: 0, magicResist: 0, damage: 0, attackSpeed: 0, range: 0 },
      count: 0,
    };
    for (const key of Object.keys(entry.sum) as (keyof ChampionRecordStats)[]) {
      entry.sum[key] += record[key];
    }
    entry.count += 1;
    totals.set(role, entry);
  }

  const means = new Map<Role, ChampionRecordStats>();
  for (const [role, { sum, count }] of totals) {
    const mean = { ...sum };
    for (const key of Object.keys(mean) as (keyof ChampionRecordStats)[]) mean[key] = sum[key] / count;
    means.set(role, mean);
  }
  return means;
};

const MEANS = roleMeans();

/** This champion's share of its role's mean on one axis, railed. */
const share = (record: ChampionRecordStats, mean: ChampionRecordStats, key: keyof ChampionRecordStats): number => {
  const reference = mean[key];
  if (!Number.isFinite(reference) || reference <= 0) return 1;
  const ratio = record[key] / reference;
  return Math.min(PLACEMENT_CLAMP.max, Math.max(PLACEMENT_CLAMP.min, ratio));
};

/**
 * The role's attack profile, moved to where this champion sits inside it.
 *
 * Everything the row itself set is kept — a hand-tuned `boltUnitsPerSecond`
 * survives — and only the three fields a role *is* are placed. Those three are
 * also what `roleOfAttack` matches on, so this must never be written back into
 * `ROSTER`: the role has to be read off the untouched profile first, or every
 * champion becomes bodiless. `roleProfiles.test.ts` caught exactly that once.
 */
export const placedAttack = (name: string, role: Role | undefined, attack: ChampionAttack): ChampionAttack => {
  const record = role ? recordFor(name) : undefined;
  const mean = role ? MEANS.get(role) : undefined;
  if (!record || !mean) return attack;
  // A melee role stays melee. The source game's own melee reach spans 125 to
  // 175, which is wider than the gap this engine leaves between a swing and a
  // bolt, so the longest-reaching bruisers pile up at the ceiling rather than
  // crossing it. Ties there are the honest outcome: past that line they would
  // not be the same champion.
  const placedRange = Math.round(attack.range * share(record, mean, 'range'));
  const melee = attack.range <= MELEE_RANGE_CEILING;

  return {
    ...attack,
    damage: Math.round(attack.damage * share(record, mean, 'damage')),
    attacksPerSecond: Math.round(attack.attacksPerSecond * share(record, mean, 'attackSpeed') * 100) / 100,
    range: melee ? Math.min(placedRange, MELEE_RANGE_CEILING) : placedRange,
  };
};

/** The role's durability profile, moved the same way. */
export const placedDefence = (name: string, role: Role): ChampionDefence => {
  const base = DEFENCE[role];
  const record = recordFor(name);
  const mean = MEANS.get(role);
  if (!record || !mean) return base;
  return {
    ...base,
    health: Math.round(base.health * share(record, mean, 'hp')),
    armor: Math.round(base.armor * share(record, mean, 'armor')),
    magicResist: Math.round(base.magicResist * share(record, mean, 'magicResist')),
  };
};


const championEntries = (): ChampionEntry[] => {
  const out: ChampionEntry[] = [];
  for (const kit of ROSTER) {
    // `champ_` was the old test for "a real champion rather than a shelf of
    // loose abilities"; it is a declared field here and never read as a
    // naming convention again.
    const playable =
      Boolean(kit.image?.startsWith('champ_')) && kit.spells.length === 4 && Boolean(kit.attack);
    // Derived from the very object `attack` points at, so the two halves of a
    // role cannot drift apart on a row — see `ROLE_OF_ATTACK`.
    const role = kit.attack ? roleOfAttack(kit.attack) : undefined;
    out.push({
      id: kit.name,
      name: kit.name,
      image: kit.image,
      playable,
      attack: kit.attack ? placedAttack(kit.name, role, kit.attack) : kit.attack,
      ...(role ? { defence: placedDefence(kit.name, role) } : {}),
      spells: [...kit.spells],
      ...(kit.passive ? { passive: kit.passive } : {}),
      recall: 'Recall',
      summonerShelf: kit.summonerShelf,
    });
  }
  return out;
};

/**
 * This pack's role taxonomy, published for the loadout screen.
 *
 * A player who assembles a kit by hand — Q from one champion, R from another —
 * has no champion to inherit a body from, and core cannot invent one: it does
 * not know what a "tank" is and deliberately never will, because a taxonomy is
 * the roster's vocabulary and not the engine's (see `ATTACK`'s own note on why
 * that table moved out of core). So the pack hands the picker its six roles as
 * data, exactly the way it hands over its champions and its items, and core
 * stores nothing but whichever id came back.
 *
 * Order matters and is the order above: front line first is not how a picker
 * should read, so it runs marksman to tank, squishy to solid.
 */
const archetypeEntries = () =>
  (Object.keys(ATTACK) as Role[]).map(role => ({
    id: role.toLowerCase(),
    name: ROLE_NAME[role],
    attack: ATTACK[role],
    defence: DEFENCE[role],
  }));

/**
 * Every spell's display fields, as plain data — this pack's own generated
 * catalogue, reshaped into the registry's `SpellDisplayData`. Core's own
 * `BasicAttack` entry is *not* folded in here: a pack file may not import
 * `@/generated/spellCatalog` (the `pack-core-boundary` seam), so
 * `src/content/install.ts` folds it on afterward, onto the `data` this
 * module exports — see that file's own header for why the merge belongs to
 * core rather than to this pack.
 *
 * **The four `Item_*` spells are deliberately left out.** This is the
 * population a `'random'` loadout slot is drawn from and a persisted slot is
 * validated against — `PackRegistry.spellDisplayIds`, read by
 * `spellRegistry.ts`'s `allSpellIds`/`isSpellId` — so without this skip
 * "Đồng Hồ Cát Zhonya's active" could be dealt as somebody's Q, on a champion
 * who does not own the item, with a ninety-second cooldown and no way to see
 * where it came from. They still belong to the *code* half (`code.ts`'s
 * `spells`, built from `generated/spellModules.ts`), which is what makes
 * `ItemDef.passive`/`ItemDef.active` resolvable at all; core's own
 * `lol:Recall` is the existing precedent for "loadable but not displayed", and
 * `PackRegistry.spellDisplay`'s own doc comment says a declared spell with no
 * display entry is a shape rather than a defect.
 *
 * Matched on the `Item_` prefix rather than a hand-kept list of four, because
 * the failure mode of the list is a fifth item spell added a year from now
 * that nobody remembers to add to it. `tests/items.test.ts` scans this
 * module's output for the leak either way.
 */
const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries(spellCatalog)) {
    if (id.startsWith('Item_')) continue;
    out[id] = {
      name: entry.name,
      description: entry.description,
      iconKey: entry.iconKey,
      coolDownMs: entry.coolDownMs,
      manaCost: entry.manaCost,
      specCoolDownMs: entry.specCoolDownMs,
    };
  }
  return out;
};

/**
 * The shop, as this pack declares it — six components and eight finished
 * items, keyed by local id exactly the way `ItemDef.id` requires.
 *
 * **None of these numbers is Riot's, and they are not meant to be.** A
 * champion in this engine has a 100-point health pool, 14 attack damage and 3
 * movement speed; a player starts on 500 gold, earns 2 a second, 20 a minion
 * and 200 a kill, so a ten-minute match is 3000–4000 gold and a full build is
 * three finished items, not six. Every value below is sized to that economy.
 * The only thing taken from Riot is the artwork and the Vietnamese name — see
 * `scripts/import-items.mjs` and `docs/items-source-manifest.json`, which
 * record every icon's source URL and hash.
 *
 * `stats` keys are core's `ITEM_STAT_KEYS` allow-list and nothing else;
 * `validate.ts` refuses the whole pack over a key that is not on it. Two of
 * them mean something a reader is likely to guess wrong, so they are worth
 * stating once here rather than in six descriptions: `attackSpeed` is a
 * **share of the wearer's own base rate**, so `attackSpeed: 0.3` is +30% —
 * worth more swings to Vayne on 1.65 than to Sona on 0.7, which is the point
 * of granting it that way; and `healthRegen` is applied per frame
 * (`Stats.update`, base 0.06), so `healthRegen: 0.25` is roughly four times
 * the regeneration a champion has for free.
 *
 * Movement speed comes in both flavours, as it does in the source game.
 * `speed: 0.45` is flat, on a base of 3, and belongs to boots. `speedPercent:
 * 0.05` multiplies the total *after* the boots, and belongs to the items a
 * player buys fourth — Tam Hợp Kiếm and Giáp Người Chết here, both 5% on the
 * wiki. Writing the flat one where the percent belongs is not an error
 * anywhere: it is an item that quietly stops scaling with the build.
 *
 * **A component with no passive and no active is legal and is the point.**
 * `ItemDef`'s own doc comment says so: a pack that could not express an inert
 * component could not express a build path, and a build path is what makes the
 * cheap rows above worth selling at all.
 *
 * ## The recipes
 *
 * `buildsFrom` names components by local id, and `cost` stays the **total** —
 * what the item is worth from an empty bag. What a player pays when the parts
 * are already held is `cost` minus what those parts cost, worked out by core's
 * `ItemShop.priceFor`, so no combine cost is written down anywhere and none
 * can drift from the price beside it.
 *
 * Two rules core cannot check, both enforced by `tests/items.test.ts`:
 *
 *   - **A finished item is never a downgrade on anything its parts grant.**
 *     Combining swaps the parts' stats for the finished item's, so granting
 *     less of something the parts granted charges gold to get worse. Zhonya's
 *     is why the rule is written down: it grants 30 armour and two Giáp Lụa
 *     grant 36, so the obvious two-component recipe would have cost 800 gold
 *     to lose six armour. It builds from one instead, and its combine cost
 *     carries the rest — the item is bought for the active, not the stats.
 *   - **Every component builds into something.** A component nothing uses is a
 *     stat stick a player buys once and can never upgrade, and the shop gives
 *     them no way to find that out before they spend.
 *
 * The shapes are deliberately varied — one part, two, two of the same, three
 * of the same — because the shop panel draws recipes and the engine matches
 * duplicate parts against separate held copies, and neither is exercised by a
 * catalogue where every recipe looks the same.
 */
const itemEntries = (): Record<string, ItemDef> => ({
  // ---- Components ------------------------------------------------------
  long_sword: {
    id: 'long_sword',
    name: 'Kiếm Dài',
    icon: 'item_long_sword',
    cost: 350,
    stats: { attackDamage: 6 },
  },
  cloth_armor: {
    id: 'cloth_armor',
    name: 'Giáp Lụa',
    icon: 'item_cloth_armor',
    cost: 300,
    description: 'Giảm khoảng <span class="buff">15%</span> sát thương vật lý nhận vào.',
    stats: { armor: 18 },
  },
  null_magic_mantle: {
    id: 'null_magic_mantle',
    name: 'Áo Vải',
    icon: 'item_null_magic_mantle',
    cost: 400,
    description: 'Giảm khoảng <span class="buff">18%</span> sát thương phép nhận vào.',
    stats: { magicResist: 22 },
  },
  ruby_crystal: {
    id: 'ruby_crystal',
    name: 'Hồng Ngọc',
    icon: 'item_ruby_crystal',
    cost: 400,
    stats: { maxHealth: 25 },
  },
  boots: {
    id: 'boots',
    name: 'Giày',
    icon: 'item_boots',
    cost: 300,
    stats: { speed: 0.35 },
  },
  recurve_bow: {
    id: 'recurve_bow',
    name: 'Cung Gỗ',
    icon: 'item_recurve_bow',
    cost: 550,
    // `onHitDamage` is flat **physical** damage folded into the swing before
    // the crit multiplier (`combat/BasicAttack.ts`), which is exactly what
    // Recurve Bow grants in the source game — and until now no item in this
    // shop granted the stat at all, so a stat core had modelled since the
    // beginning was reachable by nothing. Every item built out of this one
    // carries at least as much, or combining would charge gold to lose it.
    stats: { attackSpeed: 0.15, onHitDamage: 1 },
  },
  zeal: {
    id: 'zeal',
    name: 'Cuồng Cung',
    icon: 'item_zeal',
    cost: 700,
    // The crit shelf had no component: Statikk and Runaan both built straight
    // out of bows, so nothing in the shop sold a *little* crit and the first
    // point of it cost 1400 gold. Zeal is that rung, and it is also where the
    // `speedPercent` on those two comes from — the Zeal line is the movement
    // line in the source game.
    stats: { attackSpeed: 0.12, critChance: 0.12, speedPercent: 0.05 },
  },
  sheen: {
    id: 'sheen',
    name: 'Thủy Kiếm',
    icon: 'item_sheen',
    cost: 450,
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm <span class="buff">50%</span> công cơ bản.',
    stats: { maxMana: 15 },
    passive: 'Item_Sheen',
  },
  tiamat: {
    id: 'tiamat',
    name: 'Rìu Tiamat',
    icon: 'item_tiamat',
    cost: 550,
    description:
      'Nội tại: đòn đánh gây thêm <span class="buff">40%</span> công lên các kẻ địch khác quanh mục tiêu.',
    stats: { attackDamage: 6 },
    passive: 'Item_Tiamat',
  },

  // ---- Finished items --------------------------------------------------
  berserkers_greaves: {
    id: 'berserkers_greaves',
    name: 'Giày Cuồng Nộ',
    icon: 'item_berserkers_greaves',
    cost: 950,
    buildsFrom: ['boots', 'recurve_bow'],
    stats: { speed: 0.45, attackSpeed: 0.18, onHitDamage: 1 },
  },
  warmogs_armor: {
    id: 'warmogs_armor',
    name: 'Giáp Máu Warmog',
    icon: 'item_warmogs_armor',
    cost: 1200,
    buildsFrom: ['ruby_crystal', 'ruby_crystal'],
    // `healthRegen` is applied per *frame* by `Stats.update`, not per second —
    // base is 0.06, which is 3.6 health a second at 60fps. 0.25 was ~15/s on a
    // 100-health pool, which outheals most of the abilities in this pack.
    description: 'Hồi máu nhanh <span class="buff">gần gấp đôi</span> mức cơ bản.',
    stats: { maxHealth: 70, healthRegen: 0.05 },
  },
  thornmail: {
    id: 'thornmail',
    name: 'Giáp Gai',
    icon: 'item_thornmail',
    cost: 1100,
    // Áo Choàng Gai + Giáp Lụa, since the wound shelf arrived: the old recipe
    // was two Giáp Lụa, and a tank who bought the wound component then had
    // nowhere to put it. `Item_Thornmail` arms the component's wound as well
    // as the spikes, so combining loses nothing.
    buildsFrom: ['bramble_vest', 'cloth_armor'],
    description:
      'Nội tại: phản <span class="buff">25%</span> sát thương nhận vào về kẻ đã gây ra nó, và đặt ' +
      'Vết Thương Sâu <span class="buff">40%</span> lên chúng trong <span class="time">3 giây</span>.',
    stats: { armor: 45 },
    passive: 'Item_Thornmail',
  },
  infinity_edge: {
    id: 'infinity_edge',
    name: 'Vô Cực Kiếm',
    icon: 'item_infinity_edge',
    cost: 1600,
    buildsFrom: ['long_sword', 'long_sword', 'long_sword'],
    stats: { attackDamage: 18, critChance: 0.25, critDamage: 0.2 },
  },
  // The name and the icon are Data Dragon item 3140, whose Vietnamese name is
  // 'Khăn Giải Thuật' — Quicksilver Sash. The local id says Mercurial Scimitar
  // (which is item 3139, 'Đao Thủy Ngân'). The three were specified together
  // and are shipped as specified; anyone correcting one of them has to correct
  // all three, or the row goes from inconsistent to broken.
  quicksilver_sash: {
    id: 'quicksilver_sash',
    name: 'Khăn Giải Thuật',
    icon: 'item_quicksilver_sash',
    cost: 1200,
    buildsFrom: ['null_magic_mantle', 'long_sword'],
    description: 'Kích hoạt: gỡ bỏ mọi hiệu ứng khống chế đang chịu.',
    stats: { magicResist: 40, attackDamage: 6, tenacity: 0.2 },
    active: 'Item_Quicksilver',
  },
  blade_of_the_ruined_king: {
    id: 'blade_of_the_ruined_king',
    name: 'Gươm Suy Vong',
    icon: 'item_blade_of_the_ruined_king',
    cost: 1500,
    buildsFrom: ['recurve_bow', 'long_sword'],
    description: 'Nội tại: đòn đánh gây thêm <span class="buff">5%</span> máu hiện tại của mục tiêu.',
    stats: { attackDamage: 10, attackSpeed: 0.15, omnivamp: 0.1, onHitDamage: 2 },
    passive: 'Item_RuinedKing',
  },
  zhonyas_hourglass: {
    id: 'zhonyas_hourglass',
    name: 'Đồng Hồ Cát Zhonya',
    icon: 'item_zhonyas_hourglass',
    cost: 1500,
    buildsFrom: ['cloth_armor'],
    description:
      'Kích hoạt: đóng băng bản thân <span class="time">2.5 giây</span>, không thể bị nhắm và không nhận sát thương.',
    stats: { armor: 30, abilityPower: 1.5 },
    active: 'Item_Zhonyas',
  },
  youmuus_ghostblade: {
    id: 'youmuus_ghostblade',
    name: 'Kiếm Ma Youmuu',
    icon: 'item_youmuus_ghostblade',
    cost: 1200,
    buildsFrom: ['long_sword', 'long_sword'],
    description:
      'Kích hoạt: tăng <span class="buff">40%</span> tốc chạy trong <span class="time">5 giây</span>.',
    stats: { attackDamage: 12 },
    active: 'Item_Ghostblade',
  },

  // ---- The on-hit shelf ------------------------------------------------
  // Every passive below rides core 1.5's `Buff.onHit` pipeline (see
  // `manifest.coreRange`); each spell file carries its own numbers as
  // exported constants, and the description here repeats them because the
  // shop prints this line, not the spell's.
  guinsoos_rageblade: {
    id: 'guinsoos_rageblade',
    name: 'Cuồng Đao Guinsoo',
    icon: 'item_guinsoos_rageblade',
    cost: 1550,
    buildsFrom: ['recurve_bow', 'long_sword'],
    description:
      'Nội tại: mỗi đòn đánh tăng thêm tốc đánh, cộng dồn <span class="buff">6</span> lần; khi tích đủ, ' +
      'mỗi đòn thứ <span class="buff">3</span> kích hoạt các hiệu ứng đòn đánh <span class="buff">2</span> lần.',
    stats: { attackDamage: 8, attackSpeed: 0.21, onHitDamage: 2 },
    passive: 'Item_Guinsoo',
  },
  wits_end: {
    id: 'wits_end',
    name: 'Đao Tím',
    icon: 'item_wits_end',
    cost: 1500,
    buildsFrom: ['recurve_bow', 'null_magic_mantle'],
    description:
      'Nội tại: đòn đánh gây thêm sát thương phép bằng <span class="damage magic" data-flat="none">18% công</span> và tăng tốc chạy trong chốc lát.',
    stats: { attackSpeed: 0.18, magicResist: 26, abilityPower: 1, onHitDamage: 1 },
    passive: 'Item_WitsEnd',
  },
  kraken_slayer: {
    id: 'kraken_slayer',
    name: 'Móc Diệt Thủy Quái',
    icon: 'item_kraken_slayer',
    cost: 1650,
    buildsFrom: ['recurve_bow', 'long_sword', 'long_sword'],
    description:
      'Nội tại: mỗi đòn thứ <span class="buff">3</span> liên tiếp lên cùng một mục tiêu gây thêm ' +
      'sát thương vật lý bằng <span class="damage physical" data-flat="none">50% công</span>.',
    stats: { attackDamage: 14, attackSpeed: 0.18, onHitDamage: 3 },
    passive: 'Item_Kraken',
  },
  nashors_tooth: {
    id: 'nashors_tooth',
    name: 'Nanh Nashor',
    icon: 'item_nashors_tooth',
    cost: 1500,
    buildsFrom: ['recurve_bow'],
    description:
      'Nội tại: đòn đánh gây thêm sát thương phép bằng <span class="damage magic" data-flat="none">55% công cơ bản</span>.',
    stats: { attackSpeed: 0.24, abilityPower: 1.4, onHitDamage: 1 },
    passive: 'Item_Nashor',
  },
  trinity_force: {
    id: 'trinity_force',
    name: 'Tam Hợp Kiếm',
    icon: 'item_trinity_force',
    cost: 1800,
    buildsFrom: ['sheen', 'long_sword', 'recurve_bow'],
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm <span class="buff">100%</span> công cơ bản.',
    stats: { attackDamage: 10, attackSpeed: 0.18, maxMana: 20, speedPercent: 0.05, onHitDamage: 2 },
    passive: 'Item_TrinityForce',
  },
  divine_sunderer: {
    id: 'divine_sunderer',
    name: 'Búa Rìu Sát Thần',
    icon: 'item_divine_sunderer',
    cost: 1500,
    buildsFrom: ['sheen', 'ruby_crystal'],
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm <span class="buff">6%</span> máu tối đa của ' +
      'mục tiêu và hồi lại <span class="buff">65%</span> lượng đó.',
    stats: { maxHealth: 35, maxMana: 15, attackDamage: 8 },
    passive: 'Item_DivineSunderer',
  },
  essence_reaver: {
    id: 'essence_reaver',
    name: 'Lưỡi Hái Linh Hồn',
    icon: 'item_essence_reaver',
    cost: 1500,
    buildsFrom: ['sheen', 'long_sword'],
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm <span class="buff">70%</span> công cơ bản và ' +
      'hồi <span class="buff">15%</span> năng lượng tối đa.',
    stats: { attackDamage: 12, maxMana: 25, critChance: 0.15 },
    passive: 'Item_EssenceReaver',
  },
  lich_bane: {
    id: 'lich_bane',
    name: 'Kiếm Tai Ương',
    icon: 'item_lich_bane',
    cost: 1500,
    buildsFrom: ['sheen', 'boots'],
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm ' +
      '<span class="damage magic" data-flat="none">150% công cơ bản</span> dưới dạng sát thương phép.',
    stats: { speed: 0.4, maxMana: 20, abilityPower: 1.6 },
    passive: 'Item_LichBane',
  },
  ravenous_hydra: {
    id: 'ravenous_hydra',
    name: 'Rìu Mãng Xà',
    icon: 'item_ravenous_hydra',
    cost: 1400,
    buildsFrom: ['tiamat', 'long_sword'],
    description:
      'Nội tại: đòn đánh gây thêm <span class="buff">60%</span> công lên các kẻ địch khác quanh mục tiêu.',
    stats: { attackDamage: 14, omnivamp: 0.1 },
    passive: 'Item_RavenousHydra',
  },
  titanic_hydra: {
    id: 'titanic_hydra',
    name: 'Rìu Đại Mãng Xà',
    icon: 'item_titanic_hydra',
    cost: 1500,
    buildsFrom: ['tiamat', 'ruby_crystal'],
    description:
      'Nội tại: đòn đánh gây thêm <span class="buff">3</span> cộng <span class="buff">3%</span> máu tối đa của bạn lên các kẻ địch ' +
      'khác quanh mục tiêu.',
    stats: { attackDamage: 8, maxHealth: 40 },
    passive: 'Item_TitanicHydra',
  },
  runaans_hurricane: {
    id: 'runaans_hurricane',
    name: 'Cuồng Cung Runaan',
    icon: 'item_runaans_hurricane',
    cost: 1650,
    buildsFrom: ['zeal', 'recurve_bow'],
    description:
      'Nội tại (đánh xa): mỗi đòn đánh bắn thêm <span class="buff">2</span> tia phụ vào các kẻ địch ' +
      'đứng cạnh mục tiêu, gây <span class="buff">45%</span> công và áp dụng hiệu ứng đòn đánh của bạn.',
    stats: { attackSpeed: 0.33, critChance: 0.12, speedPercent: 0.05, onHitDamage: 2 },
    passive: 'Item_Runaan',
  },
  dusk_and_dawn: {
    id: 'dusk_and_dawn',
    name: 'Bình Minh & Hoàng Hôn',
    icon: 'item_dusk_and_dawn',
    cost: 1700,
    buildsFrom: ['ruby_crystal', 'ruby_crystal'],
    description:
      'Nội tại: các hiệu ứng đòn đánh của bạn kích hoạt <span class="buff">2</span> lần mỗi đòn đánh.',
    stats: { maxHealth: 60, attackDamage: 6 },
    passive: 'Item_DuskAndDawn',
  },

  // ---- Meters and team buttons -----------------------------------------
  // Two shapes this shop did not have. A **meter** charges off something the
  // player is doing anyway (swinging, walking) and spends the whole of it on
  // one swing — different from the spellblade family's window and from Móc
  // Diệt Thủy Quái's count of three, because the player can watch it fill and
  // decide when to cash it. A **team button** is an active that does something
  // for somebody else: every active shipped before these three fires at
  // whoever pressed it and cannot miss.
  statikk_shiv: {
    id: 'statikk_shiv',
    name: 'Móc Sét Statikk',
    icon: 'item_statikk_shiv',
    cost: 1550,
    buildsFrom: ['zeal', 'long_sword'],
    description:
      'Nội tại: mỗi đòn đánh tích điện; khi tích đầy, đòn kế tiếp phóng tia sét gây sát thương phép ' +
      'bằng <span class="damage magic" data-flat="none">70% công</span> lên mục tiêu và lan sang <span class="buff">3</span> kẻ địch gần đó.',
    stats: { attackDamage: 10, attackSpeed: 0.18, critChance: 0.15, speedPercent: 0.05 },
    passive: 'Item_StatikkShiv',
  },
  dead_mans_plate: {
    id: 'dead_mans_plate',
    name: 'Giáp Người Chết',
    icon: 'item_dead_mans_plate',
    cost: 1200,
    buildsFrom: ['cloth_armor', 'ruby_crystal'],
    description:
      'Nội tại: di chuyển tích lực, tối đa tăng thêm <span class="buff">30%</span> tốc chạy; đòn đánh kế tiếp ' +
      'xả toàn bộ lực, gây tới <span class="damage physical" data-flat="none">8 + 5% máu tối đa</span> ' +
      'sát thương vật lý và làm chậm <span class="buff">50%</span> khi tích đầy.',
    stats: { armor: 30, maxHealth: 50, speedPercent: 0.05 },
    passive: 'Item_DeadMansPlate',
  },
  locket_of_the_iron_solari: {
    id: 'locket_of_the_iron_solari',
    name: 'Vòng Sắt Mặt Trời',
    icon: 'item_locket_of_the_iron_solari',
    cost: 1450,
    buildsFrom: ['cloth_armor', 'null_magic_mantle'],
    description:
      'Kích hoạt: tạo khiên bằng <span class="buff">18% máu tối đa</span> cho bản thân và các đồng minh ' +
      'xung quanh trong <span class="time">2.5 giây</span>.',
    stats: { armor: 25, magicResist: 32, maxHealth: 40 },
    active: 'Item_Locket',
  },
  shurelyas_battlesong: {
    id: 'shurelyas_battlesong',
    name: 'Khúc Ca Shurelya',
    icon: 'item_shurelyas_battlesong',
    cost: 1500,
    buildsFrom: ['boots', 'ruby_crystal'],
    description:
      'Kích hoạt: tăng <span class="buff">35%</span> tốc chạy cho bản thân và các đồng minh xung quanh trong <span class="time">3 giây</span>.',
    stats: {
      speed: 0.45,
      maxHealth: 25,
      maxMana: 20,
      abilityPower: 0.8,
      abilityHaste: 20,
    },
    active: 'Item_Shurelya',
  },
  mikaels_blessing: {
    id: 'mikaels_blessing',
    name: 'Ơn Phước Mikael',
    icon: 'item_mikaels_blessing',
    cost: 1400,
    buildsFrom: ['null_magic_mantle'],
    description:
      'Kích hoạt: gỡ một hiệu ứng <span class="buff">khống chế</span> khỏi đồng minh và hồi ' +
      '<span class="heal" data-flat="none">15% máu tối đa</span>; trong <span class="time">3 giây</span> sau đó, mọi hiệu ứng ' +
      'hồi máu lên đồng minh đó <span class="buff">mạnh hơn 35%</span>.',
    stats: { magicResist: 30, abilityHaste: 15 },
    active: 'Item_Mikael',
  },
  everfrost: {
    id: 'everfrost',
    name: 'Vĩnh Sương',
    icon: 'item_everfrost',
    cost: 1600,
    buildsFrom: ['ruby_crystal', 'null_magic_mantle'],
    description:
      'Kích hoạt: bắn ra một luồng băng gây <span class="damage magic" data-flat="none">30 sát thương phép</span> và trói <span class="time">1.2 giây</span> mọi kẻ địch trúng đòn.',
    stats: {
      maxHealth: 35,
      magicResist: 25,
      maxMana: 25,
      abilityPower: 1.4,
      abilityHaste: 15,
    },
    active: 'Item_Everfrost',
  },

  // ---- Sustain, and the counter to it ----------------------------------
  // Two shelves that only make sense together. Core carries three vamp stats
  // split by damage *type* (`combat/Vamp.ts`) — `lifesteal` out of physical
  // and true, `spellVamp` out of magic, `omnivamp` out of all three — and
  // until now this shop sold only the third, on two items, as a garnish. A
  // player who wanted to build sustain could not, and a player being outlived
  // by one who had could do nothing about it.
  //
  // So: one component per vamp stat, and a wound that answers all of them.
  // `HealCut` (core 1.13) cuts every heal *and* health regeneration, which is
  // what makes 650 gold of Áo Choàng Gai a real answer to Giáp Máu Warmog and
  // to a jungler healing between camps — see `Item_GrievousStrike.ts` for why
  // three items share one passive and why the split is by damage type.
  vampiric_scepter: {
    id: 'vampiric_scepter',
    name: 'Huyết Trượng',
    icon: 'item_vampiric_scepter',
    cost: 550,
    stats: { attackDamage: 5, lifesteal: 0.1 },
  },
  bloodthirster: {
    id: 'bloodthirster',
    name: 'Huyết Kiếm',
    icon: 'item_bloodthirster',
    cost: 1450,
    buildsFrom: ['vampiric_scepter', 'long_sword'],
    stats: { attackDamage: 18, lifesteal: 0.2 },
  },
  deaths_dance: {
    id: 'deaths_dance',
    name: 'Vũ Điệu Tử Thần',
    icon: 'item_deaths_dance',
    cost: 1400,
    buildsFrom: ['long_sword', 'cloth_armor'],
    stats: { attackDamage: 14, armor: 25, omnivamp: 0.08 },
  },
  amplifying_tome: {
    id: 'amplifying_tome',
    name: 'Sách Cũ',
    icon: 'item_amplifying_tome',
    cost: 400,
    // The shop's first ability-power *component*. Every mage item above builds
    // out of Thủy Kiếm, Giày or a resistance, which priced the whole branch
    // like a splash of something else.
    stats: { abilityPower: 0.5 },
  },
  hextech_alternator: {
    id: 'hextech_alternator',
    name: 'Máy Chuyển Pha Hextech',
    icon: 'item_hextech_alternator',
    cost: 900,
    buildsFrom: ['amplifying_tome', 'amplifying_tome'],
    stats: { abilityPower: 1, maxMana: 15 },
  },
  riftmaker: {
    id: 'riftmaker',
    name: 'Quyền Trượng Ác Thần',
    icon: 'item_riftmaker',
    cost: 1550,
    buildsFrom: ['amplifying_tome', 'ruby_crystal'],
    stats: { abilityPower: 1.2, maxHealth: 45, spellVamp: 0.15 },
  },
  abyssal_mask: {
    id: 'abyssal_mask',
    name: 'Mặt Nạ Vực Thẳm',
    icon: 'item_abyssal_mask',
    cost: 1400,
    buildsFrom: ['null_magic_mantle', 'ruby_crystal'],
    stats: { maxHealth: 45, magicResist: 28, abilityPower: 0.6 },
  },
  executioners_calling: {
    id: 'executioners_calling',
    name: 'Gươm Đồ Tể',
    icon: 'item_executioners_calling',
    cost: 600,
    description:
      'Nội tại: sát thương vật lý bạn gây ra đặt Vết Thương Sâu, giảm <span class="buff">40%</span> ' +
      'mọi hiệu ứng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    stats: { attackDamage: 8 },
    passive: 'Item_GrievousStrike',
  },
  mortal_reminder: {
    id: 'mortal_reminder',
    name: 'Lời Nhắc Tử Vong',
    icon: 'item_mortal_reminder',
    cost: 1450,
    buildsFrom: ['executioners_calling', 'long_sword'],
    description:
      'Nội tại: sát thương vật lý bạn gây ra đặt Vết Thương Sâu, giảm <span class="buff">40%</span> ' +
      'mọi hiệu ứng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    stats: { attackDamage: 20, critChance: 0.15 },
    passive: 'Item_GrievousStrike',
  },
  chempunk_chainsword: {
    id: 'chempunk_chainsword',
    name: 'Cưa Xích Hóa Kỹ',
    icon: 'item_chempunk_chainsword',
    cost: 1450,
    buildsFrom: ['executioners_calling', 'ruby_crystal'],
    description:
      'Nội tại: sát thương vật lý bạn gây ra đặt Vết Thương Sâu, giảm <span class="buff">40%</span> ' +
      'mọi hiệu ứng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    stats: { attackDamage: 14, maxHealth: 45 },
    passive: 'Item_GrievousStrike',
  },
  bramble_vest: {
    id: 'bramble_vest',
    name: 'Áo Choàng Gai',
    icon: 'item_bramble_vest',
    cost: 650,
    description:
      'Nội tại: kẻ đánh trúng bạn dính Vết Thương Sâu, giảm <span class="buff">40%</span> mọi hiệu ứng ' +
      'hồi máu của chúng trong <span class="time">3 giây</span>.',
    stats: { armor: 20 },
    passive: 'Item_BrambleVest',
  },
  oblivion_orb: {
    id: 'oblivion_orb',
    name: 'Ngọc Quên Lãng',
    icon: 'item_oblivion_orb',
    cost: 700,
    description:
      'Nội tại: sát thương phép bạn gây ra đặt Vết Thương Sâu, giảm <span class="buff">40%</span> ' +
      'mọi hiệu ứng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    stats: { abilityPower: 0.6 },
    passive: 'Item_GrievousMagic',
  },
  morellonomicon: {
    id: 'morellonomicon',
    name: 'Quỷ Thư Morello',
    icon: 'item_morellonomicon',
    cost: 1500,
    buildsFrom: ['oblivion_orb', 'ruby_crystal'],
    description:
      'Nội tại: sát thương phép bạn gây ra đặt Vết Thương Sâu, giảm <span class="buff">40%</span> ' +
      'mọi hiệu ứng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    stats: { abilityPower: 1.1, maxHealth: 45 },
    passive: 'Item_GrievousMagic',
  },

  // ---- Xuyên kháng, kháng hiệu ứng, và cái mũ ---------------------------
  // Core 1.14's four new stats, and the items that are the reason to have
  // them. The shape is the wound shelf's again: this shop sold 45 armour on
  // one item and 40 magic resist on another with nothing that could get
  // through either, so stacking a resistance had no counter-play but to stop
  // fighting. `armorPenetration`/`magicPenetration` are **shares**, not
  // points — a flat "ignores 18 armour" means everything against Giáp Lụa and
  // nothing against the next pack's tuning.
  //
  // `tenacity` is the same idea one axis over (crowd control instead of
  // damage) and `healingReceived` is the mirror of Vết Thương Sâu: a sustain build
  // that can be shut off by one 600-gold component and has nothing to answer
  // with is not a build, it is a trap.
  last_whisper: {
    id: 'last_whisper',
    name: 'Cung Xanh',
    icon: 'item_last_whisper',
    cost: 700,
    description:
      'Nội tại: sát thương vật lý bỏ qua <span class="buff">15%</span> giáp của mục tiêu.',
    stats: { attackDamage: 8, armorPenetration: 0.15 },
  },
  lord_dominiks_regards: {
    id: 'lord_dominiks_regards',
    name: 'Nỏ Thần Dominik',
    icon: 'item_lord_dominiks_regards',
    cost: 1500,
    buildsFrom: ['last_whisper', 'long_sword'],
    description:
      'Nội tại: sát thương vật lý bỏ qua <span class="buff">35%</span> giáp của mục tiêu.',
    stats: { attackDamage: 16, armorPenetration: 0.35 },
  },
  blighting_jewel: {
    id: 'blighting_jewel',
    name: 'Đá Hắc Hóa',
    icon: 'item_blighting_jewel',
    cost: 650,
    description:
      'Nội tại: sát thương phép bỏ qua <span class="buff">18%</span> kháng phép của mục tiêu.',
    stats: { abilityPower: 0.5, magicPenetration: 0.18 },
  },
  void_staff: {
    id: 'void_staff',
    name: 'Trượng Hư Vô',
    icon: 'item_void_staff',
    cost: 1550,
    buildsFrom: ['blighting_jewel', 'amplifying_tome'],
    description:
      'Nội tại: sát thương phép bỏ qua <span class="buff">35%</span> kháng phép của mục tiêu.',
    stats: { abilityPower: 1.2, magicPenetration: 0.35 },
  },
  plated_steelcaps: {
    id: 'plated_steelcaps',
    name: 'Giày Thép Gai',
    icon: 'item_plated_steelcaps',
    cost: 900,
    buildsFrom: ['boots', 'cloth_armor'],
    stats: { speed: 0.45, armor: 30 },
  },
  mercurys_treads: {
    id: 'mercurys_treads',
    name: 'Giày Thủy Ngân',
    icon: 'item_mercurys_treads',
    cost: 1000,
    buildsFrom: ['boots', 'null_magic_mantle'],
    description:
      'Nội tại: rút ngắn <span class="buff">25%</span> thời gian các hiệu ứng khống chế ' +
      '(choáng, trói, câm lặng…) mà kẻ địch gây ra. Không tính hất tung và làm chậm.',
    stats: { speed: 0.45, magicResist: 25, tenacity: 0.25 },
  },
  sorcerers_shoes: {
    id: 'sorcerers_shoes',
    name: 'Giày Pháp Sư',
    icon: 'item_sorcerers_shoes',
    cost: 900,
    buildsFrom: ['boots'],
    // The boot shelf shipped four of the source game's five and was missing
    // exactly the mage's. Riot's version grants *flat* magic penetration, which
    // this engine deliberately does not model (`docs/STATS_VS_LEAGUE.md`: a
    // resistance is answered by a share, never by points), so it is the share
    // instead — and a share is the honest version of the same idea on a
    // resistance scale this short.
    stats: { speed: 0.45, magicPenetration: 0.18 },
  },
  ionian_boots_of_lucidity: {
    id: 'ionian_boots_of_lucidity',
    name: 'Giày Khai Sáng Ionia',
    icon: 'item_ionian_boots_of_lucidity',
    cost: 900,
    buildsFrom: ['boots'],
    stats: { speed: 0.45, abilityHaste: 25 },
  },
  rabadons_deathcap: {
    id: 'rabadons_deathcap',
    name: 'Mũ Phù Thủy Rabadon',
    icon: 'item_rabadons_deathcap',
    cost: 1700,
    buildsFrom: ['amplifying_tome', 'amplifying_tome'],
    description:
      'Nội tại: tăng thêm <span class="buff">25%</span> tổng sức mạnh phép của bạn — tính cả phần ' +
      'các món khác đang cộng.',
    stats: { abilityPower: 1.5 },
    passive: 'Item_Rabadon',
  },
  steraks_gage: {
    id: 'steraks_gage',
    name: 'Móng Vuốt Sterak',
    icon: 'item_steraks_gage',
    cost: 1500,
    buildsFrom: ['ruby_crystal', 'long_sword'],
    description:
      'Nội tại: khi máu rơi xuống dưới <span class="buff">35%</span>, nhận lá chắn bằng ' +
      '<span class="buff">30%</span> máu tối đa trong <span class="time">4 giây</span>; ' +
      'hồi lại sau <span class="time">45 giây</span>.',
    stats: { maxHealth: 55, attackDamage: 8 },
    passive: 'Item_Steraks',
  },
  spirit_visage: {
    id: 'spirit_visage',
    name: 'Giáp Tâm Linh',
    icon: 'item_spirit_visage',
    cost: 1600,
    buildsFrom: ['null_magic_mantle', 'ruby_crystal'],
    stats: { maxHealth: 45, magicResist: 28, healthRegen: 0.04, healingReceived: 0.2 },
  },
  serpents_fang: {
    id: 'serpents_fang',
    name: 'Kiếm Ác Xà',
    icon: 'item_serpents_fang',
    cost: 1300,
    buildsFrom: ['long_sword', 'long_sword'],
    description:
      'Nội tại: sát thương vật lý bạn gây ra làm Rạn Khiên — lá chắn mục tiêu nhận được trong ' +
      '<span class="time">3 giây</span> sau đó chỉ còn <span class="buff">50%</span> giá trị. ' +
      'Không ảnh hưởng lá chắn đang có sẵn.',
    stats: { attackDamage: 16, armorPenetration: 0.12 },
    passive: 'Item_SerpentsFang',
  },
  frozen_heart: {
    id: 'frozen_heart',
    name: 'Tim Băng',
    icon: 'item_frozen_heart',
    cost: 1500,
    buildsFrom: ['cloth_armor', 'cloth_armor'],
    description:
      'Nội tại: kẻ địch đứng gần bị giảm <span class="buff">20%</span> tốc đánh.',
    stats: { armor: 45, maxMana: 25, abilityHaste: 15 },
    passive: 'Item_FrozenHeart',
  },

  // ---- The tank shelf --------------------------------------------------
  // 2026-09-05, and the reason is one sentence of feedback: the shop sold
  // Rabadon, Kiếm Tai Ương and Vĩnh Sương, and nothing a front line could
  // hold them off with. Đồ kháng phép first — that was the complaint — then
  // giáp/máu, then the two bruiser answers (Chùy Gai, Chùy Bạch Ngân) so an
  // AD champion also has somewhere to put gold against a mage.
  //
  // Four new components so the shelf has rungs: Giáp Lưới and Áo Choàng Bạc
  // are Giáp Lụa/Áo Vải one size up, Đai Khổng Lồ is Hồng Ngọc's, and Áo
  // Choàng Ám Ảnh is the health-plus-kháng-phép rung the whole magic-resist
  // branch climbs through. Every number is this economy's (100-point pool,
  // three-item build), priced against the rows above: ~17đ vàng một điểm
  // giáp, ~18-19 một điểm kháng phép, ~16 một điểm máu.
  chain_vest: {
    id: 'chain_vest',
    name: 'Giáp Lưới',
    icon: 'item_chain_vest',
    cost: 700,
    description: 'Giảm khoảng <span class="buff">29%</span> sát thương vật lý nhận vào.',
    stats: { armor: 40 },
  },
  negatron_cloak: {
    id: 'negatron_cloak',
    name: 'Áo Choàng Bạc',
    icon: 'item_negatron_cloak',
    cost: 750,
    description: 'Giảm khoảng <span class="buff">29%</span> sát thương phép nhận vào.',
    stats: { magicResist: 40 },
  },
  giants_belt: {
    id: 'giants_belt',
    name: 'Đai Khổng Lồ',
    icon: 'item_giants_belt',
    cost: 700,
    stats: { maxHealth: 45 },
  },
  spectres_cowl: {
    id: 'spectres_cowl',
    name: 'Áo Choàng Ám Ảnh',
    icon: 'item_spectres_cowl',
    cost: 850,
    stats: { maxHealth: 30, magicResist: 25, healthRegen: 0.02 },
  },
  force_of_nature: {
    id: 'force_of_nature',
    name: 'Giáp Thiên Nhiên',
    icon: 'item_force_of_nature',
    cost: 1750,
    buildsFrom: ['negatron_cloak', 'giants_belt'],
    description:
      'Nội tại: trúng sát thương phép cho <span class="buff">1</span> điểm cộng dồn trong ' +
      '<span class="time">6 giây</span> (tối đa <span class="buff">5</span>): mỗi điểm ' +
      '<span class="buff">+4%</span> kháng phép và <span class="buff">+2%</span> tốc chạy.',
    stats: { maxHealth: 55, magicResist: 45, speedPercent: 0.05 },
    passive: 'Item_ForceOfNature',
  },
  kaenic_rookern: {
    id: 'kaenic_rookern',
    name: 'Vòng Sắt Cổ Tự',
    icon: 'item_kaenic_rookern',
    cost: 1600,
    buildsFrom: ['spectres_cowl', 'ruby_crystal'],
    description:
      'Nội tại: sau <span class="time">8 giây</span> không nhận sát thương, nhận lá chắn phép bằng ' +
      '<span class="buff">20%</span> máu tối đa — chỉ chặn sát thương phép, giữ đến khi vỡ.',
    stats: { maxHealth: 60, magicResist: 30, healthRegen: 0.03 },
    passive: 'Item_KaenicRookern',
  },
  banshees_veil: {
    id: 'banshees_veil',
    name: 'Dây Chuyền Chữ Thập',
    icon: 'item_banshees_veil',
    cost: 1500,
    buildsFrom: ['negatron_cloak', 'amplifying_tome'],
    description:
      'Nội tại: chặn hoàn toàn một lần sát thương phép; hồi lại sau <span class="time">12 giây</span>.',
    stats: { magicResist: 40, abilityPower: 1 },
    passive: 'Item_Banshee',
  },
  gargoyle_stoneplate: {
    id: 'gargoyle_stoneplate',
    name: 'Thú Tượng Thạch Giáp',
    icon: 'item_gargoyle_stoneplate',
    cost: 1750,
    buildsFrom: ['chain_vest', 'negatron_cloak'],
    description:
      'Kích hoạt: hoá đá — tăng <span class="buff">25%</span> giáp và kháng phép ' +
      'trong <span class="time">4 giây</span>.',
    stats: { armor: 40, magicResist: 40 },
    active: 'Item_Gargoyle',
  },
  hollow_radiance: {
    id: 'hollow_radiance',
    name: 'Áo Choàng Hắc Quang',
    icon: 'item_hollow_radiance',
    cost: 1450,
    buildsFrom: ['null_magic_mantle', 'giants_belt'],
    description:
      'Nội tại: thiêu đốt kẻ địch đứng gần, gây ' +
      '<span class="damage magic" data-flat="none">1 + 0.4% máu tối đa của bản thân</span> ' +
      'sát thương phép mỗi giây.',
    stats: { maxHealth: 50, magicResist: 28 },
    passive: 'Item_Immolate',
  },
  randuins_omen: {
    id: 'randuins_omen',
    name: 'Khiên Băng Randuin',
    icon: 'item_randuins_omen',
    cost: 1700,
    buildsFrom: ['chain_vest', 'giants_belt'],
    description:
      'Kích hoạt: toả khí lạnh làm chậm <span class="buff">35%</span> các tướng địch xung quanh ' +
      'trong <span class="time">2 giây</span>.',
    stats: { armor: 45, maxHealth: 55 },
    active: 'Item_Randuin',
  },
  sunfire_aegis: {
    id: 'sunfire_aegis',
    name: 'Khiên Thái Dương',
    icon: 'item_sunfire_aegis',
    cost: 1500,
    buildsFrom: ['chain_vest', 'ruby_crystal'],
    description:
      'Nội tại: thiêu đốt kẻ địch đứng gần, gây ' +
      '<span class="damage magic" data-flat="none">1 + 0.4% máu tối đa của bản thân</span> ' +
      'sát thương phép mỗi giây.',
    stats: { armor: 42, maxHealth: 40 },
    passive: 'Item_Immolate',
  },
  heartsteel: {
    id: 'heartsteel',
    name: 'Trái Tim Khổng Thần',
    icon: 'item_heartsteel',
    cost: 1500,
    buildsFrom: ['giants_belt', 'ruby_crystal'],
    description:
      'Nội tại: mỗi <span class="time">10 giây</span>, đòn đánh kế tiếp lên tướng địch gây thêm ' +
      '<span class="damage physical" data-flat="none">2 + 1% máu tối đa</span> sát thương vật lý và tăng vĩnh viễn ' +
      '<span class="buff">3</span> máu tối đa — cộng dồn vô hạn, giữ qua cái chết, chỉ mất khi bán.',
    stats: { maxHealth: 75 },
    passive: 'Item_Heartsteel',
  },
  iceborn_gauntlet: {
    id: 'iceborn_gauntlet',
    name: 'Găng Tay Băng Giá',
    icon: 'item_iceborn_gauntlet',
    cost: 1550,
    buildsFrom: ['sheen', 'chain_vest'],
    description:
      'Nội tại: sau khi dùng chiêu, đòn đánh kế tiếp gây thêm <span class="buff">50%</span> công cơ bản ' +
      'và làm chậm <span class="buff">25%</span> các kẻ địch quanh mục tiêu trong <span class="time">1.5 giây</span>.',
    stats: { armor: 42, maxMana: 20 },
    passive: 'Item_Iceborn',
  },
  maw_of_malmortius: {
    id: 'maw_of_malmortius',
    name: 'Chùy Gai Malmortius',
    icon: 'item_maw_of_malmortius',
    cost: 1500,
    buildsFrom: ['long_sword', 'negatron_cloak'],
    description:
      'Nội tại: khi sát thương phép đưa máu xuống dưới <span class="buff">35%</span>, nhận lá chắn phép ' +
      'bằng <span class="buff">12% máu tối đa</span> trong <span class="time">4 giây</span>; hồi lại sau <span class="time">30 giây</span>.',
    stats: { attackDamage: 12, magicResist: 40 },
    passive: 'Item_Maw',
  },
  silvermere_dawn: {
    id: 'silvermere_dawn',
    name: 'Chùy Bạch Ngân',
    icon: 'item_silvermere_dawn',
    cost: 1850,
    buildsFrom: ['quicksilver_sash', 'long_sword'],
    description: 'Kích hoạt: gỡ bỏ mọi hiệu ứng khống chế đang chịu.',
    stats: { attackDamage: 14, magicResist: 45, tenacity: 0.3 },
    active: 'Item_Quicksilver',
  },
  redemption: {
    id: 'redemption',
    name: 'Dây Chuyền Chuộc Tội',
    icon: 'item_redemption',
    cost: 1400,
    buildsFrom: ['spectres_cowl'],
    description:
      'Kích hoạt: hồi <span class="heal" data-flat="none">12% máu tối đa</span> cho bản thân và các đồng minh xung quanh.',
    stats: { maxHealth: 40, magicResist: 28, healthRegen: 0.03 },
    active: 'Item_Redemption',
  },

  // ---- The bruiser & support shelf (2026-09-05) ------------------------
  //
  // What was left after the tank wall went up: the shop sold the mage, the
  // marksman and the wall, and nothing for the fighter standing between them
  // (công + máu in one item) or the enchanter standing behind (buttons whose
  // beneficiary is somebody else). Three components and fifteen finished
  // rows. Deliberately absent: more ability power (the complaint this week
  // was the surplus), more penetration (Nỏ Thần Dominik's 35% stays the
  // ceiling so the new wall keeps meaning something), and Lời Thề Hiệp Sĩ /
  // Dạ Kiếm-style redirects — `modifyIncomingDamage` is not told the source
  // spell, so neither can be built honestly yet.
  phage: {
    id: 'phage',
    name: 'Búa Gỗ',
    icon: 'item_phage',
    cost: 700,
    stats: { attackDamage: 5, maxHealth: 25 },
  },
  caulfields_warhammer: {
    id: 'caulfields_warhammer',
    name: 'Búa Chiến Caulfield',
    icon: 'item_caulfields_warhammer',
    cost: 650,
    // The first attack-damage component that also sells haste — before it,
    // an AD kit that wanted cooldowns had to walk to the boots shelf.
    stats: { attackDamage: 7, abilityHaste: 10 },
  },
  kindlegem: {
    id: 'kindlegem',
    name: 'Hỏa Ngọc',
    icon: 'item_kindlegem',
    cost: 600,
    // The support shelf's own rung: every enchanter row below builds out of
    // this one, the way the tank shelf builds out of Giáp Lưới.
    stats: { maxHealth: 25, abilityHaste: 10 },
  },
  black_cleaver: {
    id: 'black_cleaver',
    name: 'Rìu Đen',
    icon: 'item_black_cleaver',
    cost: 1700,
    buildsFrom: ['phage', 'caulfields_warhammer'],
    description:
      'Nội tại: đòn đánh lên tướng địch phá <span class="buff">5%</span> giáp trong ' +
      '<span class="time">4 giây</span> (cộng dồn <span class="buff">3</span> lần).',
    stats: { attackDamage: 12, maxHealth: 45, abilityHaste: 10 },
    passive: 'Item_BlackCleaver',
  },
  sundered_sky: {
    id: 'sundered_sky',
    name: 'Giáo Thiên Ly',
    icon: 'item_sundered_sky',
    cost: 1500,
    buildsFrom: ['caulfields_warhammer', 'ruby_crystal'],
    description:
      'Nội tại: đòn đánh đầu tiên lên mỗi tướng địch gây thêm <span class="buff">50%</span> công ' +
      'cơ bản và hồi <span class="heal" data-flat="none">2.5% máu tối đa</span> ' +
      '(mỗi mục tiêu <span class="time">8 giây</span> một lần).',
    stats: { attackDamage: 10, maxHealth: 40, abilityHaste: 10 },
    passive: 'Item_SunderedSky',
  },
  spear_of_shojin: {
    id: 'spear_of_shojin',
    name: 'Ngọn Giáo Shojin',
    icon: 'item_spear_of_shojin',
    cost: 1650,
    buildsFrom: ['caulfields_warhammer', 'long_sword'],
    // The bruiser's stat stick — no passive, like Huyết Kiếm: the biggest
    // haste number an attack-damage build can hold is the whole purchase.
    stats: { attackDamage: 14, maxHealth: 30, abilityHaste: 20 },
  },
  stridebreaker: {
    id: 'stridebreaker',
    name: 'Chùy Phản Kích',
    icon: 'item_stridebreaker',
    cost: 1700,
    buildsFrom: ['tiamat', 'phage'],
    description:
      'Nội tại: đòn đánh gây thêm <span class="buff">40%</span> công lên các kẻ địch khác quanh ' +
      'mục tiêu. Kích hoạt: gây sát thương vật lý bằng <span class="damage physical" data-flat="none">' +
      '30% công</span> và làm chậm <span class="buff">30%</span> tướng địch xung quanh trong ' +
      '<span class="time">2.5 giây</span>; bản thân tăng <span class="buff">20%</span> tốc chạy ' +
      'trong chốc lát.',
    // Rìu Tiamat's own cleave rides along — the hydra rule (a finished item
    // never drops the component's mechanic), stated as data: the passive slot
    // re-sells the component's spell exactly the way Khiên Thái Dương
    // re-sells Thiêu Đốt.
    stats: { attackDamage: 12, maxHealth: 40, attackSpeed: 0.1 },
    passive: 'Item_Tiamat',
    active: 'Item_Stridebreaker',
  },
  hullbreaker: {
    id: 'hullbreaker',
    name: 'Búa Tiến Công',
    icon: 'item_hullbreaker',
    cost: 1500,
    buildsFrom: ['phage', 'ruby_crystal'],
    description:
      'Nội tại: khi không có đồng minh nào đứng gần, tăng <span class="buff">25%</span> giáp ' +
      'và kháng phép.',
    stats: { attackDamage: 10, maxHealth: 60, healthRegen: 0.03 },
    passive: 'Item_Hullbreaker',
  },
  phantom_dancer: {
    id: 'phantom_dancer',
    name: 'Ma Vũ Song Kiếm',
    icon: 'item_phantom_dancer',
    cost: 1600,
    buildsFrom: ['zeal', 'zeal'],
    // Two of the same part, like Giáp Máu Warmog — the crit line's pure
    // stat rung, priced level with its parts plus the combine.
    stats: { attackSpeed: 0.25, critChance: 0.24, speedPercent: 0.1 },
  },
  the_collector: {
    id: 'the_collector',
    name: 'Súng Hải Tặc',
    icon: 'item_the_collector',
    cost: 1600,
    buildsFrom: ['long_sword', 'long_sword'],
    description:
      'Nội tại: sát thương bạn gây ra kết liễu tướng địch còn dưới ' +
      '<span class="buff">5%</span> máu tối đa.',
    stats: { attackDamage: 12, critChance: 0.15 },
    passive: 'Item_Collector',
  },
  rapid_firecannon: {
    id: 'rapid_firecannon',
    name: 'Đại Bác Liên Thanh',
    icon: 'item_rapid_firecannon',
    cost: 1650,
    buildsFrom: ['zeal', 'recurve_bow'],
    description:
      'Nội tại: mỗi <span class="time">10 giây</span>, đòn đánh kế tiếp có thêm ' +
      '<span class="buff">90</span> tầm đánh và gây thêm sát thương phép bằng ' +
      '<span class="damage magic" data-flat="none">18% công</span>.',
    stats: { attackSpeed: 0.28, critChance: 0.12, speedPercent: 0.05, onHitDamage: 1 },
    passive: 'Item_Firecannon',
  },
  immortal_shieldbow: {
    id: 'immortal_shieldbow',
    name: 'Nỏ Tử Thủ',
    icon: 'item_immortal_shieldbow',
    cost: 1600,
    buildsFrom: ['vampiric_scepter', 'long_sword'],
    description:
      'Nội tại: khi máu rơi xuống dưới <span class="buff">30%</span>, nhận lá chắn bằng ' +
      '<span class="heal" data-flat="none">14% máu tối đa</span> trong <span class="time">3 giây</span> ' +
      '(hồi lại sau <span class="time">40 giây</span>).',
    stats: { attackDamage: 12, lifesteal: 0.12, critChance: 0.15 },
    passive: 'Item_Shieldbow',
  },
  navori_flickerblade: {
    id: 'navori_flickerblade',
    name: 'Đao Chớp Navori',
    icon: 'item_navori_flickerblade',
    cost: 1500,
    buildsFrom: ['recurve_bow', 'recurve_bow'],
    description:
      'Nội tại: mỗi đòn đánh giảm <span class="time">0.3 giây</span> hồi chiêu cho các chiêu ' +
      'thức đang hồi.',
    stats: { attackSpeed: 0.32, onHitDamage: 2 },
    passive: 'Item_Navori',
  },
  ardent_censer: {
    id: 'ardent_censer',
    name: 'Lư Hương Sôi Sục',
    icon: 'item_ardent_censer',
    cost: 1500,
    buildsFrom: ['kindlegem', 'null_magic_mantle'],
    description:
      'Kích hoạt: bản thân và đồng minh xung quanh tăng <span class="buff">25%</span> tốc đánh ' +
      'và đòn đánh gây thêm <span class="damage physical" data-flat="none">2 sát thương vật ' +
      'lý</span> trong <span class="time">5 giây</span>.',
    stats: { maxHealth: 30, magicResist: 25, abilityHaste: 15 },
    active: 'Item_Ardent',
  },
  moonstone_renewer: {
    id: 'moonstone_renewer',
    name: 'Bùa Nguyệt Thạch',
    icon: 'item_moonstone_renewer',
    cost: 1450,
    buildsFrom: ['kindlegem', 'ruby_crystal'],
    description:
      'Nội tại: mỗi <span class="time">5 giây</span>, hồi ' +
      '<span class="heal" data-flat="none">3% máu tối đa</span> cho đồng minh bị thương nặng nhất đứng ' +
      'gần — không bao giờ cho bản thân.',
    stats: { maxHealth: 55, abilityHaste: 10, healthRegen: 0.02 },
    passive: 'Item_Moonstone',
  },
  zekes_convergence: {
    id: 'zekes_convergence',
    name: 'Tụ Bão Zeke',
    icon: 'item_zekes_convergence',
    cost: 1400,
    buildsFrom: ['kindlegem', 'cloth_armor'],
    description:
      'Kích hoạt: trong <span class="time">4 giây</span>, làm chậm ' +
      '<span class="buff">30%</span> các tướng địch đứng gần bạn.',
    stats: { armor: 25, maxHealth: 30, abilityHaste: 10 },
    active: 'Item_Zeke',
  },
  watchful_wardstone: {
    id: 'watchful_wardstone',
    name: 'Đá Tỏa Sáng - Cảnh Giác',
    icon: 'item_watchful_wardstone',
    cost: 1400,
    buildsFrom: ['kindlegem'],
    // One part with the rest as combine, like Đồng Hồ Cát Zhonya — bought
    // for the stat no other row sells: `visionRadius` is a share of fog
    // pushed back (base sight is 500), the first and only item to grant it.
    stats: { maxHealth: 40, abilityHaste: 15, visionRadius: 90 },
  },
  guardian_angel: {
    id: 'guardian_angel',
    name: 'Giáp Thiên Thần',
    icon: 'item_guardian_angel',
    cost: 1700,
    buildsFrom: ['chain_vest', 'long_sword'],
    description:
      'Nội tại: đòn lẽ ra kết liễu bạn để lại <span class="buff">1</span> máu thay vì giết ' +
      '(hồi lại sau <span class="time">50 giây</span>).',
    stats: { attackDamage: 10, armor: 40 },
    passive: 'Item_GuardianAngel',
  },
});

/**
 * The jungle, as monster identities — six of them, matching Task 7's split:
 * the epic camp, the two buff camps, wolves, gromp, raptors. Where each one
 * stands is `maps/summonersRift_map.json`'s `slots.neutral`
 * (moved there from core's own `mapPresets.ts` by batch 4 task 6), read
 * through that same module's `slots.neutral`; a `role` here and a `role`
 * there is the only thing tying a camp's identity to its place, and
 * `PackRegistry.monstersFilling` is the match.
 *
 * No `CHAMPION_KITS`/`spellCatalog` reads, so — unlike `champions`/`spellDisplay`
 * above — this needs no getter to dodge the module's own load-order cycle;
 * it is safe to build once, eagerly.
 *
 * **A camp is a composition, not N copies of one body.** `wolves.members`
 * and `raptors.members` are a Greater Wolf/Crimson Raptor plus its smaller
 * pack-mates, each with its own avatar, size and health — every number below
 * is copied from the pre-Task-7 `MonsterPreset` table (`git show
 * f2092e4:src/game/mapPresets.ts`), not retuned. `offset` is that same
 * source's per-body `camp: {x, y}` minus its group's anchor position
 * (`wolf1`'s own camp for the wolves offsets, `raptor1`'s for the raptors) —
 * see `tests/game/preset.mapSlots.test.ts`'s "recovers the original preset
 * entries" test, which checks `slot + offset === original camp` against that
 * same historical table.
 *
 * `wolves` and `raptors` each fill **two** neutral slots (Summoner's Rift
 * has a wolf pit and a raptor pit on both sides), but there is only one
 * `MonsterDef` of each — its `members`/`offset` layout is reused at both
 * slots. That is a real, disclosed loss of fidelity: the original data
 * placed the second pit's small bodies at slightly different offsets from
 * its own anchor than the first pit's. It is not a loss of *tuning* — the
 * second pit's bodies had byte-identical avatar/speed/size/attackRange/
 * reviveTime/health to the first's in the original table (verified, not
 * assumed) — only of the incidental few-dozen-pixel arrangement within the
 * pit, which one shared `MonsterDef` cannot carry two different versions of.
 */
const monsterEntries = (): Record<string, MonsterDef> => ({
  baron: {
    id: 'baron',
    name: 'Baron',
    fills: ['baron'],
    tier: 'epic',
    members: [
      {
        name: 'Baron',
        avatar: 'monster_Baron_Nashor',
        speed: 0,
        size: 100,
        attackRange: 400,
        // Three minutes. Baron pays a two-minute team-wide blessing
        // (`monsters/JungleBuffs.ts`'s `BARON_BUFF`), so a three-second
        // respawn meant the pit was simply a permanent aura for whichever
        // team could stand in it — the objective has to be *gone* for long
        // enough that holding the buff is worth playing around.
        reviveTime: 180_000,
        health: 1000,
        // Rooted with a long reach. The bite is small because it is the one
        // part of the fight nobody can dodge — the rest of Baron's kit lives
        // in `packs/riot/monsters/Baron.ts`'s `makeBaronAbilities` (wired in
        // `./code.ts`, this pack's code half, and merged onto the preset by
        // `preset.ts`'s `monsterBodyPreset`, which this data-only definition
        // cannot carry) and is all avoidable.
        damage: 12,
        attackInterval: 2000,
        aggroRange: 480,
        // Reach 400, so core derives `ranged` on its own; the colour is all
        // this body has to say. Purple to match the blessing it pays.
        attackColor: [196, 132, 255],
        offset: { x: 0, y: 0 },
      },
    ],
  },
  /**
   * Rồng nguyên tố. Rooted like Baron and, like Baron, worth a team-wide
   * blessing — but the blessing **replaces** rather than stacks, and the
   * respawn is read against its duration. Both numbers, and why they are a
   * pair, are in `monsters/Dragon.ts`.
   */
  dragon: {
    id: 'dragon',
    name: 'Dragon',
    fills: ['dragon'],
    tier: 'epic',
    members: [
      {
        name: 'Rồng Nguyên Tố',
        // The first drake of the rotation, and only ever what stands here for
        // one frame: `monsters/Dragon.ts`'s `onSpawn` writes the name, the
        // art, the swing style, its colour and its rate for whichever of the
        // seven is actually up. A `MonsterBody` is one row and cannot describe
        // seven creatures, so the row describes the one that spawns first.
        avatar: 'monster_Infernal_Drake',
        // The one boss in this pack with legs. Baron and Vilemaw are scenery
        // with a long reach; a dragon that cannot take a step is not, and it
        // is the objective a match is meant to rotate around every minute.
        //
        // 2 is what every other single-bodied camp walks at, and a champion
        // walks at 3 — so it genuinely follows and is genuinely kiteable, and
        // with 320 of reach it does not need to catch anyone to keep
        // breathing on them. Paired with `anchored` below, which is what
        // stops legs also meaning hookable.
        speed: 2,
        size: 88,
        attackRange: 320,
        // A minute, not Baron's three: this game's pace, and the ceiling the
        // pack's newer objectives all observe.
        reviveTime: 60_000,
        health: 700,
        // A boss's whole fight, because this camp has no kit: `code.ts` wires
        // `makeDragonAbilities`, and that returns one entry — the blessing
        // paid on death, never cast. Baron and Vilemaw can afford modest
        // swings because `monsters/Baron.ts` and `monsters/Vilemaw.ts` carry
        // the rest in spit, slam, pool, web and venom. At 10 per 1.8s this
        // camp put out 5.6 dps and was the weakest fighting thing in the
        // jungle — a raptor pit did two and a half times as much.
        //
        // 24 per 1.6s is 15 dps, just past the raptors and a shade over
        // Baron's swing-plus-kit total. It is a large single hit on a ~100
        // health champion on purpose: the swing is a `breath` cone with a
        // wind-up that re-checks reach before it lands, so it is dodgeable by
        // walking, and a number worth walking away from is what makes that
        // telegraph mean anything. `tests/monsters/campPower.test.ts` measures
        // all of this against the real camps rather than trusting the table.
        damage: 24,
        // Both of these are the *fire* drake's, and both are replaced on every
        // spawn by whichever drake the rotation is on — the wind drake swings
        // half again as fast and the earth drake half as fast, which is the
        // wiki's own spread and the clearest signal of which one you walked
        // into. They stay stated here because a body that named no style would
        // be given a spat projectile by core's reach rule, and a dragon that
        // does not breathe is the whole of what was wrong with this pit.
        attackInterval: 1_600,
        aggroRange: 400,
        attackStyle: 'breath',
        attackColor: [255, 138, 58],
        // Walks, but cannot be relocated. Giving it legs alone also made it
        // hookable, and a boss that any grab can pull out of the pit it
        // guards is not guarding anything. It still takes every slow, stun,
        // root and knock-up — what it refuses is being *moved*.
        anchored: true,
        // Tighter than the jungle's own 350. With legs, the default leash
        // (`max(camp.r, aggroRange) + chaseMargin`) would let it follow you
        // 750px off its pit and into a lane. 150 keeps the chase to about
        // 550 — far enough that stepping back is not an escape, short enough
        // that the pit is still where the fight happens.
        chaseMargin: 150,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  /**
   * Bãi quái đá. One body in the data; the other five arrive at runtime when
   * this one dies — see `monsters/Krugs.ts` for the split and for why its
   * children are `ephemeral`.
   */
  krugs: {
    id: 'krugs',
    name: 'Krugs',
    fills: ['krugs'],
    members: [
      {
        name: 'Krug Cổ',
        avatar: 'monster_Ancient_Krug',
        speed: 1.6,
        size: 74,
        attackRange: 50,
        // Three seconds, matching the wolves and raptors it stands beside.
        // A farm camp's pace is a property of the jungle, not of this camp.
        reviveTime: 3000,
        health: 260,
        damage: 11,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  /**
   * Cua sông. The first camp in this pack that declares behaviour rather than
   * only numbers: it runs instead of fighting, and its leash is the shape of
   * the river.
   */
  scuttle: {
    id: 'scuttle',
    name: 'Scuttle Crab',
    fills: ['scuttle'],
    members: [
      {
        name: 'Cua Sông',
        avatar: 'monster_Rift_Scuttle',
        // Faster than anything else in the jungle, because running is what it
        // does once anything touches it.
        speed: 3.1,
        // And a quarter of that the rest of the time. This is the pace it
        // drifts up and down the river at while nothing is happening — see
        // `monsters/ScuttleCrab.ts`'s header for why the two are different
        // numbers rather than one.
        wanderSpeed: 0.75,
        size: 46,
        attackRange: 50,
        reviveTime: 45_000,
        health: 180,
        // It never swings, so this is only ever the number `Monster` would
        // have derived from health. Stated as zero so nothing about the camp
        // depends on reading `temperament` to know it is harmless.
        damage: 0,
        // Wide, and it no longer means "notices you". Nothing startles this
        // camp any more; `aggroRange` is what `updateFlee` asks — how near
        // something has to be for it to keep running from it.
        aggroRange: 420,
        temperament: 'skittish',
        roam: { kind: 'terrain', layer: 'water' },
        offset: { x: 0, y: 0 },
      },
    ],
  },
  /**
   * Vilemaw. Ships with no slot on either of this pack's maps: it exists so a
   * hand-drawn Twisted Treeline can put `role: "vilemaw"` where it wants a
   * boss. See `monsters/Vilemaw.ts` for why it does not also fill `baron`.
   */
  vilemaw: {
    id: 'vilemaw',
    name: 'Vilemaw',
    fills: ['vilemaw'],
    tier: 'epic',
    members: [
      {
        name: 'Vilemaw',
        avatar: 'monster_Vilemaw',
        speed: 0,
        size: 100,
        // Shorter than Baron's 400 on purpose — a spider you can stand off
        // from — and the one number here that is *not* matched to it.
        attackRange: 360,
        reviveTime: 60_000,
        // Baron's pool and Baron's swing. It used to be 900 and 11, which read
        // as "a slightly smaller Baron" and played as a boss that did not
        // matter: `tests/monsters/bossParity.test.ts` added it up and found
        // Vilemaw landing 70% of Baron's damage while paying a **three-minute**
        // blessing on a **sixty-second** respawn, against Baron's two on three.
        // The richer objective was the easier fight.
        health: 1000,
        damage: 13,
        attackInterval: 2000,
        aggroRange: 460,
        attackColor: [152, 245, 128],
        offset: { x: 0, y: 0 },
      },
    ],
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    fills: ['blue'],
    members: [
      {
        name: 'Blue',
        avatar: 'monster_Blue_Sentinel',
        speed: 2,
        size: 80,
        attackRange: 50,
        attackColor: [120, 190, 255],
        // Matched to the blessing's own ninety seconds
        // (`monsters/JungleBuffs.ts`), so the camp comes back at about the
        // moment the buff runs out: holding it is a route you keep walking,
        // not a wall you refarm three seconds after clearing it.
        reviveTime: 90_000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  red: {
    id: 'red',
    name: 'Red',
    fills: ['red'],
    members: [
      {
        name: 'Red',
        avatar: 'monster_Red_Brambleback',
        speed: 2,
        size: 80,
        attackRange: 50,
        attackColor: [255, 120, 90],
        /** Same ninety seconds as Blue, for the same reason. */
        reviveTime: 90_000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  // Anchor: wolf1 at (1685, 3562). wolf1_a (1602, 3511) -> offset (-83, -51).
  // wolf1_b (1725, 3659) -> offset (40, 97). Total health 300 + 100 + 100 = 500.
  wolves: {
    id: 'wolves',
    name: 'Wolves',
    fills: ['wolves'],
    members: [
      {
        name: 'Greater Wolf',
        avatar: 'monster_Greater_Murk_Wolf',
        speed: 2,
        size: 70,
        attackRange: 50,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
      {
        name: 'Wolf',
        avatar: 'monster_Murk_Wolf',
        speed: 2.5,
        size: 40,
        attackRange: 50,
        reviveTime: 3000,
        health: 100,
        offset: { x: -83, y: -51 },
      },
      {
        name: 'Wolf',
        avatar: 'monster_Murk_Wolf',
        speed: 2.5,
        size: 40,
        attackRange: 50,
        reviveTime: 3000,
        health: 100,
        offset: { x: 40, y: 97 },
      },
    ],
  },
  gromp: {
    id: 'gromp',
    name: 'Gromp',
    fills: ['gromp'],
    members: [
      {
        name: 'Gromp',
        avatar: 'monster_Gromp',
        speed: 2,
        size: 70,
        attackRange: 150,
        attackColor: [150, 225, 140],
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  // Anchor: raptor1 at (2954, 4110). raptor1_a (3045, 4026) -> offset (91, -84).
  // raptor1_b (3149, 4095) -> offset (195, -15). raptor1_c (3060, 4169) ->
  // offset (106, 59). Total health 300 + 50 + 50 + 50 = 450.
  raptors: {
    id: 'raptors',
    name: 'Raptors',
    fills: ['raptors'],
    members: [
      {
        name: 'Crimson Raptor',
        avatar: 'monster_Crimson_Raptor',
        speed: 2,
        size: 70,
        attackRange: 150,
        attackColor: [255, 150, 150],
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        attackColor: [255, 150, 150],
        reviveTime: 3000,
        health: 50,
        offset: { x: 91, y: -84 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        attackColor: [255, 150, 150],
        reviveTime: 3000,
        health: 50,
        offset: { x: 195, y: -15 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        attackColor: [255, 150, 150],
        reviveTime: 3000,
        health: 50,
        offset: { x: 106, y: 59 },
      },
    ],
  },
});

/**
 * This pack's data half: everything a picker needs — a roster, a spell's
 * tooltip, a map to offer — without ever building a `ContentApi`. Plain
 * fields, not getters: the old getters in `bundledPack.ts` existed to dodge
 * a load-order cycle through `spellCatalog.ts` (`CHAMPION_KITS` lived
 * there, and this module read it back out mid-cycle); `ROSTER` above is
 * this module's own, so there is nothing left to defer past. Matches
 * `packs/reference/pack.ts`'s own `data`, which never needed getters either.
 */
export const data: ContentPackData = {
  /**
   * `coreRange` is load-bearing rather than documentation, and it has now been
   * raised for the same reason twice.
   *
   * `>=1.3.0` was for `items`: `ContentPackData.items` existed as a *field*
   * before core read it, so a pack declaring a shop against an older core
   * validates cleanly, installs cleanly, and has every one of its fourteen
   * items silently ignored — no error, no shop, nothing to look at.
   *
   * `>=1.4.0` is for `ItemDef.buildsFrom`. Same shape, one level down: an
   * older core drops the field, so every recipe below simply does not exist,
   * every finished item costs full price for ever, and the shop looks like it
   * is working. The floor is what turns that into a refused install.
   *
   * `>=1.5.0` is for the on-hit shelf (API contract 5): `Buff.onHit`,
   * `Buff.sourceSpell`, `Spell.countsAsAbilityCast` and
   * `api.combat.applyOnHitEffects`. On an older core the plain payloads would
   * merely be inert, but Cuồng Đao Guinsoo and Cuồng Cung Runaan *call*
   * `applyOnHitEffects` and would crash the swing that procs them — the
   * loudest possible version of "silently ignored", mid-fight.
   *
   * `>=1.6.0` is for `MonsterAbility.onKilled`, which the jungle blessings
   * (bùa xanh/đỏ/Baron, `monsters/JungleBuffs.ts`) hang everything on. An
   * older core never calls the hook, so the camps go back to paying nothing
   * but gold — the buff row just never appears, and nothing says why.
   *
   * `>=1.7.0` was for the two item stats that make abilities scale with a
   * build: `abilityPower` and `abilityHaste` (`cooldownReduction` until core
   * 1.16 turned the fraction into points). Six items below grant them.
   * This one is the *loud* failure rather than the silent kind — core's
   * `ITEM_STAT_KEYS` is an allow-list and `validate.ts` refuses a pack naming
   * a key that is not on it, so an older core rejects this pack outright
   * instead of shipping a shop whose mage items do nothing. The floor turns
   * that rejection into a sentence a player can read.
   *
   * `>=1.8.0` is for `ChampionEntry.defence` and `ContentPackData.archetypes` —
   * the durability half of a role, and the taxonomy a hand-built kit picks from.
   * `defence` is the silent kind again: an older core drops the field and every
   * champion below is back to 100 health with no resistances, which is the exact
   * state this pack raised its floor to escape. `archetypes` is the loud kind:
   * an older core's `validate.ts` does not know the key and the pack is refused.
   *
   * `>=1.11.0` is the silent kind again, and the worst-shaped one yet: core
   * amplifies heals and shields by the caster's ability power now, and reads a
   * `class="heal"` span in a description as a number to rescale. Both arrived
   * together and this pack is written against both — every shield line was
   * reshaped so its figure leads, and every heal number was retagged. On a
   * core that has neither, the shields are worth what the source typed, the
   * heals are worth what they were on the first frame of the match, and the
   * descriptions promise a bonus nothing delivers. Nothing throws; a support
   * simply does not scale, which is the complaint this whole change answers.
   *
   * `>=1.16.0` is the stat rename that came with ability haste:
   * `cooldownReduction` (a capped fraction) became `abilityHaste` (points),
   * and `healPower` became `healingReceived`. Loud at install — `validate.ts`
   * refuses a stats key it does not know — which is exactly how this pack found
   * out it had missed one during the migration.
   *
   * `>=1.15.0` was `api.buffs.ShieldCut` and the seam behind it
   * (`combat/Shielding.ts`, read by `Shield.onCreate`). Loud like 1.13's: the
   * buff is read at a spell module's top level, so on an older core Kiếm Ác Xà
   * constructs its passive from `undefined` the first time somebody buys it.
   *
   * `>=1.14.0` was the same story one shelf earlier: `armorPenetration`,
   * `magicPenetration`, `tenacity` and `healingReceived` are core's, they are on
   * `ITEM_STAT_KEYS` only from that version, and `validate.ts` refuses a pack
   * naming a stat key it does not know — so this one is loud at install, like
   * the 1.7 step, rather than silent.
   *
   * `>=1.13.0` was for the wound shelf: `api.buffs.HealCut` and the
   * `Buff.onDamageDealt` hook the two attacker-side passives hang on, both
   * added in that contract. This one fails *loudly* and early — `HealCut` is
   * read at module scope (`const HealCut = api.buffs.HealCut`) and the hook is
   * an override of a method an older `Buff` does not declare, so on an old
   * core the passive is constructed from `undefined` the first time somebody
   * buys Gươm Đồ Tể. The floor turns that into a refused install with a
   * sentence in it.
   *
   * `>=1.17.0` is for `api.utils.seededShuffle`, which `monsters/Dragon.ts`
   * draws the pit's drake order with. Loud in the same way: on an older core
   * that member is `undefined`, and the first dragon spawn of the match throws
   * out of `onSpawn`. What makes it worth a floor at all rather than a local
   * copy of a shuffle is that the two ends of a LAN match have to compute the
   * *same* order — a pack cannot value-import from core at runtime, so `api`
   * is the only way to share the function, and a second copy is one copy away
   * from two packs disagreeing about what a seed means.
   *
   * `>=1.18.0` was for `api.units.Minion` and the `turretPassives` slot, which
   * `structures/Turret.ts` was written against. That one failed *quietly* on an
   * older core rather than loudly — the slot is simply not read, and every
   * tower on the map lost all three passives with no error anywhere. That is
   * exactly the case a floor exists for, and the reason it is raised for a
   * field as much as for a class.
   *
   * `>=1.19.0` was for `api.GameObject` and the `slotObjects` slot, which
   * `structures/HealthRelic.ts` needed both halves of.
   *
   * **Both of those files have since moved into core**, and the floor stays
   * where they left it rather than dropping back: it is a floor, not a
   * description of today's imports, and lowering it would let this pack install
   * onto a core whose towers are plain and whose `relic` points are bare. The
   * seams themselves are unchanged and still this pack's to use — declaring
   * `turretPassives` replaces core's list, a `slotObjects` entry wins its role
   * — this pack simply has nothing to say through them now.
   *
   * `satisfiesCoreRange` parses `*` and `>=X.Y.Z` and nothing else, which is
   * also why this is no longer the unparseable `'^1'` it used to be.
   */
  manifest: {
    id: 'lol',
    version: '1.1.0',
    coreRange: '>=1.22.0',
    assets: 'lol',
  },
  spellDisplay: displayData(),
  champions: championEntries(),
  archetypes: archetypeEntries(),
  items: itemEntries(),
  monsters: monsterEntries(),
  maps: [summonersRift, twistedTreeline],
};
