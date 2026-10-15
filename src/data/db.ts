import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Card } from '../core/srs';
import type { LessonLogEntry } from '../core/progress';

export type Dirty = { dirty: 0 | 1 };

export interface ReviewLogEntry {
  id: string;
  wordId: string;
  grade: string;
  /** Where the answer came from: review, quiz, tap … */
  context: string;
  reviewedAt: number;
}

interface OkumaDB extends DBSchema {
  cards: { key: string; value: Card & Dirty; indexes: { dirty: number } };
  lessons: { key: string; value: LessonLogEntry & Dirty; indexes: { dirty: number } };
  reviews: { key: string; value: ReviewLogEntry & Dirty; indexes: { dirty: number } };
  kv: { key: string; value: unknown };
}

export type DB = IDBPDatabase<OkumaDB>;

export function openStore(name = 'okuma'): Promise<DB> {
  return openDB<OkumaDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('cards', { keyPath: 'wordId' }).createIndex('dirty', 'dirty');
      db.createObjectStore('lessons', { keyPath: 'id' }).createIndex('dirty', 'dirty');
      db.createObjectStore('reviews', { keyPath: 'id' }).createIndex('dirty', 'dirty');
      db.createObjectStore('kv');
    },
  });
}

export const strip = <T extends Dirty>({ dirty: _d, ...rest }: T): Omit<T, 'dirty'> => rest;
