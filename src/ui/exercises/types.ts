import type { Exercise } from '../../core/session';

export interface ExerciseOutcome {
  /** Single-word exercises; null when not graded. */
  correct: boolean | null;
  /** Set exercises (match, scene, speed round): first-try result per word. */
  perWord?: Record<string, boolean>;
  /** Reading: answered questions. */
  questions?: { correct: number; total: number };
  /** Words looked up by tapping while reading. */
  tapped?: string[];
}

export interface ExerciseProps {
  ex: Exercise;
  onDone: (r: ExerciseOutcome) => void;
}
