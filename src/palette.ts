// Command palette (F2): every key command reachable by searching its name.

export interface Action {
  name: string;
  /** spoken/shown key, e.g. "Shift P" */
  label: string;
  key: string;
  shift?: boolean;
  ctrl?: boolean;
}

const a = (name: string, label: string, key: string, shift = false, ctrl = false): Action => ({ name, label, key, shift, ctrl });

export const ACTIONS: Action[] = [
  a('Align with the road', 'R', 'r'),
  a('Heading', 'H', 'h'),
  a('Headphone check', 'Shift H', 'H', true),
  a('Speed', 'S', 's'),
  a('Location', 'L', 'l'),
  a('Toggle live GPS and compass', 'Shift L', 'L', true),
  a('Next intersection', 'N', 'n'),
  a('Last intersection behind you', 'Shift N', 'N', true),
  a('Step forward through intersections', 'Period', '.'),
  a('Step back through intersections', 'Comma', ','),
  a('Toggle intersection proximity beeps', 'Shift B', 'B', true),
  a("What's around", 'W', 'w'),
  a('Weather and daylight', 'Shift W', 'W', true),
  a('Sonar sweep', 'Space', ' '),
  a('Jump to a place', 'Control J', 'j', false, true),
  a('Save route', 'Shift Q', 'Q', true),
  a('Saved routes', 'Q', 'q'),
  a('Search for a destination', 'Control D', 'd', false, true),
  a('Distance to go', 'D', 'd'),
  a('Toggle turn-by-turn directions', 'T', 't'),
  a('Next instruction', 'I', 'i'),
  a('Toggle destination beacon', 'B', 'b'),
  a('Next nearby place', 'Tab', 'Tab'),
  a('Previous nearby place', 'Shift Tab', 'Tab', true),
  a('Set browsed place as destination', 'Enter', 'Enter'),
  a('Destination distance and direction', 'G', 'g'),
  a('Clear destination', 'Backspace', 'Backspace'),
  a('Filter kind of place', 'C', 'c'),
  a('Leave a spoken note', 'V', 'v'),
  a('Delete note here', 'Shift V', 'V', true),
  a('Copy share link', 'Z', 'z'),
  a('Trip summary', 'U', 'u'),
  a('Where am I', 'E', 'e'),
  a('Preview route', 'O', 'o'),
  a('Next bus stop or station', 'X', 'x'),
  a('Save this place', 'Y', 'y'),
  a('Walker', '1', '1'),
  a('Bicycle', '2', '2'),
  a('Car', '3', '3'),
  a('Helicopter', '4', '4'),
  a('Toggle road assist', 'A', 'a'),
  a('Switch sound theme', 'Shift A', 'A', true),
  a('Toggle place announcements', 'P', 'p'),
  a('Switch sound profile', 'Shift P', 'P', true),
  a('Toggle map rotation', 'M', 'm'),
  a('Previous spoken message', 'Left bracket', '['),
  a('Next spoken message', 'Right bracket', ']'),
  a('Stop speech', 'Control', 'Control'),
  a('Volume up', 'Page Up', 'PageUp'),
  a('Volume down', 'Page Down', 'PageDown'),
  a('Search for a new location', 'F', 'f'),
  a('Open settings', 'Control comma', ',', false, true),
  a('Learn the keys', 'Shift F1', 'F1', true),
  a('Spoken help', 'F1', 'F1'),
  a('Menu', 'Escape', 'Escape'),
];

/** Case-insensitive; every typed word must appear in the name. */
export function filterActions(q: string): Action[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return ACTIONS.filter((x) => words.every((w) => x.name.toLowerCase().includes(w)));
}

/** Wires the dialog and returns the opener. `run` is called after the dialog has closed. */
export function setupPalette(canOpen: () => boolean, onClose: () => void, run: (x: Action) => void) {
  const dlg = document.getElementById('palette') as HTMLDialogElement;
  const q = document.getElementById('palette-q') as HTMLInputElement;
  const list = document.getElementById('palette-list') as HTMLUListElement;
  const status = document.getElementById('palette-status') as HTMLElement;
  let shown: Action[] = [];
  let active = 0;

  const mark = () => {
    list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    q.setAttribute('aria-activedescendant', shown.length ? `palette-opt-${active}` : '');
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (x: Action) => {
    dlg.close();
    onClose();
    run(x);
  };
  const render = () => {
    shown = filterActions(q.value);
    active = 0;
    list.replaceChildren(
      ...shown.map((x, i) => {
        const li = document.createElement('li');
        li.id = `palette-opt-${i}`;
        li.setAttribute('role', 'option');
        li.textContent = `${x.name}, ${x.label}`;
        li.addEventListener('click', () => choose(x));
        return li;
      }),
    );
    status.textContent = shown.length === 1 ? '1 action.' : `${shown.length} actions.`;
    mark();
  };

  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    dlg.close();
    onClose();
  });

  return () => {
    if (dlg.open || !canOpen()) return;
    q.value = '';
    render();
    dlg.showModal();
    q.focus();
  };
}
