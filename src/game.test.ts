import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game, minutesText } from './game';
import { loadNotes, saveNotes } from './notes';
import { Projection } from './geo';
import { loadSettings } from './settings';
import { World, type Place } from './world';
import { fetchPlaces, fetchRoads, fetchRoadsBox, fetchStopRoutes, reverseGeocode } from './osm';
import { fetchTileArea } from './tiles';
import type { RawPlaces, RawRoads } from './osm';

vi.mock('./onlineRouter', () => ({ hasOnlineRouting: () => false, fetchOnlineRoute: vi.fn() }));
vi.mock('./osm', async (orig) => ({ ...(await orig<typeof import('./osm')>()), fetchRoads: vi.fn(), fetchPlaces: vi.fn(), fetchRoadsBox: vi.fn(), reverseGeocode: vi.fn(), fetchStopRoutes: vi.fn() }));
vi.mock('./tiles', () => ({ fetchTileArea: vi.fn() }));
vi.stubGlobal('requestAnimationFrame', () => 0);

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
});

vi.stubGlobal('window', { dispatchEvent: () => true });

const proj = new Projection({ lat: 51, lon: 0 });
const ll = (x: number, y: number) => proj.toLatLon(x, y);

// Oak Street runs north from (0,0) to (0,400); Elm Street crosses it at (0,200). A cafe sits beside Oak at (20,100).
function rawRoads(): RawRoads {
  const pts: [number, number, number][] = [[1, 0, 0], [2, 0, 200], [3, 0, 400], [4, -200, 200], [5, 200, 200]];
  const nodes = new Map(pts.map(([id, x, y]) => [id, ll(x, y)]));
  return {
    nodes,
    ways: [
      { id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Oak Street' } },
      { id: 11, nodes: [4, 2, 5], tags: { highway: 'residential', name: 'Elm Street' } },
    ],
  };
}

function buildWorld(): World {
  const world = new World(proj, rawRoads());
  const cafe = ll(20, 100);
  const places: RawPlaces = { places: [{ id: 'n1', lat: cafe.lat, lon: cafe.lon, tags: { amenity: 'cafe', name: 'Blue Cafe' } }], signals: new Set() };
  world.addPlaces(places);
  return world;
}

interface Harness {
  game: Game;
  said: string[];
  g: any; // private state is poked directly: Game has no injection seams
}

function setup(vehicle: 'walker' | 'car' = 'walker'): Harness {
  const said: string[] = [];
  const speech = { say: (t: string) => void said.push(t), stop() {}, review() {}, configure() {}, onSpeakingChange: undefined };
  const quiet = new Proxy({}, { get: (_t, p) => (p === 'now' ? 0 : p === 'ctx' ? { suspend: async () => {} } : () => {}) });
  const settings = { ...loadSettings(), vehicle, announcePlaces: true, roadAssist: false, units: 'metric' as const };
  const game = new Game(settings, speech as any, quiet as any, quiet as any);
  const g = game as any;
  g.proj = proj;
  g.world = buildWorld();
  g.x = 0;
  g.y = 50;
  g.heading = 0;
  return { game, said, g };
}

beforeEach(() => {
  memory.clear();
  vi.mocked(fetchRoads).mockReset().mockImplementation(async () => rawRoads());
  vi.mocked(fetchPlaces).mockReset().mockResolvedValue({ places: [], signals: new Set<number>() });
  vi.mocked(reverseGeocode).mockReset().mockResolvedValue('Testville');
  vi.mocked(fetchTileArea).mockReset().mockRejectedValue(new Error('no tiles'));
  vi.mocked(fetchStopRoutes).mockReset().mockResolvedValue([]);
});

describe('commands', () => {
  it('names the rebound key in the no-destination hint', () => {
    const { game, said, g } = setup();
    g.settings.keyBindings = { navigate: { key: 'k', ctrl: true } };
    game.run('i');
    expect(said.at(-1)).toBe('No destination. Press Control K to choose one.');
  });

  it('H reports compass heading', () => {
    const { game, said, g } = setup();
    g.heading = 90;
    game.run('h');
    expect(said.at(-1)).toBe('Facing east, 90 degrees.');
  });

  it('S says stopped, then the speed', () => {
    const { game, said, g } = setup();
    game.run('s');
    expect(said.at(-1)).toBe('Stopped.');
    g.speed = 5;
    game.run('s');
    expect(said.at(-1)).not.toBe('Stopped.');
  });

  it('toggles road assist and place announcements, and persists them', () => {
    const { game, said, g } = setup();
    game.run('a');
    expect(g.settings.roadAssist).toBe(true);
    expect(said.at(-1)).toBe('Road assist on.');
    game.run('p');
    expect(said.at(-1)).toBe('Place announcements off.');
    expect(JSON.parse(memory.get([...memory.keys()][0])!).announcePlaces).toBe(false);
  });

  it('number keys switch vehicle', () => {
    const { game, g } = setup();
    game.run('3');
    expect(g.vehicle.id).toBe('car');
  });

  it('refuses commands before a map is loaded', () => {
    const { game, said, g } = setup();
    g.world = null;
    game.run('h');
    expect(said.at(-1)).toMatch(/No map loaded|Still loading/);
  });

  it('PageUp / PageDown clamp volume to 0..1', () => {
    const { game, g } = setup();
    g.settings.volume = 0.95;
    game.run('PageUp');
    expect(g.settings.volume).toBe(1);
    g.settings.volume = 0.05;
    game.run('PageDown');
    game.run('PageDown');
    expect(g.settings.volume).toBe(0);
  });
});

describe('movement', () => {
  it('moves north when facing north and accelerating', () => {
    const { g } = setup();
    g.input.isDown = (c: string) => c === 'ArrowUp';
    for (let i = 0; i < 120; i++) g.step(1 / 60);
    expect(g.speed).toBeGreaterThan(0);
    expect(g.y).toBeGreaterThan(50);
    expect(Math.abs(g.x)).toBeLessThan(0.01);
  });

  it('never exceeds the vehicle top speed', () => {
    const { g } = setup('car');
    g.input.isDown = (c: string) => c === 'ArrowUp';
    for (let i = 0; i < 60 * 60; i++) g.step(1 / 60);
    expect(g.speed).toBeLessThanOrEqual(g.vehicle.maxSpeed);
  });

  it('turn wraps heading into 0..360', () => {
    const { g } = setup();
    g.turn(-10);
    expect(g.heading).toBeCloseTo(350);
    g.turn(20);
    expect(g.heading).toBeCloseTo(10);
  });
});

describe('road awareness', () => {
  it('names the street being walked along', () => {
    const { g } = setup();
    g.updateRoad(true);
    expect(g.onRoad).toBe(true);
    expect(g.road.name).toBe('Oak Street');
  });

  it('goes off road far from any street', () => {
    const { g } = setup();
    g.x = 500;
    g.updateRoad(true);
    expect(g.onRoad).toBe(false);
  });

  it('announces a nearby place once, not again within the repeat window', () => {
    const { g, said } = setup();
    g.y = 90; // inside the walker's pass radius
    g.speed = 1.3;
    g.clock = 10;
    g.checkPlaces();
    expect(said.filter((s) => s.startsWith('Blue Cafe'))).toHaveLength(1);
    g.clock = 20;
    g.checkPlaces();
    expect(said.filter((s) => s.startsWith('Blue Cafe'))).toHaveLength(1);
  });

  it('stays quiet about places when announcements are off or stopped', () => {
    const { g, said } = setup();
    g.y = 90;
    g.speed = 0;
    g.clock = 10;
    g.checkPlaces();
    g.speed = 1.3;
    g.settings.announcePlaces = false;
    g.checkPlaces();
    expect(said).toHaveLength(0);
  });
});

describe('destination', () => {
  it('setTarget speaks distance and direction', () => {
    const { g, said } = setup();
    g.settings.turnByTurn = false;
    g.setTarget({ name: 'Blue Cafe', x: 20, y: 100 });
    expect(said.at(-1)).toMatch(/^Destination Blue Cafe, .* at \d+ o'clock\. Follow the beacon\.$/);
    expect(g.dest.name).toBe('Blue Cafe');
  });

  it('refuses a destination you are already standing at', () => {
    const { g, said } = setup();
    g.setTarget({ name: 'Here', x: 0, y: 50 });
    expect(said.at(-1)).toBe('You are already at Here.');
    expect(g.dest).toBeNull();
  });

  it('D with no destination says so; with one, reports straight-line distance', () => {
    const { game, g, said } = setup();
    game.run('d');
    expect(said.at(-1)).toMatch(/No destination/);
    g.settings.turnByTurn = false;
    g.setTarget({ name: 'Elm', x: 0, y: 200 });
    g.lastDPress = -Infinity;
    g.clock = 1;
    game.run('d');
    expect(said.at(-1)).toMatch(/^Elm: .* in a straight line, north\.$/);
  });

  it('Backspace clears the destination', () => {
    const { game, g } = setup();
    g.settings.turnByTurn = false;
    g.setTarget({ name: 'Elm', x: 0, y: 200 });
    game.run('Backspace');
    expect(g.dest).toBeNull();
  });
});

describe('places', () => {
  it('findPlaces matches by name or category, nearest first, empty for blank query', () => {
    const { game } = setup();
    expect(game.findPlaces('blue')).toHaveLength(1);
    expect(game.findPlaces('cafe')[0].name).toBe('Blue Cafe');
    expect(game.findPlaces('zzz')).toEqual([]);
    expect(game.findPlaces('  ')).toEqual([]);
  });

  it('Tab browses nearby places and Enter sets one as destination', () => {
    const { game, g, said } = setup();
    g.settings.turnByTurn = false;
    game.run('Tab', {});
    expect(said.at(-1)).toMatch(/^Blue Cafe, cafe, .* 1 of 1$/);
    game.run('Enter');
    expect(g.dest.name).toBe('Blue Cafe');
  });

  it('Enter without browsing prompts for Tab', () => {
    const { game, said } = setup();
    game.run('Enter');
    expect(said.at(-1)).toBe('Press Tab to choose a place first.');
  });
});

describe('notes', () => {
  it('addNote saves, announces when near, and Shift+V deletes it', () => {
    const { game, g, said } = setup();
    game.addNote('loose paving');
    expect(g.notes).toHaveLength(1);
    g.clock = 5;
    g.checkNotes();
    expect(said.at(-1)).toBe('Note: loose paving');
    game.run('v', { shift: true });
    expect(said.at(-1)).toBe('Note deleted.');
    expect(g.notes).toHaveLength(0);
  });

  it('Shift+V deletes the right note after another tab added one', () => {
    const { game } = setup();
    game.addNote('here');
    saveNotes([{ text: 'elsewhere', lat: 10, lon: 10 }, ...loadNotes()]);
    game.run('v', { shift: true });
    expect(loadNotes().map((n) => n.text)).toEqual(['elsewhere']);
  });

  it('Shift+V far from any note reports none', () => {
    const { game, said } = setup();
    game.run('v', { shift: true });
    expect(said.at(-1)).toBe('No note within 25 metres.');
  });
});

describe('E where am I', () => {
  it('speaks the full text with the area once the lookup returns', async () => {
    const { game, said } = setup();
    game.run('e');
    await vi.waitFor(() => expect(said.length).toBe(1));
    expect(said[0]).toContain('Testville');
    expect(said[0]).toContain('Nearest landmark: Blue Cafe');
  });

  it('still speaks the full text after 2.5 s when the lookup hangs', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(reverseGeocode).mockReturnValue(new Promise(() => {}));
      const { game, said } = setup();
      game.run('e');
      await vi.advanceTimersByTimeAsync(2499);
      expect(said).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(said.length).toBe(1);
      expect(said[0]).toContain('Nearest landmark: Blue Cafe');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('position helpers', () => {
  it('position and toXY round-trip', () => {
    const { game, g } = setup();
    g.x = 30;
    g.y = 70;
    const p = game.toXY(game.position!);
    expect(p.x).toBeCloseTo(30, 1);
    expect(p.y).toBeCloseTo(70, 1);
  });

  it('describeFromHere gives distance and compass point', () => {
    const { game } = setup();
    const p = ll(0, 250); // 200 m north of the start at y=50
    expect(game.describeFromHere(p.lat, p.lon)).toBe('200 metres north');
  });

  it('currentTrip is null without a destination', () => {
    expect(setup().game.currentTrip()).toBeNull();
  });
});

describe('turn-by-turn', () => {
  const route = (dest: { name: string; x: number; y: number }) => {
    const h = setup();
    h.g.settings.turnByTurn = true;
    h.g.setTarget(dest);
    return h;
  };

  it('plans a route on the loaded map and announces it', () => {
    const { g, said } = route({ name: 'Far End', x: 0, y: 380 });
    expect(g.route).not.toBeNull();
    expect(g.route.length).toBeGreaterThan(300);
    expect(said.at(-1)).toMatch(/^Route .*Far End/);
  });

  it('announces a right turn onto Elm Street', () => {
    const { said } = route({ name: 'East End', x: 190, y: 200 });
    expect(said.at(-1)).toMatch(/right/i);
    expect(said.at(-1)).toMatch(/Elm Street/);
  });

  it('says the destination is too far to plan offline beyond the corridor limit', () => {
    const { g, said } = route({ name: 'Faraway', x: 0, y: 9000 });
    expect(g.route).toBeNull();
    expect(said.at(-1)).toMatch(/too far to plan offline/);
  });

  it('loads a corridor for a distant destination, then plans a partial route as far as the streets go', async () => {
    vi.mocked(fetchRoadsBox).mockResolvedValue({ ...rawRoads(), box: undefined });
    const { g, said } = route({ name: 'Island', x: 3000, y: 3000 });
    expect(said.at(-1)).toMatch(/^Loading the streets toward the destination/);
    await vi.waitFor(() => expect(g.route).not.toBeNull());
    expect(g.route.partial).toBe(true);
    expect(said.at(-1)).toMatch(/as far as the map has loaded/);
  });

  it('turn by turn off clears the route; helicopter never gets one', () => {
    const { game, g, said } = route({ name: 'Far End', x: 0, y: 380 });
    game.run('t');
    expect(g.route).toBeNull();
    expect(said.at(-1)).toMatch(/^Turn by turn off/);
    g.setVehicle('helicopter', false);
    game.run('t');
    expect(said.at(-1)).toMatch(/not available in the helicopter/);
  });

  it('re-plans after being off the route for a few seconds', () => {
    const { g, said } = route({ name: 'Far End', x: 0, y: 380 });
    g.x = 120;
    g.clock = 100;
    g.updateRoute();
    expect(said.at(-1)).not.toBe('Off route. Recalculating.');
    g.clock = 104;
    g.updateRoute();
    expect(said).toContain('Off route. Recalculating.');
  });

  it('warns when travelling back along the route', () => {
    const { g, said } = route({ name: 'Far End', x: 0, y: 380 });
    g.speed = 1.3;
    g.y = 300;
    g.updateRoute();
    g.y = 200;
    g.clock = 50;
    g.updateRoute();
    expect(said.at(-1)).toBe('Wrong way. Turn around.');
  });

  it('arriving clears destination and route and summarises the trip', () => {
    const { g, said } = route({ name: 'Far End', x: 0, y: 380 });
    g.y = 375;
    g.updateDestination();
    expect(said.at(-1)).toMatch(/^Arrived at Far End\./);
    expect(g.dest).toBeNull();
    expect(g.route).toBeNull();
    expect(g.lastTrip).toMatch(/^Last trip to Far End/);
  });

  it('speaks distance milestones on the way', () => {
    const { g, said } = route({ name: 'Far End', x: 0, y: 380 });
    g.y = 250;
    g.updateRoute();
    g.updateDestination();
    expect(said.some((t) => /^Far End, .* to go\.$/.test(t))).toBe(true);
  });
});

describe('start / load', () => {
  it('loads the map, snaps onto the nearest road and says ready', async () => {
    const { game, g, said } = setup();
    g.world = null;
    await game.start({ lat: 51, lon: 0 }, 'Testville');
    expect(said[0]).toBe('Loading map data for Testville. Please wait.');
    expect(g.world).not.toBeNull();
    expect(g.streetName).toBe('Oak Street');
    expect(said.at(-1)).toMatch(/^Ready\. .*On Oak Street, facing .*Testville\..* 2 roads/);
    game.pause();
  });

  it('reports failure when roads and tiles both fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchRoads).mockRejectedValue(new Error('busy'));
    const { game, g, said } = setup();
    g.world = null;
    await game.start({ lat: 51, lon: 0 });
    expect(g.world).toBeNull();
    expect(said.at(-1)).toMatch(/^Could not load map data/);
    expect(g.nextLoadTry).toBeGreaterThan(g.clock);
    game.pause();
  });

  it('says so when the area has no roads', async () => {
    vi.mocked(fetchRoads).mockResolvedValue({ nodes: new Map(), ways: [] });
    const { game, g, said } = setup();
    g.world = null;
    await game.start({ lat: 51, lon: 0 });
    expect(said.some((t) => t.startsWith('No roads found here'))).toBe(true);
    game.pause();
  });

  it('start clears the previous destination and route', async () => {
    const { game, g } = setup();
    g.setTarget({ name: 'Elm', x: 0, y: 200 });
    await game.start({ lat: 51, lon: 0 });
    expect(g.dest).toBeNull();
    expect(g.route).toBeNull();
    game.pause();
  });
});

describe('roundabouts', () => {
  // Ring of radius 25 about the origin, one-way clockwise, with a road leaving north and another south.
  function ringWorld(): World {
    const R = 25;
    const ring = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return [100 + i, Math.sin(a) * R, Math.cos(a) * R] as [number, number, number];
    });
    const nodes = new Map<number, { lat: number; lon: number }>(ring.map(([id, x, y]) => [id, ll(x, y)]));
    nodes.set(1, ll(0, 200));
    nodes.set(2, ll(0, -200));
    return new World(proj, {
      nodes,
      ways: [
        { id: 20, nodes: [...ring.map(([id]) => id), 100], tags: { highway: 'residential', junction: 'roundabout' } },
        { id: 21, nodes: [100, 1], tags: { highway: 'residential', name: 'North Road' } },
        { id: 22, nodes: [104, 2], tags: { highway: 'residential', name: 'South Road' } },
      ],
    });
  }

  it('enters ring state on the roundabout and leaves it after moving away', () => {
    const { g } = setup('car');
    g.world = ringWorld();
    g.x = 25;
    g.y = 0;
    g.heading = 180;
    g.speed = 5;
    g.updateRoad(true);
    g.updateRing();
    expect(g.ring).not.toBeNull();
    expect(g.ring.exits.length).toBeGreaterThan(0);
    g.x = 0;
    g.y = 150;
    g.updateRoad(true);
    for (let i = 0; i < 400; i++) {
      g.clock += 1 / 60;
      g.updateRing();
    }
    expect(g.ring).toBeNull();
  });

  it('keeps the ring through a brief swerve off it', () => {
    const { g } = setup('car');
    g.world = ringWorld();
    g.x = 25;
    g.y = 0;
    g.heading = 180;
    g.speed = 5;
    g.updateRoad(true);
    g.updateRing();
    g.x = 0;
    g.y = 150;
    g.updateRoad(true);
    for (let i = 0; i < 3; i++) {
      g.clock += 1 / 60;
      g.updateRing();
    }
    expect(g.ring).not.toBeNull();
  });
});

describe('grid mode', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function gridSetup() {
    const h = setup();
    const at = vi.fn(async () => ({ key: 'park1', kind: 'park', name: 'Oak Park', sound: 'green' }));
    h.g.areas = { at, has: () => true };
    h.g.loadCenter = { x: 0, y: 0 };
    return { ...h, at };
  }

  it('F3 turns it on and says what is here; F3 again turns it off', async () => {
    const { game, said, g } = gridSetup();
    game.run('F3');
    await flush();
    expect(g.grid).not.toBeNull();
    expect(said.at(-1)).toMatch(/^Grid mode, up is north\. .*Oak Street\.$/);
    game.run('F3');
    expect(g.grid).toBeNull();
    expect(said.at(-1)).toMatch(/^Grid mode off/);
  });

  it('arrows step by compass direction, whatever the heading', async () => {
    const { game, g } = gridSetup();
    g.heading = 90;
    game.run('F3');
    game.run('ArrowUp');
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo(60);
    game.run('ArrowRight');
    expect(g.x).toBeCloseTo(10);
    game.run('ArrowDown');
    game.run('ArrowLeft');
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo(50);
    expect(g.speed).toBe(0);
  });

  it('speaks an area only on entering it; Space repeats it', async () => {
    const { game, said, g } = gridSetup();
    game.run('F3');
    await flush();
    game.run('ArrowRight'); // off Oak Street into the park
    await flush();
    expect(said.at(-1)).toBe('Oak Park.');
    const n = said.length;
    game.run('ArrowRight');
    await flush();
    expect(said.length).toBe(n);
    game.run(' ');
    await flush();
    expect(said.at(-1)).toBe('Oak Park.');
    expect(g.grid.key).toBe('park1');
  });

  it('minus and equals change the step between 1 and 1000', () => {
    const { game, said, g } = gridSetup();
    game.run('F3');
    game.run('=');
    expect(said.at(-1)).toBe('Step 100 metres.');
    game.run('=');
    game.run('=');
    expect(said.at(-1)).toBe('Largest step, 1000 metres.');
    for (let i = 0; i < 4; i++) game.run('-');
    expect(said.at(-1)).toBe('Smallest step, 1 metre.');
    game.run('ArrowUp');
    expect(g.y).toBeCloseTo(51);
  });

  it('uses yards with imperial units', () => {
    const { game, said, g } = gridSetup();
    g.settings.units = 'imperial';
    game.run('F3');
    game.run('=');
    expect(said.at(-1)).toBe('Step 100 yards.');
    game.run('ArrowUp');
    expect(g.y).toBeCloseTo(50 + 91.44);
  });

  it('cannot start while live GPS is on', () => {
    const { game, said, g } = gridSetup();
    g.live = {};
    game.run('F3');
    expect(g.grid).toBeNull();
    expect(said.at(-1)).toMatch(/Live GPS is on/);
  });
});

describe('stops, entrances and crossings', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const at = (x: number, y: number) => ll(x, y);
  const destSaid = (said: string[]) => [...said].reverse().find((t) => t.startsWith('Destination'));
  // Oak Street runs north at x = 0 and Elm Street east at y = 200 (see rawRoads)
  function withStops() {
    const h = setup();
    const p = (id: string, x: number, y: number, tags: Record<string, string>) => ({ id, ...at(x, y), tags });
    h.g.world.addPlaces({
      signals: new Set(),
      places: [
        p('n101', -8, 192, { highway: 'bus_stop', name: 'Oak & Elm' }),
        p('n102', 30, 200, { highway: 'bus_stop', name: 'Elm Street Stop' }),
        p('n103', 8, 215, { highway: 'bus_stop', name: 'Oak & Elm', local_ref: 'K' }),
      ],
    });
    return h;
  }

  it('X keeps the stops of one intersection together and says which corner', () => {
    const { game, said, g } = withStops();
    game.run('x');
    expect(g.dest.placeId).toBe('n101');
    expect(destSaid(said)).toMatch(/^Destination Oak & Elm, south-west corner of (Oak Street and Elm Street|Elm Street and Oak Street), buses probably head/);
    game.run('x');
    expect(g.dest.placeId).toBe('n103'); // the other Oak & Elm stop, though Elm Street Stop is nearer
    expect(destSaid(said)).toMatch(/north-east corner .*stop K/);
    game.run('x');
    expect(g.dest.placeId).toBe('n102');
  });

  it('looks up the lines at a chosen stop and repeats them with G', async () => {
    vi.mocked(fetchStopRoutes).mockResolvedValue([{ ref: '5E', to: 'Lincoln Square' }]);
    const { game, said } = withStops();
    game.run('x');
    await flush();
    expect(fetchStopRoutes).toHaveBeenCalledWith(101);
    expect(said).toContain('Lines here: 5E to Lincoln Square.');
    game.run('g');
    expect(said.at(-1)).toMatch(/Lines here: 5E to Lincoln Square\.$/);
  });

  it('guides to the main door of a place mapped as a building', () => {
    const { game, said, g } = setup();
    g.world.addPlaces({
      signals: new Set(),
      places: [
        {
          id: 'w9',
          ...at(40, 100),
          tags: { amenity: 'library', name: 'Oak Library' },
          entrances: [
            { ...at(60, 110), tags: { entrance: 'yes' } },
            { ...at(10, 100), tags: { entrance: 'main', wheelchair: 'yes' } },
          ],
        },
      ],
    });
    const lib = g.world.places.find((p: Place) => p.name === 'Oak Library');
    game.setTarget(g.targetFor(lib));
    expect(g.dest.x).toBeCloseTo(10, 0);
    expect(destSaid(said)).toMatch(/^Destination Oak Library, main entrance on Oak Street, wheelchair accessible,/);
  });

  it('names the street a crossing goes over and what it offers', () => {
    const { said, g } = setup();
    g.world.addPlaces({ signals: new Set(), places: [], crossings: [{ ...at(0, 180), text: 'Crossing with signals', extras: ['audible signal', 'push button'] }] });
    g.y = 160;
    g.speed = 1;
    g.checkHazards();
    expect(said.at(-1)).toBe('Crossing with signals ahead, 20 metres, over Oak Street, south of Elm Street. Audible signal, push button');
  });
});

describe('minutesText', () => {
  it('pluralises hours and minutes and drops zero minutes', () => {
    expect([1, 59, 60, 61, 120, 121, 181].map(minutesText)).toEqual(['1 minute', '59 minutes', '1 hour', '1 hour 1 minute', '2 hours', '2 hours 1 minute', '3 hours 1 minute']);
  });
});

describe('hold (touch and voice)', () => {
  it('announces the speed change when a held brake lets go', () => {
    const { game, said, g } = setup();
    g.speed = 5;
    game.hold('Slash', true);
    g.speed = 0;
    game.hold('Slash', false);
    expect(said.at(-1)).toBe('Stopped.');
  });
});
