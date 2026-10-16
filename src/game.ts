// Game loop: vehicle physics, road awareness, announcements and keyboard commands.

import { AudioEngine } from './audio/audio';
import { Input, type Command } from './input';
import { MapView } from './mapview';
import { fetchPlaces, fetchRoads, reverseGeocode } from './osm';
import { Projection, bearing as bearingTo, pointSeg, clockDir, compass16, compass8, dist, normDeg, relAngle, sideWord, type LatLon } from './geo';
import { fmtDistance, fmtSpeed, fmtSpeedShort, saveSettings, type Settings, type VehicleId } from './settings';
import { Speech } from './speech';
import { maneuverText, planRoute, pointAlong, type Route, type RouteOptions } from './router';
import { VEHICLES, roadHalfWidth, type VehicleProfile } from './vehicles';
import { World, type Edge, type GNode, type Junction, type Place, type Way } from './world';

const STEP = 1 / 60;
/** distances (m) at which progress toward the destination is spoken */
const MILESTONES = [50, 100, 200, 500, 1000, 2000, 5000];
const ROUGH = new Set(['gravel', 'dirt', 'unpaved', 'ground', 'grass', 'sand', 'cobblestone', 'sett', 'compacted', 'fine_gravel', 'mud', 'pebblestone', 'wood']);

export interface Hud {
  street: string;
  speed: string;
  heading: string;
  area: string;
  destination: string;
  status: string;
}

interface Target {
  name: string;
  x: number;
  y: number;
  /** size of the target area; you arrive when within this distance (or the vehicle's usual radius) */
  radius?: number;
}

export interface PlaceMatch {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

interface StepEntry {
  ahead: Ahead;
  key: number;
  /** distance along the road beyond the first (next) intersection */
  cum: number;
  /** street travelled to reach it */
  via: string;
}

interface Ahead {
  node: GNode;
  /** distance along the road (straight-line distance for the off-road fallback) */
  forward: number;
  /** direction of travel when arriving at the node */
  arrival: number;
  deadEnd: boolean;
  /** street we arrive on */
  arriveName: string;
}

export class Game {
  private proj!: Projection;
  private world: World | null = null;
  private loadCenter = { x: 0, y: 0 };
  private loading = false;
  private nextLoadTry = 0;
  private loadAbort: AbortController | null = null;
  private areaName = '';

  private x = 0;
  private y = 0;
  private heading = 0;
  private speed = 0;
  private throttle = 0;
  private vehicle: VehicleProfile;

  private running = false;
  private paused = false;
  private lastFrame = 0;
  private acc = 0;
  private clock = 0;

  // road state
  private road: Way | null = null;
  private onRoad = false;
  private candName: string | null = null;
  private candSince = 0;
  private streetName: string | null = null;
  private wasOffRoad = false;

  // announcements
  private ahead: Ahead | null = null;
  private announcedNodes = new Map<number, number>();
  private announcedPlaces = new Map<string, number>();
  private nextPlaceCheck = 0;
  private nextAheadCheck = 0;
  /** member nodes of the junction the traveller is standing in, if any */
  private inJunction: Set<number> | null = null;
  /** junction last described by N, so repeats can be short */
  private lastN: number | null = null;
  /** intersections stepped through with period / comma */
  private stepCursor: { list: StepEntry[]; idx: number } | null = null;
  private aheadAt = 0;
  private nextProxBeep = 0;
  private lastPlaceSpoken = 0;

  // turning
  private turnHold: { dir: -1 | 1; since: number } | null = null;
  private turnedDuringHold = false;
  private lastManualTurn = -10;
  private speedAtPress = 0;

  // destination / place browsing
  private dest: Target | null = null;
  private nextBeacon = 0;

  // turn-by-turn
  private route: Route | null = null;
  private routeIdx = 0;
  private routeProg = 0;
  private nextMan = 0;
  private spokenSteps = new Set<number>();
  private offRouteSince = -1;
  private lastRouteCalc = -1e9;
  private nextRouteCheck = 0;
  private destMilestone = Infinity;
  private browse: { list: Place[]; idx: number; x: number; y: number } | null = null;

  private nextHud = 0;
  private nextMap = 0;

  readonly input = new Input();
  onHud?: (h: Hud) => void;
  onMenu?: (focus: 'main' | 'search') => void;
  onNavigate?: () => void;

  constructor(
    private settings: Settings,
    private speech: Speech,
    private audio: AudioEngine,
    private map: MapView,
  ) {
    this.vehicle = VEHICLES[settings.vehicle];
    this.input.onCommand = (c) => this.command(c);
    this.input.onKeyUp = (code) => this.keyUp(code);
    this.speech.onSpeakingChange = (s) => this.audio.duck(s);
  }

  // ---------------- lifecycle ----------------

  async start(center: LatLon, placeName?: string) {
    this.loadAbort?.abort();
    this.proj = new Projection(center);
    this.x = 0;
    this.y = 0;
    this.speed = 0;
    this.world = null;
    this.road = null;
    this.streetName = null;
    this.dest = null;
    this.browse = null;
    this.announcedNodes.clear();
    this.announcedPlaces.clear();
    this.inJunction = null;
    this.lastN = null;
    this.stepCursor = null;
    this.clearRoute();
    this.map.resetTrail();
    this.map.setDestination(null);
    this.audio.setVehicle(this.vehicle.id);
    this.audio.resume();
    this.paused = false;
    if (!this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      requestAnimationFrame(this.frame);
    }

    this.speech.say(`Loading map data${placeName ? ` for ${placeName}` : ''}. Please wait.`, 'high');
    const stopHeartbeat = this.loadingHeartbeat();
    const ok = await this.load(true);
    stopHeartbeat();
    const world = this.world as World | null; // assigned during load()
    if (!ok || !world) return;

    // put the traveller on the nearest suitable road, facing along it
    if (this.vehicle.id !== 'helicopter') {
      const hit =
        world.nearestRoad(0, 0, 400, this.filter) ?? world.nearestRoad(0, 0, 400);
      if (hit) {
        this.x = hit.hit.px;
        this.y = hit.hit.py;
        this.heading = Math.round(hit.dir);
      }
    }
    this.updateRoad(true);
    this.audio.loaded();
    const where = this.streetName ? `On ${this.streetName}` : 'Not on a road';
    this.speech.say(
      `Ready. ${this.vehicle.name}. ${where}, facing ${compass16(this.heading)}.` +
        `${this.areaName ? ` ${this.areaName}.` : ''} ${world.ways.length} roads loaded.` +
        ` Hold up arrow to move. Press F1 for help.`,
      'normal',
    );
  }

  /** Soft pulse and occasional spoken update so a long load is never silent. */
  private loadingHeartbeat(): () => void {
    let beats = 0;
    const id = setInterval(() => {
      beats++;
      this.audio.tone(392, { dur: 0.08, level: 0.04, type: 'sine' });
      if (beats % 10 === 0) this.speech.say('Still loading map data.', 'normal');
    }, 1500);
    return () => clearInterval(id);
  }

  private async load(initial: boolean): Promise<boolean> {
    this.loading = true;
    const center = this.proj.toLatLon(this.x, this.y);
    const at = { x: this.x, y: this.y };
    const radius = this.vehicle.loadRadius;
    const abort = (this.loadAbort = new AbortController());
    let warned = false;
    const onRetry = () => {
      if (initial && !warned) {
        warned = true;
        this.speech.say('The map server is busy. Still trying.', 'normal');
      }
    };
    try {
      const areaP = reverseGeocode(center);
      const placesP = fetchPlaces(center, radius, abort.signal, onRetry);
      placesP.catch(() => undefined); // handled below; avoid unhandled-rejection noise
      const world = new World(this.proj, await fetchRoads(center, radius, abort.signal, onRetry));

      if (initial) {
        if (world.isEmpty) {
          this.audio.error();
          this.speech.say('No roads found here. Press Escape to choose another location.', 'high');
        }
        // start moving on roads right away; places arrive when ready
        placesP.then(
          (p) => {
            if (this.world !== world) return;
            world.addPlaces(p);
            this.speech.say(`${world.places.length} places loaded.`, 'low');
          },
          () => {
            if (!abort.signal.aborted && this.world === world) this.speech.say('Could not load places. Roads are available.', 'normal');
          },
        );
      } else {
        // swap in the new area only once it is complete, so nothing disappears while moving
        try {
          world.addPlaces(await placesP);
        } catch (e) {
          if (abort.signal.aborted) throw e;
          console.warn('places failed', e);
        }
      }

      this.world = world;
      if (this.dest && this.settings.turnByTurn && (!this.route || this.route.partial)) this.computeRoute(false);
      this.loadCenter = at;
      const area = await areaP;
      if (area) {
        if (!initial && area !== this.areaName) this.speech.say(`Entering ${area}`, 'low');
        this.areaName = area;
      }
      return true;
    } catch (e) {
      if (abort.signal.aborted) return false;
      console.error(e);
      this.audio.error();
      this.speech.say(
        initial
          ? 'Could not load map data. The map server may be busy. Press Escape, then Start to try again.'
          : 'Could not load more map data. Will retry shortly.',
        'high',
      );
      this.nextLoadTry = this.clock + 20;
      return false;
    } finally {
      if (this.loadAbort === abort) this.loading = false;
    }
  }

