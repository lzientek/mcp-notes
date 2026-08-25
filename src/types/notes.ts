/**
 * Shape of the records stored in DynamoDB, shared by the lambdas and the
 * frontend (src/frontend/types.ts re-exports these).
 */

export type SharePermission = 'read' | 'write';
export type ShareType = 'public' | 'user';

/**
 * A note stored in DynamoDB, scoped to a user via the userId partition key.
 */
export interface Note {
  /** Cognito User Pool sub (UUID) — partition key */
  userId: string;
  /** ULID — sort key, provides time-ordered IDs */
  noteId: string;
  /** Note title */
  title: string;
  /** Note body content (markdown) */
  content: string;
  /** Tag names, always lowercased */
  tags: string[];
  /** Folder the note lives in, null when at root */
  folderId: string | null;
  isFavorite: boolean;
  /** Client that wrote last, e.g. "claude" or "cursor" — null when unknown */
  lastModifiedBy: string | null;
  /** Email of the user who wrote last, falling back to their Cognito sub */
  lastModifiedByUser: string | null;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** A note returned to someone it was shared with, carrying the share metadata. */
export interface SharedNote extends Note {
  isShared: true;
  /** userId of the note owner — the partition the note actually lives in */
  ownerId: string;
  permission: SharePermission;
  sharedAt: string;
}

/**
 * A note as it comes back from DynamoDB. Attributes added after the first
 * release (tags, folderId, isFavorite…) are absent from older items, so every
 * field is optional until the handler fills in the defaults.
 */
export type NoteItem = Partial<Note>;

export interface Share {
  /** Random URL-safe id — partition key */
  shareId: string;
  /** Owner of the shared note */
  userId: string;
  noteId: string;
  type: ShareType;
  permission: SharePermission;
  /** Only set for user shares */
  recipientEmail?: string;
  createdAt: string;
}

export interface Tag {
  /** Present on the stored item, not returned to the frontend */
  userId?: string;
  /** The lowercased name, used as the sort key */
  tagId: string;
  name: string;
  createdAt: string;
}

export interface Folder {
  userId?: string;
  /** The lowercased name, used as the sort key */
  folderId: string;
  name: string;
  createdAt: string;
}
