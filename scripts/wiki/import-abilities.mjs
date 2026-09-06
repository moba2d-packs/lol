import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAssetManifestSource, PACK_ASSET_TREE } from '@moba2d/core/pack-assets';
import { createMediaWikiClient } from './mediawiki.mjs';
import { assertPcSource, championSkillForms, parseLuaData } from './lua-data.mjs';
import { normalizeAbilityFields } from './normalize.mjs';

const ALL_SLOTS = ['I', 'Q', 'W', 'E', 'R'];

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  }
  return value;
}

export function deterministicJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

export function contentHash(value) {
  const content = typeof value === 'string' || value instanceof Uint8Array ? value : deterministicJson(value);
  return createHash('sha256').update(content).digest('hex');
}

export function championSlug(name) {
  if (typeof name !== 'string' || !name || !/^[\p{L}\p{N} .'-]+$/u.test(name)) {
    throw new Error(`Invalid champion name: ${name}`);
  }
  // Separators are dropped, not turned into '-': the repo names champion art
  // `chogath.png` / `leesin.png`, and a '-' here would import Cho'Gath and Lee
  // Sin under a second slug, duplicating their avatars and producing asset keys
  // (spell_cho_gath_e) that no spell references.
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug) throw new Error(`Invalid champion name: ${name}`);
  return slug;
}

function sourceRecord(source, fetchedAt, content) {
  return {
    pageUrl: source.pageUrl,
    revisionId: source.revisionId,
    sourceTimestamp: source.timestamp,
    fetchedAt,
    contentHash: contentHash(content),
  };
}

function imageExtension(mime, url) {
  const known = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
  if (known) return known;
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return extension === '.jpeg' ? '.jpg' : extension;
  throw new Error(`Unsupported image type: ${mime}`);
}

function validateImage(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) throw new Error('Downloaded image is empty');
  const valid = mime === 'image/png'
    ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8
      : mime === 'image/gif'
        ? new TextDecoder().decode(bytes.slice(0, 3)) === 'GIF'
        : mime === 'image/webp'
          ? new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
          : false;
  if (!valid) throw new Error(`Downloaded bytes do not match ${mime}`);
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function commitFiles(root, files, removals = []) {
  const parent = dirname(root);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, '.wiki-import-'));
  const destinations = [...new Set([...files.map(([path]) => path), ...removals])];
  const backups = [];
  const installed = [];
  try {
    for (const [path, contents] of files) {
      const staged = join(stage, path);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, contents);
    }

    for (const path of destinations) {
      const destination = join(root, path);
      if (!await exists(destination)) continue;
      const backup = join(stage, '.backup', path);
      await mkdir(dirname(backup), { recursive: true });
      await rename(destination, backup);
      backups.push(path);
    }
    for (const [path] of files) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(stage, path), destination);
      installed.push(path);
    }
  } catch (error) {
    for (const path of installed.reverse()) await rm(join(root, path), { force: true });
    for (const path of backups.reverse()) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(stage, '.backup', path), destination);
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function findChampion(index, requested) {
  const entry = Object.entries(index).find(([key, champion]) =>
    key.toLowerCase() === requested.toLowerCase() || champion?.name?.toLowerCase() === requested.toLowerCase()
  );
  if (!entry) throw new Error(`Champion not found in PC index: ${requested}`);
  return { key: entry[0], value: entry[1] };
}

function changedFields(previous, next) {
  const changes = [];
  const fields = new Set([
    ...(previous?.forms ?? []).flatMap(form => Object.keys(form.fields ?? {})),
    ...(next?.forms ?? []).flatMap(form => Object.keys(form.fields ?? {})),
  ]);
  for (const field of [...fields].sort()) {
    const oldValues = previous?.forms?.map(form => form.fields?.[field]) ?? [];
    const newValues = next?.forms?.map(form => form.fields?.[field]) ?? [];
    if (contentHash(oldValues) !== contentHash(newValues)) changes.push(`fields.${field}`);
  }
  return changes;
}

async function readJson(path, fallback) {
  return JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return JSON.stringify(fallback);
    throw error;
  }));
}

