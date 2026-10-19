// Route export as GPX, which every walking and mapping app can open.

import type { LatLon } from './geo';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function routeToGpx(name: string, points: LatLon[]): string {
  const pts = points.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Audio Map Explorer" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>\n`;
}

export function downloadGpx(name: string, xml: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  a.download = `${name.replace(/[^\w -]+/g, '').trim() || 'route'}.gpx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
