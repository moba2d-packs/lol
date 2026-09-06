import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildTestApi, PackRegistry } from '@moba2d/core/testing';
import { describeItemShop } from '@moba2d/core/testing/items';
import type { ContentPack, SpellSource } from '@moba2d/core/content/types';
import riotCode, { data } from '../pack';
import { spellCatalog } from '../generated/spellCatalog';
import { assetManifest } from '../generated/assetManifest';

const api = buildTestApi();

/**
 * The shop this pack ships: a hundred and eleven items, sixty-seven spells behind them, and the
 * one thing about them that is easy to get wrong in a way nothing complains
 * about.
 *
 * **`Item_*` must not reach `spellDisplay`.** That record is
 * `PackRegistry.spellDisplayIds`, which is the population a `'random'` loadout
 * slot is drawn from — so an item's active landing there is dealt to a
 * champion who does not own the item, on a key the HUD will happily draw. It
 * fails silently in both directions: nothing throws, and the spell works.
 *
 * The scan below is over the *data* rather than over `data.ts`'s source text,
 * because the data is what core reads and a text scan would pass the day
 * someone rewrote the filter into a helper. What makes it falsifiable rather
 * than vacuous is the first case: the four ids really are in the generated
 * catalogue, so "none of them is in `spellDisplay`" is a filter doing work
 * rather than four spells that do not exist.
 */

/** The sixty-seven, by name. Not derived from a prefix the code under test also uses. */
const ITEM_SPELL_IDS = [
  'Item_Thornmail',
  'Item_Zhonyas',
  'Item_Ghostblade',
  'Item_Quicksilver',
  'Item_Mikael',
  'Item_Sheen',
  'Item_TrinityForce',
  'Item_DivineSunderer',
  'Item_EssenceReaver',
  'Item_LichBane',
  'Item_Tiamat',
  'Item_RavenousHydra',
  'Item_TitanicHydra',
  'Item_RuinedKing',
  'Item_WitsEnd',
  'Item_Kraken',
  'Item_Guinsoo',
  'Item_Runaan',
  'Item_Nashor',
  'Item_DuskAndDawn',
  'Item_StatikkShiv',
  'Item_DeadMansPlate',
  'Item_Locket',
  'Item_Shurelya',
  'Item_Everfrost',
  // The wound shelf. Three passives, six items: one spell per *trigger*, not
  // one per item — see `spells/Item_GrievousStrike.ts` for why.
  'Item_GrievousStrike',
  'Item_GrievousMagic',
  'Item_BrambleVest',
  // Core 1.14's shelf: the hat that multiplies, the shield that waits for a
  // threshold, and the shop's one aura.
  'Item_Rabadon',
  'Item_Steraks',
  'Item_FrozenHeart',
  'Item_SerpentsFang',
  // The tank shelf (2026-09-05). One spell per *mechanic*, as the wound
  // shelf: Item_Immolate burns for both Khiên Thái Dương and Áo Choàng Hắc
  // Quang, and Chùy Bạch Ngân re-sells Item_Quicksilver (already above)
  // rather than shipping a second cleanse.
  'Item_ForceOfNature',
  'Item_KaenicRookern',
  'Item_Banshee',
  'Item_Gargoyle',
  'Item_Immolate',
  'Item_Randuin',
  'Item_Heartsteel',
  'Item_Iceborn',
  'Item_Maw',
  'Item_Redemption',
  // The bruiser and support shelf (2026-09-05). Chùy Phản Kích re-sells
  // Item_Tiamat (already above) as its passive beside its own active — the
  // hydra family's cleave carried into a third item, the Thiêu Đốt shape.
  'Item_BlackCleaver',
  'Item_SunderedSky',
  'Item_Stridebreaker',
  'Item_Hullbreaker',
  'Item_Collector',
  'Item_Firecannon',
  'Item_Shieldbow',
  'Item_Navori',
  'Item_Ardent',
  'Item_Moonstone',
  'Item_Zeke',
  'Item_GuardianAngel',
  'Item_Rylai',
  'Item_Liandry',
  'Item_Ludens',
  'Item_Shadowflame',
  'Item_Cryptbloom',
  'Item_Serylda',
  'Item_Voltaic',
  'Item_ProfaneHydra',
  'Item_Terminus',
  'Item_UnendingDespair',
  'Item_Anathema',
  'Item_ImperialMandate',
  'Item_Hexplate',
] as const;

/**
 * Everything about this shop that is really a rule about *core*: the icon it
 * looks up, the spell ids it resolves, the recipe it combines, the ceiling it
 * clamps cooldowns at, and what an item description may contain now that both
 * the shop card and the inventory tooltip draw the stat list themselves.
 *
 * All of it used to be written out here, and a differently-shaped half of it
 * was written out in the other pack — with core's own `MAX_COOLDOWN_REDUCTION`
 * copied into each as a literal `0.6`. `@moba2d/core/testing/items` is the one
 * copy; what is left in this file is this pack's own design, which is the only
 * thing a pack's shop test should have been about.
 */
describeItemShop({ data, assetManifest, spellCatalog });

/**
 * The set as specified: id, name, cost, and every stat with its exact amount.
 * Written out rather than read back off `data.items`, which is the thing under
 * test — a table that asks the shop what the shop says agrees with itself
 * whatever the shop says.
 */
const SPEC: Record<
  string,
  {
    name: string;
    cost: number;
    stats: Record<string, number>;
    passive?: string;
    active?: string;
    /** The recipe, in the order the shop draws it. Absent for a component. */
    buildsFrom?: string[];
  }
