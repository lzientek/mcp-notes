import { useState, useEffect, useCallback } from 'react';
import { fetchActivity, type ActivityEvent } from '../services/activity-service.js';

interface ActivityPanelProps {
  noteId: string;
}

const AI_LOGOS: Record<string, { src: string; alt: string }> = {
  claude: { src: '/static/logos/claude.svg', alt: 'Claude' },
  kiro: { src: '/static/logos/kiro.png', alt: 'Kiro' },
  cursor: { src: '/static/logos/cursor.svg', alt: 'Cursor' },
  windsurf: { src: '/static/logos/windsurf.svg', alt: 'Windsurf' },
};

function formatAction(event: ActivityEvent): string {
  switch (event.action) {
    case 'note_created':
      return 'a créé la note';
    case 'title_changed': {
      const d = event.details as { oldTitle?: string; newTitle?: string } | null;
      return d ? `a renommé « ${d.oldTitle} » → « ${d.newTitle} »` : 'a modifié le titre';
    }
    case 'content_updated':
      return 'a modifié le contenu';
    case 'tags_added': {
      const d = event.details as { added?: string[] } | null;
      return d?.added ? `a ajouté les tags : ${d.added.join(', ')}` : 'a ajouté des tags';
    }
    case 'tags_removed': {
      const d = event.details as { removed?: string[] } | null;
      return d?.removed ? `a retiré les tags : ${d.removed.join(', ')}` : 'a retiré des tags';
    }
    case 'folder_changed': {
      const d = event.details as { newFolderId?: string } | null;
      return d?.newFolderId === 'root' ? 'a déplacé vers la racine' : 'a déplacé dans un dossier';
    }
    case 'favorite_toggled': {
      const d = event.details as { isFavorite?: boolean } | null;
      return d?.isFavorite ? 'a mis en favori' : 'a retiré des favoris';
    }
    case 'shared':
      return 'a partagé la note';
    case 'unshared':
      return 'a retiré le partage';
    case 'imported':
      return 'a importé la note';
    default:
      return event.action;
  }
}

function formatRelativeDate(timestamp: string): string {
  // timestamp format: "2026-07-27T18:30:00.000Z#01KY6ABC" — take date part
  const dateStr = timestamp.split('#')[0];
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays < 7) return `il y a ${diffDays}j`;
  return date.toLocaleDateString('fr-FR');
}

export function ActivityPanel({ noteId }: ActivityPanelProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    try {
      const result = await fetchActivity(noteId, 30, cursor);
      setEvents((prev) => cursor ? [...prev, ...result.events] : result.events);
      setNextCursor(result.nextCursor);
    } catch {
      // Non-critical
    } finally {
      setIsLoading(false);
      setLoaded(true);
    }
  }, [noteId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded && isLoading) {
    return (
      <aside className="activity-panel">
        <h2 className="activity-panel-title">Activité</h2>
        <p className="loading">Chargement…</p>
      </aside>
    );
  }

  return (
    <aside className="activity-panel">
      <h2 className="activity-panel-title">Activité</h2>
      {events.length === 0 && !isLoading && (
        <p className="activity-panel-empty">Aucune activité enregistrée.</p>
      )}
      <ul className="activity-timeline">
        {events.map((event) => {
          const aiLogo = event.source ? AI_LOGOS[event.source.toLowerCase()] : null;
          const actor = event.actorEmail ?? 'Utilisateur';
          return (
            <li key={event.timestamp} className="activity-event">
              <div className="activity-event-icon">
                {aiLogo ? (
                  <img src={aiLogo.src} alt={aiLogo.alt} className="activity-event-ai-logo" />
                ) : (
                  <span className="activity-event-dot" />
                )}
              </div>
              <div className="activity-event-content">
                <span className="activity-event-text">
                  <strong>{aiLogo?.alt ?? actor}</strong> {formatAction(event)}
                </span>
                <time className="activity-event-time">{formatRelativeDate(event.timestamp)}</time>
              </div>
            </li>
          );
        })}
      </ul>
      {nextCursor && !isLoading && (
        <button type="button" className="activity-load-more" onClick={() => load(nextCursor)}>
          Voir plus
        </button>
      )}
      {isLoading && loaded && <p className="loading">Chargement…</p>}
    </aside>
  );
}
