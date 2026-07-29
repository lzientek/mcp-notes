import { apiGet } from './api-client.js';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface ActivityEvent {
  noteId: string;
  timestamp: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  source: string | null;
  details: Record<string, unknown> | null;
  diff?: DiffHunk[];
}

export interface ActivityResponse {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export async function fetchActivity(noteId: string, limit = 20, cursor?: string): Promise<ActivityResponse> {
  const params: Record<string, string> = { limit: String(limit) };
  if (cursor) params.cursor = cursor;
  return apiGet<ActivityResponse>(`/notes/${encodeURIComponent(noteId)}/activity`, params);
}