> = {
  long_sword: { name: 'Kiếm Dài', cost: 350, stats: { attackDamage: 6 } },
  cloth_armor: { name: 'Giáp Lụa', cost: 300, stats: { armor: 18 } },
  null_magic_mantle: { name: 'Áo Vải', cost: 400, stats: { magicResist: 22 } },
  ruby_crystal: { name: 'Hồng Ngọc', cost: 400, stats: { maxHealth: 25 } },
  boots: { name: 'Giày', cost: 300, stats: { speed: 0.35 } },
  recurve_bow: { name: 'Cung Gỗ', cost: 550, stats: { attackSpeed: 0.15, onHitDamage: 1 } },
  zeal: {
    name: 'Cuồng Cung',
    cost: 700,
    stats: { attackSpeed: 0.12, critChance: 0.12, speedPercent: 0.05 },
  },
  berserkers_greaves: {
    name: 'Giày Cuồng Nộ',
    cost: 950,
    stats: { speed: 0.45, attackSpeed: 0.18, onHitDamage: 1 },
    buildsFrom: ['boots', 'recurve_bow'],
  },
  warmogs_armor: {
    name: 'Giáp Máu Warmog',
    cost: 1200,
    stats: { maxHealth: 70, healthRegen: 0.05 },
    buildsFrom: ['ruby_crystal', 'ruby_crystal'],
  },
  thornmail: { name: 'Giáp Gai', cost: 1100, stats: { armor: 45 }, passive: 'Item_Thornmail', buildsFrom: ['bramble_vest', 'cloth_armor'] },
  infinity_edge: {
    name: 'Vô Cực Kiếm',
    cost: 1600,
    stats: { attackDamage: 18, critChance: 0.25, critDamage: 0.2 },
    buildsFrom: ['long_sword', 'long_sword', 'long_sword'],
  },
  quicksilver_sash: {
    name: 'Khăn Giải Thuật',
    cost: 1200,
    stats: { magicResist: 40, attackDamage: 6, tenacity: 0.2 },
    active: 'Item_Quicksilver',
    buildsFrom: ['null_magic_mantle', 'long_sword'],
  },
  blade_of_the_ruined_king: {
    name: 'Gươm Suy Vong',
    cost: 1500,
    stats: { attackDamage: 10, attackSpeed: 0.15, omnivamp: 0.1, onHitDamage: 2 },
    passive: 'Item_RuinedKing',
    buildsFrom: ['recurve_bow', 'long_sword'],
  },
  sheen: { name: 'Thủy Kiếm', cost: 450, stats: { maxMana: 15 }, passive: 'Item_Sheen' },
  tiamat: { name: 'Rìu Tiamat', cost: 550, stats: { attackDamage: 6 }, passive: 'Item_Tiamat' },
  guinsoos_rageblade: {
    name: 'Cuồng Đao Guinsoo',
    cost: 1550,
    stats: { attackDamage: 8, attackSpeed: 0.21, onHitDamage: 2 },
    passive: 'Item_Guinsoo',
    buildsFrom: ['recurve_bow', 'long_sword'],
  },
  wits_end: {
    name: 'Đao Tím',
    cost: 1500,
    stats: { attackSpeed: 0.18, magicResist: 26, abilityPower: 1, onHitDamage: 1 },
    passive: 'Item_WitsEnd',
    buildsFrom: ['recurve_bow', 'null_magic_mantle'],
  },
  kraken_slayer: {
    name: 'Móc Diệt Thủy Quái',
    cost: 1650,
    stats: { attackDamage: 14, attackSpeed: 0.18, onHitDamage: 3 },
    passive: 'Item_Kraken',
    buildsFrom: ['recurve_bow', 'long_sword', 'long_sword'],
  },
  nashors_tooth: {
    name: 'Nanh Nashor',
    cost: 1500,
    stats: { attackSpeed: 0.24, abilityPower: 1.4, onHitDamage: 1 },
    passive: 'Item_Nashor',
    buildsFrom: ['recurve_bow'],
  },
  trinity_force: {
    name: 'Tam Hợp Kiếm',
    cost: 1800,
    stats: { attackDamage: 10, attackSpeed: 0.18, maxMana: 20, speedPercent: 0.05, onHitDamage: 2 },
    passive: 'Item_TrinityForce',
    buildsFrom: ['sheen', 'long_sword', 'recurve_bow'],
  },
  divine_sunderer: {
    name: 'Búa Rìu Sát Thần',
    cost: 1500,
    stats: { maxHealth: 35, maxMana: 15, attackDamage: 8 },
    passive: 'Item_DivineSunderer',
    buildsFrom: ['sheen', 'ruby_crystal'],
  },
  essence_reaver: {
    name: 'Lưỡi Hái Linh Hồn',
    cost: 1500,
    stats: { attackDamage: 12, maxMana: 25, critChance: 0.15 },
    passive: 'Item_EssenceReaver',
    buildsFrom: ['sheen', 'long_sword'],
  },
  lich_bane: {
    name: 'Kiếm Tai Ương',
    cost: 1500,
    stats: { speed: 0.4, maxMana: 20, abilityPower: 1.6 },
    passive: 'Item_LichBane',
    buildsFrom: ['sheen', 'boots'],
  },
  ravenous_hydra: {
    name: 'Rìu Mãng Xà',
    cost: 1400,
    stats: { attackDamage: 14, omnivamp: 0.1 },
    passive: 'Item_RavenousHydra',
    buildsFrom: ['tiamat', 'long_sword'],
  },
  titanic_hydra: {
    name: 'Rìu Đại Mãng Xà',
    cost: 1500,
    stats: { attackDamage: 8, maxHealth: 40 },
    passive: 'Item_TitanicHydra',
    buildsFrom: ['tiamat', 'ruby_crystal'],
  },
  runaans_hurricane: {
    name: 'Cuồng Cung Runaan',
    cost: 1650,
    stats: { attackSpeed: 0.33, critChance: 0.12, speedPercent: 0.05, onHitDamage: 2 },
    passive: 'Item_Runaan',
    buildsFrom: ['zeal', 'recurve_bow'],
  },
  dusk_and_dawn: {
    name: 'Bình Minh & Hoàng Hôn',
    cost: 1700,
    stats: { maxHealth: 60, attackDamage: 6 },
    passive: 'Item_DuskAndDawn',
    buildsFrom: ['ruby_crystal', 'ruby_crystal'],
  },
  zhonyas_hourglass: {
    name: 'Đồng Hồ Cát Zhonya',
    cost: 1500,
    stats: { armor: 30, abilityPower: 1.5 },
    active: 'Item_Zhonyas',
    buildsFrom: ['cloth_armor'],
  },
  youmuus_ghostblade: {
    name: 'Kiếm Ma Youmuu',
    cost: 1200,
    stats: { attackDamage: 12 },
    active: 'Item_Ghostblade',
    buildsFrom: ['long_sword', 'long_sword'],
  },
  statikk_shiv: {
    name: 'Móc Sét Statikk',
    cost: 1550,
    stats: { attackDamage: 10, attackSpeed: 0.18, critChance: 0.15, speedPercent: 0.05 },
    passive: 'Item_StatikkShiv',
    buildsFrom: ['zeal', 'long_sword'],
  },
  dead_mans_plate: {
    name: 'Giáp Người Chết',
    cost: 1200,
    stats: { armor: 30, maxHealth: 50, speedPercent: 0.05 },
    passive: 'Item_DeadMansPlate',
    buildsFrom: ['cloth_armor', 'ruby_crystal'],
  },
  locket_of_the_iron_solari: {
    name: 'Vòng Sắt Mặt Trời',
    cost: 1450,
    stats: { armor: 25, magicResist: 32, maxHealth: 40 },
    active: 'Item_Locket',
    buildsFrom: ['cloth_armor', 'null_magic_mantle'],
  },
  shurelyas_battlesong: {
    name: 'Khúc Ca Shurelya',
    cost: 1500,
    stats: {
      speed: 0.45,
      maxHealth: 25,
      maxMana: 20,
      abilityPower: 0.8,
      abilityHaste: 20,
    },
    active: 'Item_Shurelya',
    buildsFrom: ['boots', 'ruby_crystal'],
  },
  vampiric_scepter: { name: 'Huyết Trượng', cost: 550, stats: { attackDamage: 5, lifesteal: 0.1 } },
  bloodthirster: {
    name: 'Huyết Kiếm',
    cost: 1450,
    stats: { attackDamage: 18, lifesteal: 0.2 },
    buildsFrom: ['vampiric_scepter', 'long_sword'],
  },
  deaths_dance: {
    name: 'Vũ Điệu Tử Thần',
    cost: 1400,
    stats: { attackDamage: 14, armor: 25, omnivamp: 0.08 },
    buildsFrom: ['long_sword', 'cloth_armor'],
  },
  amplifying_tome: { name: 'Sách Cũ', cost: 400, stats: { abilityPower: 0.5 } },
  hextech_alternator: {
    name: 'Máy Chuyển Pha Hextech',
    cost: 900,
    stats: { abilityPower: 1, maxMana: 15 },
    buildsFrom: ['amplifying_tome', 'amplifying_tome'],
  },
  riftmaker: {
    name: 'Quyền Trượng Ác Thần',
    cost: 1550,
    stats: { abilityPower: 1.2, maxHealth: 45, spellVamp: 0.15 },
    buildsFrom: ['amplifying_tome', 'ruby_crystal'],
  },
  abyssal_mask: {
    name: 'Mặt Nạ Vực Thẳm',
    cost: 1400,
    stats: { maxHealth: 45, magicResist: 28, abilityPower: 0.6 },
    buildsFrom: ['null_magic_mantle', 'ruby_crystal'],
  },
  executioners_calling: {
    name: 'Gươm Đồ Tể',
    cost: 600,
    stats: { attackDamage: 8 },
    passive: 'Item_GrievousStrike',
  },
  mortal_reminder: {
    name: 'Lời Nhắc Tử Vong',
    cost: 1450,
    stats: { attackDamage: 20, critChance: 0.15 },
    passive: 'Item_GrievousStrike',
    buildsFrom: ['executioners_calling', 'long_sword'],
  },
  chempunk_chainsword: {
    name: 'Cưa Xích Hóa Kỹ',
    cost: 1450,
    stats: { attackDamage: 14, maxHealth: 45 },
    passive: 'Item_GrievousStrike',
    buildsFrom: ['executioners_calling', 'ruby_crystal'],
  },
  bramble_vest: {
    name: 'Áo Choàng Gai',
    cost: 650,
    stats: { armor: 20 },
    passive: 'Item_BrambleVest',
  },
  oblivion_orb: {
    name: 'Ngọc Quên Lãng',
    cost: 700,
    stats: { abilityPower: 0.6 },
    passive: 'Item_GrievousMagic',
  },
  morellonomicon: {
    name: 'Quỷ Thư Morello',
    cost: 1500,
    stats: { abilityPower: 1.1, maxHealth: 45 },
    passive: 'Item_GrievousMagic',
    buildsFrom: ['oblivion_orb', 'ruby_crystal'],
  },
  last_whisper: {
    name: 'Cung Xanh',
    cost: 700,
    stats: { attackDamage: 8, armorPenetration: 0.15 },
  },
  lord_dominiks_regards: {
    name: 'Nỏ Thần Dominik',
    cost: 1500,
    stats: { attackDamage: 16, armorPenetration: 0.35 },
    buildsFrom: ['last_whisper', 'long_sword'],
  },
  blighting_jewel: {
    name: 'Đá Hắc Hóa',
    cost: 650,
    stats: { abilityPower: 0.5, magicPenetration: 0.18 },
  },
  void_staff: {
    name: 'Trượng Hư Vô',
    cost: 1550,
    stats: { abilityPower: 1.2, magicPenetration: 0.35 },
    buildsFrom: ['blighting_jewel', 'amplifying_tome'],
  },
  plated_steelcaps: {
    name: 'Giày Thép Gai',
    cost: 900,
    stats: { speed: 0.45, armor: 30 },
    buildsFrom: ['boots', 'cloth_armor'],
  },
  mercurys_treads: {
    name: 'Giày Thủy Ngân',
    cost: 1000,
    stats: { speed: 0.45, magicResist: 25, tenacity: 0.25 },
    buildsFrom: ['boots', 'null_magic_mantle'],
  },
  sorcerers_shoes: {
    name: 'Giày Pháp Sư',
    cost: 900,
    stats: { speed: 0.45, magicPenetration: 0.18 },
    buildsFrom: ['boots'],
  },
  ionian_boots_of_lucidity: {
    name: 'Giày Khai Sáng Ionia',
    cost: 900,
    stats: { speed: 0.45, abilityHaste: 25 },
    buildsFrom: ['boots'],
  },
  rabadons_deathcap: {
    name: 'Mũ Phù Thủy Rabadon',
    cost: 1700,
    stats: { abilityPower: 1.5 },
    passive: 'Item_Rabadon',
    buildsFrom: ['amplifying_tome', 'amplifying_tome'],
  },
  steraks_gage: {
    name: 'Móng Vuốt Sterak',
    cost: 1500,
    stats: { maxHealth: 55, attackDamage: 8 },
    passive: 'Item_Steraks',
    buildsFrom: ['ruby_crystal', 'long_sword'],
  },
  spirit_visage: {
    name: 'Giáp Tâm Linh',
    cost: 1600,
    stats: { maxHealth: 45, magicResist: 28, healthRegen: 0.04, healingReceived: 0.2 },
    buildsFrom: ['null_magic_mantle', 'ruby_crystal'],
  },
  serpents_fang: {
    name: 'Kiếm Ác Xà',
    cost: 1300,
    stats: { attackDamage: 16, armorPenetration: 0.12 },
    passive: 'Item_SerpentsFang',
    buildsFrom: ['long_sword', 'long_sword'],
  },
  frozen_heart: {
    name: 'Tim Băng',
    cost: 1500,
    stats: { armor: 45, maxMana: 25, abilityHaste: 15 },
    passive: 'Item_FrozenHeart',
    buildsFrom: ['cloth_armor', 'cloth_armor'],
  },
  mikaels_blessing: {
    name: 'Ơn Phước Mikael',
    cost: 1400,
    stats: { magicResist: 30, abilityHaste: 15 },
    active: 'Item_Mikael',
    buildsFrom: ['null_magic_mantle'],
  },
  everfrost: {
    name: 'Vĩnh Sương',
    cost: 1600,
    stats: {
      maxHealth: 35,
      magicResist: 25,
      maxMana: 25,
      abilityPower: 1.4,
      abilityHaste: 15,
    },
    active: 'Item_Everfrost',
    buildsFrom: ['ruby_crystal', 'null_magic_mantle'],
  },
  // The tank shelf, 2026-09-05.
  chain_vest: { name: 'Giáp Lưới', cost: 700, stats: { armor: 40 } },
  negatron_cloak: { name: 'Áo Choàng Bạc', cost: 750, stats: { magicResist: 40 } },
  giants_belt: { name: 'Đai Khổng Lồ', cost: 700, stats: { maxHealth: 45 } },
  spectres_cowl: {
    name: 'Áo Choàng Ám Ảnh',
    cost: 850,
    stats: { maxHealth: 30, magicResist: 25, healthRegen: 0.02 },
  },
  force_of_nature: {
    name: 'Giáp Thiên Nhiên',
    cost: 1750,
    stats: { maxHealth: 55, magicResist: 45, speedPercent: 0.05 },
    passive: 'Item_ForceOfNature',
    buildsFrom: ['negatron_cloak', 'giants_belt'],
  },
  kaenic_rookern: {
    name: 'Vòng Sắt Cổ Tự',
    cost: 1600,
    stats: { maxHealth: 60, magicResist: 30, healthRegen: 0.03 },
    passive: 'Item_KaenicRookern',
    buildsFrom: ['spectres_cowl', 'ruby_crystal'],
  },
  banshees_veil: {
    name: 'Dây Chuyền Chữ Thập',
    cost: 1500,
    stats: { magicResist: 40, abilityPower: 1 },
    passive: 'Item_Banshee',
    buildsFrom: ['negatron_cloak', 'amplifying_tome'],
  },
  gargoyle_stoneplate: {
    name: 'Thú Tượng Thạch Giáp',
    cost: 1750,
    stats: { armor: 40, magicResist: 40 },
    active: 'Item_Gargoyle',
    buildsFrom: ['chain_vest', 'negatron_cloak'],
  },
  hollow_radiance: {
    name: 'Áo Choàng Hắc Quang',
    cost: 1450,
    stats: { maxHealth: 50, magicResist: 28 },
    passive: 'Item_Immolate',
    buildsFrom: ['null_magic_mantle', 'giants_belt'],
  },
  randuins_omen: {
    name: 'Khiên Băng Randuin',
    cost: 1700,
    stats: { armor: 45, maxHealth: 55 },
    active: 'Item_Randuin',
    buildsFrom: ['chain_vest', 'giants_belt'],
  },
  sunfire_aegis: {
    name: 'Khiên Thái Dương',
    cost: 1500,
    stats: { armor: 42, maxHealth: 40 },
    passive: 'Item_Immolate',
    buildsFrom: ['chain_vest', 'ruby_crystal'],
  },
  heartsteel: {
    name: 'Trái Tim Khổng Thần',
    cost: 1500,
    stats: { maxHealth: 75 },
    passive: 'Item_Heartsteel',
    buildsFrom: ['giants_belt', 'ruby_crystal'],
  },
  iceborn_gauntlet: {
    name: 'Găng Tay Băng Giá',
    cost: 1550,
    stats: { armor: 42, maxMana: 20 },
    passive: 'Item_Iceborn',
    buildsFrom: ['sheen', 'chain_vest'],
  },
  maw_of_malmortius: {
    name: 'Chùy Gai Malmortius',
    cost: 1500,
    stats: { attackDamage: 12, magicResist: 40 },
    passive: 'Item_Maw',
    buildsFrom: ['long_sword', 'negatron_cloak'],
  },
  silvermere_dawn: {
    name: 'Chùy Bạch Ngân',
    cost: 1850,
    stats: { attackDamage: 14, magicResist: 45, tenacity: 0.3 },
    active: 'Item_Quicksilver',
    buildsFrom: ['quicksilver_sash', 'long_sword'],
  },
  redemption: {
    name: 'Dây Chuyền Chuộc Tội',
    cost: 1400,
    stats: { maxHealth: 40, magicResist: 28, healthRegen: 0.03 },
    active: 'Item_Redemption',
    buildsFrom: ['spectres_cowl'],
  },
  // The bruiser and support shelf, 2026-09-05.
  phage: { name: 'Búa Gỗ', cost: 700, stats: { attackDamage: 5, maxHealth: 25 } },
  caulfields_warhammer: {
    name: 'Búa Chiến Caulfield',
    cost: 650,
    stats: { attackDamage: 7, abilityHaste: 10 },
  },
  kindlegem: { name: 'Hỏa Ngọc', cost: 600, stats: { maxHealth: 25, abilityHaste: 10 } },
  black_cleaver: {
    name: 'Rìu Đen',
    cost: 1700,
    stats: { attackDamage: 12, maxHealth: 45, abilityHaste: 10 },
    passive: 'Item_BlackCleaver',
    buildsFrom: ['phage', 'caulfields_warhammer'],
  },
  sundered_sky: {
    name: 'Giáo Thiên Ly',
    cost: 1500,
    stats: { attackDamage: 10, maxHealth: 40, abilityHaste: 10 },
    passive: 'Item_SunderedSky',
    buildsFrom: ['caulfields_warhammer', 'ruby_crystal'],
  },
  spear_of_shojin: {
    name: 'Ngọn Giáo Shojin',
    cost: 1650,
    stats: { attackDamage: 14, maxHealth: 30, abilityHaste: 20 },
    buildsFrom: ['caulfields_warhammer', 'long_sword'],
  },
  stridebreaker: {
    name: 'Chùy Phản Kích',
    cost: 1700,
    stats: { attackDamage: 12, maxHealth: 40, attackSpeed: 0.1 },
    passive: 'Item_Tiamat',
    active: 'Item_Stridebreaker',
    buildsFrom: ['tiamat', 'phage'],
  },
  hullbreaker: {
    name: 'Búa Tiến Công',
    cost: 1500,
    stats: { attackDamage: 10, maxHealth: 60, healthRegen: 0.03 },
    passive: 'Item_Hullbreaker',
    buildsFrom: ['phage', 'ruby_crystal'],
  },
  phantom_dancer: {
    name: 'Ma Vũ Song Kiếm',
    cost: 1600,
    stats: { attackSpeed: 0.25, critChance: 0.24, speedPercent: 0.1 },
    buildsFrom: ['zeal', 'zeal'],
  },
  the_collector: {
    name: 'Súng Hải Tặc',
    cost: 1600,
    stats: { attackDamage: 12, critChance: 0.15 },
    passive: 'Item_Collector',
    buildsFrom: ['long_sword', 'long_sword'],
  },
  rapid_firecannon: {
    name: 'Đại Bác Liên Thanh',
    cost: 1650,
    stats: { attackSpeed: 0.28, critChance: 0.12, speedPercent: 0.05, onHitDamage: 1 },
    passive: 'Item_Firecannon',
    buildsFrom: ['zeal', 'recurve_bow'],
  },
  immortal_shieldbow: {
    name: 'Nỏ Tử Thủ',
    cost: 1600,
    stats: { attackDamage: 12, lifesteal: 0.12, critChance: 0.15 },
    passive: 'Item_Shieldbow',
    buildsFrom: ['vampiric_scepter', 'long_sword'],
  },
  navori_flickerblade: {
    name: 'Đao Chớp Navori',
    cost: 1500,
    stats: { attackSpeed: 0.32, onHitDamage: 2 },
    passive: 'Item_Navori',
    buildsFrom: ['recurve_bow', 'recurve_bow'],
  },
  ardent_censer: {
    name: 'Lư Hương Sôi Sục',
    cost: 1500,
    stats: { maxHealth: 30, magicResist: 25, abilityHaste: 15 },
    active: 'Item_Ardent',
    buildsFrom: ['kindlegem', 'null_magic_mantle'],
  },
  moonstone_renewer: {
    name: 'Bùa Nguyệt Thạch',
    cost: 1450,
    stats: { maxHealth: 55, abilityHaste: 10, healthRegen: 0.02 },
    passive: 'Item_Moonstone',
    buildsFrom: ['kindlegem', 'ruby_crystal'],
  },
  zekes_convergence: {
    name: 'Tụ Bão Zeke',
    cost: 1400,
    stats: { armor: 25, maxHealth: 30, abilityHaste: 10 },
    active: 'Item_Zeke',
    buildsFrom: ['kindlegem', 'cloth_armor'],
  },
  watchful_wardstone: {
    name: 'Đá Tỏa Sáng - Cảnh Giác',
    cost: 1400,
    stats: { maxHealth: 40, abilityHaste: 15, visionRadius: 90 },
    buildsFrom: ['kindlegem'],
  },
  guardian_angel: {
    name: 'Giáp Thiên Thần',
    cost: 1700,
    stats: { attackDamage: 10, armor: 40 },
    passive: 'Item_GuardianAngel',
    buildsFrom: ['chain_vest', 'long_sword'],
  },
  blasting_wand: { name: 'Gậy Bùng Nổ', cost: 700, stats: { abilityPower: 0.85 } },
  rylais_crystal_scepter: {
    name: 'Trượng Pha Lê Rylai',
    cost: 1550,
    stats: { abilityPower: 1.1, maxHealth: 50 },
    passive: 'Item_Rylai',
    buildsFrom: ['blasting_wand', 'ruby_crystal'],
  },
  liandrys_torment: {
    name: 'Mặt Nạ Đọa Đày Liandry',
    cost: 1700,
    stats: { abilityPower: 1.1, maxHealth: 55 },
    passive: 'Item_Liandry',
    buildsFrom: ['blasting_wand', 'giants_belt'],
  },
  ludens_echo: {
    name: 'Vọng Âm Luden',
    cost: 1550,
    stats: { abilityPower: 1.3, abilityHaste: 15 },
    passive: 'Item_Ludens',
    buildsFrom: ['blasting_wand'],
  },
  shadowflame: {
    name: 'Ngọn Lửa Hắc Hóa',
    cost: 1600,
    stats: { abilityPower: 1.3, magicPenetration: 0.25 },
    passive: 'Item_Shadowflame',
    buildsFrom: ['blighting_jewel'],
  },
  cryptbloom: {
    name: 'Hoa Tử Linh',
    cost: 1800,
    stats: { abilityPower: 1.4, magicPenetration: 0.22, abilityHaste: 10 },
    passive: 'Item_Cryptbloom',
    buildsFrom: ['blighting_jewel', 'blasting_wand'],
  },
  serrated_dirk: {
    name: 'Dao Hung Tàn',
    cost: 850,
    stats: { attackDamage: 12, armorPenetration: 0.08 },
  },
  opportunity: {
    name: 'Gươm Thức Thời',
    cost: 1400,
    stats: { attackDamage: 14, armorPenetration: 0.2, speedPercent: 0.08 },
    buildsFrom: ['serrated_dirk'],
  },
  seryldas_grudge: {
    name: 'Thương Phục Hận Serylda',
    cost: 1700,
    stats: { attackDamage: 19, armorPenetration: 0.25, abilityHaste: 10 },
    passive: 'Item_Serylda',
    buildsFrom: ['serrated_dirk', 'caulfields_warhammer'],
  },
  voltaic_cyclosword: {
    name: 'Kiếm Điện Phong',
    cost: 1750,
    stats: { attackDamage: 17, armorPenetration: 0.12, maxHealth: 30, speedPercent: 0.05 },
    passive: 'Item_Voltaic',
    buildsFrom: ['serrated_dirk', 'phage'],
  },
  profane_hydra: {
    name: 'Mãng Xà Kích',
    cost: 1750,
    stats: { attackDamage: 18, armorPenetration: 0.15 },
    passive: 'Item_Tiamat',
    active: 'Item_ProfaneHydra',
    buildsFrom: ['tiamat', 'serrated_dirk'],
  },
  terminus: {
    name: 'Cung Chạng Vạng',
    cost: 1700,
    stats: { attackSpeed: 0.2, magicResist: 40, onHitDamage: 2, armorPenetration: 0.1 },
    passive: 'Item_Terminus',
    buildsFrom: ['recurve_bow', 'negatron_cloak'],
  },
  unending_despair: {
    name: 'Áo Choàng Diệt Vong',
    cost: 1650,
    stats: { maxHealth: 55, armor: 40, abilityHaste: 10 },
    passive: 'Item_UnendingDespair',
    buildsFrom: ['kindlegem', 'chain_vest'],
  },
  anathemas_chains: {
    name: 'Găng Xích Thù Hận',
    cost: 1650,
    stats: { maxHealth: 55, abilityHaste: 20, tenacity: 0.2 },
    active: 'Item_Anathema',
    buildsFrom: ['kindlegem', 'ruby_crystal'],
  },
  imperial_mandate: {
    name: 'Trát Lệnh Đế Vương',
    cost: 1500,
    stats: { abilityPower: 0.9, maxHealth: 35, abilityHaste: 20 },
    passive: 'Item_ImperialMandate',
    buildsFrom: ['kindlegem', 'amplifying_tome'],
  },
  experimental_hexplate: {
    name: 'Khiên Hextech Thử Nghiệm',
    cost: 1600,
    stats: {
      attackDamage: 10,
      maxHealth: 45,
      attackSpeed: 0.15,
      abilityHaste: 15,
      onHitDamage: 1,
    },
    passive: 'Item_Hexplate',
    buildsFrom: ['caulfields_warhammer', 'recurve_bow'],
  },
};

