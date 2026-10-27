export class ProgressSync {
  constructor({ api, onSnapshot, onState, isOnline = () => globalThis.navigator?.onLine !== false }) {
    this.api = api; this.onSnapshot = onSnapshot; this.onState = onState; this.isOnline = isOnline;
    this.store = null; this.generation = 0; this.running = null; this.again = false; this.failures = 0;
  }
  setAccount(store) {
    this.generation++; this.store = store; this.again = false; this.failures = 0;
  }
  retryDelay() { return Math.min(60000, 2000 * 2 ** Math.max(0, this.failures - 1)); }
  run() {
    if (this.running) { this.again = true; return this.running; }
    const store = this.store; const generation = this.generation;
    if (!store) return Promise.resolve();
    if (!this.isOnline()) { this.onState({ kind: 'offline', message: '离线，联网后自动同步' }); return Promise.resolve(); }
    const current = () => this.store === store && this.generation === generation;
    this.onState({ kind: 'syncing', message: '正在同步' });
    const execute = async () => {
      try {
        const empty = { operations: [], view: null };
        const initial = await this.api.sync(empty, store.uid);
        if (!current()) return;
        store.accept(initial, empty);
        this.onSnapshot({ marks: store.visibleMarks(), view: store.visibleView(), conflicts: initial.conflicts }, store.uid);
        let rounds = 0;
        do {
          this.again = false;
          if (!current() || !this.isOnline()) return;
          const batch = store.batch();
          if (batch.operations.length || batch.view) {
            const result = await this.api.sync(batch, store.uid);
            if (!current()) return;
            store.accept(result, batch);
            this.onSnapshot({ marks: store.visibleMarks(), view: store.visibleView(), conflicts: result.conflicts }, store.uid);
          }
          rounds++;
        } while (current() && (this.again || store.hasPending()) && rounds < 10);
        if (current()) {
          this.failures = 0;
          this.onState({ kind: store.hasPending() ? 'pending' : 'synced', message: store.hasPending() ? '正在同步' : '已同步', at: Date.now() });
        }
      } catch (error) {
        if (!current()) return;
        this.failures++;
        const needsLogin = error?.status === 401 || error?.code === 'PGRST301' || error?.code === 'AUTH_ACCOUNT_CHANGED';
        this.onState({ kind: needsLogin ? 'login' : this.isOnline() ? 'error' : 'offline', message: needsLogin ? '需要重新登录' : this.isOnline() ? '同步暂不可用，本机记录已保留' : '离线，联网后自动同步', error });
      }
    };
    this.running = execute().finally(() => {
      this.running = null;
      if (this.generation !== generation && this.again && this.store) {
        this.again = false; this.run();
      }
    });
    return this.running;
  }
}
