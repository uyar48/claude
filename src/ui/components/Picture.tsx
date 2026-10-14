import { getWord } from '../../content';
import { imageFor } from '../../content/media';

/** Word picture (4:3). Falls back to a plain colour card with the word. */
export function Picture({ wordId, size = 'md', label }: { wordId: string; size?: 'sm' | 'md' | 'lg'; label?: boolean }) {
  const img = imageFor(wordId);
  const word = getWord(wordId);
  return (
    <figure className={`picture picture-${size}`} data-word={wordId}>
      {img ? (
        <img src={img.url} alt={word.en} draggable={false} />
      ) : (
        <div className="picture-fallback" style={{ background: hueFor(wordId) }}>
          <span>{word.en}</span>
        </div>
      )}
      {label && img && !img.placeholder && <figcaption>{word.en}</figcaption>}
    </figure>
  );
}

export function hueFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 28% 42%)`;
}
