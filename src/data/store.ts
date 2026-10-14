// Local-first app state. IndexedDB is the source of truth on the device; every
// change is marked dirty and pushed by the sync engine when online.

import type { LessonLogEntry, LessonPlan } from '../core/lesson';
import { normalizeSettings, type Settings } from '../core/settings';
import { introduce, markForReview, newCard, review, type Card, type Grade } from '../core/srs';
import { strip, type DB, type ReviewLogEntry } from './db';

export interface LessonProgress {
  lessonId: string;
  plan: LessonPlan;
  segmentIndex: number;
  startedAt: number;
  reviewed: number;
  correct: number;
  tapped: string[];
}

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

export interface AppState {
  ready: boolean;
  cards: ReadonlyMap<string, Card>;
  lessons: readonly LessonLogEntry[];
  settings: Settings;
  progress: LessonProgress | null;
  sync: { status: SyncStatus; lastSyncAt: number | null; error?: string };
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  /** Called after local writes; the sync engine hooks in here. */
  onLocalChange: () => void = () => {};

  constructor(
    private db: DB,
    private now: () => number = Date.now,
  ) {
    this.state = {
      ready: false,
      cards: new Map(),
      lessons: [],
      settings: normalizeSettings(undefined),
      progress: null,
      sync: { status: 'local', lastSyncAt: null },
    };
  }

  async load() {
    const [cards, lessons, settings, progress, lastSyncAt] = await Promise.all([
      this.db.getAll('cards'),
      this.db.getAll('lessons'),
      this.db.get('kv', 'settings'),
      this.db.get('kv', 'progress'),
      this.db.get('kv', 'lastSyncAt'),
    ]);
    this.set({
      ready: true,
      cards: new Map(cards.map((c) => [c.wordId, strip(c) as Card])),
      lessons: sortLessons(lessons.map((l) => strip(l) as LessonLogEntry)),
      settings: normalizeSettings(settings),
      progress: (progress as LessonProgress | undefined) ?? null,
      sync: { ...this.state.sync, lastSyncAt: (lastSyncAt as number | undefined) ?? null },
    });
  }

  // ---------- subscription (useSyncExternalStore) ----------

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  setSync(sync: Partial<AppState['sync']>) {
    this.set({ sync: { ...this.state.sync, ...sync } });
    if (sync.lastSyncAt) void this.db.put('kv', sync.lastSyncAt, 'lastSyncAt');
  }

  // ---------- cards ----------

  card(wordId: string): Card {
    return this.state.cards.get(wordId) ?? newCard(wordId, 0);
  }

  async putCards(cards: Card[]) {
    const tx = this.db.transaction('cards', 'readwrite');
    await Promise.all([...cards.map((c) => tx.store.put({ ...c, dirty: 1 })), tx.done]);
    const next = new Map(this.state.cards);
    for (const c of cards) next.set(c.wordId, c);
    this.set({ cards: next });
    this.onLocalChange();
  }

  async introduceWords(ids: string[]) {
    const now = this.now();
    await this.putCards(ids.map((id) => introduce(this.card(id), now)));
  }

  async grade(wordId: string, grade: Grade, context: string): Promise<Card> {
    const now = this.now();
    const card = review(this.card(wordId), grade, now);
    await this.putCards([card]);
    const entry: ReviewLogEntry = { id: crypto.randomUUID(), wordId, grade, context, reviewedAt: now };
    await this.db.put('reviews', { ...entry, dirty: 1 });
    return card;
  }

  async tapWord(wordId: string) {
    const before = this.card(wordId);
    const after = markForReview(before, this.now());
    if (after !== before) await this.putCards([after]);
  }

  // ---------- lessons ----------

  async putLesson(entry: LessonLogEntry) {
    await this.db.put('lessons', { ...entry, dirty: 1 });
    const others = this.state.lessons.filter((l) => l.id !== entry.id);
    this.set({ lessons: sortLessons([...others, entry]) });
    this.onLocalChange();
  }