describe('no Item_ spell leaks into spellDisplay', () => {
  it('has every one in the generated catalogue, or the scan below proves nothing', () => {
    for (const id of ITEM_SPELL_IDS) {
      expect(Object.keys(spellCatalog), id).toContain(id);
    }
  });

  it("keeps every one of them out of the data half's spellDisplay", () => {
    const display = Object.keys(data.spellDisplay ?? {});
    expect(display.length).toBeGreaterThan(200);
    for (const id of ITEM_SPELL_IDS) {
      expect(display, id).not.toContain(id);
    }
    // The prefix, not only the four: a fifth item spell added later must not
    // slip in behind a list nobody remembered to grow.
    expect(display.filter(id => id.startsWith('Item_'))).toEqual([]);
  });

  it('still hands every one over in the code half, or the items that name them are inert', () => {
    const code = riotCode(api);
    for (const id of ITEM_SPELL_IDS) {
      expect(code.spells?.[id], id).toBeTypeOf('function');
    }
  });
});

describe('the item set', () => {
  const items = data.items ?? {};

  it('ships exactly the hundred and eleven specified, keyed by their own id', () => {
    expect(Object.keys(items).sort()).toEqual(Object.keys(SPEC).sort());
  });

  it('carries the specified name, cost and stats, to the number', () => {
    for (const [key, expected] of Object.entries(SPEC)) {
      const def = items[key];
      expect(def, key).toBeDefined();
      expect(def.name, key).toBe(expected.name);
      expect(def.cost, key).toBe(expected.cost);
      expect(def.stats ?? {}, key).toEqual(expected.stats);
      expect(def.passive, `${key} passive`).toBe(expected.passive);
      expect(def.active, `${key} active`).toBe(expected.active);
      expect(def.buildsFrom, `${key} buildsFrom`).toEqual(expected.buildsFrom);
    }
  });

  it('reaches its spells only through passive/active, and only the sixty-seven', () => {
    const named = new Set<string>();
    for (const def of Object.values(items)) {
      if (def.passive) named.add(def.passive);
      if (def.active) named.add(def.active);
    }
    expect([...named].sort()).toEqual([...ITEM_SPELL_IDS].sort());
  });

  it('declares a core floor new enough that core actually reads `items`', () => {
    // `ContentPackData.items` existed as a field before core read it, so a
    // pack declaring a shop against an older core installs cleanly and has
    // every item silently ignored. `satisfiesCoreRange` parses `*` and
    // `>=X.Y.Z` and nothing else.
    //
    // Every step since is recorded in `data.ts`'s own note beside the value.
    // The latest is 1.19 — `api.GameObject` and the `slotObjects` slot, which
    // `structures/HealthRelic.ts` needed both halves of. Before it, 1.18 was
    // `api.units.Minion` and the `turretPassives` slot, which
    // `structures/Turret.ts` needed to exist at all: on an older core the slot
    // is ignored and every tower silently loses all three of its passives,
    // which is the quiet half of a floor's job. Both of those files are core's
    // now, and the floor stays where they left it: it is a floor, not a list of
    // today's imports, and dropping it would let this pack install onto a core
    // whose towers are plain and whose `relic` points are bare. Before it, 1.17 was
    // `api.utils.seededShuffle`, which `monsters/Dragon.ts` uses to draw the
    // pit's drake order from the match seed. Like
    // the 1.15 step it is loud rather than silent: on an older core that
    // member is `undefined` and the first drake spawn throws, so the floor is
    // what turns it into a refused install. Before it, 1.16 was the stat
    // model — counters, ability haste, and grants that are a share of the
    // wearer. Before that, 1.15 was `api.buffs.ShieldCut`, which Kiếm Ác Xà
    // reads at module scope. Before it, 1.14 added `armorPenetration`,
    // `magicPenetration`, `tenacity` and `healingReceived` to core's
    // `ITEM_STAT_KEYS`, which `validate.ts` refuses a pack for naming before
    // they exist. The step before that was 1.13: `api.buffs.HealCut` and the `Buff.onDamageDealt`
    // hook, which the wound shelf below is entirely built on. Unlike the 1.11
    // step this one is loud — the buff is read at a spell module's top level
    // and would be `undefined` on an older core — and the floor is what turns
    // that into a refused install instead of a crash on the first purchase.
    expect(data.manifest.coreRange).toBe('>=1.22.0');
  });

  /**
   * The reason the two stats were added to core at all, held to a number.
   *
   * Before them, a full attack build multiplied a champion's damage per swing
   * by about 5.7 and its rate by about 1.5, while every one of this pack's
   * abilities dealt a flat number that no item could move — a multiplier of
   * exactly 1.00. Spamming a kit lost to holding right-click, which is what
   * was reported.
   *
   * Core does the scaling (`Stats.abilityPower`, a fraction applied in
   * `takeDamage`); the *magnitude* is this table's decision and nowhere else's,
   * so it is asserted here. The first magnitude — best six summing to ~2.2, a
   * 3.2x kit — was set before `balanceReport.test.ts` existed to compare the
   * two paths gold for gold; that measurement put the attack path at 6x the
   * ability path's value per 1000g, because crit, attack damage and attack
   * speed multiply each other while ability power only adds. The 2026-08-28
   * rebalance raised the six to sum ~7.9 (an 8.9x kit before cooldowns),
   * which lands the per-gold ratio at ~1.8 — `balanceReport.test.ts` is the
   * test that owns that ratio; this band only stops the table drifting from
   * the magnitude that produces it.
   */
  it('sells enough ability power for a full build to keep pace with a full attack build', () => {
    const powers = Object.values(items)
      .map(def => def.stats?.abilityPower ?? 0)
      .filter(amount => amount > 0)
      .sort((a, b) => b - a);

    const bestSix = powers.slice(0, 6).reduce((sum, amount) => sum + amount, 0);

    expect(powers.length, 'no item grants ability power at all').toBeGreaterThanOrEqual(6);
    expect(
      bestSix,
      `the six best ability items grant ${bestSix.toFixed(2)}, a ${(1 + bestSix).toFixed(2)}x kit`
    ).toBeGreaterThanOrEqual(7);
    expect(bestSix).toBeLessThanOrEqual(9);
  });

  it('sells ability haste at all, and in a band a kit can feel', () => {
    // That haste is written in points rather than as the old fraction, and
    // that the whole shop cannot reach core's runaway rail, are core's rules
    // and live in `describeItemShop`. What is this pack's is that the stat is
    // *for sale* and that the amounts mean something: four items lean on it,
    // and a shop selling 3 haste a time would be scaling on one axis while
    // pretending otherwise.
    const sources = Object.values(items)
      .map(def => def.stats?.abilityHaste ?? 0)
      .filter(amount => amount > 0);

    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const amount of sources) expect(amount).toBeGreaterThanOrEqual(10);
  });

  it("survives core's own validation, stat allow-list included", () => {
    // The real gate, rather than a second copy of `ITEM_STAT_KEYS` kept here:
    // `PackRegistry.install` runs `validate.ts`, which refuses a stats key
    // that is not on core's allow-list, an `id` that disagrees with its key,
    // and a passive/active naming a spell the code half does not ship.
    //
    // `BasicAttack` and `Recall` are folded on the way `src/content/install.ts`
    // folds them — this pack is deliberately not installable without them
    // (`tests/pack.test.ts`), and that has nothing to do with items.
    const code = riotCode(api);
    const spells: Record<string, SpellSource> = {
      ...(code.spells ?? {}),
      BasicAttack: class {} as SpellSource,
      Recall: class {} as SpellSource,
    };
    const pack: ContentPack = { ...data, ...code, spells };

    const registry = new PackRegistry();
    registry.install(pack);

    expect(registry.items()).toHaveLength(111);
    const thornmail = registry.item('lol:thornmail');
    expect(thornmail?.passive).toBe('lol:Item_Thornmail');
    expect(thornmail?.icon).toBe('lol:item_thornmail');
  });
});

