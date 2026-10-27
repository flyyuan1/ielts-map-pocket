import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore, backupLegacy, readGuest } from '../account/storage.mjs';

export function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map };
}
const ids = new Set(['a', 'b']);
let sequence = 0;
const options = { ids, categories: new Set(['g1']), makeId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` };
const response = (marks, ack = [], view = null) => ({ complete: true, marks, acknowledgedOperationIds: ack, conflicts: [], view });

test('legacy backup preserves the exact original value and is never overwritten', () => {
  const storage = memoryStorage(); storage.setItem('ielts-map-pocket-v1', '{"marks":{"a":"known"},"extra":true}');
  backupLegacy(storage); storage.setItem('ielts-map-pocket-v1', '{}'); backupLegacy(storage);
  assert.equal(storage.getItem('pocket:guest-backup:v1'), '{"marks":{"a":"known"},"extra":true}');
  assert.deepEqual(readGuest(storage, options).marks, {});
});
test('account caches remain separate after a reload', () => {
  const storage = memoryStorage(); const a = new AccountStore(storage, 'user-a', options);
  a.enqueueMarks([{ cardId: 'a', status: 'known' }]);
  assert.deepEqual(new AccountStore(storage, 'user-a', options).visibleMarks(), { a: 'known' });
  assert.deepEqual(new AccountStore(storage, 'user-b', options).visibleMarks(), {});
});
test('a response confirms only submitted operations and retains changes made in flight', () => {
  const store = new AccountStore(memoryStorage(), 'a', options);
  store.enqueueMarks([{ cardId: 'a', status: 'known' }]); const batch = store.batch();
  store.enqueueMarks([{ cardId: 'b', status: 'weak' }]);
  store.accept(response([{ cardId: 'a', status: 'known', revision: 1 }], [batch.operations[0].operationId]), batch);
  assert.equal(store.read().outbox.length, 1);
  assert.equal(store.read().outbox[0].cardId, 'b');
  assert.deepEqual(store.visibleMarks(), { a: 'known', b: 'weak' });
});
test('same-device changes behind an in-flight operation rebase only after its acknowledgement', () => {
  const store = new AccountStore(memoryStorage(), 'a', options);
  store.enqueueMarks([{ cardId: 'a', status: 'weak' }]); const first = store.batch();
  store.enqueueMarks([{ cardId: 'a', status: 'known' }]);
  store.accept(response([{ cardId: 'a', status: 'weak', revision: 1 }], [first.operations[0].operationId]), first);
  const second = store.batch();
  assert.equal(second.operations[0].baseRevision, 1);
  assert.equal(second.operations[0].status, 'known');
});
test('retries retain exactly the same operation ID and payload', () => {
  const store = new AccountStore(memoryStorage(), 'a', options);
  store.enqueueMarks([{ cardId: 'a', status: 'weak' }]);
  const first = store.batch(); const again = store.batch();
  assert.deepEqual(again, first);
});
test('a cloud pull cannot erase a queued offline mark or silently rebase a genuine conflict', () => {
  const store = new AccountStore(memoryStorage(), 'a', options);
  store.enqueueMarks([{ cardId: 'a', status: 'weak' }]);
  store.accept(response([{ cardId: 'a', status: 'known', revision: 2 }]), { operations: [], view: null });
  assert.deepEqual(store.visibleMarks(), { a: 'weak' });
  assert.equal(store.batch().operations[0].baseRevision, 0);
});
test('incomplete or malformed responses leave the queue unchanged', () => {
  const store = new AccountStore(memoryStorage(), 'a', options);
  store.enqueueMarks([{ cardId: 'a', status: 'weak' }]); const batch = store.batch();
  assert.throws(() => store.accept({ marks: [], acknowledgedOperationIds: [] }, batch));
  assert.equal(store.read().outbox.length, 1);
});
test('failed durable writes do not mutate the prior in-memory queue', () => {
  const storage = memoryStorage(); const store = new AccountStore(storage, 'a', options);
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.enqueueMarks([{ cardId: 'a', status: 'weak' }]), /quota/);
  assert.deepEqual(store.visibleMarks(), {});
});
test('invalid versioned account data is preserved and reported', () => {
  const storage = memoryStorage(); const raw = '{"schemaVersion":999}'; storage.setItem('pocket:account:v2:a', raw);
  assert.throws(() => new AccountStore(storage, 'a', options), /同步数据/);
  assert.equal(storage.getItem('pocket:account:v2:a'), raw);
});