  focus(el: HTMLElement) {
    this.input.attach(el);
    el.focus();
  }

  pause() {
    this.paused = true;
    this.speed = 0;
    this.audio.update({ speed: 0, maxSpeed: 1, throttle: 0, surface: 'paved', tunnel: false }, STEP);
    this.audio.setRumble(0, 0, 10);
    void this.audio.ctx.suspend();
  }

  resume() {
    this.paused = false;
    this.lastFrame = performance.now();
    this.audio.resume();
  }

  get isStarted() {
    return !!this.proj;
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.speech.configure(s.speechMode, s.voiceRate);
    this.audio.setVolume(s.volume);
    this.map.headingUp = s.headingUpMap;
    if (s.vehicle !== this.vehicle.id) this.setVehicle(s.vehicle, false);
  }

  private setVehicle(id: VehicleId, announce: boolean) {
    const prevRadius = this.vehicle.loadRadius;
    this.vehicle = VEHICLES[id];
    this.settings.vehicle = id;
    saveSettings(this.settings);
    this.speed = Math.min(this.speed, this.vehicle.maxSpeed);
    this.audio.setVehicle(id);
    if (this.dest && this.world) {
      if (this.settings.turnByTurn && id !== 'helicopter') this.computeRoute(announce);
      else this.clearRoute();
    }
    this.announcedNodes.clear();
    if (announce) {
      this.speech.say(`${this.vehicle.name}. Top speed ${fmtSpeedShort(this.vehicle.maxSpeed, this.settings.units)}.`, 'high');
    }
    if (this.proj && this.vehicle.loadRadius > prevRadius && !this.loading) void this.load(false);
  }

  // ---------------- loop ----------------

  private frame = (t: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.25, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    if (this.paused || !this.world) return;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.audio.update(
      {
        speed: this.speed,
        maxSpeed: this.vehicle.maxSpeed,
        throttle: this.throttle,
        surface: !this.onRoad && this.vehicle.id !== 'helicopter' ? 'offroad' : this.road?.surface && ROUGH.has(this.road.surface) ? 'rough' : 'paved',
        tunnel: !!this.road?.tunnel && this.onRoad,
      },
      dt,
    );
    if (t > this.nextMap) {
      this.nextMap = t + 33;
      this.map.update(this.proj.toLatLon(this.x, this.y), this.heading, this.speed);
    }
    if (t > this.nextHud) {
      this.nextHud = t + 200;
      this.emitHud();
    }
  };

  private step(dt: number) {
    this.clock += dt;
    const v = this.vehicle;
    const inp = this.input;

    // --- speed ---
    this.throttle = 0;
    if (inp.isDown('ArrowUp') && !inp.isDown('ControlLeft') && !inp.isDown('ControlRight')) {
      this.speed += v.accel * dt;
      this.throttle = 1;
    }
    if (inp.isDown('ArrowDown')) {
      this.speed -= v.decel * dt;
      this.throttle = -1;
    }
    if (inp.isDown('Slash')) {
      this.speed -= v.brake * dt;
      this.throttle = -1;
    }
    let max = v.maxSpeed;
    if (v.offRoadMax !== null && !this.onRoad) max = Math.min(max, v.offRoadMax);
    if (this.speed > max) this.speed = Math.max(max, this.speed - v.brake * dt);
    this.speed = Math.max(0, Math.min(v.maxSpeed, this.speed));

    // --- continuous turning after a short hold ---
    if (this.turnHold) {
      const code = this.turnHold.dir < 0 ? 'ArrowLeft' : 'ArrowRight';
      if (!inp.isDown(code)) this.turnHold = null;
      else if (this.clock - this.turnHold.since > 0.35) {
        this.turn(this.turnHold.dir * v.turnRate * (inp.shift ? 2 : 1) * dt);
      }
    }

    if (this.settings.roadAssist) this.assist(dt);

    // --- move ---
    const r = (this.heading * Math.PI) / 180;
    this.x += Math.sin(r) * this.speed * dt;
    this.y += Math.cos(r) * this.speed * dt;

    this.updateRoad(false);
    this.updateRumble();
    this.checkInJunction();

    if (this.clock > this.nextAheadCheck) {
      this.nextAheadCheck = this.clock + 0.1;
      this.checkAhead();
    }
    this.updateProximityBeeps();
    if (this.route && this.clock > this.nextRouteCheck) {
      this.nextRouteCheck = this.clock + 0.1;
      this.updateRoute();
    }
    if (this.clock > this.nextPlaceCheck) {
      this.nextPlaceCheck = this.clock + 0.25;
      this.checkPlaces();
    }
    this.updateDestination();

    if (!this.loading && this.clock > this.nextLoadTry && dist(this.x, this.y, this.loadCenter.x, this.loadCenter.y) > v.loadRadius * 0.55) {
      void this.load(false);
    }
  }

  /**
   * Lane keeping: while on a road and not steering, ease the heading along the road and toward
   * its centre. Gives up when the traveller deliberately points more than 20° away from the road.
   */
  private assist(dt: number) {
    if (!this.onRoad || !this.road || this.speed < 0.5 || this.vehicle.id === 'helicopter') return;
    if (this.input.isDown('ArrowLeft') || this.input.isDown('ArrowRight')) return;
    if (this.clock - this.lastManualTurn < 1.5) return;
    const w = this.world!;
    const name = this.road.name;
    const same = (wy: Way) => wy.name === name && this.vehicle.canUse(wy);
    const reach = roadHalfWidth(this.road.type) + 6;

    // intent: compare with the road direction where we are now
    const here = w.nearestRoad(this.x, this.y, reach, same);
    if (!here) return;
    const hereDir = Math.abs(relAngle(this.heading, here.dir)) > 90 ? normDeg(here.dir + 180) : here.dir;
    if (Math.abs(relAngle(this.heading, hereDir)) > 25) return; // deliberately pointing elsewhere

    // steering: aim at the centre line a little ahead so bends are anticipated
    const look = this.speed * 0.6 + 3;
    const r = (this.heading * Math.PI) / 180;
    const ahead = w.nearestRoad(this.x + Math.sin(r) * look, this.y + Math.cos(r) * look, reach + 4, same) ?? here;
    const dir = Math.abs(relAngle(hereDir, ahead.dir)) > 90 ? normDeg(ahead.dir + 180) : ahead.dir;
    const target = bearingTo(this.x, this.y, ahead.hit.px, ahead.hit.py);
    const toCentre = relAngle(dir, target);
    const aim = dir + Math.max(-25, Math.min(25, toCentre)); // follow the road, drifting back to its centre
    const err = relAngle(this.heading, aim);
    const maxStep = this.vehicle.turnRate * 1.5 * dt;
    this.heading = normDeg(this.heading + Math.max(-maxStep, Math.min(maxStep, err * Math.min(1, dt * 4))));
  }

  private turn(deg: number) {
    const before = this.heading;
    this.heading = normDeg(this.heading + deg);
    this.lastManualTurn = this.clock;
    this.turnedDuringHold = true;
    if (!this.settings.compassTicks) return;
    const a = Math.floor(before / 10);
    const b = Math.floor(this.heading / 10);
    if (a !== b) {
      // crossed a 10° line; which one depends on direction
      const line = deg > 0 ? b * 10 : a * 10;
      this.audio.tick(line % 90 === 0);
    }
  }

  // ---------------- road awareness ----------------

