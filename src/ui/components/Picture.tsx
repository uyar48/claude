import { getWord } from '../../content';
import { creditLine, emojiFor, imageFor } from '../../content/media';
import { useAppState } from '../hooks';

/**
 * Word picture (4:3): the chosen stock photo, else the word's emoji, else a
 * plain colour card. `credit` shows the photographer line (Pexels asks for it).
 */
export function Picture({
  wordId,
  size = 'md',
  label,
  credit,
}: {
  wordId: string;
  size?: 'sm' | 'md' | 'lg';
  label?: boolean;
  credit?: boolean;
}) {
  const { mediaChoices } = useAppState();
  const img = imageFor(wordId, mediaChoices);
  const word = getWord(wordId);
  const emoji = emojiFor(wordId);
  return (
    <figure className={`picture picture-${size}`} data-word={wordId}>
      {img ? (
        <img src={img.src} alt={word.en} draggable={false} />
      ) : emoji ? (
        <div className="picture-emoji" role="img" aria-label={word.en}>
          <span>{emoji}</span>
        </div>
      ) : (
        <div className="picture-fallback" style={{ background: hueFor(wordId) }}>
          <span lang="en">{word.en}</span>
        </div>
      )}
      {label && <figcaption lang="en">{word.en}</figcaption>}
      {credit && img && (
        <a className="credit" href={img.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {creditLine(img)}
        </a>
      )}
    </figure>
  );
}

/** True when the word has a real photo (used for picture exercises). */
export function useHasPhoto(): (wordId: string) => boolean {
  const { mediaChoices } = useAppState();
  return (wordId: string) => imageFor(wordId, mediaChoices) !== null;
}

export function hueFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 28% 42%)`;
}
