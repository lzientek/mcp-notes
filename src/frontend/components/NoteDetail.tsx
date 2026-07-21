import { useState, useEffect } from 'react';
import { fetchNote } from '../services/notes-service.js';
import type { Note } from '../types.js';

interface NoteDetailProps {
  noteId: string;
  onBack: () => void;
}

export function NoteDetail({ noteId, onBack }: NoteDetailProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchNote(noteId)
      .then((data) => {
        if (!cancelled) setNote(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (isLoading) {
    return (
      <div className="note-detail" aria-live="polite">
        <button type="button" className="back-btn" onClick={onBack}>
          ← Retour
        </button>
        <p className="loading">Chargement…</p>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="note-detail" aria-live="polite">
        <button type="button" className="back-btn" onClick={onBack}>
          ← Retour
        </button>
        <p className="error-alert" role="alert">
          {error ?? 'Note introuvable'}
        </p>
      </div>
    );
  }

  return (
    <div className="note-detail">
      <button type="button" className="back-btn" onClick={onBack}>
        ← Retour
      </button>
      <article>
        <h1>{note.title}</h1>
        {note.tags.length > 0 && (
          <div className="note-detail-tags">
            {note.tags.map((tag) => (
              <span key={tag} className="tag-badge">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="note-detail-dates">
          <span>Créé le {new Date(note.createdAt).toLocaleDateString('fr-FR')}</span>
          <span>Modifié le {new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
        </div>
        <div className="note-detail-content">
          {note.content.split('\n').map((line, i) => (
            <p key={i}>{line || '\u00A0'}</p>
          ))}
        </div>
      </article>
    </div>
  );
}
