import { useState, useEffect, useCallback } from 'react';
import { fetchNotes } from '../services/notes-service.js';
import { fetchTags } from '../services/tags-service.js';
import { fetchFolders, createFolder as apiCreateFolder, deleteFolder as apiDeleteFolder } from '../services/folders-service.js';
import type { Note, Tag, Folder, NotesFilters } from '../types.js';

export function useDashboard() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
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

  const loadFolders = useCallback(async () => {
    try {
      const result = await fetchFolders();
      setFolders(result.folders);
    } catch {
      // Folders loading failure is non-critical
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadFolders();
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

  const createFolder = useCallback(async (name: string) => {
    try {
      await apiCreateFolder(name);
      await loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création du dossier');
    }
  }, [loadFolders]);

  const deleteFolder = useCallback(async (folderId: string) => {
    try {
      await apiDeleteFolder(folderId);
      await loadFolders();
      // Refresh notes in case some were in that folder
      loadNotes(filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression du dossier');
    }
  }, [loadFolders, loadNotes, filters]);

  return {
    notes,
    tags,
    folders,
    nextCursor,
    isLoading,
    error,
    filters,
    applyFilters,
    loadMore,
    refresh,
    createFolder,
    deleteFolder,
  };
}
