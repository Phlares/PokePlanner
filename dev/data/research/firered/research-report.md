# FireRed Data Pack Research Report

Generated deterministically from the pinned sources at `2026-07-19T04:09:43+02:00`.

## Scope

- Game: Pokémon FireRed (version 10, version-group 7, generation 3)
- Species: 386
- Moves: 354
- Types: 17

## Source registry and licensing

| Source | Revision | License |
| --- | --- | --- |
| [Bulbapedia: Move Tutor](https://bulbapedia.bulbagarden.net/wiki/Move_Tutor) (`bulbapedia-frlg-move-tutors`) | `accessed-2026-07-19` | reference only (no license) |
| [Bulbapedia: FireRed and LeafGreen walkthrough](https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_FireRed_and_LeafGreen) (`bulbapedia-frlg-walkthrough`) | `accessed-2026-07-19` | reference only (no license) |
| [Bulbapedia: List of TM and HM locations in Generation III](https://bulbapedia.bulbagarden.net/wiki/List_of_TM_and_HM_locations_in_Generation_III) (`bulbapedia-gen3-tm-hm-locations`) | `accessed-2026-07-19` | reference only (no license) |
| [PokeAPI api-data snapshot](https://github.com/PokeAPI/api-data) (`pokeapi-api-data`) | `0fb5313cb77f46269502e987a53a0bf751ae883d` | BSD-3-Clause |
| [pret/pokefirered decompilation (accuracy reference only)](https://github.com/pret/pokefirered) (`pret-pokefirered`) | `df4449a27cd78dd747ce269e47d3ab4a0149d8f4` | reference only (no license) |

## Counts

- acquisitions: 123
- encounters: 137
- evolutions: 184
- hms: 8
- learnsets: 386
- moves: 354
- pokemon: 386
- tms: 50
- tutors: 18
- types: 17

## Coverage matrix

### Species availability by status

- event-only: 5
- postgame: 47
- standard: 147
- transfer-only: 164
- version-exclusive: 23

### Acquisitions by kind

- event: 5
- fossil: 3
- game-corner: 2
- gift: 4
- hm: 8
- starter: 3
- static: 9
- tm: 50
- trade: 6
- transfer: 15
- tutor: 18

### Encounter areas by method

- event: 2
- gift: 8
- gift-egg: 1
- good-rod: 49
- old-rod: 49
- only-one: 7
- pokeflute: 2
- rock-smash: 13
- super-rod: 49
- surf: 49
- walk: 106

## Historical conflicts and resolutions

- **Curse move type:** Curse retains the Generation III "???" type, normalized as the move-only value "unknown"; it is never a Pokemon type or type-chart entry.
- **Fairy type:** No Fairy type or Fairy relations exist; the type chart holds exactly 17 Generation III types.
- **Hidden abilities:** Hidden (Dream World) abilities are excluded; only Generation III ability slots 1 and 2 are retained.
- **Orre-only Shadow moves:** PokeAPI move IDs 10001-10018 (the shadow type) are excluded as non-FireRed data with no FireRed learnset.
- **Physical/special split:** Damage class is derived from the Generation III type-based physical/special split rather than per-move categories.

## Evolution overrides

15 curated evolution overrides applied (National Dex gates, FireRed-impossible triggers, transfer-prepared and later-generation exclusions):

- #42 -> #169: postgame (milestone: national-dex)
- #44 -> #182: postgame (milestone: national-dex)
- #61 -> #186: postgame (milestone: national-dex)
- #79 -> #199: postgame (milestone: national-dex)
- #95 -> #208: postgame (milestone: national-dex)
- #113 -> #242: postgame (milestone: national-dex)
- #117 -> #230: postgame (milestone: national-dex)
- #123 -> #212: postgame (milestone: national-dex)
- #133 -> #196: unavailable (reason: no-day-night-cycle)
- #133 -> #197: unavailable (reason: no-day-night-cycle)
- #137 -> #233: postgame (milestone: national-dex)
- #265 -> #266: standard (reason: personality-value-branch)
- #265 -> #268: standard (reason: personality-value-branch)
- #290 -> #292: standard (reason: empty-party-slot)
- #349 -> #350: transfer-only (reason: requires-pre-raised-beauty)

## Selected cross-checks

- **Route 22 wild Mankey:** Location area 313 (kanto-route-22) walk encounters list Mankey (#56) at chances [20,10,10,4,1] and levels [3,4,2,5,5].
- **Boulder Badge milestone acquisition:** Acquisition "tm39-rock-tomb" (TM39 Rock Tomb) becomes available at the brock-gym milestone.
- **Mankey ability rollback:** Mankey (#56) retains only its Generation III ability slot(s): ["Vital Spirit"]; hidden abilities are excluded.
- **HM08 Dive excluded from FireRed use:** Acquisition "hm08-dive" (HM08 Dive) is recorded as unavailable in FireRed.

## Provenance

Provisional records: 0. Every shipped fact is verified or cross-checked; zero provisional records remain in the built pack.

Facts are referenced by source revision and locator only; no pret decompilation source or copyrighted tables are redistributed.
