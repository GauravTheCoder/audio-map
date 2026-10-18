// Where exactly a stop, entrance or crossing is: which corner of which intersection, which side of
// the street, and which way the traffic beside it goes. Worked out from the street layout so it
// works for any stop, then refined by what the stop's OSM tags say when they say it.

import { bearing, compass8, dist, normDeg, relAngle } from './geo';
import { fmtDistance, type Units } from './settings';
import type { StopRoute } from './osm';
import { MINOR, type GNode, type Place, type Way, type World } from './world';

const isStreet = (w: Way) => w.named && !MINOR.has(w.type);

/** How close (m) to an intersection something must be to be "on the corner". */
const CORNER = 35;

export interface Spot {
  /** the street it is beside */
  street: string;
  /** e.g. "north-west corner" or "east side"; empty when it sits on the street's centre line */
  where: string;
  /** e.g. "of Goodwin Avenue and Green Street" or "of Goodwin Avenue, 60 metres north of Green Street" */
  of: string;
  corner: boolean;
  /** the nearest cross street, if one is close */
  cross?: string;
  /** the way traffic on its side of the street goes; sure when the street is one way */
  travel?: { dir: number; sure: boolean };
  /** at a corner: the direction from the intersection to the spot, along its street */
  fromCross?: number;
}

/** Snap a bearing to whichever way along a road (dir or its reverse) it is closer to. */
function along(roadDir: number, b: number): number {
  return Math.abs(relAngle(roadDir, b)) <= 90 ? roadDir : normDeg(roadDir + 180);
}

const GENERIC = new Set(['street', 'avenue', 'road', 'drive', 'boulevard', 'lane', 'place', 'court', 'way', 'north', 'south', 'east', 'west', 'and', 'the', 'stop', 'station']);

/** The distinctive words of a name: "Green & Goodwin" -> green, goodwin. */
function keywords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
}

/** The other street at an intersection on `street`; "North Goodwin Avenue" is the same street as "South Goodwin Avenue". */
function crossStreet(n: GNode, street: string) {
  if (!n.edges.some((e) => e.way.name === street && isStreet(e.way))) return null;
  const own = keywords(street);
  return n.edges.find((e) => isStreet(e.way) && e.way.name !== street && !keywords(e.way.name).some((w) => own.includes(w))) ?? null;
}

/**
 * Where (x, y) is along the nearest street; null if no named street is within 40 m. A stop's
 * name ("Green & Goodwin") picks the cross street it is measured from, even when another is nearer.
 */
export function locate(world: World, x: number, y: number, units: Units, leftHand = false, name = ''): Spot | null {
  const hit = world.nearestRoad(x, y, 40, isStreet);
  if (!hit) return null;
  const way = hit.seg.way;
  const street = way.name;
  const roadDir = hit.dir;
  const h = hit.hit;
  // the side of the street, square to it
  let perp: number | null = null;
  if (h.dist > 1) perp = normDeg(roadDir + (relAngle(roadDir, bearing(h.px, h.py, x, y)) >= 0 ? 90 : -90));

  const hint = keywords(name);
  let best: { n: GNode; name: string; dir: number; d: number; named: boolean } | null = null;
  for (const n of world.nodesNear(h.px, h.py, 250)) {
    const e = crossStreet(n, street);
    if (!e) continue;
    const d = dist(h.px, h.py, n.x, n.y);
    const named = keywords(e.way.name).some((w) => hint.includes(w));
    if (!named && d > 200) continue;
    if (!best || (named && !best.named) || (named === best.named && d < best.d)) best = { n, name: e.way.name, dir: world.edgeBearing(n, e), d, named };
  }

  let travel: Spot['travel'];
  if (way.oneway) travel = { dir: way.onewayReverse ? normDeg(roadDir + 180) : roadDir, sure: true };
  else if (perp !== null) travel = { dir: along(roadDir, perp + (leftHand ? 90 : -90)), sure: false };

  if (best && best.d <= CORNER) {
    // add up "which side of each street" to get the corner
    let vx = 0;
    let vy = 0;
    const add = (deg: number) => {
      vx += Math.sin((deg * Math.PI) / 180);
      vy += Math.cos((deg * Math.PI) / 180);
    };
    if (perp !== null) add(perp);
    const toSpot = bearing(best.n.x, best.n.y, x, y);
    if (dist(best.n.x, best.n.y, x, y) > 1) add(normDeg(best.dir + (relAngle(best.dir, toSpot) >= 0 ? 90 : -90)));
    // opposite sides cancel to ~1e-16 rather than exactly 0, which would name a random corner
    const where = Math.hypot(vx, vy) > 1e-6 ? `${compass8(bearing(0, 0, vx, vy))} corner` : '';
    const fromCross = best.d > 3 ? along(roadDir, bearing(best.n.x, best.n.y, h.px, h.py)) : undefined;
    return { street, where, of: `of ${street} and ${best.name}`, corner: true, cross: best.name, travel, fromCross };
  }
  const where = perp !== null ? `${compass8(perp)} side` : '';
  let of = `of ${street}`;
  if (best) of += `, ${fmtDistance(best.d, units)} ${compass8(along(roadDir, bearing(best.n.x, best.n.y, h.px, h.py)))} of ${best.name}`;
  return { street, where, of, corner: false, cross: best?.name, travel };
}