  private updateRoad(immediate: boolean) {
    const w = this.world!;
    const hit = w.nearestRoad(this.x, this.y, 40, this.vehicle.canUse);
    const half = hit ? roadHalfWidth(hit.seg.way.type) : 0;
    const tolerance = this.vehicle.id === 'walker' ? 4 : 1.5;
    this.onRoad = !!hit && hit.hit.dist <= half + tolerance;
    this.road = this.onRoad ? hit!.seg.way : null;

    // street name the traveller would describe themselves as being on
    let name: string | null = null;
    if (this.vehicle.id === 'walker') {
      const named = w.nearestRoad(this.x, this.y, 18, (wy) => wy.named);
      name = named ? named.seg.way.name : this.road?.name ?? null;
    } else if (this.vehicle.id === 'helicopter') {
      const named = w.nearestRoad(this.x, this.y, 25, (wy) => wy.named);
      name = named?.seg.way.name ?? null;
    } else {
      name = this.road?.name ?? null;
    }

    if (immediate) {
      this.streetName = name;
      this.candName = name;
      return;
    }
    if (name !== this.candName) {
      this.candName = name;
      this.candSince = this.clock;
    }
    if (this.candName !== this.streetName && this.clock - this.candSince > 0.6) {
      this.streetName = this.candName;
      if (this.streetName && this.settings.announceStreets) {
        const extras: string[] = [];
        if (this.road?.bridge) extras.push('bridge');
        if (this.road?.tunnel) extras.push('tunnel');
        if (this.road?.oneway && this.vehicle.id === 'car') extras.push('one way');
        this.audio.streetChange();
        const pr = this.vehicle.id === 'helicopter' ? 'low' : 'normal';
        this.speech.say([this.streetName, ...extras].join(', '), pr);
      }
    }

    // leaving / rejoining the road network
    const constrained = this.vehicle.offRoadMax !== null;
    if (constrained) {
      if (!this.onRoad && !this.wasOffRoad && this.speed > 0.5) {
        this.wasOffRoad = true;
        if (this.speed > (this.vehicle.offRoadMax ?? 0) + 3) this.audio.bump();
        const side = hit ? (relAngle(this.heading, bearingTo(this.x, this.y, hit.hit.px, hit.hit.py)) < 0 ? 'left' : 'right') : null;
        this.speech.say(side ? `Off road. Road is on your ${side}.` : 'Off road.', 'high');
      } else if (this.onRoad && this.wasOffRoad) {
        this.wasOffRoad = false;
        this.speech.say(`Back on ${this.road?.name ?? 'the road'}`, 'normal');
      }
    }
  }

  private updateRumble() {
    const v = this.vehicle.id;
    if ((v !== 'car' && v !== 'bicycle') || this.speed < 0.5 || !this.world) {
      this.audio.setRumble(0, 0, 10);
      return;
    }
    const hit = this.world.nearestRoad(this.x, this.y, 40, this.vehicle.canUse);
    if (!hit) {
      this.audio.setRumble(0, 0, 10);
      return;
    }
    const half = roadHalfWidth(hit.seg.way.type);
    const toCentre = relAngle(this.heading, bearingTo(this.x, this.y, hit.hit.px, hit.hit.py));
    const pan = Math.sin((toCentre * Math.PI) / 180);
    if (!this.onRoad) {
      // rough ground: rumble comes from the side the road is on
      this.audio.setRumble(0.6, pan, 6);
      return;
    }
    const ratio = hit.hit.dist / half;
    if (ratio > 0.7) {
      // rumble strip on the edge you are drifting towards (opposite the centre)
      this.audio.setRumble(Math.min(1, (ratio - 0.7) / 0.3) * 0.8, -pan, this.speed / 0.4);
    } else {
      this.audio.setRumble(0, 0, 10);
    }
  }

  private filter = (w: Way) => this.vehicle.roadFilter(w);

  /**
   * How close to junction node n counts as "at the intersection". Walkers use the sidewalk, so the
   * zone covers the widest road there; vehicles drive near the centre line and get a small speed lead.
   */
  private turnZone(n: GNode): number {
    if (this.vehicle.id === 'walker') {
      let half = 0;
      for (const e of n.edges) if (this.filter(e.way)) half = Math.max(half, roadHalfWidth(e.way.type));
      return half + 5;
    }
    return 6 + this.speed * 0.15;
  }

  /** Play a cue on entering a junction (the point to turn) and a softer one on leaving it. */
  private checkInJunction() {
    if (this.vehicle.id === 'helicopter') return;
    const w = this.world!;
    let leaving = false;
    if (this.inJunction) {
      for (const id of this.inJunction) {
        const n = w.nodes.get(id);
        if (n && dist(this.x, this.y, n.x, n.y) <= this.turnZone(n) + 2) return; // still inside (small hysteresis)
      }
      this.inJunction = null;
      leaving = true;
    }
    let near: GNode | null = null;
    let best = Infinity;
    for (const n of w.nodesNear(this.x, this.y, 20)) {
      if (!w.isIntersection(n, this.filter)) continue;
      const d = dist(this.x, this.y, n.x, n.y);
      if (d <= this.turnZone(n) && d < best) {
        best = d;
        near = n;
      }
    }
    if (!near) {
      if (leaving) this.audio.leftIntersection(); // skipped when we step straight into the next junction
      return;
    }
    const j = w.junction(near, this.filter, this.junctionRadius);
    this.inJunction = new Set(j.nodes.map((m) => m.id));
    this.audio.atIntersection(this.exitAngles(j));
    // the moment to decide: name every road and which way it goes from here
    const branches = this.junctionBranches(near, this.heading, this.streetName ?? '', false);
    if (branches && this.speed > 0.3 && !this.routeTurnWithin(25)) this.speech.say(`${branches}.`, 'high');
  }

  /** Directions (relative to heading) of the roads leaving a junction, excluding the one we arrived on. */
  private exitAngles(j: Junction): number[] {
    const w = this.world!;
    const rels: number[] = [];
    let droppedBehind = false;
    for (const { from, edge } of j.exits) {
      const rel = relAngle(this.heading, w.edgeBearing(from, edge));
      if (Math.abs(rel) > 150 && (!droppedBehind || edge.way.name === this.streetName)) {
        droppedBehind = true;
        continue;
      }
      if (rels.some((r) => Math.abs(relAngle(r, rel)) < 15)) continue; // same direction, e.g. both carriageways
      rels.push(rel);
    }
    return rels.sort((a, b) => a - b);
  }

  /** Nodes this close together count as one junction (dual carriageways, staggered crossings). */
  private get junctionRadius() {
    return this.vehicle.id === 'walker' ? 12 : 22;
  }

  /** Off-road fallback: nearest junction roughly straight ahead. */
  private findAhead(range: number): Ahead | null {
    const w = this.world!;
    const r = (this.heading * Math.PI) / 180;
    const sx = Math.sin(r);
    const cy = Math.cos(r);
    let best: Ahead | null = null;
    for (const n of w.nodesNear(this.x, this.y, range)) {
      if (!w.isIntersection(n, this.filter)) continue;
      const dx = n.x - this.x;
      const dy = n.y - this.y;
      const forward = dx * sx + dy * cy;
      const lateral = dx * cy - dy * sx;
      if (forward < 2 || Math.abs(lateral) > Math.max(12, forward * 0.15)) continue;
      if (!best || forward < best.forward) {
        best = { node: n, forward, arrival: this.heading, deadEnd: false, arriveName: this.streetName ?? '' };
      }
    }
    return best;
  }

  /** Next junction (or dead end) following the road we are on, however it curves. */
  private nextAlongRoad(range: number): Ahead | null {
    const w = this.world!;
    if (this.vehicle.id !== 'helicopter') {
      const hit = w.nearestRoad(this.x, this.y, 20, this.filter);
      if (hit) {
        const forwards = Math.abs(relAngle(this.heading, hit.dir)) <= 90;
        const from = w.nodes.get(forwards ? hit.seg.a : hit.seg.b)!;
        const to = w.nodes.get(forwards ? hit.seg.b : hit.seg.a)!;
        const skip = this.inJunction; // the junction we are standing in doesn't count as "next"
        const r = w.followRoad(
          from,
          to,
          dist(this.x, this.y, to.x, to.y),
          hit.seg.way.name,
          this.filter,
          (n) => w.isIntersection(n, this.filter) && !skip?.has(n.id),
          range,
        );
        return r && { node: r.node, forward: r.dist, arrival: r.arrival, deadEnd: r.deadEnd, arriveName: r.arriveName };
      }
    }
    return this.findAhead(range);
  }

