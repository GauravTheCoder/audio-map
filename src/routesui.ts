import type { Game } from './game';
import { loadRoutes, removeRoute, saveRoute } from './routes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shift + Q saves the current trip under a name; Q lists saved routes to start or remove. */
export function bindRoutes(game: Game, stage: HTMLElement) {
  const dlg = $<HTMLDialogElement>('routes');
  const status = $('routes-status');
  const saveBox = $('routes-save');
  const name = $<HTMLInputElement>('routes-name');
  const list = $<HTMLUListElement>('routes-list');

  const open = () => {
    game.pause();
    if (!dlg.open) dlg.showModal();
  };
  const close = () => {
    if (dlg.open) dlg.close();
    game.resume();
    game.focus(stage);
  };

  function renderList() {
    list.replaceChildren();
    const routes = loadRoutes();
    status.textContent = routes.length ? `${routes.length} saved routes. Choose one to start it.` : 'No saved routes. Set a destination, then press Shift Q.';
    for (const r of routes) {
      const li = document.createElement('li');
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = `${r.name}`;
      go.addEventListener('click', async () => {
        close();
        await game.start(r.start, r.name);
        game.setTargetLatLon(r.dest.name, r.dest.lat, r.dest.lon, r.dest.radius);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Remove';
      del.setAttribute('aria-label', `Remove ${r.name}`);
      del.addEventListener('click', () => {
        removeRoute(r.name);
        renderList();
        (list.querySelector('button') ?? $('routes-close')).focus();
      });
      li.append(go, del);
      list.appendChild(li);
    }
  }

  game.onRoutes = () => {
    saveBox.hidden = true;
    renderList();
    open();
    (list.querySelector('button') ?? $('routes-close')).focus();
  };

  game.onSaveRoute = () => {
    const trip = game.currentTrip();
    list.replaceChildren();
    open();
    if (!trip) {
      saveBox.hidden = true;
      status.textContent = 'Set a destination first, then save the route.';
      $('routes-close').focus();
      return;
    }
    saveBox.hidden = false;
    status.textContent = 'Name this route. It starts where you are now.';
    name.value = `${trip.street ?? 'Here'} to ${trip.dest.name}`;
    name.select();
    name.focus();
    save = () => {
      const n = name.value.trim();
      if (!n) return;
      saveRoute({ name: n, start: trip.start, dest: trip.dest });
      close();
    };
  };

  let save = () => {};
  $('routes-save-btn').addEventListener('click', () => save());
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  $('routes-close').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
}
