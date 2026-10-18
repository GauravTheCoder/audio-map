// Key rebinding dialog: pick an action, press its new key. All feedback is spoken.

import { conflict, describeBinding, isReserved, type ActionId, type Binding, type KeyOverrides } from './keymap';
import { ACTIONS, filterActions, type Action } from './palette';

const MODIFIER_KEYS = ['Shift', 'Alt', 'Meta', 'AltGraph'];

/** What pressing `b` for `id` does: the binding to save, or the reason it is refused. */
export function tryBind(id: ActionId, b: Binding, o: KeyOverrides): { ok: true } | { ok: false; why: string } {
  if (isReserved(b)) return { ok: false, why: `${describeBinding(b)} is reserved. Press another key.` };
  const other = conflict(id, b, o);
  if (other) {
    const name = ACTIONS.find((x) => x.id === other)?.name ?? other;
    return { ok: false, why: `${describeBinding(b)} is already used for ${name}. Press another key.` };
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
  let shown: Action[] = [];
  let active = 0;
  let pending: Action | null = null;

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
        say('Cancelled.');
        return;
      }
      if (MODIFIER_KEYS.includes(e.key)) return;
      if (e.altKey) return say('Alt combinations are not supported. Press another key.');
      const b: Binding = { key: e.key.length === 1 ? e.key.toLowerCase() : e.key, shift: e.shiftKey, ctrl: e.ctrlKey };
      const r = tryBind(pending.id!, b, getKeys());
      if (!r.ok) return say(r.why);
      setKeys({ ...getKeys(), [pending.id!]: b });
      say(`${pending.name} is now ${describeBinding(b)}.`);
      pending = null;
      render();
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