  async setProgress(progress: LessonProgress | null) {
    if (progress) await this.db.put('kv', progress, 'progress');
    else await this.db.delete('kv', 'progress');
    this.set({ progress });
  }

  // ---------- settings ----------

  async updateSettings(patch: (s: Settings) => Settings) {
    const settings = { ...patch(this.state.settings), updatedAt: this.now() };
    await this.db.put('kv', settings, 'settings');
    await this.db.put('kv', true, 'settingsDirty');
    this.set({ settings });
    this.onLocalChange();
  }

  // ---------- used by sync ----------

  async applyRemote(cards: Card[], lessons: LessonLogEntry[], settings: Settings | null) {
    const nextCards = new Map(this.state.cards);
    let changed = false;
    if (cards.length) {
      const tx = this.db.transaction('cards', 'readwrite');
      for (const remote of cards) {
        const local = await tx.store.get(remote.wordId);
        if (!local || remote.updatedAt > local.updatedAt) {
          await tx.store.put({ ...remote, dirty: 0 });
          nextCards.set(remote.wordId, remote);
          changed = true;
        }
      }
      await tx.done;
    }
    let nextLessons = this.state.lessons;
    if (lessons.length) {
      const tx = this.db.transaction('lessons', 'readwrite');
      const byId = new Map(nextLessons.map((l) => [l.id, l]));
      for (const remote of lessons) {
        const local = await tx.store.get(remote.id);
        if (!local || remote.updatedAt > local.updatedAt) {
          await tx.store.put({ ...remote, dirty: 0 });
          byId.set(remote.id, remote);
          changed = true;
        }
      }
      await tx.done;
      nextLessons = sortLessons([...byId.values()]);
    }
    let nextSettings = this.state.settings;
    if (settings && settings.updatedAt > this.state.settings.updatedAt) {
      nextSettings = settings;
      await this.db.put('kv', settings, 'settings');
      changed = true;
    }
    if (changed) this.set({ cards: nextCards, lessons: nextLessons, settings: nextSettings });
  }

  dirtyCards = async () => (await this.db.getAllFromIndex('cards', 'dirty', 1)).map((c) => strip(c) as Card);
  dirtyLessons = async () =>
    (await this.db.getAllFromIndex('lessons', 'dirty', 1)).map((l) => strip(l) as LessonLogEntry);
  dirtyReviews = async () =>
    (await this.db.getAllFromIndex('reviews', 'dirty', 1)).map((r) => strip(r) as ReviewLogEntry);
  settingsDirty = async () => Boolean(await this.db.get('kv', 'settingsDirty'));

  /** Clears the dirty flag unless the record changed again meanwhile. */
  async markClean(kind: 'cards' | 'lessons', items: Array<{ updatedAt: number; key: string }>) {
    const tx = this.db.transaction(kind, 'readwrite');
    for (const { key, updatedAt } of items) {
      const cur = await tx.store.get(key);
      if (cur && cur.updatedAt === updatedAt) await tx.store.put({ ...cur, dirty: 0 });
    }
    await tx.done;
  }

  async markReviewsClean(ids: string[]) {
    const tx = this.db.transaction('reviews', 'readwrite');
    for (const id of ids) {
      const cur = await tx.store.get(id);
      if (cur) await tx.store.put({ ...cur, dirty: 0 });
    }
    await tx.done;
  }

  async clearSettingsDirty(updatedAt: number) {
    if (this.state.settings.updatedAt === updatedAt) await this.db.put('kv', false, 'settingsDirty');
  }

  kvGet = (key: string) => this.db.get('kv', key);
  kvSet = (key: string, value: unknown) => this.db.put('kv', value, key);
}

function sortLessons(l: LessonLogEntry[]): LessonLogEntry[] {
  return [...l].sort((a, b) => a.startedAt - b.startedAt);
}