  private checkAhead() {
    const range = Math.max(40, Math.min(400, this.speed * 7 + 30));
    this.ahead = this.nextAlongRoad(range);
    this.aheadAt = this.clock;
    const a = this.ahead;
    if (!a || this.speed < 0.3) return;
    const announceAt = this.speed * 5 + 20;
    const last = this.announcedNodes.get(a.node.id) ?? -1e9;
    if (a.forward > announceAt || this.clock - last <= 60) return;
    const pr = this.vehicle.id === 'helicopter' ? 'low' : 'normal';
    const u = this.settings.units;
    if (a.deadEnd) {
      this.announcedNodes.set(a.node.id, this.clock);
      this.audio.deadEnd();
      this.speech.say(`${this.endWord(a)} in ${fmtDistance(a.forward, u)}${this.bendText(a.arrival, this.heading)}.`, pr);
      return;
    }
    const j = this.world!.junction(a.node, this.filter, this.junctionRadius);
    for (const m of j.nodes) this.announcedNodes.set(m.id, this.clock); // one announcement per junction
    const branches = this.junctionBranches(a.node, a.arrival, a.arriveName, false);
    if (!branches) return;
    this.audio.intersectionChime(j.exits.length, j.signals);
    // kept short while moving: relative directions only
    this.speech.say(
      `Intersection in ${fmtDistance(a.forward, u)}${this.bendText(a.arrival, this.heading)}${j.signals ? ', traffic signals' : ''}: ${branches}.`,
      pr,
    );
  }

  /** ", road bends left before it" when the road turns noticeably between here and there. */
  private bendText(arrival: number, from: number): string {
    const b = relAngle(from, arrival);
    if (Math.abs(b) < 30) return '';
    return `, road bends ${Math.abs(b) > 120 ? 'sharply ' : ''}${b < 0 ? 'left' : 'right'} before it`;
  }

  /** "Dead end", or "Oak Street ends" when a path or smaller road carries on (walkers are never blocked). */
  private endWord(a: Ahead): string {
    const usable = a.node.edges.filter((e) => this.vehicle.canUse(e.way)).length;
    const blocked = usable <= 1 && this.vehicle.id !== 'walker';
    return !blocked && a.arriveName ? `${a.arriveName} ends` : 'Dead end';
  }

