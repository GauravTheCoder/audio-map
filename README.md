# Audio Map Explorer

Explore real city streets by sound and keyboard. Built for blind and low-vision travellers, with a visual map for sighted helpers.

**Try it:** https://soundaryakp1999.github.io/audio-map/

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Headphones recommended (place sounds are positioned in 3D around you).

## How it works

- **Map data:** OpenStreetMap. Roads and places are first built from OpenFreeMap vector tiles (`src/tiles.ts`), ready in a second or two; the fuller Overpass data (roundabouts, traffic signals) follows in the background and replaces them. Overpass responses are cached in the browser for 14 days, and requests rotate across mirrors with backoff.
- **Search:** Nominatim. **Visual map:** MapLibre GL with OpenFreeMap tiles (no API keys needed).
- **Speech:** your screen reader via ARIA live regions, or the browser's built-in voice.
- **Sound:** synthesized with the Web Audio API. No audio files.

| File | Role |
|---|---|
| `src/game.ts` | Game loop, physics, road assist, announcements, key commands |
| `src/world.ts` | Road graph, junction grouping, spatial indexes, places |
| `src/areas.ts` | Buildings, water, parks and land use under a point, for grid mode |
| `src/osm.ts` | Overpass and Nominatim fetching, retry, cache |
| `src/audio/audio.ts` | Vehicle engines, earcons, HRTF place cues, rumble strips |
| `src/speech.ts` | Live regions, built-in voice, priorities, message history |
| `src/vehicles.ts` | Speed and handling per vehicle, which roads each can use |
| `src/mapview.ts` | Visual map, trail, heading cone |
| `src/profiles.ts` | Sound profiles: which places and junctions are heard for each vehicle |
| `src/favorites.ts`, `src/notes.ts` | Saved places and spot notes, kept in the browser |

Press **F3** for grid mode: north is up, the arrow keys step across the map, and each kind of ground (road, building, park, water, land use) has its own sound. Areas come from the same vector tiles (`src/areas.ts`).

Press **F1** in the explorer for spoken help. The full key list is in the menu (**Escape**).
