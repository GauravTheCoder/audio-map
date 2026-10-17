// High-contrast restyle of the base map: a dark, high-contrast map with wide, bright roads and large
// labels. Applied to the loaded style in place, layer by layer, so it follows the style's own
// zoom-dependent widths and sizes (just scaled up).

import type { Map as MlMap } from 'maplibre-gl';

const BG = '#000000';
const LAND = '#121212';
const GREEN = '#0c2410';
const WATER = '#0b2a5c';
const BUILDING = '#3a3a3a';
const MAJOR = '#ffd400'; // main roads: bright yellow
const MINOR = '#ffffff'; // ordinary streets: white
const PATH = '#2f8f9c'; // footpaths and cycle paths: muted teal, so streets stand out

const ROAD_WIDTH = 2.2;
const PATH_WIDTH = 1.2;
const TEXT_SIZE = 1.6;

/** Multiply the outputs of a number, or of a zoom interpolate / step expression, by f. */
function scale(v: unknown, f: number): unknown {
  if (typeof v === 'number') return v * f;
  if (!Array.isArray(v)) return v;
  if (v[0] === 'interpolate') return v.map((x, i) => (i > 3 && i % 2 === 0 ? scale(x, f) : x));
  if (v[0] === 'step') return v.map((x, i) => (i === 2 || (i > 2 && i % 2 === 0) ? scale(x, f) : x));
  return v;
}

function roadColor(id: string): string {
  if (/rail|hatching/.test(id)) return '#808080';
  if (/path|pedestrian/.test(id)) return PATH;
  if (/motorway|trunk|primary|secondary|tertiary/.test(id)) return MAJOR;
  return MINOR;
}

export function applyHighContrast(map: MlMap) {
  const style = map.getStyle();
  for (const layer of style.layers) {
    const id = layer.id;
    const src = 'source-layer' in layer ? layer['source-layer'] : undefined;
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    const layout = (layer.layout ?? {}) as Record<string, unknown>;
    // property names and values come from the style itself, so they are not statically typed here
    const set = (p: string, v: unknown) => map.setPaintProperty(id, p as never, v as never);
    const setLayout = (p: string, v: unknown) => map.setLayoutProperty(id, p as never, v as never);
    const hide = () => setLayout('visibility', 'none');

    switch (layer.type) {
      case 'background':
        set('background-color', BG);
        break;
      case 'raster':
      case 'fill-extrusion':
        hide(); // shaded relief and 3D buildings only add clutter
        break;
      case 'fill':
        if (src === 'water') set('fill-color', WATER);
        else if (src === 'building') {
          set('fill-color', BUILDING);
          set('fill-outline-color', '#8a8a8a');
        } else if (src === 'transportation') hide(); // patterned squares and road areas
        else if (src === 'park' || /wood|grass|park|pitch|wetland/.test(id)) set('fill-color', GREEN);
        else set('fill-color', LAND);
        if ('fill-pattern' in paint) set('fill-pattern', undefined);
        break;
      case 'line':
        if (src === 'transportation') {
          const casing = id.includes('casing');
          set('line-color', casing ? BG : roadColor(id));
          set('line-width', scale(paint['line-width'], /path|pedestrian/.test(id) ? PATH_WIDTH : ROAD_WIDTH));
          if (!casing) set('line-opacity', 1);
        } else if (src === 'waterway') set('line-color', '#1f6fe0');
        else if (src === 'boundary') set('line-color', '#777777');
        else if (src === 'park') hide();
        break;
      case 'symbol': {
        if (layout['text-field'] !== undefined) {
          setLayout('text-size', scale(layout['text-size'] ?? 16, TEXT_SIZE));
          setLayout('text-font', ['Noto Sans Bold']);
          set('text-color', src === 'transportation_name' || src === 'place' ? '#ffffff' : '#e8e8e8');
          set('text-halo-color', BG);
          set('text-halo-width', 2.5);
          set('text-halo-blur', 0);
        }
        if (layout['icon-image'] !== undefined && src === 'transportation') {
          setLayout('icon-size', 1.6); // one-way arrows
        }
        break;
      }
    }
  }
}
