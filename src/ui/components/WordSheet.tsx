import { useEffect, useMemo } from 'react';
import { exampleFor, lookup } from '../../content';
import { speaker } from '../../audio/speaker';
import { IconClose, IconSpeaker } from './Icons';
import { Picture } from './Picture';

/** Bottom sheet shown when a word is tapped while reading. */
export function WordSheet({ form, onClose, added }: { form: string; onClose: () => void; added: boolean }) {
  const hit = lookup(form);
  const word = hit.word;
  const example = useMemo(() => (word ? exampleFor(word.id) : null), [word]);
  useEffect(() => {
    if (word) void speaker.word(word.id);
    else void speaker.text(form);
  }, [form, word]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label={`Kelime: ${form}`} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label="Kapat">
          <IconClose />
        </button>
        {word && <Picture wordId={word.id} size="md" credit />}
        <div className="sheet-word">
          <span className="en" lang="en">
            {word?.en ?? form}
          </span>
          <button className="icon-btn" aria-label="Dinle" onClick={() => (word ? speaker.word(word.id) : speaker.text(form))}>
            <IconSpeaker />
          </button>
        </div>
        <p className="sheet-tr">{word?.tr ?? 'Bu kelime henüz derslerde yok.'}</p>
        {example && (
          <p className="sheet-example">
            <button className="link en" lang="en" onClick={() => speaker.courseSentence(example.id)}>
              {example.en}
            </button>
            <span className="tr">{example.tr}</span>
          </p>
        )}
        {word && added && <p className="note">Tekrar listene eklendi.</p>}
      </div>
    </div>
  );
}
