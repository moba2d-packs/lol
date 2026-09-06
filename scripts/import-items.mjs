/**
 * Fetches this pack's shop-item icons from Riot's own Data Dragon CDN, and
 * records where every byte came from.
 *
 * **This is a pack, so third-party art belongs here.** Core ships none — the
 * engine draws every pixel it carries, and Riot-derived material lives in the
 * pack that is named for Riot's game. Item icons are the same class of asset
 * as the champion portraits and ability icons already under `assets/`: the
 * files the League client itself serves, unaltered.
 *
 * ## Why the ledger is not `assets/source-manifest.json`
 *
 * That file is the *wiki* importer's, and `scripts/wiki/check-abilities.mjs`
 * holds it to a rule these icons cannot satisfy: every key in it must be
 * referenced by a record under `docs/abilities/` ("unreferenced asset key"),
 * because it exists to tie an ability's imported artwork to the ability record
 * that imported it. An item is not an ability and has no such record, so a row
 * for `item_thornmail` in that manifest would fail `npm run ability:check` the
 * moment it was written.
 *
 * The ledger therefore lives beside `docs/spell-names-vi.json`, which sits
 * outside `docs/abilities/` for the same shape of reason — a cache that
 * `ability:check` validates against a different schema has no business inside
 * the tree it validates. It also may not live under `assets/` at all:
 * `generate-assets.mjs` excludes exactly two files by name from the manifest
 * walk, and a third JSON file there would silently mint an asset key
 * (`items_source_manifest`) and ship the provenance record itself into every
 * player's download.
 *
 * ## Verbatim, and why both hashes are recorded anyway
 *
 * Data Dragon serves item icons at 64x64, which is the size the shop draws
 * them at, so nothing is resized, cropped or re-encoded on the way in — the
 * bytes on disk are the bytes Riot served, which is the strongest form the
 * provenance claim can take. `sourceHash` and `contentHash` are consequently
 * equal on every row today. Both are still written, and the schema matches the
 * dota pack's `scripts/import-art.mjs` field for field, because the day one of
 * these needs a transform is the day the two stop being equal — and a schema
 * that has to change at that point is a schema that will not be changed.
 *
 * (The build re-encodes raster art to WebP on the way into `dist/` — see
 * `vite.config.ts` and core's `scripts/pack-webp.mjs` — so shrinking these
 * files here would buy nothing and cost the provenance claim.)
 *
 * `--check` re-hashes what is on disk against the ledger and touches the
 * network for nothing. That is what `verify` runs, so a build on a machine
 * with no internet still fails loudly when the committed art and the recorded
 * provenance have drifted apart — rather than silently re-fetching and turning
 * a review of "which art changed" into a diff of binary blobs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'docs/items-source-manifest.json');
const UA = 'moba2d-content-lol item icon importer (+https://github.com/moba2d-packs/lol)';

/**
 * The Data Dragon patch these icons were taken from. Pinned, not "latest": a
 * floating version turns `items:check` into a check of what Riot published
 * this morning, and the whole point of the ledger is that the bytes on disk
 * are reproducible from a URL that still means what it meant.
 */
const PATCH = '16.16.1';

const CDN = `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/item`;

/**
 * The item set, and the only place a Riot item id is written down.
 *
 * `local` is this pack's own id for the item — the key in `data.ts`'s `items`
 * record, the `id` on its `ItemDef`, and half of its asset key: core's asset
 * generator maps `assets/images/items/long_sword.png` to `item_long_sword`,
 * which is the string `ItemDef.icon` carries. `riot` is the number Data Dragon
 * files the icon under, and it is *only* an icon coordinate — none of the
 * stats, costs or build paths in `data.ts` come from Riot's own item data, and
 * they are not meant to: this engine's champion has a 100-point health pool.
 */
