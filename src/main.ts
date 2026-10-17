import './style.css';
import { AudioEngine } from './audio/audio';
import { Game } from './game';
import type { LatLon } from './geo';
import { MapView } from './mapview';
import { loadFavorites, removeFavorite } from './favorites';
import { geocode, type GeocodeResult } from './osm';
import { loadSettings, saveSettings, type Settings } from './settings';
import { Speech } from './speech';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
const speech = new Speech(settings.speechMode, settings.voiceRate);

interface Selected extends LatLon {
  name: string;
}

const PLACE_KEY = 'audio-map-place';
let selected: Selected = loadPlace() ?? { name: 'Times Square, New York', lat: 40.758, lon: -73.9855 };

/** A shared link: #from=lat,lon,name[&to=lat,lon,name] starts there and sets the destination. */
function parseShared(): { from: Selected; to?: Selected } | null {
  const pt = (v: string | null): Selected | undefined => {
    const [lat, lon, ...rest] = (v ?? '').split(',');
    const p = { lat: Number(lat), lon: Number(lon), name: decodeURIComponent(rest.join(',')) || 'Shared place' };
    return lat && lon && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? p : undefined;
  };
  try {
    const q = new URLSearchParams(location.hash.slice(1));
    const from = pt(q.get('from'));
    return from ? { from, to: pt(q.get('to')) } : null;
  } catch {
    return null;
  }
}

let shared = parseShared();
if (shared) selected = shared.from;

const stage = $<HTMLDivElement>('stage');
const menu = $<HTMLDialogElement>('menu');
const startBtn = $<HTMLButtonElement>('start-btn');
const resumeBtn = $<HTMLButtonElement>('resume-btn');

applyDisplay();
const map = new MapView($('map'), selected, settings.display === 'highContrast');
map.headingUp = settings.headingUpMap;
let game: Game | null = null;

// ---------- settings form ----------

function bindSettings() {
  for (const name of ['vehicle', 'speechMode', 'display', 'walkRoute', 'soundProfile'] as const) {
    for (const r of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      r.checked = r.value === settings[name];
      r.addEventListener('change', () => {
        if (r.checked) update({ [name]: r.value } as Partial<Settings>);
      });
    }
  }
  for (const id of ['announceStreets', 'announcePlaces', 'announceHazards', 'announceHeadingAfterTurn', 'compassTicks', 'roadAssist', 'proximityBeeps', 'turnByTurn', 'beaconSound', 'headingUpMap'] as const) {
    const el = $<HTMLInputElement>(id);
    el.checked = settings[id];
    el.addEventListener('change', () => update({ [id]: el.checked }));
  }
  for (const id of ['voiceRate', 'volume'] as const) {
    const el = $<HTMLInputElement>(id);
    el.value = String(settings[id]);
    el.addEventListener('input', () => update({ [id]: parseFloat(el.value) }));
  }
  const units = $<HTMLSelectElement>('units');
  units.value = settings.units;
  units.addEventListener('change', () => update({ units: units.value as Settings['units'] }));
}

function update(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  saveSettings(settings);
  speech.configure(settings.speechMode, settings.voiceRate);
  map.headingUp = settings.headingUpMap;
  applyDisplay();
  map.setHighContrast(settings.display === 'highContrast');
  game?.applySettings(settings);
}

/** High contrast mode restyles the whole page (larger text, high contrast) through a root attribute. */
function applyDisplay() {
  if (settings.display === 'highContrast') document.documentElement.dataset.display = 'high-contrast';
  else delete document.documentElement.dataset.display;
}

/** settings that can also change by key (vehicle 1–4, walking routes D twice) */
function syncVehicleRadios() {
  for (const name of ['vehicle', 'walkRoute', 'soundProfile'] as const) {
    for (const r of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) r.checked = r.value === settings[name];
  }
}

// ---------- location selection ----------

function select(p: Selected, announce = true) {
  selected = p;
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
  // the line is a live region for choosing in the menu; a jump says where you are anyway
  const line = $('selected-place');
  if (!announce) line.removeAttribute('aria-live');
  line.textContent = `Selected: ${p.name}`;
  if (!announce) setTimeout(() => line.setAttribute('aria-live', 'polite'), 0);
  startBtn.textContent = game ? 'Go there' : 'Start';
}

