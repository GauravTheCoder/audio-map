// Key rebinding dialog: pick an action, press its new key. All feedback is spoken.

import { conflict, describeBinding, isReserved, type ActionId, type Binding, type KeyOverrides } from './keymap';
import { ACTIONS, filterActions, type Action } from './palette';

const MODIFIER_KEYS = ['Shift', 'Alt', 'Meta', 'AltGraph'];

/** What pressing `b` for `id` does: the binding to save, or the reason it is refused. */
export function tryBind(id: ActionId, b: Binding, o: KeyOverrides): { ok: true } | { ok: false; why: string } {
  if (isReserved(b)) return { ok: false, why: `Error: ${describeBinding(b)} is reserved.` };
  const other = conflict(id, b, o);
  if (other) {
    const name = ACTIONS.find((x) => x.id === other)?.name ?? other;
    return { ok: false, why: `Error: key conflict with ${name}.` };
  }
  return { ok: true };
}

/** Wires the dialog and returns the opener. */
export function setupRebind(
  getKeys: () => KeyOverrides,
  setKeys: (o: KeyOverrides) => void,
  say: (text: string) => void,
  onClose: () => void,
) {
  const dlg = document.getElementById('rebind') as HTMLDialogElement;
  const q = document.getElementById('rebind-q') as HTMLInputElement;
  const list = document.getElementById('rebind-list') as HTMLUListElement;
  const reset = document.getElementById('rebind-reset') as HTMLButtonElement;
  // role=application makes NVDA/JAWS pass every key through instead of using it for browse-mode navigation
  const capture = document.getElementById('rebind-capture') as HTMLElement;
  let shown: Action[] = [];
  let active = 0;
  let pending: Action | null = null;
  let candidate: Binding | null = null;

  const mark = () => {
    list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    q.setAttribute('aria-activedescendant', shown.length ? `rebind-opt-${active}` : '');
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    shown = filterActions(q.value, getKeys()).filter((x) => x.id);
    active = 0;
    list.replaceChildren(
      ...shown.map((x, i) => {
        const li = document.createElement('li');
        li.id = `rebind-opt-${i}`;
        li.setAttribute('role', 'option');
        li.textContent = `${x.name}, ${x.label}`;
        li.addEventListener('click', () => ask(x));
        return li;
      }),
    );
    mark();
  };
  const ask = (x: Action) => {
    pending = x;
    candidate = null;
    capture.focus();
    say(`${x.name}, now ${x.label}. Press the new key, or Escape to cancel.`);
  };

  dlg.addEventListener(
    'keydown',
    (e) => {
      if (!pending) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        pending = null;
        candidate = null;
        q.focus();
        say('Cancelled.');
        return;
      }
      if (candidate && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        setKeys({ ...getKeys(), [pending.id!]: candidate });
        say(`New key set: ${pending.name} is now ${describeBinding(candidate)}.`);
        pending = null;
        candidate = null;
        render();
        q.focus();
        return;
      }
      if (MODIFIER_KEYS.includes(e.key)) return;
      if (e.altKey) return say('Error: Alt combinations are not supported.');
      const b: Binding = { key: e.key.length === 1 ? e.key.toLowerCase() : e.key, shift: e.shiftKey, ctrl: e.ctrlKey };
      const r = tryBind(pending.id!, b, getKeys());
      if (!r.ok) {
        candidate = null;
        return say(`${r.why} Press another key, or Escape to cancel.`);
      }
      candidate = b;
      say(`${describeBinding(b)}. Press Enter to set it, or press another key.`);
    },
    true,
  );
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) ask(shown[active]);
    }
  });
  reset.addEventListener('click', () => {
    pending = null;
    candidate = null;
    setKeys({});
    say('All keys are back to their defaults.');
    render();
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (pending) return;
    dlg.close();
    onClose();
  });

  return () => {
    q.value = '';
    pending = null;
    render();
    dlg.showModal();
    q.focus();
    say('Change key bindings. Search for an action, then press Enter to give it a new key.');
  };
}