export const ITEMS = [
  { local: 'long_sword', riot: 1036 },
  { local: 'cloth_armor', riot: 1029 },
  { local: 'null_magic_mantle', riot: 1033 },
  { local: 'ruby_crystal', riot: 1028 },
  { local: 'boots', riot: 1001 },
  { local: 'recurve_bow', riot: 1043 },
  { local: 'zeal', riot: 3086 },
  { local: 'sorcerers_shoes', riot: 3020 },
  { local: 'mikaels_blessing', riot: 3222 },
  { local: 'berserkers_greaves', riot: 3006 },
  { local: 'warmogs_armor', riot: 3083 },
  { local: 'thornmail', riot: 3075 },
  { local: 'infinity_edge', riot: 3031 },
  { local: 'quicksilver_sash', riot: 3140 },
  { local: 'blade_of_the_ruined_king', riot: 3153 },
  { local: 'zhonyas_hourglass', riot: 3157 },
  { local: 'youmuus_ghostblade', riot: 3142 },
  // The on-hit shelf. 2510 is Bình Minh & Hoàng Hôn — a real Data Dragon
  // 16.16.1 row, checked against that patch's own item.json before being
  // written down here, fictional though the name reads.
  { local: 'sheen', riot: 3057 },
  { local: 'tiamat', riot: 3077 },
  { local: 'guinsoos_rageblade', riot: 3124 },
  { local: 'wits_end', riot: 3091 },
  { local: 'kraken_slayer', riot: 6672 },
  { local: 'nashors_tooth', riot: 3115 },
  { local: 'trinity_force', riot: 3078 },
  { local: 'divine_sunderer', riot: 6632 },
  { local: 'essence_reaver', riot: 3508 },
  { local: 'lich_bane', riot: 3100 },
  { local: 'ravenous_hydra', riot: 3074 },
  { local: 'titanic_hydra', riot: 3748 },
  { local: 'runaans_hurricane', riot: 3085 },
  { local: 'dusk_and_dawn', riot: 2510 },
  { local: 'statikk_shiv', riot: 3087 },
  { local: 'locket_of_the_iron_solari', riot: 3190 },
  { local: 'shurelyas_battlesong', riot: 2065 },
  { local: 'everfrost', riot: 6656 },
  { local: 'dead_mans_plate', riot: 3742 },
  // The sustain shelf and its counter. Data Dragon 16.16.1 files the wound
  // items under the ids League's own tooltips call "Vết Thương Sâu" — the
  // phrase this pack's descriptions use, and the reason these six sit
  // together: they are one mechanic sold to three different builds.
  { local: 'vampiric_scepter', riot: 1053 },
  { local: 'bloodthirster', riot: 3072 },
  { local: 'deaths_dance', riot: 6333 },
  { local: 'amplifying_tome', riot: 1052 },
  { local: 'hextech_alternator', riot: 3145 },
  { local: 'riftmaker', riot: 4633 },
  { local: 'abyssal_mask', riot: 8020 },
  { local: 'executioners_calling', riot: 3123 },
  { local: 'mortal_reminder', riot: 3033 },
  { local: 'chempunk_chainsword', riot: 6609 },
  { local: 'bramble_vest', riot: 3076 },
  { local: 'oblivion_orb', riot: 3916 },
  { local: 'morellonomicon', riot: 3165 },
  // Penetration, tenacity and heal power — the three stats core grew in 1.14,
  // and the items that are the only reason to grow them. Same story as the
  // wound shelf above: the shop sold the wall and nothing that got through it.
  { local: 'last_whisper', riot: 3035 },
  { local: 'lord_dominiks_regards', riot: 3036 },
  { local: 'blighting_jewel', riot: 4630 },
  { local: 'void_staff', riot: 3135 },
  { local: 'plated_steelcaps', riot: 3047 },
  { local: 'mercurys_treads', riot: 3111 },
  { local: 'ionian_boots_of_lucidity', riot: 3158 },
  { local: 'rabadons_deathcap', riot: 3089 },
  { local: 'steraks_gage', riot: 3053 },
  { local: 'spirit_visage', riot: 3065 },
  { local: 'frozen_heart', riot: 3110 },
  // The fourth counter (core 1.15): shields granted *after* the hit are worth
  // less. Renekton's W already strips what is up; this punishes the re-cast.
  { local: 'serpents_fang', riot: 6695 },
  // The tank shelf, 2026-09-05: the shop sold the ability-power ceiling
  // (Rabadon, Kiếm Tai Ương, Vĩnh Sương) and nothing a front line could hold
  // it off with — four components and twelve finished items, magic resist
  // first because that was the complaint. Ids checked against 16.16.1's own
  // item.json (Kaenic Rookern is 2504 there, not a guess).
  { local: 'chain_vest', riot: 1031 },
  { local: 'negatron_cloak', riot: 1057 },
  { local: 'giants_belt', riot: 1011 },
  { local: 'spectres_cowl', riot: 3211 },
  { local: 'force_of_nature', riot: 4401 },
  { local: 'kaenic_rookern', riot: 2504 },
  { local: 'banshees_veil', riot: 3102 },
  { local: 'gargoyle_stoneplate', riot: 3193 },
  { local: 'hollow_radiance', riot: 6664 },
  { local: 'randuins_omen', riot: 3143 },
  { local: 'sunfire_aegis', riot: 3068 },
  { local: 'heartsteel', riot: 3084 },
  { local: 'iceborn_gauntlet', riot: 6662 },
  { local: 'maw_of_malmortius', riot: 3156 },
  { local: 'silvermere_dawn', riot: 6035 },
  { local: 'redemption', riot: 3107 },
  // The bruiser and support shelf, 2026-09-05: the gap left after the tank
  // wall went up — the shop sold the wall and the mage, and nothing for the
  // fighter standing between them or the enchanter standing behind. Ids
  // checked against 16.16.1's own vi_VN item.json before being written down
  // (Sundered Sky is 6610 there, the Collector 6676, Navori 6675).
  { local: 'phage', riot: 3044 },
  { local: 'caulfields_warhammer', riot: 3133 },
  { local: 'kindlegem', riot: 3067 },
  { local: 'black_cleaver', riot: 3071 },
  { local: 'sundered_sky', riot: 6610 },
  { local: 'spear_of_shojin', riot: 3161 },
  { local: 'stridebreaker', riot: 6631 },
  { local: 'hullbreaker', riot: 3181 },
  { local: 'phantom_dancer', riot: 3046 },
  { local: 'the_collector', riot: 6676 },
  { local: 'rapid_firecannon', riot: 3094 },
  { local: 'immortal_shieldbow', riot: 6673 },
  { local: 'navori_flickerblade', riot: 6675 },
  { local: 'ardent_censer', riot: 3504 },
  { local: 'moonstone_renewer', riot: 6617 },
  { local: 'zekes_convergence', riot: 3050 },
  { local: 'watchful_wardstone', riot: 4638 },
  { local: 'guardian_angel', riot: 3026 },
  // The mage, lethality and utility shelf, 2026-09-06. Two components the
  // shop had no rung for at all — a lethality one (Dao Hung Tàn) and the
  // ability-power step between Sách Cũ and Máy Chuyển Pha Hextech (Gậy Bùng
  // Nổ) — and fourteen finished rows on top of them. Every id below was
  // checked against 16.16.1's own vi_VN item.json before being written down:
  // Terminus is 3302 there, Anathema's Chains 8001, Unending Despair 2502,
  // and Luden's is still filed as 'Vọng Âm Luden' on this patch.
  //
  // The whole shelf's art is fetched here in one go rather than a row at a
  // time as the items land: `importAll` rewrites the entire ledger on every
  // run (every `fetchedAt`, all 111 of them), so fourteen imports would be
  // fourteen full-file diffs recording nothing but fourteen clock readings.
  { local: 'serrated_dirk', riot: 3134 },
  { local: 'blasting_wand', riot: 1026 },
  { local: 'rylais_crystal_scepter', riot: 3116 },
  { local: 'liandrys_torment', riot: 6653 },
  { local: 'ludens_echo', riot: 6655 },
  { local: 'shadowflame', riot: 4645 },
  { local: 'cryptbloom', riot: 3137 },
  { local: 'seryldas_grudge', riot: 6694 },
  { local: 'opportunity', riot: 6701 },
  { local: 'voltaic_cyclosword', riot: 6699 },
  { local: 'profane_hydra', riot: 6698 },
  { local: 'terminus', riot: 3302 },
  { local: 'unending_despair', riot: 2502 },
  { local: 'anathemas_chains', riot: 8001 },
  { local: 'imperial_mandate', riot: 4005 },
  { local: 'experimental_hexplate', riot: 3073 },
];

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function check() {
  if (!existsSync(MANIFEST)) {
    console.error(
      'import-items --check: docs/items-source-manifest.json is missing. Run `npm run items:import`.'
    );
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) {
    console.error('import-items --check: docs/items-source-manifest.json: invalid schema');
    process.exit(1);
  }

  const problems = [];
  const recorded = new Set();
  for (const entry of manifest.sources) {
    if (!entry?.localPath || !entry.localAssetKey || !/^[a-f0-9]{64}$/.test(entry.contentHash)) {
      problems.push(`${entry?.localPath ?? '(no path)'} — invalid source metadata`);
      continue;
    }
    if (recorded.has(entry.localAssetKey)) {
      problems.push(`${entry.localAssetKey} — recorded twice`);
      continue;
    }
    recorded.add(entry.localAssetKey);
    const path = join(root, entry.localPath);
    if (!existsSync(path)) {
      problems.push(`${entry.localPath} — recorded but not on disk`);
      continue;
    }
    if (sha256(readFileSync(path)) !== entry.contentHash) {
      problems.push(`${entry.localPath} — content does not match the recorded hash`);
    }
  }

  // The other direction, which a hash sweep alone cannot see: an item added to
  // `ITEMS` and never imported has no row here, so nothing would be re-hashed
  // and the run would pass with the icon simply missing.
  for (const item of ITEMS) {
    if (!recorded.has(`item_${item.local}`)) {
      problems.push(`item_${item.local} — in ITEMS but absent from the ledger`);
    }
  }

  if (problems.length) {
    console.error(`import-items --check: ${problems.length} problem(s):`);
    for (const problem of problems) console.error('  ' + problem);
    console.error('Run `npm run items:import` and commit the art together with the manifest.');
    process.exit(1);
  }
  console.log(
    `import-items --check: ${manifest.sources.length} item icon(s) match their recorded source`
  );
}

