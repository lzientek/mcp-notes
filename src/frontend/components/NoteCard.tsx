import type { Note } from '../types.js';

interface NoteCardProps {
  note: Note;
  onSelect: (noteId: string) => void;
}

function formatRelativeDate(dateStr: string): string {
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

export function NoteCard({ note, onSelect }: NoteCardProps) {
  const excerpt =
    note.content.length > 120
      ? `${note.content.slice(0, 120)}…`
      : note.content;

  return (
    <article
      className="note-card"
      onClick={() => onSelect(note.noteId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(note.noteId);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Ouvrir la note : ${note.title}`}
    >
      <h3 className="note-card-title">{note.title}</h3>
      <p className="note-card-excerpt">{excerpt}</p>
      <div className="note-card-meta">
        {note.tags.length > 0 && (
          <div className="note-card-tags">
            {note.tags.map((tag) => (
              <span key={tag} className="tag-badge">
                {tag}
              </span>
            ))}
          </div>
        )}
        <time className="note-card-date" dateTime={note.createdAt}>
          {formatRelativeDate(note.updatedAt)}
        </time>
      </div>
    </article>
  );
}
