import { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { fetchNote, toggleFavorite } from '../services/notes-service.js';
import { ShareModal } from './ShareModal.js';
import type { Note } from '../types.js';

// Configure marked for safe rendering (no raw HTML)
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface NoteDetailProps {
  noteId: string;
  onBack: () => void;
}

export function NoteDetail({ noteId, onBack }: NoteDetailProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingFav, setTogglingFav] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

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

  const handleToggleFavorite = useCallback(async () => {
    if (!note || togglingFav) return;
    setTogglingFav(true);
    try {
      const updated = await toggleFavorite(note.noteId, !note.isFavorite);
      setNote(updated);
    } catch {
      // silently fail
    } finally {
      setTogglingFav(false);
    }
  }, [note, togglingFav]);

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
        <div className="note-detail-header">
          <h1>{note.title}</h1>
          <button
            type="button"
            className={`favorite-btn ${note.isFavorite ? 'active' : ''}`}
            onClick={handleToggleFavorite}
            disabled={togglingFav}
            aria-label={note.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            title={note.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            {note.isFavorite ? '★' : '☆'}
          </button>
          <button
            type="button"
            className="share-btn"
            onClick={() => setShowShareModal(true)}
            title="Partager cette note"
          >
            🔗
          </button>
        </div>
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
        <div
          className="note-detail-content markdown-body"
          dangerouslySetInnerHTML={{ __html: marked.parse(note.content) as string }}
        />
      </article>
      {showShareModal && <ShareModal noteId={noteId} onClose={() => setShowShareModal(false)} />}
    </div>
  );
}