/** "on Green Street" style text for any spot. */
export function spotText(s: Spot): string {
  return s.where ? `${s.where} ${s.of}` : `on ${s.of.slice(3)}`;
}

const ABBR: Record<string, string> = {
  N: 'north',
  S: 'south',
  E: 'east',
  W: 'west',
  NE: 'north-east',
  NW: 'north-west',
  SE: 'south-east',
  SW: 'south-west',
  NB: 'northbound',
  SB: 'southbound',
  EB: 'eastbound',
  WB: 'westbound',
};

/**
 * A stop's local_ref is either its letter or bay ("K", "2", "H.1") or a description of where it
 * stands ("NW Far Side", "North side"). UK-style "opp" and "adj" only make sense with a landmark,
 * so they are left out.
 */
export function parseLocalRef(v: string): { letter?: string; position?: string } {
  const t = v.trim();
  if (!t || /^(opp|adj|at|nr|o\/s|outside|before|after|by)$/i.test(t)) return {};
  if (/^([A-Za-z]{1,2}\d{0,2}|\d+[A-Za-z]?|[A-Za-z]\.\d+)$/.test(t) && !/^(NE|NW|SE|SW|NB|SB|EB|WB)$/i.test(t)) return { letter: t };
  const words = t.split(/\s+/).map((w) => ABBR[w.toUpperCase()] ?? (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()));
  return { position: words.join(' ') };
}

const BEARING: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

