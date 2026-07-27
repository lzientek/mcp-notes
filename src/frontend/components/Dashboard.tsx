import { useState, useCallback } from 'react';
import { useDashboard } from '../hooks/useDashboard.js';
import { SearchBar } from './SearchBar.js';
import { TagFilter } from './TagFilter.js';
import { DateFilter } from './DateFilter.js';
import { FolderFilter } from './FolderFilter.js';
import { NoteCard } from './NoteCard.js';
import { clearSession, redirectToLogin } from '../services/api-client.js';
import { bulkDeleteNotes } from '../services/notes-service.js';
import type { NotesFilters } from '../types.js';

interface DashboardProps {
  onSelectNote: (noteId: string) => void;
}

export function Dashboard({ onSelectNote }: DashboardProps) {
  const { notes, tags, folders, nextCursor, isLoading, error, applyFilters, loadMore, refresh, createFolder, deleteFolder } =
    useDashboard();

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const buildAndApply = useCallback(
    (overrides: Partial<{ tags: string[]; from: string | null; to: string | null; search: string; folderId: string | null }>) => {
      const newTags = overrides.tags ?? selectedTags;
      const newFrom = overrides.from !== undefined ? overrides.from : dateFrom;
      const newTo = overrides.to !== undefined ? overrides.to : dateTo;
      const newSearch = overrides.search !== undefined ? overrides.search : searchQuery;
      const newFolderId = overrides.folderId !== undefined ? overrides.folderId : selectedFolderId;

      const filters: NotesFilters = {};
      if (newTags.length > 0) filters.tags = newTags;
      if (newFrom) filters.from = newFrom;
      if (newTo) filters.to = newTo;
      if (newSearch) filters.search = newSearch;
      if (newFolderId) filters.folderId = newFolderId;

      applyFilters(filters);
    },
    [selectedTags, dateFrom, dateTo, searchQuery, selectedFolderId, applyFilters],
  );

  const handleTagFilter = useCallback(
    (newTags: string[]) => {
      setSelectedTags(newTags);
      buildAndApply({ tags: newTags });
    },
    [buildAndApply],
  );

  const handleFolderFilter = useCallback(
    (folderId: string | null) => {
      setSelectedFolderId(folderId);
      buildAndApply({ folderId });
    },
    [buildAndApply],
  );

  const handleDateFilter = useCallback(
    (from: string | null, to: string | null) => {
      setDateFrom(from);
      setDateTo(to);
      buildAndApply({ from, to });
    },
    [buildAndApply],
  );

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      buildAndApply({ search: query });
    },
    [buildAndApply],
  );

  const handleLogout = useCallback(() => {
    clearSession();
    redirectToLogin();
  }, []);

  const toggleNoteSelection = useCallback((noteId: string) => {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedNotes.size === 0) return;
    const confirmed = window.confirm(`Supprimer ${selectedNotes.size} note(s) définitivement ?`);
    if (!confirmed) return;

    try {
      await bulkDeleteNotes(Array.from(selectedNotes));
      setSelectedNotes(new Set());
      setIsSelectionMode(false);
      refresh();
    } catch {
      // Error handled by service
    }
  }, [selectedNotes, refresh]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedNotes(new Set());
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <a href="/" aria-label="Retour à la liste des notes">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
        </a>
        <div className="dashboard-header-actions">
          {isSelectionMode ? (
            <>
              <span className="selection-count">{selectedNotes.size} sélectionnée(s)</span>
              <button type="button" className="bulk-delete-btn" onClick={handleBulkDelete} disabled={selectedNotes.size === 0}>
                Supprimer
              </button>
              <button type="button" className="cancel-selection-btn" onClick={exitSelectionMode}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button type="button" className="select-btn" onClick={() => setIsSelectionMode(true)}>
                Sélectionner
              </button>
              <button type="button" className="logout-btn" onClick={handleLogout}>
                Déconnexion
              </button>
            </>
          )}
        </div>
      </header>

      <div className="dashboard-filters">
        <SearchBar onSearch={handleSearch} />
        <FolderFilter
          folders={folders}
          selectedFolderId={selectedFolderId}
          onFilterChange={handleFolderFilter}
          onCreateFolder={createFolder}
          onDeleteFolder={deleteFolder}
        />
        <TagFilter tags={tags} selectedTags={selectedTags} onFilterChange={handleTagFilter} />
        <DateFilter onFilterChange={handleDateFilter} />
      </div>

      <main className="dashboard-content" aria-live="polite">
        {error && (
          <p className="error-alert" role="alert">
            {error}
          </p>
        )}

        {!isLoading && notes.length === 0 && !error && (
          <div className="empty-state">
            <p>Aucune note pour le moment.</p>
            <p>Créez vos premières notes via votre assistant IA (Claude, ChatGPT…) avec le serveur MCP Notlai.</p>
          </div>
        )}

        <div className="notes-list">
          {notes.map((note) => (
            <NoteCard
              key={note.noteId}
              note={note}
              onSelect={isSelectionMode ? toggleNoteSelection : onSelectNote}
              isSelectionMode={isSelectionMode}
              isSelected={selectedNotes.has(note.noteId)}
              folders={folders}
            />
          ))}
        </div>

        {isLoading && <p className="loading">Chargement…</p>}

        {nextCursor && !isLoading && (
          <button type="button" className="load-more-btn" onClick={loadMore}>
            Charger plus
          </button>
        )}
      </main>
    </div>
  );
}
