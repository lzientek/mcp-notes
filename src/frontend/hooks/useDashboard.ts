import { useState, useEffect, useCallback } from 'react';
import { fetchNotes } from '../services/notes-service.js';
import { fetchTags } from '../services/tags-service.js';
import type { Note, Tag, NotesFilters } from '../types.js';

export function useDashboard() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<NotesFilters>({});

  const loadNotes = useCallback(async (currentFilters: NotesFilters, append = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchNotes(currentFilters);
      setNotes((prev) => (append ? [...prev, ...result.notes] : result.notes));
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement des notes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const result = await fetchTags();
      setTags(result.tags);
    } catch {
      // Tags loading failure is non-critical
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadNotes(filters);
  }, []);

  const applyFilters = useCallback((newFilters: NotesFilters) => {
    const updated = { ...newFilters, cursor: undefined };
    setFilters(updated);
    loadNotes(updated);
  }, [loadNotes]);

  const loadMore = useCallback(() => {
    if (nextCursor) {
      const withCursor = { ...filters, cursor: nextCursor };
      loadNotes(withCursor, true);
    }
  }, [nextCursor, filters, loadNotes]);

  const refresh = useCallback(() => {
    loadNotes(filters);
  }, [filters, loadNotes]);

  return {
    notes,
    tags,
    nextCursor,
    isLoading,
    error,
    filters,
    applyFilters,
    loadMore,
    refresh,
  };
}