/**
 * Ghép đồ — the part of the build paths that is *this shop's* design.
 *
 * The rules that are core's are in `describeItemShop` above and are not
 * repeated here: a recipe naming an item that does not exist, a total under
 * the sum of its parts, a combine that is a downgrade (caught while designing
 * these — Zhonya's grants 30 armour and two Giáp Lụa grant 36, so the obvious
 * two-component recipe would have charged 800 gold to *lose* six armour, and
 * it builds from one instead), and a recipe with more parts than a bag has
 * slots. Every one of those is silent if broken and none of them is a fact
 * about this pack.
 *
 * What is left is the shape of *this* shelf: which eight items are sold as
 * parts rather than as an end in themselves, and the promise that each of
 * them leads somewhere. The shared rule only catches a component that is a
 * dead end *and* does nothing; this one holds the stronger line, that
 * everything on this pack's own component list is genuinely on a build path.
 */
describe('the build paths', () => {
  const items = data.items ?? {};

  /** The six the shop sells as parts rather than as an end in themselves. */
  const COMPONENTS = [
    'long_sword',
    'cloth_armor',
    'null_magic_mantle',
    'ruby_crystal',
    'boots',
    'recurve_bow',
    'zeal',
    'sheen',
    'tiamat',
    'vampiric_scepter',
    'amplifying_tome',
    'executioners_calling',
    'bramble_vest',
    'oblivion_orb',
    'last_whisper',
    'blighting_jewel',
    'chain_vest',
    'negatron_cloak',
    'giants_belt',
    'spectres_cowl',
    'phage',
    'caulfields_warhammer',
    'kindlegem',
    'blasting_wand',
    'serrated_dirk',
  ];

  const finished = Object.values(items).filter(def => !COMPONENTS.includes(def.id));

  it('gives every finished item a recipe and every component none', () => {
    for (const id of COMPONENTS) {
      expect(items[id]?.buildsFrom, `${id} is a component`).toBeUndefined();
    }
    for (const def of finished) {
      expect(def.buildsFrom?.length, `${def.id} builds from nothing`).toBeGreaterThan(0);
    }
  });

  it('gives every component somewhere to go', () => {
    const used = new Set(finished.flatMap(def => def.buildsFrom ?? []));
    for (const id of COMPONENTS) {
      expect(used.has(id), `${id} builds into nothing`).toBe(true);
    }
  });
});

/**
 * The floor used to be declared **twice** — `data.ts`'s `manifest.coreRange`,
 * the copy `PackRegistry` holds after this pack's code has already run, and a
 * literal in this pack's own `scripts/write-manifest.mjs`, the copy a
 * *runtime* install checks before a line of it runs. Only the second can
 * refuse an install, so the two drifting meant the bundled build and the
 * published build disagreed about which cores they support, with the published
 * one winning. It had been missed once, and this test existed to regex that
 * script's source and compare the strings.
 *
 * `moba2d-write-manifest` reads `data.manifest.coreRange` off the built pack
 * now, so there is no second copy to police — the check that is still worth
 * making is that the value actually survived the trip into what shipped.
 */
describe('the core floor', () => {
  const manifestPath = new URL('../dist/manifest.json', import.meta.url);
  const built = existsSync(manifestPath);

  it.runIf(built)('reaches the published manifest unchanged from the data half', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.coreRange).toBe(data.manifest.coreRange);
  });
});
