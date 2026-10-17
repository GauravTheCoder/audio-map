import { loadFavorites, saveFavorites, SAVED_CHANGED } from './favorites';
import { loadNotes, saveNotes } from './notes';
import type { MapView } from './mapview';

interface Deps {
  map: MapView;
  /** Choose a saved place as destination; the caller closes the menus. */
  go: (name: string, lat: number, lon: number) => void;
  canGo: () => boolean;
  /** Spot notes in the running game must be reloaded after any change. */
  notesChanged: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initManage(d: Deps) {
  const dlg = $<HTMLDialogElement>('saved');
  const status = $('saved-status');

  const syncMap = () => {
    d.map.setSaved(loadFavorites(), loadNotes());
    d.notesChanged();
  };
  window.addEventListener(SAVED_CHANGED, syncMap);
  syncMap();

  function row(list: HTMLElement, label: string, value: string, onSave: (v: string) => void, onDelete: () => void, onGo?: () => void) {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.setAttribute('aria-label', label);
    const btn = (text: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', `${text} ${value}`);
      b.addEventListener('click', fn);
      return b;
    };
    const save = () => {
      const v = input.value.trim();
      if (!v) {
        status.textContent = 'Text cannot be empty.';
        return;
      }
      onSave(v);
      status.textContent = 'Saved.';
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    li.append(input, btn('Save', save));
    if (onGo) li.append(btn('Go to', onGo));
    li.append(btn('Delete', onDelete));
    list.appendChild(li);
  }

  function render() {
    const places = $('saved-places');
    const notes = $('saved-notes');
    places.replaceChildren();
    notes.replaceChildren();
    const favs = loadFavorites();
    favs.forEach((f, i) =>
      row(
        places,
        `Place name ${i + 1}`,
        f.name,
        (v) => saveFavorites(favs.map((o, j) => (j === i ? { ...o, name: v } : o))),
        () => {
          saveFavorites(favs.filter((_, j) => j !== i));
          status.textContent = `Deleted ${f.name}.`;
          render();
        },
        d.canGo() ? () => d.go(f.name, f.lat, f.lon) : undefined,
      ),
    );
    const ns = loadNotes();
    ns.forEach((n, i) =>
      row(
        notes,
        `Note text ${i + 1}`,
        n.text,
        (v) => saveNotes(ns.map((o, j) => (j === i ? { ...o, text: v } : o))),
        () => {
          saveNotes(ns.filter((_, j) => j !== i));
          status.textContent = 'Deleted note.';
          render();
        },
      ),
    );
    if (!favs.length) places.innerHTML = '<li>No saved places. Press Y in the explorer to save one.</li>';
    if (!ns.length) notes.innerHTML = '<li>No notes. Press V in the explorer to leave one.</li>';
    // rebuilding the rows drops the focused control, which would send keyboard users back to the top of the page
    if (dlg.open && !dlg.contains(document.activeElement)) (places.querySelector<HTMLElement>('input') ?? $('saved-close')).focus();
  }

  $('saved-btn').addEventListener('click', () => {
    status.textContent = '';
    render();
    dlg.showModal();
    dlg.querySelector<HTMLElement>('input, #saved-close')?.focus();
  });
  $('saved-close').addEventListener('click', () => dlg.close());
  return { close: () => dlg.close() };
}
