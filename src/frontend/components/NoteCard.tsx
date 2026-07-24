import type { Note } from '../types.js';

interface NoteCardProps {
  note: Note;
  onSelect: (noteId: string) => void;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')          // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/__(.+?)__/g, '$1')        // bold alt
    .replace(/_(.+?)_/g, '$1')          // italic alt
    .replace(/~~(.+?)~~/g, '$1')        // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // inline/block code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
    .replace(/^\s*[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^\s*>\s+/gm, '')          // blockquotes
    .replace(/---+/g, '')               // horizontal rules
    .replace(/\n{2,}/g, ' ')            // collapse multiple newlines
    .replace(/\n/g, ' ')                // remaining newlines
    .trim();
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
  const plain = stripMarkdown(note.content);
  const excerpt = plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;

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
      <div className="note-card-title-row">
        <h3 className="note-card-title">{note.title}</h3>
        {note.isFavorite && <span className="note-card-star" aria-label="Favori">★</span>}
      </div>
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