function loadPlace(): Selected | null {
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    return raw ? (JSON.parse(raw) as Selected) : null;
  } catch {
    return null;
  }
}

async function runSearch() {
  const q = $<HTMLInputElement>('search').value.trim();
  const status = $('search-status');
  const list = $<HTMLUListElement>('results');
  if (!q) return;
  status.textContent = 'Searching…';
  list.replaceChildren();
  let results: GeocodeResult[] = [];
  try {
    results = await geocode(q);
  } catch {
    status.textContent = 'Search failed. Check your connection and try again.';
    return;
  }
  if (!results.length) {
    status.textContent = 'No results found.';
    return;
  }
  status.textContent = `${results.length} results. Choose one below.`;
  for (const r of results) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r.name;
    b.addEventListener('click', () => {
      select({ name: shortName(r.name), lat: r.lat, lon: r.lon });
      startBtn.focus();
    });
    li.appendChild(b);
    list.appendChild(li);
  }
  (list.querySelector('button') as HTMLButtonElement | null)?.focus();
}

function shortName(full: string) {
  return full.split(',').slice(0, 3).join(',').trim();
}

$('search-btn').addEventListener('click', runSearch);
$<HTMLInputElement>('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runSearch();
  }
});

for (const b of document.querySelectorAll<HTMLButtonElement>('.preset')) {
  b.addEventListener('click', () => {
    select({ name: b.textContent!.trim(), lat: parseFloat(b.dataset.lat!), lon: parseFloat(b.dataset.lon!) });
    startBtn.focus();
  });
}