function listText(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What to say about a stop or station entrance besides its name. Short is for passing it
 * ("north-west corner, stop K"); long adds the streets, lines and direction.
 */
export function stopDetail(p: Place, spot: Spot | null): { short: string; long: string } {
  const info = p.info ?? {};
  const ref = info.localRef ? parseLocalRef(info.localRef) : {};
  const entrance = p.category === 'station entrance';
  // "Exit 4, Oxford Street" already says it is entrance 4
  const inName = ref.letter && new RegExp(`(^|[^A-Za-z0-9])${ref.letter.replace(/[.]/g, '[.]')}($|[^A-Za-z0-9])`).test(p.name);
  const letter = ref.letter && !inName ? `${entrance ? 'entrance' : 'stop'} ${ref.letter}` : '';
  // what the stop's own tags say about where it stands beats the guess from the street layout
  const where = ref.position ?? spot?.where ?? '';
  let of = spot ? (where ? spot.of : `on ${spot.of.slice(3)}`) : '';
  // "south side of Illinois Street, at Gregory Street" rather than "south side of Illinois Street and Gregory Street"
  if (ref.position && spot?.corner && !/corner/.test(ref.position)) of = `of ${spot.street}, at ${spot.cross}`;
  const vehicles = p.category === 'tram stop' ? 'trams' : 'buses';
  let heading = '';
  const b = info.bearing ? BEARING[info.bearing.toUpperCase()] : undefined;
  if (b !== undefined) heading = `${vehicles} head ${compass8(b)}`;
  else if (spot?.travel && !entrance) heading = `${vehicles} ${spot.travel.sure ? '' : 'probably '}head ${compass8(spot.travel.dir)}`;
  // past the intersection or before it, when the direction of travel is known rather than guessed
  const going = b ?? (spot?.travel?.sure ? spot.travel.dir : undefined);
  const side =
    !entrance && going !== undefined && spot?.fromCross !== undefined && !/side/.test(where) ? (Math.abs(relAngle(going, spot.fromCross)) < 90 ? 'far side' : 'near side') : '';
  const routes = info.routeRef
    ? (() => {
        const r = info.routeRef.split(/\s*[;,]\s*/).filter(Boolean);
        return `${r.length === 1 ? 'route' : 'routes'} ${listText(r)}`;
      })()
    : '';
  const join = (xs: string[]) => xs.filter(Boolean).join(', ');
  return {
    short: join([where, side, letter]),
    long: join([where ? `${where} ${of}` : of, side, letter, routes, heading]),
  };
}

/** "Lines here: 5E to Lincoln Square, 12E to Orchard Downs." */
export function routesText(routes: StopRoute[]): string {
  if (!routes.length) return '';
  const shown = routes.slice(0, 6).map((r) => (r.to ? `${r.ref} to ${r.to}` : r.ref));
  return `Lines here: ${shown.join(', ')}${routes.length > 6 ? `, and ${routes.length - 6} more` : ''}.`;
}

/** For a crossing: the street it crosses and which side of the intersection it is on. */
export function crossingLeg(world: World, x: number, y: number, units: Units): string {
  const hit = world.nearestRoad(x, y, 8, isStreet);
  if (!hit) return '';
  const street = hit.seg.way.name;
  let best: { n: GNode; name: string; d: number } | null = null;
  for (const n of world.nodesNear(x, y, 150)) {
    const e = crossStreet(n, street);
    if (!e) continue;
    const d = dist(x, y, n.x, n.y);
    if (!best || d < best.d) best = { n, name: e.way.name, d };
  }
  if (!best || best.d < 3) return `over ${street}`;
  const side = compass8(along(hit.dir, bearing(best.n.x, best.n.y, x, y)));
  return `over ${street}, ${best.d > CORNER ? `${fmtDistance(best.d, units)} ` : ''}${side} of ${best.name}`;
}

// Rough boxes around the places that drive on the left, to guess which side of the street a
// stop serves. Only used when the street is two-way and the stop does not say.
const LEFT_HAND: [number, number, number, number][] = [
  [49.8, -11, 61, 1.8], // Britain and Ireland
  [30.2, 129.5, 41.6, 142.2], // Japan: Kyushu to northern Honshu
  [41.3, 139.3, 45.6, 145.9], // Hokkaido
  [24, 122.5, 28.5, 131.5], // Okinawa
  [-44, 112, -10, 154], // Australia
  [-48, 166, -34, 179], // New Zealand
  [6, 68, 30.5, 89], // India, Pakistan, Nepal, Bangladesh, Sri Lanka
  [-35, 16, -17, 33], // southern Africa
  [-12, 29, 4.2, 42], // Kenya, Uganda, Tanzania
  [-11, 95, 4.5, 141], // Indonesia, Malaysia, Singapore
  [5.5, 97.5, 20.5, 101.5], // Thailand
  [22.1, 113.8, 22.6, 114.5], // Hong Kong
];

// Right-hand places that the boxes above clip
const RIGHT_HAND: [number, number, number, number][] = [
  [50, 1.5, 50.99, 2.6], // Calais and Boulogne
  [-4.5, 28.8, -1, 30.9], // Rwanda and Burundi
];

const inBox = (lat: number, lon: number, [s, w, n, e]: [number, number, number, number]) => lat >= s && lat <= n && lon >= w && lon <= e;

export function drivesOnLeft(lat: number, lon: number): boolean {
  if (RIGHT_HAND.some((b) => inBox(lat, lon, b))) return false;
  return LEFT_HAND.some((b) => inBox(lat, lon, b));
}
