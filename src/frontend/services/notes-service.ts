import { apiGet, apiPut } from './api-client.js';
import type { NotesFilters, NotesListResponse, Note } from '../types.js';

export async function fetchNotes(filters: NotesFilters = {}): Promise<NotesListResponse> {
  const params: Record<string, string> = {};

  if (filters.tags && filters.tags.length > 0) {
    params.tags = filters.tags.join(',');
  }
  if (filters.from) {
    params.from = filters.from;
  }
  if (filters.to) {
    params.to = filters.to;
  }
  if (filters.search) {
    params.search = filters.search;
  }
  if (filters.favorites) {
    params.favorites = 'true';
  }
  if (filters.limit) {
    params.limit = String(filters.limit);
  }
  if (filters.cursor) {
    params.cursor = filters.cursor;
  }

  return apiGet<NotesListResponse>('/notes', params);
}

export async function fetchNote(noteId: string): Promise<Note> {
  return apiGet<Note>(`/notes/${encodeURIComponent(noteId)}`);
}

export async function toggleFavorite(noteId: string, isFavorite: boolean): Promise<Note> {
  return apiPut<Note>(`/notes/${encodeURIComponent(noteId)}`, { isFavorite });
}