$('geo-btn').addEventListener('click', () => {
  const status = $('search-status');
  if (!navigator.geolocation) {
    status.textContent = 'Location is not available in this browser.';
    return;
  }
  status.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      status.textContent = 'Location found.';
      select({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude });
      startBtn.focus();
    },
    () => {
      status.textContent = 'Could not get your location. Permission may have been denied.';
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------- menu / game flow ----------

function openMenu(focus: 'main' | 'search' | 'settings') {
  game?.pause();
  resumeBtn.hidden = !game;
  startBtn.textContent = game ? 'Go there' : 'Start';
  syncVehicleRadios();
  if (!menu.open) menu.showModal();
  if (focus === 'search') {
    $<HTMLInputElement>('search').focus();
  } else if (focus === 'settings') {
    const box = $('display-settings');
    box.scrollIntoView({ block: 'start' });
    box.querySelector<HTMLInputElement>('input:checked')?.focus();
  } else {
    (game ? resumeBtn : startBtn).focus();
  }
}

function closeMenu() {
  if (menu.open) menu.close();
  if (game) {
    game.resume();
    game.focus(stage);
  }
}

startBtn.addEventListener('click', () => {
  if (!game) {
    const audio = new AudioEngine(settings.volume); // created on a user gesture so the browser allows sound
    game = new Game(settings, speech, audio, map);
    game.onMenu = openMenu;
    game.onNavigate = () => openNav('navigate');
    game.onJump = () => openNav('jump');
    game.onHud = (h) => {
      $('hud-street').textContent = h.street || '—';
      $('hud-speed').textContent = h.speed;
      $('hud-heading').textContent = h.heading;
      $('hud-area').textContent = h.area;
      const dest = $('hud-dest');
      dest.hidden = !h.destination;
      dest.textContent = h.destination ? `→ ${h.destination}` : '';
      $('hud-status').textContent = h.status;
    };
  }
  if (menu.open) menu.close();
  game.focus(stage);
  const to = shared?.to;
  shared = null; // only the first start follows the link
  void game.start(selected, selected.name).then(() => {
    if (to) game?.setTargetLatLon(to.name, to.lat, to.lon);
  });
});

resumeBtn.addEventListener('click', closeMenu);

menu.addEventListener('cancel', (e) => {
  // Escape inside the menu resumes the game; before the first start there is nothing to resume.
  e.preventDefault();
  if (game) closeMenu();
});

// ---------- destination search (beacon) ----------

const nav = $<HTMLDialogElement>('nav');
/** the same search serves Control + D (set a destination) and Control + J (jump there) */
let navMode: 'navigate' | 'jump' = 'navigate';

function openNav(mode: 'navigate' | 'jump') {
  if (!game) return;
  navMode = mode;
  const jump = mode === 'jump';
  $('nav-title').textContent = jump ? 'Jump to' : 'Navigate to';
  $('nav-hint').textContent = jump
    ? 'Search for a place, address or area to move there. Any destination you have set is kept. Escape to cancel.'
    : 'Search for a place, address or area. Turn-by-turn directions and a beacon will guide you there. Escape to cancel.';
  $('nav-label').textContent = jump ? 'Where do you want to jump to?' : 'Where do you want to go?';
  game.pause();
  $<HTMLInputElement>('nav-q').value = '';
  showFavorites();
  if (!nav.open) nav.showModal();
  const q = $<HTMLInputElement>('nav-q');
  q.select();
  q.focus();
}

function closeNav() {
  if (nav.open) nav.close();
  if (game) {
    game.resume();
    game.focus(stage);
  }
}

function pickDestination(name: string, lat: number, lon: number, radius: number) {
  closeNav();
  if (navMode === 'jump') {
    select({ name, lat, lon }, false); // also where the next visit starts
    void game?.jumpTo(name, lat, lon);
  } else game?.setTargetLatLon(name, lat, lon, radius);
}

/** Saved places (key Y), each with a button to remove it; shown when the search is empty. */
function showFavorites() {
  const list = $<HTMLUListElement>('nav-results');
  list.replaceChildren();
  const favs = loadFavorites();
  $('nav-status').textContent = favs.length ? `${favs.length} saved places. Choose one, or search.` : 'No saved places yet. Press Y in the explorer to save one.';
  for (const f of favs) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${f.name}, ${game?.describeFromHere(f.lat, f.lon) ?? ''}`;
    b.addEventListener('click', () => pickDestination(f.name, f.lat, f.lon, 0));
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.addEventListener('click', () => {
      removeFavorite(f);
      showFavorites();
      $<HTMLInputElement>('nav-q').focus();
    });
    li.append(b, rm);
    list.appendChild(li);
  }
}

async function runNavSearch() {
  if (!game) return;
  const q = $<HTMLInputElement>('nav-q').value.trim();
  if (!q) return showFavorites();
  const status = $('nav-status');
  const list = $<HTMLUListElement>('nav-results');
  list.replaceChildren();
  const add = (label: string, onPick: () => void) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onPick);
    li.appendChild(b);
    list.appendChild(li);
  };
  // places already loaded around you come first, then a wider search biased toward where you are
  for (const m of game.findPlaces(q)) add(`${m.name}, ${m.detail}`, () => pickDestination(m.name, m.lat, m.lon, 0));
  status.textContent = 'Searching…';
  try {
    for (const r of await geocode(q, game.position ?? undefined)) {
      const name = shortName(r.name);
      add(`${name}, ${game.describeFromHere(r.lat, r.lon)}`, () => pickDestination(name, r.lat, r.lon, r.radius));
    }
  } catch {
    // keep any nearby matches
  }
  const n = list.children.length;
  status.textContent = n ? `${n} results. Choose one to ${navMode === 'jump' ? 'jump' : 'navigate'} there.` : 'No results found.';
  (list.querySelector('button') as HTMLButtonElement | null)?.focus();
}

$('nav-btn').addEventListener('click', runNavSearch);
$<HTMLInputElement>('nav-q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runNavSearch();
  }
});
nav.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeNav();
});

$('menu-btn').addEventListener('click', () => openMenu('main'));

stage.addEventListener('focus', () => {
  if (game && !menu.open) game.focus(stage);
});

window.addEventListener('resize', () => map.resize());

// Control + comma: settings, from anywhere outside the explorer (the explorer handles it itself)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === ',' && document.activeElement !== stage) {
    e.preventDefault();
    openMenu('settings');
  }
});

bindSettings();
select(selected);
openMenu('main');

// the dev server must not serve stale files from a worker
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => {});
}