  /**
   * Roads leaving the junction at n, relative to the direction you arrive (ref):
   * "Oak Street left and right; Main Street continues ahead". With compass, each gets "heading west".
   * Null if the junction offers nothing worth mentioning.
   */
  private junctionBranches(n: GNode, ref: number, arriveName: string, compass: boolean): string | null {
    const w = this.world!;
    const groups = new Map<string, string[]>();
    let hasAhead = false;
    let droppedBehind = false;
    const j = w.junction(n, this.filter, this.junctionRadius);
    const seen = new Set<string>();
    for (const { from, edge: e } of j.exits) {
      const b = w.edgeBearing(from, e);
      const rel = relAngle(ref, b);
      const a = Math.abs(rel);
      // the road we arrive on (both carriageways of a divided road)
      if (a > 150 && (!droppedBehind || e.way.name === arriveName)) {
        droppedBehind = true;
        continue;
      }
      const side = rel < 0 ? 'left' : 'right';
      let dir: string;
      if (a <= 25) {
        dir = 'ahead';
        hasAhead = true;
      } else if (a <= 60) dir = `bear ${side}`;
      else if (a <= 135) dir = side;
      else dir = `sharp ${side}`;
      const key = `${e.way.name}|${dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!groups.has(e.way.name)) groups.set(e.way.name, []);
      groups.get(e.way.name)!.push(compass ? `${dir} heading ${compass8(b)}` : dir);
    }
    if (!groups.size) return null;
    const parts: string[] = [];
    for (const [name, dirs] of groups) {
      if (name === arriveName && dirs.length === 1 && dirs[0].startsWith('ahead')) {
        parts.push(`${name} continues ${dirs[0]}`);
      } else parts.push(`${name} ${dirs.join(' and ')}`);
    }
    if (!hasAhead) parts.push('no road straight ahead');
    return parts.join('; ');
  }

  private checkPlaces() {
    if (!this.settings.announcePlaces || this.speed < 0.3) return;
    if (this.clock - this.lastPlaceSpoken < 1.2) return;
    for (const { place, d } of this.world!.placesNear(this.x, this.y, this.vehicle.passRadius)) {
      const last = this.announcedPlaces.get(place.id) ?? -1e9;
      if (this.clock - last < 180) continue;
      const rel = relAngle(this.heading, bearingTo(this.x, this.y, place.x, place.y));
      if (Math.abs(rel) > 120 && d > 10) continue; // already passed it
      this.announcedPlaces.set(place.id, this.clock);
      this.audio.placeCue(place.group, rel, 0.2);
      this.speech.say(`${place.name}, ${place.category}, ${sideWord(rel)}${d > 15 ? `, ${fmtDistance(d, this.settings.units)}` : ''}`, 'low');
      this.lastPlaceSpoken = this.clock;
      break;
    }
  }

  private get arriveRadius() {
    return this.vehicle.id === 'helicopter' ? 60 : this.vehicle.id === 'car' ? 25 : 12;
  }

  private updateDestination() {
    if (!this.dest) return;
    const d = dist(this.x, this.y, this.dest.x, this.dest.y);
    if (d < Math.max(this.arriveRadius, this.dest.radius ?? 0)) {
      this.audio.arrival();
      this.speech.say(`Arrived at ${this.dest.name}.`, 'high');
      this.dest = null;
      this.map.setDestination(null);
      this.clearRoute();
      return;
    }
    const r = this.route;
    const remaining = r && !r.partial ? r.length - this.routeProg : d;
    if (this.settings.beaconSound && this.clock >= this.nextBeacon) {
      const closeness = Math.max(0, 1 - remaining / 500);
      this.nextBeacon = this.clock + 0.35 + (1 - closeness) * 1.4;
      // with a route, aim a little way along it so following the beacon follows the streets
      const look = this.vehicle.id === 'walker' ? 15 : Math.max(25, this.speed * 2);
      const aim = r ? pointAlong(r, this.routeProg + look) : this.dest;
      this.audio.beacon(relAngle(this.heading, bearingTo(this.x, this.y, aim.x, aim.y)), closeness);
    }
    // progress updates at distance milestones
    const mark = MILESTONES.find((m) => remaining <= m);
    if (mark !== undefined && mark < this.destMilestone) {
      this.destMilestone = mark;
      const rel = relAngle(this.heading, bearingTo(this.x, this.y, this.dest.x, this.dest.y));
      this.speech.say(`${this.dest.name}, ${fmtDistance(remaining, this.settings.units)}${r ? ' to go' : ` at ${clockDir(rel)}`}.`, 'low');
    }
  }

  // ---------------- turn-by-turn ----------------

  private routeOptions(): RouteOptions {
    const canUse = this.vehicle.canUse;
    switch (this.vehicle.id) {
      case 'car':
        return {
          canUse,
          obeyOneway: true,
          minFactor: 0.5,
          uTurnPenalty: 300,
          costFactor: (w) =>
            ({ motorway: 0.5, trunk: 0.55, primary: 0.6, secondary: 0.7, tertiary: 0.8, living_street: 1.5, service: 2 } as Record<string, number>)[
              w.type.replace('_link', '')
            ] ?? 1,
        };
      case 'bicycle':
        return {
          canUse,
          obeyOneway: false,
          minFactor: 0.7,
          uTurnPenalty: 60,
          costFactor: (w) => (w.type === 'cycleway' ? 0.7 : w.type === 'primary' || w.type === 'trunk' ? 1.3 : 1),
        };
      default:
        // walkers prefer named streets over unnamed paths so directions stay easy to follow
        return {
          canUse,
          obeyOneway: false,
          minFactor: 1,
          uTurnPenalty: 15,
          costFactor: (w) => (w.type === 'steps' ? 1.5 : !w.named && ['footway', 'path', 'track', 'service'].includes(w.type) ? 1.4 : 1),
        };
    }
  }

  /** Plan (or re-plan) the route to the destination. */
  private computeRoute(announce: boolean) {
    this.lastRouteCalc = this.clock;
    if (!this.dest || !this.world || !this.settings.turnByTurn || this.vehicle.id === 'helicopter') return this.clearRoute();
    const r = planRoute(this.world, { x: this.x, y: this.y, heading: this.heading }, this.dest, this.routeOptions());
    if (!r) {
      this.clearRoute();
      if (announce) this.speech.say('No route found from here. Follow the beacon.', 'normal');
      return;
    }
    this.route = r;
    this.routeIdx = 0;
    this.routeProg = 0;
    this.nextMan = 0;
    this.spokenSteps.clear();
    this.offRouteSince = -1;
    this.map.setRoute(r.points.map((p) => this.proj.toLatLon(p.x, p.y)));
    if (!announce) return;
    const u = this.settings.units;
    const first = r.maneuvers[0];
    const startAim = pointAlong(r, 15);
    const turnAround = Math.abs(relAngle(this.heading, bearingTo(this.x, this.y, startAim.x, startAim.y))) > 120 ? 'Turn around. ' : '';
    const lead = `Route ${fmtDistance(r.length, u)}${r.partial ? ', as far as the map has loaded; it will extend as you go' : ''}. `;
    const step =
      first.kind === 'arrive'
        ? r.partial
          ? 'Follow this road.'
          : `${this.dest.name} is ${fmtDistance(first.d, u)} along this road.`
        : `In ${fmtDistance(first.d, u)}, ${maneuverText(first, this.dest.name)}.`;
    // the instruction was just given: don't repeat the early reminders
    const th = this.stepThresholds;
    for (let k = 0; k < 2; k++) if (first.d <= th[k]) this.spokenSteps.add(k);
    this.speech.say(turnAround + lead + step, 'normal');
  }

  private clearRoute() {
    this.route = null;
    this.map.setRoute(null);
  }

  private toggleTurnByTurn() {
    this.settings.turnByTurn = !this.settings.turnByTurn;
    saveSettings(this.settings);
    if (!this.settings.turnByTurn) {
      this.clearRoute();
      return this.speech.say('Turn by turn off. The beacon points straight to the destination.', 'high');
    }
    if (this.vehicle.id === 'helicopter') {
      return this.speech.say('Turn by turn on, but not available in the helicopter. The beacon points straight to the destination.', 'high');
    }
    if (!this.dest) return this.speech.say('Turn by turn on. Press Control D to choose a destination.', 'high');
    this.speech.say('Turn by turn on.', 'high');
    this.computeRoute(true);
  }

  /** Distances (m) before a manoeuvre at which it is spoken: early, closer, now. */
  private get stepThresholds(): [number, number, number] {
    switch (this.vehicle.id) {
      case 'walker':
        return [60, 25, 14];
      case 'bicycle':
        return [150, 50, Math.max(15, this.speed * 2.5)];
      default:
        return [400, 150, Math.max(30, this.speed * 2.5)];
    }
  }

  /** Is the next turn on the route within d metres? */
  private routeTurnWithin(d: number): boolean {
    const m = this.route?.maneuvers[this.nextMan];
    return !!m && m.kind !== 'arrive' && m.d - this.routeProg < d;
  }

  private updateRoute() {
    const r = this.route!;
    const dest = this.dest;
    if (!dest) return this.clearRoute();
    const u = this.settings.units;

    // progress: nearest point on the route, searching a window around the last position
    let best = Infinity;
    let bi = this.routeIdx;
    let bt = 0;
    const hi = Math.min(r.points.length - 1, this.routeIdx + 80);
    for (let i = Math.max(0, this.routeIdx - 3); i < hi; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const h = pointSeg(this.x, this.y, a.x, a.y, b.x, b.y);
      if (h.dist < best) {
        best = h.dist;
        bi = i;
        bt = h.t;
      }
    }
    this.routeIdx = bi;
    const a = r.points[bi];
    const b = r.points[Math.min(bi + 1, r.points.length - 1)];
    this.routeProg = a.d + bt * (b.d - a.d);

    // off the route: re-plan after a short grace period
    const tolerance = this.vehicle.id === 'walker' ? 20 : this.vehicle.id === 'bicycle' ? 25 : 30;
    if (best > tolerance) {
      if (this.offRouteSince < 0) this.offRouteSince = this.clock;
      else if (this.clock - this.offRouteSince > 2.5 && this.clock - this.lastRouteCalc > 5) {
        this.speech.say('Off route. Recalculating.', 'high');
        this.computeRoute(true);
      }
      return;
    }
    this.offRouteSince = -1;

    // a route that stops at the edge of the loaded map: extend it as we approach the end
    if (r.partial && r.length - this.routeProg < 150 && this.clock - this.lastRouteCalc > 5) {
      this.computeRoute(false);
      return;
    }

    const th = this.stepThresholds;
    // manoeuvres we have passed
    while (this.nextMan < r.maneuvers.length && r.maneuvers[this.nextMan].d < this.routeProg - 3) {
      const passed = r.maneuvers[this.nextMan++];
      this.spokenSteps.clear();
      const next = r.maneuvers[this.nextMan];
      if (next && passed.kind !== 'arrive') {
        const gap = next.d - this.routeProg;
        if (gap > th[1] * 1.4) {
          // say what comes next now, instead of a separate early reminder moments later
          const then = next.kind === 'arrive' && r.partial ? '' : `, then ${maneuverText(next, dest.name)}`;
          this.speech.say(`Continue on ${passed.ontoNamed ? passed.onto : 'this road'} for ${fmtDistance(gap, u)}${then}.`, 'normal');
          if (gap <= th[0] * 1.5) this.spokenSteps.add(0);
        }
      }
    }
    const m = r.maneuvers[this.nextMan];
    if (!m || (m.kind === 'arrive' && r.partial)) return;
    const d = m.d - this.routeProg;
    for (let k = 2; k >= 0; k--) {
      if (d > th[k] || this.spokenSteps.has(k)) continue;
      if (k < 2 && d <= th[k + 1] * 1.4) continue; // the closer reminder is coming up anyway
      for (let j = 0; j <= k; j++) this.spokenSteps.add(j); // never say an earlier reminder after a later one
      const text = maneuverText(m, dest.name);
      const n2 = r.maneuvers[this.nextMan + 1];
      const then = n2 && n2.d - m.d < 60 && !(n2.kind === 'arrive' && r.partial) ? `, then ${maneuverText(n2, dest.name)}` : '';
      if (k < 2) {
        this.speech.say(`In ${fmtDistance(d, u)}, ${text}${then}.`, k === 0 ? 'normal' : 'high');
      } else if (m.kind !== 'arrive') {
        this.audio.turnCue(m.rel);
        this.speech.say(`${cap(text)} now${then}.`, 'high');
      }
      break;
    }
  }

  // ---------------- keyboard ----------------

  private command(c: Command): boolean | void {
    if (!this.world && c.key !== 'Escape' && c.key !== 'F1') {
      if (!c.repeat) this.speech.say(this.loading ? 'Still loading map data.' : 'No map loaded. Press Escape for the menu.', 'high');
      return;
    }
    const u = this.settings.units;
    switch (c.code) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Slash':
        if (!c.repeat) this.speedAtPress = this.speed;
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (c.repeat) return;
        const dir = c.code === 'ArrowLeft' ? -1 : 1;
        if (c.ctrl) return this.snapTurn(dir);
        this.turnedDuringHold = false;
        this.turn(dir * (c.shift ? 10 : 1));
        this.turnHold = { dir, since: this.clock };
        return;
      }
    }
    if (c.repeat && c.code !== 'Tab') return;

    switch (c.key.length === 1 ? c.key.toLowerCase() : c.key) {
      case 'Control':
        this.speech.stop();
        return;
      case 'Escape':
        this.onMenu?.('main');
        return;
      case 'F1':
      case 'k':
        return this.help();
      case 'h':
        return this.speech.say(`Facing ${compass16(this.heading)}, ${Math.round(this.heading)} degrees.`, 'high');
      case 's':
        return this.speech.say(
          this.speed < 0.1 ? 'Stopped.' : `${fmtSpeed(this.speed, u)}.`,
          'high',
        );
      case 'l':
        return this.speech.say(this.locationText(), 'high');
      case 'n':
        return c.shift ? this.previousIntersection() : this.nextIntersection();
      case '.':
        return this.stepIntersection(1);
      case ',':
        return this.stepIntersection(-1);
      case 'b':
        if (c.shift) {
          this.settings.proximityBeeps = !this.settings.proximityBeeps;
          saveSettings(this.settings);
          return this.speech.say(`Intersection beeps ${this.settings.proximityBeeps ? 'on' : 'off'}.`, 'high');
        }
        this.settings.beaconSound = !this.settings.beaconSound;
        saveSettings(this.settings);
        return this.speech.say(`Beacon sound ${this.settings.beaconSound ? 'on' : 'off'}.`, 'high');
      case 't':
        return this.toggleTurnByTurn();
      case 'w':
        return this.whatsAround();
      case ' ':
        return this.sonar();
      case 'Tab':
        return this.browsePlaces(c.shift ? -1 : 1);
      case 'Enter':
        return this.setDestination();
      case 'g':
        return c.shift ? this.clearDestination() : this.destinationInfo();
      case 'Backspace':
        return this.clearDestination();
      case 'r':
        return this.alignToRoad();
      case 'f':
        this.onMenu?.('search');
        return;
      case 'd':
        if (!c.ctrl) return false;
        this.onNavigate?.();
        return;
      case 'm':
        this.settings.headingUpMap = !this.settings.headingUpMap;
        this.map.headingUp = this.settings.headingUpMap;
        saveSettings(this.settings);
        return this.speech.say(this.settings.headingUpMap ? 'Map rotates with heading.' : 'Map north up.', 'high');
      case 'a':
        this.settings.roadAssist = !this.settings.roadAssist;
        saveSettings(this.settings);
        return this.speech.say(`Road assist ${this.settings.roadAssist ? 'on' : 'off'}.`, 'high');
      case 'p':
        this.settings.announcePlaces = !this.settings.announcePlaces;
        saveSettings(this.settings);
        return this.speech.say(`Place announcements ${this.settings.announcePlaces ? 'on' : 'off'}.`, 'high');
      case '[':
        return this.speech.review(-1);
      case ']':
        return this.speech.review(1);
      case '1':
      case '2':
      case '3':
      case '4':
        return this.setVehicle((['walker', 'bicycle', 'car', 'helicopter'] as const)[Number(c.key) - 1], true);
      case 'PageUp':
      case 'PageDown': {
        const v = Math.max(0, Math.min(1, this.settings.volume + (c.key === 'PageUp' ? 0.1 : -0.1)));
        this.settings.volume = Math.round(v * 10) / 10;
        this.audio.setVolume(this.settings.volume);
        saveSettings(this.settings);
        return this.speech.say(`Volume ${Math.round(this.settings.volume * 100)} percent.`, 'high');
      }
    }
    return false;
  }

  private keyUp(code: string) {
    if (!this.world) return;
    if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'Slash') {
      if (this.input.isDown('ArrowUp') || this.input.isDown('ArrowDown') || this.input.isDown('Slash')) return;
      if (Math.abs(this.speed - this.speedAtPress) < 0.2) return;
      this.speech.say(this.speed < 0.1 ? 'Stopped.' : fmtSpeedShort(this.speed, this.settings.units), 'high');
    } else if ((code === 'ArrowLeft' || code === 'ArrowRight') && this.turnedDuringHold) {
      this.turnedDuringHold = false;
      if (this.settings.announceHeadingAfterTurn) {
        this.speech.say(`${Math.round(this.heading)}, ${compass8(this.heading)}`, 'high');
      }
    }
  }

  private help() {
    this.speech.say(
      'Up arrow accelerate, down arrow slow down, slash brake. Left and right turn 1 degree, with shift 10 degrees; hold to keep turning. ' +
        'Control left or right turns onto the next road. R aligns with the road. ' +
        'H heading, S speed, L location, N distance to the next intersection, Shift N the one behind you, period and comma step forward and back through intersections ahead, W what is around, Space sonar sweep. ' +
        'Control D searches for a destination. T toggles turn by turn directions, B toggles the beacon sound, Shift B the intersection beeps. Tab cycles nearby places, Enter sets one as destination, G destination info, Backspace clears it. ' +
        '1 to 4 change vehicle. A toggles road assist. P toggles place announcements. Left and right bracket review messages. Control stops speech. ' +
        'Page up and down change volume. F searches for a location. Escape opens the menu.',
      'high',
    );
  }

  private locationText(): string {
    const parts: string[] = [];
    if (this.streetName) {
      let s = `On ${this.streetName}`;
      const near = this.nearestCrossStreet();
      if (near) s += `, near ${near.name}, ${fmtDistance(near.d, this.settings.units)} ${near.where}`;
      parts.push(s);
    } else {
      const hit = this.world!.nearestRoad(this.x, this.y, 150, (w) => w.named);
      parts.push(
        hit
          ? `Off road. ${hit.seg.way.name} is ${fmtDistance(hit.hit.dist, this.settings.units)} ${clockDir(relAngle(this.heading, bearingTo(this.x, this.y, hit.hit.px, hit.hit.py)))}`
          : 'Off road, no streets nearby',
      );
    }
    parts.push(`facing ${compass8(this.heading)}`);
    if (this.areaName) parts.push(this.areaName);
    return parts.join('. ') + '.';
  }

  private nearestCrossStreet(): { name: string; d: number; where: string } | null {
    const w = this.world!;
    let best: { name: string; d: number; where: string } | null = null;
    for (const n of w.nodesNear(this.x, this.y, 120)) {
      if (!w.isIntersection(n, this.filter)) continue;
      const other = n.edges.find((e) => e.way.named && e.way.name !== this.streetName && this.filter(e.way));
      if (!other) continue;
      const d = dist(this.x, this.y, n.x, n.y);
      if (!best || d < best.d) {
        const rel = relAngle(this.heading, bearingTo(this.x, this.y, n.x, n.y));
        best = { name: other.way.name, d, where: Math.abs(rel) < 90 ? 'ahead' : 'behind' };
      }
    }
    return best;
  }

  /** A stable id for a junction (smallest member node id). */
  private junctionKey(n: GNode): number {
    let k = Infinity;
    for (const m of this.world!.junction(n, this.filter, this.junctionRadius).nodes) k = Math.min(k, m.id);
    return k;
  }

  /** Short name for a junction: the cross streets, e.g. "Oak Street" or "Oak Street and King Street". */
  private junctionLabel(a: Ahead): string {
    if (a.deadEnd) return this.endWord(a).toLowerCase().startsWith('dead') ? 'dead end' : `end of ${a.arriveName}`;
    const names: string[] = [];
    for (const { edge } of this.world!.junction(a.node, this.filter, this.junctionRadius).exits) {
      const nm = edge.way.name;
      if (nm !== a.arriveName && edge.way.named && !names.includes(nm)) names.push(nm);
    }
    if (names.length) return names.slice(0, 2).join(' and ');
    return a.arriveName ? `${a.arriveName} junction` : 'intersection';
  }

  /** Full spoken description of a junction ahead; lead is e.g. "Next intersection in 120 metres". */
  private describeAhead(a: Ahead, lead: string, bendFrom: number): string {
    const bend = this.bendText(a.arrival, bendFrom);
    if (a.deadEnd) return `${lead}${bend}: ${this.endWord(a).toLowerCase()}.`;
    const sig = this.world!.junction(a.node, this.filter, this.junctionRadius).signals;
    const branches = this.junctionBranches(a.node, a.arrival, a.arriveName, true) ?? 'no turns';
    return `${lead}${bend}${sig ? ', traffic signals' : ''}. ${branches}.`;
  }

  /**
   * N: live distance to the next intersection along the road. The first press for an intersection
   * describes it fully; repeated presses for the same one give just the distance, so it can be used
   * as a countdown while moving. N also brings the step cursor (. and ,) back to this intersection.
   */
  private nextIntersection() {
    const u = this.settings.units;
    this.stepCursor = null;
    const a = this.nextAlongRoad(1500);
    if (!a) {
      this.lastN = null;
      return this.speech.say(this.onRoad ? `No intersection within ${fmtDistance(1500, u)} along this road.` : 'No intersection ahead.', 'high');
    }
    const key = this.junctionKey(a.node);
    for (const m of this.world!.junction(a.node, this.filter, this.junctionRadius).nodes) this.announcedNodes.set(m.id, this.clock);
    if (this.lastN === key) {
      if (a.deadEnd) return this.speech.say(`${fmtDistance(a.forward, u)}, ${this.junctionLabel(a)}.`, 'high');
      const branches = this.junctionBranches(a.node, a.arrival, a.arriveName, false) ?? this.junctionLabel(a);
      return this.speech.say(`${fmtDistance(a.forward, u)}: ${branches}.`, 'high');
    }
    this.lastN = key;
    const rel = relAngle(this.heading, bearingTo(this.x, this.y, a.node.x, a.node.y));
    const where = a.forward < 15 || Math.abs(rel) <= 15 ? 'straight ahead' : `at ${clockDir(rel)}`;
    if (a.deadEnd) {
      return this.speech.say(`${this.endWord(a)} in ${fmtDistance(a.forward, u)}, ${where}${this.bendText(a.arrival, this.heading)}.`, 'high');
    }
    this.speech.say(this.describeAhead(a, `Next intersection in ${fmtDistance(a.forward, u)}, ${where}`, this.heading), 'high');
  }

  /** Shift+N: the last intersection behind you, described as you passed through it. */
  private previousIntersection() {
    const w = this.world!;
    const u = this.settings.units;
    const back = normDeg(this.heading + 180);
    const hit = this.vehicle.id !== 'helicopter' ? w.nearestRoad(this.x, this.y, 20, this.filter) : null;
    if (!hit) return this.speech.say('Not on a road.', 'high');
    if (this.inJunction) {
      const n = w.nodes.get([...this.inJunction][0])!;
      const branches = this.junctionBranches(n, this.heading, this.streetName ?? '', true) ?? 'no turns';
      return this.speech.say(`You are at an intersection. ${branches}.`, 'high');
    }
    const backwards = Math.abs(relAngle(back, hit.dir)) <= 90;
    const from = w.nodes.get(backwards ? hit.seg.a : hit.seg.b)!;
    const to = w.nodes.get(backwards ? hit.seg.b : hit.seg.a)!;
    const r = w.followRoad(from, to, dist(this.x, this.y, to.x, to.y), hit.seg.way.name, this.filter, (n) => w.isIntersection(n, this.filter), 1500);
    if (!r) return this.speech.say(`No intersection within ${fmtDistance(1500, u)} behind you.`, 'high');
    const rel = relAngle(this.heading, bearingTo(this.x, this.y, r.node.x, r.node.y));
    const where = Math.abs(rel) >= 165 ? 'directly behind' : `at ${clockDir(rel)}`;
    if (r.deadEnd) return this.speech.say(`Behind you, ${this.endWord({ ...r, forward: r.dist }).toLowerCase()} after ${fmtDistance(r.dist, u)}, ${where}.`, 'high');
    // describe it facing the way you were travelling when you went through it
    const forwardAtNode = normDeg(r.arrival + 180);
    const branches = this.junctionBranches(r.node, forwardAtNode, this.streetName ?? r.arriveName, true) ?? 'no turns';
    this.speech.say(`Last intersection, ${fmtDistance(r.dist, u)} behind you, ${where}. ${branches}.`, 'high');
  }

  /**
   * Period / comma: step forward or back through the intersections down the road, as if going
   * straight on. The list re-anchors to your position, so "from here" distances stay current.
   */
  private stepIntersection(dir: 1 | -1) {
    const u = this.settings.units;
    const live = this.nextAlongRoad(1500);
    if (!live) {
      this.stepCursor = null;
      return this.speech.say('No intersection ahead.', 'high');
    }
    // re-anchor: keep the list only if its first entry is still the next intersection (or we passed some)
    let c = this.stepCursor;
    if (c) {
      const liveKey = this.junctionKey(live.node);
      const at = c.list.findIndex((e) => e.key === liveKey);
      if (at < 0) c = null;
      else {
        c.list = c.list.slice(at);
        c.idx = Math.max(0, c.idx - at);
      }
    }
    if (!c) c = { list: [{ ahead: live, key: this.junctionKey(live.node), cum: 0, via: live.arriveName }], idx: 0 };
    c.list[0].ahead = live;
    this.stepCursor = c;

    if (dir < 0) {
      if (c.idx === 0) return this.speech.say('This is the next intersection. Shift N for the one behind you.', 'high');
      c.idx--;
    } else {
      if (c.idx + 1 >= c.list.length) {
        const next = this.stepFrom(c.list[c.idx]);
        if (typeof next === 'string') return this.speech.say(next, 'high');
        c.list.push(next);
      }
      c.idx++;
    }
    const e = c.list[c.idx];
    const fromHere = live.forward + e.cum;
    const lead =
      c.idx === 0
        ? `Next intersection, ${fmtDistance(fromHere, u)}`
        : `Intersection ${c.idx + 1}, ${fmtDistance(fromHere, u)} from here on ${e.via}`;
    const prevArrival = c.idx === 0 ? this.heading : c.list[c.idx - 1].ahead.arrival;
    this.speech.say(this.describeAhead(e.ahead, lead, prevArrival), 'high');
  }

  /** The intersection after `e`, continuing as straight as possible; a message if there is none. */
  private stepFrom(e: StepEntry): StepEntry | string {
    const w = this.world!;
    const u = this.settings.units;
    if (e.ahead.deadEnd) return 'The road ends there.';
    const j = w.junction(e.ahead.node, this.filter, this.junctionRadius);
    const members = new Set(j.nodes.map((n) => n.id));
    let best: { from: GNode; edge: Edge } | null = null;
    let bestScore = Infinity;
    for (const x of j.exits) {
      const turn = Math.abs(relAngle(e.ahead.arrival, w.edgeBearing(x.from, x.edge)));
      if (turn > 45) continue;
      const score = turn + (x.edge.way.name === e.ahead.arriveName ? 0 : 20);
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    if (!best) return 'No road continues straight after that intersection.';
    const to = w.nodes.get(best.edge.to)!;
    const r = w.followRoad(
      best.from,
      to,
      dist(best.from.x, best.from.y, to.x, to.y),
      best.edge.way.name,
      this.filter,
      (n) => w.isIntersection(n, this.filter) && !members.has(n.id),
      1500,
    );
    if (!r) return `No further intersection within ${fmtDistance(1500, u)}.`;
    const ahead: Ahead = { node: r.node, forward: r.dist, arrival: r.arrival, deadEnd: r.deadEnd, arriveName: r.arriveName };
    return { ahead, key: this.junctionKey(r.node), cum: e.cum + r.dist, via: best.edge.way.name };
  }

  /** Parking-sensor style beeps that quicken as the next intersection approaches. */
  private updateProximityBeeps() {
    const a = this.ahead;
    if (!this.settings.proximityBeeps || !a || this.inJunction || this.speed < 0.3 || this.vehicle.id === 'helicopter') return;
    const base = this.vehicle.id === 'walker' ? 25 : this.vehicle.id === 'bicycle' ? 35 : 40;
    const range = Math.min(120, Math.max(base, this.speed * 3));
    const d = a.forward - this.speed * (this.clock - this.aheadAt); // ahead is refreshed every 0.1 s
    if (d > range || d < 0) return;
    if (this.clock < this.nextProxBeep) return;
    const closeness = 1 - d / range;
    this.audio.proximityBeep(closeness, a.deadEnd);
    this.nextProxBeep = this.clock + 0.1 + 0.8 * (1 - closeness);
  }

  private whatsAround() {
    const list = this.world!.placesNear(this.x, this.y, this.vehicle.scanRadius).slice(0, 6);
    if (!list.length) return this.speech.say(`No places within ${fmtDistance(this.vehicle.scanRadius, this.settings.units)}.`, 'high');
    const text = list
      .map(({ place, d }) => `${place.name}, ${place.category}, ${fmtDistance(d, this.settings.units)} at ${clockDir(relAngle(this.heading, bearingTo(this.x, this.y, place.x, place.y)))}`)
      .join('. ');
    this.speech.say(text + '.', 'high');
  }

  private sonar() {
    const list = this.world!.placesNear(this.x, this.y, this.vehicle.scanRadius).slice(0, 14);
    this.audio.sonarStart();
    const t0 = this.audio.now + 0.5;
    for (const { place, d } of list) {
      const rel = relAngle(this.heading, bearingTo(this.x, this.y, place.x, place.y));
      const when = t0 + (normDeg(rel) / 360) * 2.2; // sweep clockwise from straight ahead
      const level = 0.12 + 0.3 * (1 - d / this.vehicle.scanRadius);
      this.audio.placeCue(place.group, rel, level, when);
    }
    this.speech.say(list.length ? `${list.length} places` : 'Nothing nearby', 'low');
  }

  private browsePlaces(dir: 1 | -1) {
    if (!this.browse || dist(this.x, this.y, this.browse.x, this.browse.y) > 30) {
      const list = this.world!.placesNear(this.x, this.y, this.vehicle.scanRadius * 2).slice(0, 40).map((p) => p.place);
      if (!list.length) return this.speech.say('No places nearby.', 'high');
      this.browse = { list, idx: dir === 1 ? -1 : list.length, x: this.x, y: this.y };
    }
    const b = this.browse;
    b.idx = (b.idx + dir + b.list.length) % b.list.length;
    const p = b.list[b.idx];
    const d = dist(this.x, this.y, p.x, p.y);
    const rel = relAngle(this.heading, bearingTo(this.x, this.y, p.x, p.y));
    this.audio.placeCue(p.group, rel, 0.3);
    this.speech.say(`${p.name}, ${p.category}, ${fmtDistance(d, this.settings.units)} at ${clockDir(rel)}. ${b.idx + 1} of ${b.list.length}`, 'high');
  }

  private setDestination() {
    if (!this.browse) return this.speech.say('Press Tab to choose a place first.', 'high');
    const p = this.browse.list[this.browse.idx];
    this.setTarget({ name: p.name, x: p.x, y: p.y });
  }

  setTarget(t: Target) {
    if (dist(this.x, this.y, t.x, t.y) < Math.max(this.arriveRadius, t.radius ?? 0)) {
      this.audio.arrival();
      return this.speech.say(`You are already at ${t.name}.`, 'high');
    }
    this.dest = t;
    this.nextBeacon = 0;
    const d0 = dist(this.x, this.y, t.x, t.y);
    this.destMilestone = MILESTONES.find((m) => d0 <= m) ?? Infinity;
    this.map.setDestination(this.proj.toLatLon(t.x, t.y));
    const d = dist(this.x, this.y, t.x, t.y);
    const rel = relAngle(this.heading, bearingTo(this.x, this.y, t.x, t.y));
    const guided = this.settings.turnByTurn && this.vehicle.id !== 'helicopter';
    this.speech.say(`Destination ${t.name}, ${fmtDistance(d, this.settings.units)} at ${clockDir(rel)}.${guided ? '' : ' Follow the beacon.'}`, 'high');
    if (guided) this.computeRoute(true);
    else this.clearRoute();
  }

  /** Set a beacon destination from a search result (any distance, even outside the loaded map). */
  setTargetLatLon(name: string, lat: number, lon: number, radius = 0) {
    const p = this.proj.toXY(lat, lon);
    this.setTarget({ name, x: p.x, y: p.y, radius: Math.min(400, radius) });
  }

  /** Loaded places whose name matches the query, nearest first, for the destination search. */
  findPlaces(q: string): PlaceMatch[] {
    if (!this.world || !q.trim()) return [];
    const needle = q.trim().toLowerCase();
    return this.world.places
      .filter((p) => p.name.toLowerCase().includes(needle) || p.category.toLowerCase().includes(needle))
      .map((p) => ({ p, d: dist(this.x, this.y, p.x, p.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
      .map(({ p, d }) => {
        const ll = this.proj.toLatLon(p.x, p.y);
        return { name: p.name, detail: `${p.category}, ${this.describeOffset(d, bearingTo(this.x, this.y, p.x, p.y))}`, lat: ll.lat, lon: ll.lon };
      });
  }

  /** "1.2 kilometres north-east" from the traveller to a lat/lon. */
  describeFromHere(lat: number, lon: number): string {
    const p = this.proj.toXY(lat, lon);
    return this.describeOffset(dist(this.x, this.y, p.x, p.y), bearingTo(this.x, this.y, p.x, p.y));
  }

  private describeOffset(d: number, b: number): string {
    return `${fmtDistance(d, this.settings.units)} ${compass8(b)}`;
  }

  get position(): LatLon | null {
    return this.proj ? this.proj.toLatLon(this.x, this.y) : null;
  }

  private destinationInfo() {
    if (!this.dest) return this.speech.say('No destination. Press Control D to search for one, or Tab to pick a nearby place and Enter.', 'high');
    const u = this.settings.units;
    const d = dist(this.x, this.y, this.dest.x, this.dest.y);
    const b = bearingTo(this.x, this.y, this.dest.x, this.dest.y);
    const straight = `${this.dest.name}, ${fmtDistance(d, u)} ${compass8(b)}, at ${clockDir(relAngle(this.heading, b))}`;
    const r = this.route;
    if (!r) return this.speech.say(`${straight}.`, 'high');
    const m = r.maneuvers[this.nextMan];
    const next = m && m.kind !== 'arrive' ? `${cap(maneuverText(m, this.dest.name))} in ${fmtDistance(m.d - this.routeProg, u)}. ` : '';
    const left = r.partial ? `${fmtDistance(r.length - this.routeProg, u)} of route loaded so far` : `${fmtDistance(r.length - this.routeProg, u)} to go`;
    this.speech.say(`${next}${left}. ${straight} in a straight line.`, 'high');
  }

  private clearDestination() {
    if (!this.dest) return this.speech.say('No destination set.', 'high');
    this.dest = null;
    this.map.setDestination(null);
    this.clearRoute();
    this.speech.say('Destination cleared.', 'high');
  }

  private alignToRoad() {
    const hit = this.world!.nearestRoad(this.x, this.y, 25);
    if (!hit) return this.speech.say('No road nearby.', 'high');
    const opts = [hit.dir, normDeg(hit.dir + 180)];
    const target = Math.abs(relAngle(this.heading, opts[0])) <= 90 ? opts[0] : opts[1];
    this.heading = Math.round(target);
    this.speech.say(`Aligned with ${hit.seg.way.name}, facing ${compass8(this.heading)}.`, 'high');
  }

  /** Turn onto the next road branch to the left or right, at the nearest intersection or along the current road. */
  private snapTurn(dir: -1 | 1) {
    const w = this.world!;
    const options: { b: number; name: string }[] = [];
    const nodes = w.nodesNear(this.x, this.y, 25).filter((n) => w.isIntersection(n, this.filter));
    nodes.sort((a, b) => dist(this.x, this.y, a.x, a.y) - dist(this.x, this.y, b.x, b.y));
    if (nodes[0]) {
      for (const { from, edge } of w.junction(nodes[0], this.filter, this.junctionRadius).exits) {
        options.push({ b: w.edgeBearing(from, edge), name: edge.way.name });
      }
    } else {
      const hit = w.nearestRoad(this.x, this.y, 25);
      if (hit) options.push({ b: hit.dir, name: hit.seg.way.name }, { b: normDeg(hit.dir + 180), name: hit.seg.way.name });
    }
    let best: { b: number; name: string; amt: number } | null = null;
    for (const o of options) {
      const amt = normDeg(dir * (o.b - this.heading)); // rotation needed in the requested direction
      if (amt < 5 || amt > 355) continue;
      if (!best || amt < best.amt) best = { ...o, amt };
    }
    if (!best) {
      this.audio.error();
      return this.speech.say(`No road to the ${dir < 0 ? 'left' : 'right'}.`, 'high');
    }
    this.heading = normDeg(Math.round(best.b));
    this.lastManualTurn = this.clock;
    this.audio.tick(true);
    this.speech.say(`${best.name}, ${compass8(this.heading)}.`, 'high');
  }

  private emitHud() {
    const u = this.settings.units;
    let destination = '';
    if (this.dest) {
      const d = dist(this.x, this.y, this.dest.x, this.dest.y);
      destination = `${this.dest.name} · ${fmtDistance(d, u)} · ${clockDir(relAngle(this.heading, bearingTo(this.x, this.y, this.dest.x, this.dest.y)))}`;
      const m = this.route?.maneuvers[this.nextMan];
      if (m && m.kind !== 'arrive') destination += ` · ${maneuverText(m, this.dest.name)} in ${fmtDistance(m.d - this.routeProg, u)}`;
    }
    this.onHud?.({
      street: this.streetName ?? (this.onRoad ? '' : 'Off road'),
      speed: fmtSpeedShort(this.speed, u),
      heading: `${Math.round(this.heading)}° ${compass16(this.heading)}`,
      area: this.areaName,
      destination,
      status: this.loading ? 'Loading map data…' : '',
    });
  }

  /** Convert a lat/lon to world coordinates (for teleport targets found by search). */
  toXY(p: LatLon) {
    return this.proj.toXY(p.lat, p.lon);
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
