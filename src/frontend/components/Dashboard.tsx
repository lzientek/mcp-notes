import { useState, useCallback } from 'react';
import { useDashboard } from '../hooks/useDashboard.js';
import { SearchBar } from './SearchBar.js';
import { TagFilter } from './TagFilter.js';
import { DateFilter } from './DateFilter.js';
import { NoteCard } from './NoteCard.js';
import { clearSession, redirectToLogin } from '../services/api-client.js';
import type { NotesFilters } from '../types.js';

interface DashboardProps {
  onSelectNote: (noteId: string) => void;
}

export function Dashboard({ onSelectNote }: DashboardProps) {
  const { notes, tags, nextCursor, isLoading, error, applyFilters, loadMore } =
    useDashboard();

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const buildAndApply = useCallback(
    (overrides: Partial<{ tags: string[]; from: string | null; to: string | null; search: string }>) => {
      const newTags = overrides.tags ?? selectedTags;
      const newFrom = overrides.from !== undefined ? overrides.from : dateFrom;
      const newTo = overrides.to !== undefined ? overrides.to : dateTo;
      const newSearch = overrides.search !== undefined ? overrides.search : searchQuery;

      const filters: NotesFilters = {};
      if (newTags.length > 0) filters.tags = newTags;
      if (newFrom) filters.from = newFrom;
      if (newTo) filters.to = newTo;
      if (newSearch) filters.search = newSearch;

      applyFilters(filters);
    },
    [selectedTags, dateFrom, dateTo, searchQuery, applyFilters],
  );

  const handleTagFilter = useCallback(
    (newTags: string[]) => {
      setSelectedTags(newTags);
      buildAndApply({ tags: newTags });
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

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <a href="/" aria-label="Retour à la liste des notes">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
        </a>
        <button type="button" className="logout-btn" onClick={handleLogout}>
          Déconnexion
        </button>
      </header>

      <div className="dashboard-filters">
        <SearchBar onSearch={handleSearch} />
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
            <NoteCard key={note.noteId} note={note} onSelect={onSelectNote} />
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
