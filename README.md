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

- **Map data:** OpenStreetMap via the Overpass API (roads first, then places), cached in the browser for 14 days. Public Overpass servers are often busy: requests rotate across mirrors with backoff, and a soft pulse plays while loading.
- **Search:** Nominatim. **Visual map:** MapLibre GL with OpenFreeMap tiles (no API keys needed).
- **Speech:** your screen reader via ARIA live regions, or the browser's built-in voice (lower latency, interruptible).
- **Sound:** synthesized with the Web Audio API. No audio files.

| File | Role |
|---|---|
| `src/game.ts` | Game loop, physics, road assist, announcements, key commands |
| `src/world.ts` | Road graph, junction grouping, spatial indexes, places |
| `src/osm.ts` | Overpass and Nominatim fetching, retry, cache |
| `src/audio/audio.ts` | Vehicle engines, earcons, HRTF place cues, rumble strips |
| `src/speech.ts` | Live regions, built-in voice, priorities, message history |
| `src/vehicles.ts` | Speed and handling per vehicle, which roads each can use |
| `src/mapview.ts` | Visual map, trail, heading cone |

Press **F1** in the explorer for spoken help. The full key list is in the menu (**Escape**).