export async function importAbilities({
  root,
  champions,
  all = false,
  slots = ALL_SLOTS,
  update = false,
  client = createMediaWikiClient(),
  now = () => new Date().toISOString(),
  log = console.log,
}) {
  const indexSource = await client.fetchChampionIndex();
  assertPcSource(indexSource.pageUrl);
  const index = parseLuaData(indexSource.source);
  const requested = all ? Object.keys(index) : champions;
  if (!requested?.length) throw new Error('Select champions with --champion, --champions, or --all');

  const fetchedAt = now();
  const normalizedIndex = { schemaVersion: 1, source: sourceRecord(indexSource, fetchedAt, index), champions: index };
  const rawIndex = { schemaVersion: 1, source: sourceRecord(indexSource, fetchedAt, indexSource.source), payload: indexSource.source };
  const outputs = [
    ['docs/abilities/generated/champions.json', deterministicJson(normalizedIndex)],
    ['docs/abilities/cache/raw/champions.json', deterministicJson(rawIndex)],
    ['docs/abilities/cache/normalized/champions.json', deterministicJson(normalizedIndex)],
  ];
  const manifestPath = resolve(root, 'assets/source-manifest.json');
  const manifest = await readJson(manifestPath, { schemaVersion: 1, sources: [] });
  const sourceEntries = new Map(manifest.sources.map(entry => [entry.localAssetKey, entry]));
  const removals = new Set();

  for (const requestedName of requested) {
    const { value: champion } = findChampion(index, requestedName);
    const name = champion.name ?? requestedName;
    const slug = championSlug(name);
    const championImage = champion.image ?? `${name.replaceAll(' ', '_')}Square.png`;
    const championImageInfo = await client.fetchImageInfo(championImage);
    const championBytes = await client.fetchBytes(championImageInfo.url);
    validateImage(championBytes, championImageInfo.mime);
    const championExtension = imageExtension(championImageInfo.mime, championImageInfo.url);
    const championAssetKey = `champ_${slug.replaceAll('-', '_')}`;
    const championLocalPath = `assets/images/champions/${slug}${championExtension}`;
    const championRecord = {
      schemaVersion: 1,
      champion: name,
      data: champion,
      source: sourceRecord(indexSource, fetchedAt, champion),
      asset: { key: championAssetKey, originalUrl: championImageInfo.url, mime: championImageInfo.mime, sha1: championImageInfo.sha1 },
    };
    const championRecordPath = resolve(root, `docs/abilities/${slug}/champion.json`);
    const championExists = await exists(championRecordPath);
    const previousChampion = update && championExists ? await readJson(championRecordPath, null) : null;
    const previousChampionSource = sourceEntries.get(championAssetKey);
    const championImageHash = contentHash(championBytes);
    const championImageChanged = previousChampionSource?.contentHash !== championImageHash || previousChampionSource?.localPath !== championLocalPath;
    if (!championExists || update && (previousChampion.source?.revisionId !== championRecord.source.revisionId || previousChampion.source?.contentHash !== championRecord.source.contentHash || championImageChanged)) {
      if (previousChampionSource?.localPath && previousChampionSource.localPath !== championLocalPath) removals.add(previousChampionSource.localPath);
      outputs.push([relative(root, championRecordPath), deterministicJson(championRecord)]);
      outputs.push([`docs/abilities/cache/normalized/${slug}/champion.json`, deterministicJson(championRecord)]);
      outputs.push([championLocalPath, championBytes]);
      sourceEntries.set(championAssetKey, {
        localAssetKey: championAssetKey,
        localPath: championLocalPath,
        sourceUrl: championImageInfo.url,
        revisionId: indexSource.revisionId,
        fetchedAt,
        contentHash: championImageHash,
      });
    }
    for (const slot of slots) {
      const forms = championSkillForms(champion, slot);
      if (!forms.length) continue;
      const recordPath = resolve(root, `docs/abilities/${slug}/${slot.toLowerCase()}.json`);
      if (!update && await exists(recordPath)) throw new Error(`${name} ${slot} already exists; use ability:update`);

      const templates = await Promise.all(forms.map(form => {
        const page = `Template:Data ${name}/${form}`;
        assertPcSource(page);
        return client.fetchTemplate(page);
      }));
      const normalizedForms = templates.map((template, index) => ({
        name: forms[index],
        fields: normalizeAbilityFields(template.fields),
      }));
      const source = sourceRecord(templates[0], fetchedAt, normalizedForms);

      // The chain runs to `icon4` because the wiki does not use these slots as
      // "first choice, then alternates" — it uses them **positionally**, and a
      // template is free to leave the earlier ones as the literal string
      // `false`. `Template:Data Garen/Courage` is exactly that: `icon = false`
      // with the real art sitting in `icon3`. Stopping at `icon2` read that as
      // "no art exists" and refused the slot, which is why Garen W and
      // Warwick W shipped with placeholder icons for art the wiki had all along.
      //
      // **Positional first, then the chain as a fallback.** Each form is its own
      // `Template:Data <Champion>/<Form>` page, and this used to take the first
      // usable value on the theory that a page carries only its own icon. It
      // does not: all three of Yasuo's Steel Tempest pages carry `icon`,
      // `icon2` *and* `icon3`, so "first usable" handed every form
      // `Steel Tempest.png` and the importer wrote three copies of one square
      // over the three phase icons the wiki had all along — the same failure
      // the Garen note above describes, one level up. Reported in play as
      // Yasuo's Q icon never changing between Q1, Q2 and Q3.
      const formAssets = [];
      for (const [formIndex, form] of normalizedForms.entries()) {
        const usable = value =>
          typeof value === 'string' && value && value.toLowerCase() !== 'false';
        // The **usable** icons, which is not the same as the raw slots: a
        // template may leave `icon` as the literal `false` and start the real
        // art at `icon2` (Zed's Living Shadow does exactly that).
        const usableIcons = [
          form.fields.icon,
          form.fields.icon2,
          form.fields.icon3,
          form.fields.icon4,
        ].filter(usable);
        // Deliberately no "prefer stills" filter. `Twisted Fate Pick a Card.gif`
        // does sit in this chain between the card art, but the name match below
        // already passes it over — the form is called `Pick a Card` and the
        // still is named for it exactly. Filtering gifs out as well swept up
        // Thresh's Flay icons, which have always been animated here on purpose
        // (`tests/build/runtimeBundle.test.ts` pins that the encoder leaves
        // them alone), so the extra rule only cost art nobody asked to change.
        const icons = usableIcons;
        // **Matched to the form by name, not by position.** The chain is not one
        // icon per form in order: Pick a Card's holds four entries for four
        // forms but in a different order, and Xin Zhao's second is prefixed with
        // his name. Position gave forms the wrong art — a gif for Blue Card, a
        // diagram for a passive — which is worse than the duplicate it replaced.
        // The wiki does name them the same thing, so ask that.
        const normalise = value =>
          value
            .toLowerCase()
            .replace(/\.(png|jpe?g|gif|svg|webp)$/, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const wanted = normalise(form.name ?? '');
        // Exact first; then the *closest* containing name, not the first one.
        // Ashe's chain is `["Ashe Ranger's Focus 2.png", "Ashe Ranger's
        // Focus.png"]` — the "2" variant sits in `icon` — so "first match wins"
        // hands form 0 the second form's art. The shortest match is the one
        // with the least left over, which is the one that was meant.
        const contains = icons
          .filter(value => normalise(value).includes(wanted))
          .sort((a, b) => normalise(a).length - normalise(b).length);
        const icon =
          (wanted && (icons.find(value => normalise(value) === wanted) ?? contains[0])) ||
          icons[0];
        if (!icon) throw new Error(`${name} ${slot} (${form.name}): icon is missing`);
        const imageInfo = await client.fetchImageInfo(icon);
        const bytes = await client.fetchBytes(imageInfo.url);
        validateImage(bytes, imageInfo.mime);
        const extension = imageExtension(imageInfo.mime, imageInfo.url);
        // Form 1 keeps the bare `_<slot>` asset; form 2+ appends the 1-based form
        // number (`_<slot>2`, `_<slot>3`, ...), matching the hand-added spell art
        // convention (e.g. thresh_q.png/thresh_q2.png, zed_r1.png/zed_r2.png).
        const formSuffix = formIndex === 0 ? '' : String(formIndex + 1);
        const localAssetKey = `spell_${slug.replaceAll('-', '_')}_${slot.toLowerCase()}${formSuffix}`;
        const localPath = `assets/images/spells/${slug}_${slot.toLowerCase()}${formSuffix}${extension}`;
        const previousImageSource = sourceEntries.get(localAssetKey);
        const imageHash = contentHash(bytes);
        const imageChanged = previousImageSource?.contentHash !== imageHash || previousImageSource?.localPath !== localPath;
        formAssets.push({ imageInfo, bytes, localAssetKey, localPath, imageHash, imageChanged, previousImageSource });
      }
      const recordForms = normalizedForms.map((form, formIndex) => ({
        ...form,
        asset: {
          key: formAssets[formIndex].localAssetKey,
          originalUrl: formAssets[formIndex].imageInfo.url,
          mime: formAssets[formIndex].imageInfo.mime,
          sha1: formAssets[formIndex].imageInfo.sha1,
        },
      }));
      const anyImageChanged = formAssets.some(asset => asset.imageChanged);
      const record = {
        schemaVersion: 1,
        champion: name,
        slot,
        forms: recordForms,
        source,
        asset: recordForms[0].asset,
      };
      if (update && await exists(recordPath)) {
        const previous = await readJson(recordPath, null);
        for (const field of changedFields(previous, record)) log(`${name} ${slot}: ${field} changed`);
        if (previous.source?.revisionId === record.source.revisionId && previous.source?.contentHash === record.source.contentHash && !anyImageChanged) {
          log(`${name} ${slot}: unchanged`);
          continue;
        }
      }
      const rawCache = {
        schemaVersion: 1,
        source: sourceRecord(templates[0], fetchedAt, templates.map(template => template.raw ?? template.fields)),
        payload: templates.map(template => ({
          page: template.page,
          revisionId: template.revisionId,
          timestamp: template.timestamp,
          response: template.raw ?? template.fields,
        })),
      };
      outputs.push([relative(root, recordPath), deterministicJson(record)]);
      outputs.push([`docs/abilities/cache/raw/${slug}/${slot.toLowerCase()}.json`, deterministicJson(rawCache)]);
      outputs.push([`docs/abilities/cache/normalized/${slug}/${slot.toLowerCase()}.json`, deterministicJson(record)]);
      for (const asset of formAssets) {
        outputs.push([asset.localPath, asset.bytes]);
        if (asset.previousImageSource?.localPath && asset.previousImageSource.localPath !== asset.localPath) removals.add(asset.previousImageSource.localPath);
        sourceEntries.set(asset.localAssetKey, {
          localAssetKey: asset.localAssetKey,
          localPath: asset.localPath,
          sourceUrl: asset.imageInfo.url,
          revisionId: templates[0].revisionId,
          fetchedAt,
          contentHash: asset.imageHash,
        });
      }
    }
  }
  manifest.sources = [...sourceEntries.values()].sort((a, b) => a.localAssetKey.localeCompare(b.localAssetKey));
  outputs.push(['assets/source-manifest.json', deterministicJson(manifest)]);
  // Content-pack-and-repo-split batch 6 task 10: this pack is now a
  // repository of its own, `root` is *its* root (not a monorepo root with a
  // `packs/riot/` subdirectory inside it), and champion portraits and spell
  // icons already land directly under this pack's own `assets/` — no
  // `packs/riot/` prefix left to strip. One tree, one manifest, one call.
  //
  // Before the departure this used to be two calls: one regenerating core's
  // own `src/generated/assetManifest.ts` via core's generic generator, a
  // second — reached through a *dynamic* `import()`, because a static one
  // resolved at module load and broke `ability:check` the moment
  // `packs/riot/` was moved aside by the departure drill — re-rooting at
  // `packs/riot/` to regenerate the pack's own manifest through its own
  // `generate-assets.mjs`. Both problems are gone with the split itself: the
  // top-level `import { renderAssetManifestSource } from '../generate-
  // assets.mjs'` at the head of this file now resolves to *this pack's own*
  // generator (the only one that exists in this repository), so the dynamic
  // re-import and the `packs/riot/` re-rooting it existed for are both
  // dead code, not a live seam.
  outputs.push([
    'generated/assetManifest.ts',
    await renderAssetManifestSource(root, {
      tree: PACK_ASSET_TREE,
      add: outputs.map(([path]) => path),
      remove: [...removals],
    }),
  ]);
  await commitFiles(resolve(root), outputs, [...removals]);
  return outputs.map(([path]) => path);
}

export async function syncChampionIndex({ root, client = createMediaWikiClient(), now = () => new Date().toISOString() }) {
  const response = await client.fetchChampionIndex();
  assertPcSource(response.pageUrl);
  const data = parseLuaData(response.source);
  const fetchedAt = now();
  const normalized = { schemaVersion: 1, source: sourceRecord(response, fetchedAt, data), champions: data };
  const raw = { schemaVersion: 1, source: sourceRecord(response, fetchedAt, response.source), payload: response.source };
  await commitFiles(resolve(root), [
    ['docs/abilities/generated/champions.json', deterministicJson(normalized)],
    ['docs/abilities/cache/raw/champions.json', deterministicJson(raw)],
    ['docs/abilities/cache/normalized/champions.json', deterministicJson(normalized)],
  ]);
}

export function parseCli(args) {
  const options = { champions: undefined, slots: ALL_SLOTS };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--index') options.index = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--champion' || arg === '--champions') {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options.champions = value.split(',').map(name => name.trim());
      options.champions.forEach(championSlug);
      if (new Set(options.champions.map(name => name.toLowerCase())).size !== options.champions.length) {
        throw new Error(`Duplicate champion selection: ${value}`);
      }
    } else if (arg === '--slots') {
      const value = args[++index];
      if (!value) throw new Error('--slots requires a value');
      options.slots = value.toUpperCase().split(',');
      if (options.slots.some(slot => !ALL_SLOTS.includes(slot))) throw new Error(`Invalid slots: ${value}`);
      if (new Set(options.slots).size !== options.slots.length) throw new Error(`Duplicate slot selection: ${value}`);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.index && !options.all && !options.champions) throw new Error('Use --champion, --champions, or --all');
  if (options.all && options.champions) throw new Error('--all cannot be combined with champion selection');
  return options;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), '../..');
  Promise.resolve().then(async () => {
    const options = parseCli(process.argv.slice(2));
    if (options.index) await syncChampionIndex({ root });
    else await importAbilities({ root, ...options });
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
