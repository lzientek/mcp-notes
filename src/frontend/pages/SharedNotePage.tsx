import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import { isAuthenticated, apiPost } from '../services/api-client.js';

marked.setOptions({ breaks: true, gfm: true });

export function SharedNotePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [note, setNote] = useState<{ title: string; content: string; createdAt: string; updatedAt: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const loggedIn = isAuthenticated();

  useEffect(() => {
    if (!shareId) return;
    setIsLoading(true);
    fetch(`https://api.notlai.com/shared/${encodeURIComponent(shareId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Note not found');
        return res.json();
      })
      .then((data) => setNote(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [shareId]);

  const handleImport = useCallback(async () => {
    if (!note) return;
    setImportStatus('loading');
    try {
      await apiPost('/notes', {
        title: note.title,
        content: note.content,
      });
      setImportStatus('success');
    } catch {
      setImportStatus('error');
    }
  }, [note]);

  if (isLoading) {
    return (
      <div className="shared-page">
        <div className="shared-page-header">
          <a href="/" aria-label="Notlai">
            <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="shared-page-logo" />
          </a>
        </div>
        <div className="shared-page-content">
          <p className="loading">Chargement…</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="shared-page">
        <div className="shared-page-header">
          <a href="/" aria-label="Notlai">
            <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="shared-page-logo" />
          </a>
        </div>
        <div className="shared-page-content">
          <div className="shared-page-not-found">
            <h1>Note introuvable</h1>
            <p>Ce lien de partage n'existe pas ou a été révoqué.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-page">
      <div className="shared-page-header">
        <a href="/" aria-label="Notlai">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="shared-page-logo" />
        </a>
        <div className="shared-page-header-actions">
          <span className="shared-page-badge">Note partagée</span>
          {loggedIn && importStatus === 'idle' && (
            <button type="button" className="shared-page-import-btn" onClick={handleImport}>
              Importer dans mes notes
            </button>
          )}
          {importStatus === 'loading' && (
            <span className="shared-page-import-status">Import en cours…</span>
          )}
          {importStatus === 'success' && (
            <span className="shared-page-import-status success">
              ✓ Importée ! <a href="/dashboard">Voir mes notes</a>
            </span>
          )}
          {importStatus === 'error' && (
            <span className="shared-page-import-status error">
              Erreur — <button type="button" className="shared-page-retry-btn" onClick={handleImport}>réessayer</button>
            </span>
          )}
        </div>
      </div>
      <article className="shared-page-content">
        <h1>{note.title}</h1>
        <div className="shared-page-dates">
          <span>Créé le {new Date(note.createdAt).toLocaleDateString('fr-FR')}</span>
          <span>Modifié le {new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
        </div>
        <div
          className="note-detail-content markdown-body"
          dangerouslySetInnerHTML={{ __html: marked.parse(note.content) as string }}
        />
      </article>
      <footer className="shared-page-footer">
        <p>Propulsé par <a href="https://www.notlai.com">Notlai</a> — Notes pour l'ère de l'IA</p>
      </footer>
    </div>
  );
}
