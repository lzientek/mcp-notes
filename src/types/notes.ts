/**
 * Represents a note stored in DynamoDB.
 * Each note is scoped to a user via the userId partition key.
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
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}
