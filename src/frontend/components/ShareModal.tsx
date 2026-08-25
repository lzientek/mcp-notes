import { useState, useCallback } from 'react';

interface ShareModalProps {
  noteId: string;
  onClose: () => void;
}

interface ShareInfo {
  shareId: string;
  shareUrl?: string;
  type: 'public' | 'user';
  email?: string;
  permission: 'read' | 'write';
}

export function ShareModal({ noteId, onClose }: ShareModalProps) {
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createPublicLink = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`https://api.notlai.com/notes/${encodeURIComponent(noteId)}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('notlai_id_token')}`,
        },
        body: JSON.stringify({ type: 'public' }),
      });
      if (!res.ok) throw new Error('Failed to create public link');
      const data = await res.json() as ShareInfo;
      setPublicLink(data.shareUrl ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error');
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  const revokePublicLink = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetch(`https://api.notlai.com/notes/${encodeURIComponent(noteId)}/share?type=public`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('notlai_id_token')}` },
      });
      setPublicLink(null);
      setMessage('Lien public révoqué.');
    } catch {
      setMessage('Erreur lors de la révocation.');
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  const shareWithUser = useCallback(async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Email invalide.');
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`https://api.notlai.com/notes/${encodeURIComponent(noteId)}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('notlai_id_token')}`,
        },
        body: JSON.stringify({ type: 'user', email, permission }),
      });
      if (!res.ok) throw new Error('Failed to share');
      setMessage(`Partagé avec ${email} (${permission}).`);
      setEmail('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error');
    } finally {
      setIsLoading(false);
    }
  }, [noteId, email, permission]);

  const handleCopy = useCallback(() => {
    if (publicLink) {
      void navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicLink]);

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <h2>Partager la note</h2>
          <button type="button" className="share-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="share-modal-section">
          <h3>Lien public (lecture seule)</h3>
          {publicLink ? (
            <div className="share-modal-link">
              <input type="text" value={publicLink} readOnly />
              <button type="button" onClick={handleCopy}>
                {copied ? '✓' : 'Copier'}
              </button>
              <button type="button" className="share-modal-revoke" onClick={revokePublicLink} disabled={isLoading}>
                Révoquer
              </button>
            </div>
          ) : (
            <button type="button" className="share-modal-btn" onClick={createPublicLink} disabled={isLoading}>
              Générer un lien public
            </button>
          )}
        </div>

        <div className="share-modal-section">
          <h3>Partager avec un utilisateur</h3>
          <div className="share-modal-user-form">
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select value={permission} onChange={(e) => setPermission(e.target.value as 'read' | 'write')}>
              <option value="read">Lecture</option>
              <option value="write">Lecture + Écriture</option>
            </select>
            <button type="button" onClick={shareWithUser} disabled={isLoading}>
              Partager
            </button>
          </div>
        </div>

        {message && <p className="share-modal-message">{message}</p>}
      </div>
    </div>
  );
}
