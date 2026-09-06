# @moba2d/content-lol

The League of Legends content pack for [`@moba2d/core`](https://github.com/moba2d-game/core):
77 playable champions' worth of spells, monsters and the Summoner's Rift map,
built entirely against core's public `ContentApi`. Until content-pack-and-
repo-split batch 6 task 10, this pack lived inside the core monorepo, at
`packs/riot/` (the pack id was `riot` then too, and is `lol` now — named
for the game it draws from rather than for the company that makes it); this repository is that same content, moved out — same files,
same tests, same history from this point forward, now versioned on its own.

(Checked, not rounded: `data.ts`'s own `ROSTER`/`championEntries()` produces
exactly 77 entries with `playable: true`, one per file-name prefix under
`spells/` that carries a `_Q`/`_W`/`_E`/`_R` suffix — the same count
`vite.config.ts` (in core) uses for its per-champion chunking. It said 63 for
a long time and had been wrong by fourteen for most of it: the number is prose,
nothing re-derives it, and every champion added since is one it did not count.
The pack's spell files total more than that: a handful — `Flash`, `Ghost`, `Heal`,
`Ignite`, `StealthWard` — carry no champion prefix at all and share one
`spell-common` chunk, which is why "champions" and "spell chunks" are two
different, both-correct numbers.)

## Requires `@moba2d/core`

This pack is nothing on its own — it is a plugin. It declares `@moba2d/core`
under `devDependencies`, not `dependencies`, on purpose: every crossing this
pack makes into core is `import type` — three modules
(`@moba2d/core/content/ContentApi`, `@moba2d/core/content/ContentPack`,
`@moba2d/core/content/types`), never a value. At runtime the pack needs
nothing of core directly; it receives a fully-built `ContentApi` object as the
argument to its own factory function (`pack.ts`) and calls methods on that
object, never on an import. Core's own `pack-core-boundary` seam enforces
this on core's side — a value import of any of the three, or an import of
anything else core exposes, both fail that scan.

Core is not yet published to the npm registry, so the dependency is a plain
git reference:

```json
"devDependencies": {
  "@moba2d/core": "github:moba2d-game/core#main"
}
```

(`main` is unpinned on purpose while the split is being tested end to end:
this pack is the thing that finds out whether core's published surface is
actually sufficient, and a pin would let core drift without this repository
noticing. Pin it to a tag before anyone else depends on either.)

## Install

```bash
npm install
```

## Run the checks

```bash
npm run verify
```

`verify` runs, in order: `assets:check` (the generated asset manifest is
current), `catalog:check` (the generated spell catalogue is current),
`ability:check` (the imported ability data under `docs/abilities/` is
internally consistent and every image it references exists), `items:check`
(every shop item icon still hashes to what `docs/items-source-manifest.json`
recorded), `typecheck`,
`check-seams` and `check-seams:monsters` (the source-scan rules that keep
this pack from reaching into core through anything but `ContentApi`), and
`npm test` (this pack's own Vitest suite).

Individual scripts are also available on their own — `npm run test`,
`npm run typecheck`, `npm run assets:generate` (rewrite the manifest rather
than just check it), and so on; see `package.json` for the full list.

## Where the content came from

`docs/abilities/`, `assets/source-manifest.json` and `scripts/wiki/` are the
Riot Wiki / Data Dragon import toolchain and its provenance records — how
this pack's ability data and art were pulled from the public wiki in the
first place, and how a future refresh (`npm run ability:update`,
`npm run names:sync`) would pull an update. They touch the network only when
explicitly invoked; nothing in `verify` does.

The shop's item icons come off Data Dragon directly rather than the wiki, so
they have their own importer and their own ledger — `scripts/import-items.mjs`
and `docs/items-source-manifest.json` (`npm run items:import` to refetch,
`npm run items:check` to re-hash offline). The ledger lives outside `assets/`
on purpose: `assets/source-manifest.json` is the *wiki* importer's and
`ability:check` requires every key in it to be referenced by a record under
`docs/abilities/`, which an item — not being an ability — can never satisfy.
Same reason `docs/spell-names-vi.json` sits where it does.

The seven drake portraits are a third ledger for the third time that reason
applies — `docs/monsters-source-manifest.json`, re-hashed by
`tests/monsterArt.test.ts` rather than by a script, since re-hashing is the
only half `verify` runs and a test does it inside the run that is already
happening. They are `.webp` and not `.png` because that is what the wiki CDN
actually served under its `…Square.png` URLs, and the extension has to agree
with the bytes. The ten older monster icons predate all of this and are
knowingly outside it; that test says so rather than letting the ledger look
complete. `Vilemaw.webp` is outside it for a different reason and is worth
naming: it replaced a hand-drawn placeholder with a portrait supplied by this
pack's owner rather than fetched by either importer, so there is no URL to
record and a row claiming one would be provenance invented instead of kept.

## Trademarks and third-party assets

This is a **non-commercial, unofficial fan project**. It is **not affiliated
with, authorised by, or endorsed by [Riot Games](https://www.riotgames.com/)**,
and it generates no revenue.

Everything this pack is _for_ is Riot's: the champions, their ability names,
their artwork. `assets/` holds champion portraits and ability icons imported
from the League of Legends Wiki — `assets/source-manifest.json` records, for
every one of them, the URL it came from, the revision it was, and a SHA-256 of
the bytes, and `npm run ability:check` re-hashes each file against that record
so the provenance stays true. The shop's fifty-seven item icons are the same
deal one ledger over: taken byte-for-byte off Data Dragon, recorded in
`docs/items-source-manifest.json`, re-hashed by `npm run items:check`. The
items' own stats, costs and build paths are *not* Riot's — they are written
here, for a champion with a 100-point health pool. The Vietnamese ability names come from Riot's own
`vi_VN` locale via Data Dragon (`npm run names:sync`); only the descriptions are
written here, because the official ones carry no numbers and these are scaled to
a 100-health champion.

League of Legends and all related trademarks, characters, artwork and other
assets are the property of Riot Games. This project claims no ownership over
that intellectual property, and asks that no one treat the files in `assets/`
as licensed for reuse.

The pack is named `lol` for the game, not `riot` for the company. The two are
easy to conflate and only one of them describes what is in here.
