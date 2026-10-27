import { normalizeView, snapshotToMarks, validRevision, validateMarks } from './core.mjs';

const LEGACY = 'ielts-map-pocket-v1';
export function backupLegacy(storage) {
  const raw = storage.getItem(LEGACY);
  if (raw !== null && storage.getItem('pocket:guest-backup:v1') === null) storage.setItem('pocket:guest-backup:v1', raw);
}
export function readGuest(storage, { ids, categories }) {
  const raw = storage.getItem(LEGACY);
  let data = {};
  if (raw !== null) {
    try { data = JSON.parse(raw) || {}; }
    catch { backupLegacy(storage); }
  }
  return { marks: validateMarks(data.marks, ids), ...normalizeView({ ...data, category: data.cat ?? data.category }, ids, categories), position: Number.isSafeInteger(data.position) && data.position >= 0 ? data.position : 0 };
}
const copy = value => structuredClone(value);
const publicOperation = ({ operationId, cardId, status, baseRevision }) => ({ operationId, cardId, status, baseRevision });
const publicView = ({ operationId, cardId, filter, category, baseRevision }) => ({ operationId, cardId, filter, category, baseRevision });

export class AccountStore {
  constructor(storage, uid, { ids, categories, makeId = () => crypto.randomUUID() }) {
    if (!uid || typeof uid !== 'string') throw new TypeError('Invalid account');
    this.storage = storage; this.uid = uid; this.ids = ids; this.categories = categories; this.makeId = makeId;
    this.key = 'pocket:account:v2:' + uid;
    const raw = storage.getItem(this.key);
    if (raw !== null) {
      try {
        this.state = JSON.parse(raw);
        if (this.state.schemaVersion !== 2 || !Array.isArray(this.state.outbox) || !Array.isArray(this.state.views) || !Array.isArray(this.state.cloudMarks)) throw new Error('Invalid cache');
        for (const op of this.state.outbox) this.validateOperation(op);
        for (const view of this.state.views) this.validateView(view);
        this.validateSnapshot({ complete: true, marks: this.state.cloudMarks, view: this.state.cloudView, acknowledgedOperationIds: [], conflicts: [] });
      } catch { throw new Error('本机同步数据暂不可读，原始记录已保留；请先备份后再恢复。'); }
    } else {
      this.state = { schemaVersion: 2, deviceId: makeId(), cloudMarks: [], cloudView: null, outbox: [], views: [], legacyImportComplete: false };
      this.commit(this.state);
    }
  }
  commit(next) {
    this.storage.setItem(this.key, JSON.stringify(next));
    this.state = next;
  }
  read() { return copy(this.state); }
  visibleMarks() {
    const marks = snapshotToMarks(this.state.cloudMarks, this.ids);
    for (const op of this.state.outbox) {
      if (op.status === 'new') delete marks[op.cardId]; else marks[op.cardId] = op.status;
    }
    return marks;
  }
  visibleView() {
    const view = this.state.views.at(-1) ?? this.state.cloudView;
    return view ? normalizeView(view, this.ids, this.categories) : null;
  }
  hasPending() { return this.state.outbox.length > 0 || this.state.views.length > 0; }
  revision(id) { return this.state.cloudMarks.find(row => row.cardId === id)?.revision ?? 0; }
  validateOperation(op) {
    if (!op || !this.ids.has(op.cardId) || !['known', 'weak', 'new'].includes(op.status) || !validRevision(op.baseRevision) || typeof op.operationId !== 'string') throw new TypeError('Invalid progress operation');
  }
  validateView(view) {
    const normal = normalizeView(view, this.ids, this.categories);
    if (!view || typeof view.operationId !== 'string' || !validRevision(view.baseRevision) || normal.cardId !== view.cardId || normal.category !== view.category || normal.filter !== view.filter) throw new TypeError('Invalid view operation');
  }
  enqueueMarks(changes) {
    const next = this.read();
    for (const change of changes) {
      const last = next.outbox.findLast(op => op.cardId === change.cardId);
      const op = {
        operationId: this.makeId(), cardId: change.cardId, status: change.status,
        baseRevision: last?.baseRevision ?? this.revision(change.cardId),
        sent: false, dependsOn: last?.sent ? last.operationId : last?.dependsOn ?? null,
      };
      this.validateOperation(op);
      if (last && !last.sent) next.outbox.splice(next.outbox.indexOf(last), 1, op); else next.outbox.push(op);
    }
    this.commit(next);
  }
  enqueueView(view) {
    const normal = normalizeView(view, this.ids, this.categories);
    if (JSON.stringify(this.visibleView()) === JSON.stringify(normal)) return;
    const next = this.read(); const last = next.views.at(-1);
    const op = {
      operationId: this.makeId(), ...normal,
      baseRevision: last?.baseRevision ?? next.cloudView?.revision ?? 0,
      sent: false, dependsOn: last?.sent ? last.operationId : last?.dependsOn ?? null,
    };
    if (last && !last.sent) next.views.splice(-1, 1, op); else next.views.push(op);
    this.commit(next);
  }
  batch() {
    const next = this.read(); const seen = new Set(); const selected = [];
    for (const op of next.outbox) {
      if (seen.has(op.cardId) || selected.length === 200) continue;
      seen.add(op.cardId); op.sent = true; selected.push(publicOperation(op));
    }
    const view = next.views[0] ?? null;
    if (view) view.sent = true;
    this.commit(next);
    return { operations: selected, view: view ? publicView(view) : null };
  }
  validateSnapshot(result) {
    if (!result || result.complete !== true || !Array.isArray(result.marks) || !Array.isArray(result.acknowledgedOperationIds) || !Array.isArray(result.conflicts) || result.marks.length > this.ids.size) throw new Error('同步响应不完整，待上传进度已保留。');
    const seen = new Set();
    for (const row of result.marks) {
      if (!row || seen.has(row.cardId) || !this.ids.has(row.cardId) || !['known', 'weak', 'new'].includes(row.status) || !validRevision(row.revision) || row.revision === 0) throw new Error('同步响应包含无效记录。');
      seen.add(row.cardId);
    }
    if (result.view !== null && result.view !== undefined) {
      const view = result.view; const normal = normalizeView(view, this.ids, this.categories);
      if (!validRevision(view.revision) || view.revision === 0 || normal.cardId !== view.cardId || normal.category !== view.category || normal.filter !== view.filter) throw new Error('同步位置无效。');
    }
  }
  accept(result, submitted = { operations: [], view: null }) {
    this.validateSnapshot(result);
    const sent = new Set([...submitted.operations.map(op => op.operationId), ...(submitted.view ? [submitted.view.operationId] : [])]);
    const ack = new Set(result.acknowledgedOperationIds.filter(id => sent.has(id)));
    const next = this.read();
    const rows = new Map(next.cloudMarks.map(row => [row.cardId, row]));
    for (const row of result.marks) if ((rows.get(row.cardId)?.revision ?? 0) <= row.revision) rows.set(row.cardId, { ...row });
    next.cloudMarks = [...rows.values()];
    if (result.view && (next.cloudView?.revision ?? 0) <= result.view.revision) next.cloudView = copy(result.view);
    next.outbox = next.outbox.filter(op => !ack.has(op.operationId));
    for (const op of next.outbox) if (!op.sent && op.dependsOn && ack.has(op.dependsOn)) {
      op.baseRevision = rows.get(op.cardId)?.revision ?? 0; op.dependsOn = null;
    }
    next.views = next.views.filter(op => !ack.has(op.operationId));
    for (const view of next.views) if (!view.sent && view.dependsOn && ack.has(view.dependsOn)) {
      view.baseRevision = next.cloudView?.revision ?? 0; view.dependsOn = null;
    }
    this.commit(next);
  }
  finishLegacyImport() { const next = this.read(); next.legacyImportComplete = true; this.commit(next); }
}
