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

export interface Note {
  userId: string;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  folderId: string | null;
  isFavorite: boolean;
  lastModifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  tagId: string;
  name: string;
  createdAt: string;
}

export interface Folder {
  folderId: string;
  name: string;
  createdAt: string;
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
