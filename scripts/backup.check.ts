// Run: node --experimental-strip-types scripts/backup.check.ts
import assert from 'node:assert/strict';
import { merge, validate } from '../src/backup.ts';

assert.throws(() => validate({ places: [] }));
const b = validate({
  app: 'audio-map',
  evil: 1,
  places: [{ name: 'A', lat: 1, lon: 2, x: 1 }, { name: 'B', lat: 99, lon: 0 }, { name: 5, lat: 0, lon: 0 }, null],
  notes: [{ text: 'hi', lat: 0, lon: 0 }, { text: '', lat: 0, lon: 0 }],
  settings: { vehicle: 'car', units: 'bogus', volume: 7, turnByTurn: false, nope: true },
});
assert.deepEqual(b.places, [{ name: 'A', lat: 1, lon: 2 }]);
assert.equal(b.notes.length, 1);
assert.deepEqual(b.settings, { vehicle: 'car', turnByTurn: false });
assert.equal(validate({ app: 'audio-map', places: Array(9999).fill({ name: 'a', lat: 0, lon: 0 }) }).places.length, 500);
const m = merge(b.places, [{ name: 'a', lat: 1, lon: 2 }, { name: 'C', lat: 3, lon: 4 }], (x) => x.name, 500);
assert.equal(m.added, 1);
console.log('ok');
