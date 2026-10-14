import { useEffect } from 'react';
import { lookup } from '../../content';
import { speaker } from '../../audio/speaker';
import { IconClose, IconSpeaker } from './Icons';
import { Picture } from './Picture';

/** Bottom sheet shown when a word is tapped while reading. */
export function WordSheet({ form, onClose, added }: { form: string; onClose: () => void; added: boolean }) {
  const hit = lookup(form);
  useEffect(() => {
    if (hit.word) void speaker.word(hit.word.id);
    else void speaker.text(form);
  }, [form, hit.word]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label={`Kelime: ${form}`} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label="Kapat">
          <IconClose />
        </button>
        {hit.word && <Picture wordId={hit.word.id} size="md" />}
        <div className="sheet-word">
          <span className="en">{hit.word?.en ?? form}</span>
          <button
            className="icon-btn"
            aria-label="Dinle"
            onClick={() => (hit.word ? speaker.word(hit.word.id) : speaker.text(form))}
          >
            <IconSpeaker />
          </button>
        </div>
        <p className="sheet-tr">{hit.word?.tr ?? hit.gloss ?? '—'}</p>
        {hit.word && (
          <p className="sheet-example">
            <button className="link en" lang="en" onClick={() => speaker.example(hit.word!.id)}>
              {hit.word.example}
            </button>
            <span className="tr">{hit.word.exampleTr}</span>
          </p>
        )}
        {hit.word && added && <p className="note">Tekrar listene eklendi.</p>}
      </div>
    </div>
  );
}
