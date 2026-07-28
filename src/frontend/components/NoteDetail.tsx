import { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { fetchNote, toggleFavorite } from '../services/notes-service.js';
import { ShareModal } from './ShareModal.js';
import { ActivityPanel } from './ActivityPanel.js';
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
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = useCallback(async () => {
    if (!note) return;
    try {
      await navigator.clipboard.writeText(note.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = note.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [note]);

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
      <div className="note-detail-layout">
        <article className="note-detail-main">
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
            <button
              type="button"
              className={`copy-md-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopyMarkdown}
              title="Copier le contenu en Markdown"
              aria-label="Copier le contenu en Markdown"
            >
              {copied ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
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
        <ActivityPanel noteId={noteId} />
      </div>
      {showShareModal && <ShareModal noteId={noteId} onClose={() => setShowShareModal(false)} />}
    </div>
  );
}
