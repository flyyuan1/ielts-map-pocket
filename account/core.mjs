const rank = Object.freeze({ new: 0, known: 1, weak: 2 });
export function conservativeStatus(a = 'new', b = 'new') {
  if (!Object.hasOwn(rank, a) || !Object.hasOwn(rank, b)) throw new TypeError('Invalid mark status');
  return rank[a] >= rank[b] ? a : b;
}
export function validateMarks(input, ids) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [id, status] of Object.entries(input)) {
    if (ids.has(id) && id !== '__proto__' && (status === 'known' || status === 'weak')) result[id] = status;
  }
  return result;
}
export function importLegacy(local = {}, cloud = {}) {
  const result = { ...cloud };
  for (const [id, status] of Object.entries(local)) {
    if (id === '__proto__' || (status !== 'known' && status !== 'weak')) continue;
    const merged = conservativeStatus(status, cloud[id] ?? 'new');
    if (merged !== 'new') result[id] = merged;
  }
  return result;
}
export function changedMarks(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(id => (before[id] ?? 'new') !== (after[id] ?? 'new'))
    .map(cardId => ({ cardId, status: after[cardId] ?? 'new' }));
}
export function snapshotToMarks(rows, ids) {
  const marks = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && ids.has(row.cardId) && row.cardId !== '__proto__' && (row.status === 'known' || row.status === 'weak')) marks[row.cardId] = row.status;
  }
  return marks;
}
export function normalizeView(view, ids, categories) {
  return {
    cardId: ids.has(view?.cardId) ? view.cardId : null,
    filter: ['core', 'all', 'weak', 'new'].includes(view?.filter) ? view.filter : 'core',
    category: view?.category === 'all' || categories.has(view?.category) ? view.category : 'all',
  };
}
export function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