async function importAll() {
  const sources = [];
  for (const item of ITEMS) {
    const url = `${CDN}/${item.riot}.png`;
    const bytes = await download(url);
    const localPath = `assets/images/items/${item.local}.png`;
    const path = join(root, localPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    sources.push({
      contentHash: sha256(bytes),
      fetchedAt: new Date().toISOString(),
      localAssetKey: `item_${item.local}`,
      localPath,
      riotItemId: item.riot,
      // Equal to `contentHash` while nothing transforms these — see the header.
      sourceHash: sha256(bytes),
      sourceUrl: url,
    });
    console.log(`  ${localPath}  <-  ${url}`);
  }

  sources.sort((a, b) => a.localPath.localeCompare(b.localPath));
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        schemaVersion: 1,
        patch: PATCH,
        note:
          'League of Legends item icons, fetched verbatim from Riot\'s own Data Dragon CDN. ' +
          'League of Legends and all related trademarks and artwork are the property of Riot ' +
          'Games; this pack is an unofficial, non-commercial fan project and claims no ownership ' +
          'of them. The stats, costs and build paths in data.ts are this pack\'s own and are ' +
          'not Riot\'s. See README.md.',
        sources,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `import-items: ${sources.length} icon(s) written, provenance in docs/items-source-manifest.json`
  );
}

if (process.argv.includes('--check')) check();
else await importAll();
