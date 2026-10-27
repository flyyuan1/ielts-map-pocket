import test from 'node:test';
import assert from 'node:assert/strict';
import { changedMarks, conservativeStatus, importLegacy, validateMarks, snapshotToMarks, normalizeView } from '../account/core.mjs';

test('legacy merge preserves disjoint cards and ignores empty device state', () => {
  assert.deepEqual(importLegacy({ a: 'known' }, { b: 'weak' }), { b: 'weak', a: 'known' });
  assert.deepEqual(importLegacy({}, { b: 'known' }), { b: 'known' });
});
test('unordered legacy conflicts conservatively retain weak', () => {
  assert.equal(conservativeStatus('known', 'weak'), 'weak');
  assert.equal(conservativeStatus('weak', 'known'), 'weak');
  assert.equal(conservativeStatus('new', 'known'), 'known');
  assert.throws(() => conservativeStatus('invalid', 'weak'), TypeError);
});
test('clearing an existing mark produces a versioned new operation', () => {
  assert.deepEqual(changedMarks({ a: 'weak' }, {}), [{ cardId: 'a', status: 'new' }]);
  assert.deepEqual(changedMarks({ a: 'known' }, { a: 'known' }), []);
});
test('untrusted cache cannot introduce unknown cards, invalid states or prototype keys', () => {
  const input = JSON.parse('{"a":"known","b":"bad","other":"weak","__proto__":"known"}');
  assert.deepEqual(validateMarks(input, new Set(['a', 'b'])), { a: 'known' });
  assert.deepEqual(validateMarks([], new Set(['a'])), {});
});
test('server tombstones are retained in revisions but excluded from visible marks', () => {
  assert.deepEqual(snapshotToMarks([{ cardId: 'a', status: 'new', revision: 4 }, { cardId: 'b', status: 'weak', revision: 1 }], new Set(['a', 'b'])), { b: 'weak' });
});
test('view uses stable card ID and only valid scopes', () => {
  assert.deepEqual(normalizeView({ cardId: 'a', filter: 'all', category: 'g1' }, new Set(['a']), new Set(['g1'])), { cardId: 'a', filter: 'all', category: 'g1' });
  assert.deepEqual(normalizeView({ cardId: 'missing', filter: 'bad', category: '__proto__' }, new Set(['a']), new Set(['g1'])), { cardId: null, filter: 'core', category: 'all' });
});
