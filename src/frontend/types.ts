// Note, Tag and Folder are the DynamoDB shapes — defined once in src/types
// and re-exported here so frontend imports stay local.
import type { Note, Tag, Folder } from '../types/notes.js';

export type { Note, Tag, Folder };

export type AppStep = 'signup' | 'confirm' | 'success' | 'login' | 'login-success' | 'login-error' | 'dashboard' | 'detail';

export interface FormErrors {
  email?: string | null;
  password?: string | null;
  code?: string | null;
}

export interface UseSignupReturn {
  signup: (email: string, password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export interface UseConfirmReturn {
  confirm: (email: string, code: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export interface UseResendCodeReturn {
  resend: (email: string) => Promise<void>;
  isLoading: boolean;
  cooldownRemaining: number;
  message: string | null;
}

export interface NotesFilters {
  tags?: string[];
  from?: string;
  to?: string;
  search?: string;
  favorites?: boolean;
  folderId?: string;
  limit?: number;
  cursor?: string;
}

export interface NotesListResponse {
  notes: Note[];
  nextCursor: string | null;
}

export interface TagsListResponse {
  tags: Tag[];
}

export interface FoldersListResponse {
  folders: Folder[];
}
