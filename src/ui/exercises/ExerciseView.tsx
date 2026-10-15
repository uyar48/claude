import type { ExerciseType } from '../../core/session';
import { ChoiceExercise } from './ChoiceExercise';
import { Dictation } from './Dictation';
import { IntroCard } from './IntroCard';
import { BuildSentence, FillBlankExercise } from './SentenceExercises';
import { MatchExercise, ReadingExercise, Scene, SpeedRound } from './SetExercises';
import type { ExerciseProps } from './types';

export const EXERCISE_LABEL: Record<ExerciseType, string> = {
  intro: 'Yeni kelime',
  match: 'Eşleştir',
  'word-to-picture': 'Kelime → resim',
  'picture-to-word': 'Resim → kelime',
  'listen-picture': 'Dinle → seç',
  'en-tr': 'İngilizce → Türkçe',
  'tr-en': 'Türkçe → İngilizce',
  dictation: 'Dikte',
  'fill-blank': 'Boşluk doldur',
  'build-sentence': 'Cümle kur',
  reading: 'Okuma',
  scene: 'Mini sahne',
  'speed-round': 'Hızlı tur',
};

export function ExerciseView(props: ExerciseProps) {
  switch (props.ex.type) {
    case 'intro':
      return <IntroCard {...props} />;
    case 'match':
      return <MatchExercise {...props} />;
    case 'word-to-picture':
    case 'picture-to-word':
    case 'listen-picture':
    case 'en-tr':
    case 'tr-en':
      return <ChoiceExercise {...props} />;
    case 'dictation':
      return <Dictation {...props} />;
    case 'fill-blank':
      return <FillBlankExercise {...props} />;
    case 'build-sentence':
      return <BuildSentence {...props} />;
    case 'reading':
      return <ReadingExercise {...props} />;
    case 'scene':
      return <Scene {...props} />;
    case 'speed-round':
      return <SpeedRound {...props} />;
  }
}
