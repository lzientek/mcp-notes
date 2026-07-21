# Simple Web View — Requirements

## Overview

A read-only web interface at `www.notlai.com` that lets an authenticated user browse, filter, search, and read notes they created via their LLM (Claude, ChatGPT, Mistral…) and the MCP server. This is **not** a second editing surface — no creation, modification, or deletion is possible from this view.

Notes are created and managed exclusively through the MCP server (`notlai-mcp`) running locally alongside the LLM. The web view is a consultation window only.

## System Context

| Component | Role |
|-----------|------|
| `notlai-mcp` (local) | MCP server — exposes tools to the LLM for auth, note CRUD, and tag management. Calls `api.notlai.com`. |
| `mcp-notes` (AWS) | Backend — CDK stack with API Gateway, Lambda functions, DynamoDB, Cognito. |
| `www.notlai.com` (S3/CF) | Frontend — read-only SPA served via CloudFront. |

## Actors

- **Note owner**: The user who creates notes via their LLM. Authenticates with the same Cognito account on both the MCP server and the web view.

---

## Functional Requirements

### REQ-1: Authentication

- The user logs in with the same credentials used by their LLM/MCP integration (single identity, Cognito User Pool).
- After successful login, the user lands directly on their notes list — no manual sync step.
- Tokens (idToken, refreshToken) are stored in `localStorage`.
- Silent token refresh using the refresh token when the ID token expires.
- If the session is invalid or expired beyond refresh, redirect to the login page.

### REQ-2: Notes list

- Display all user notes in reverse-chronological order (most recent `updatedAt` first).
- Each list entry shows:
  - An excerpt of the content (first ~120 characters).
  - Associated tags (as badges/chips).
  - Creation date.
- Pagination or infinite scroll when the number of notes exceeds a threshold (start with paginated batches of 20).
- Empty state: message indicating no notes have been created yet, inviting the user to use their LLM.

### REQ-3: Filtering

- Filter by tag: select one or multiple tags from the user's tag list; show only notes carrying at least one selected tag.
- Filter by period: predefined shortcuts ("cette semaine", "ce mois-ci") and a custom date range picker.
- Both filters can be combined (AND logic: matching tags AND within the selected period).
- Active filters are visually indicated and individually dismissable.

### REQ-4: Search

- Free-text search field over note content and title.
- Results updated after the user submits (press Enter / click search) — server-side query.
- Search can be combined with active filters.
- Clear search action resets to the full filtered list.

### REQ-5: Note detail view

- Clicking a note in the list opens a full view of the note.
- Displays: full content, all tags, creation date, last modification date.
- No edit or delete action is visible or accessible — strictly read-only.
- A "back to list" action returns to the list, preserving active filters and scroll position.

### REQ-6: Logout

- A logout button clears stored tokens and redirects to the login page.

### REQ-7: Freshness guarantee

- A note deleted or modified via the LLM/MCP must be reflected on the next page load or list refresh — no stale cache.
- The list fetches fresh data from the API on every navigation to the list view.

---

## Tag System Requirements

### REQ-8: Tag data model

- Tags are **scoped per user** — each user has their own independent set of tags.
- A tag has: `userId` (partition key), `tagId` (sort key, ULID), `name` (string, unique per user), `createdAt`.
- Tag names are case-insensitive for uniqueness (stored lowercase).
- A note can have 0 to N tags (stored as a `tags` array of tag names on the note item).

### REQ-9: Tags API — CRUD endpoints

New endpoints on `api.notlai.com`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tags` | List all tags for the authenticated user |
| `POST` | `/tags` | Create a new tag. Body: `{ "name": "string" }`. Returns 409 if name already exists for this user. |
| `DELETE` | `/tags/{tagId}` | Delete a tag. Also removes the tag name from all notes that reference it. |

- All endpoints require Cognito authorization (same authorizer as `/notes`).
- `GET /tags` returns `{ "tags": [{ "tagId", "name", "createdAt" }] }`.

### REQ-10: Notes API — tag support in create and update

Modify existing endpoints:

- **`POST /notes`** — accept an optional `tags` field: `{ "title", "content", "tags": ["tag1", "tag2"] }`.
  - Each tag name in the array must already exist in the user's tag list (validated server-side).
  - If a tag name doesn't exist, return 400 with the invalid tag names listed.
  - Tags are stored as a `tags: string[]` attribute on the note DynamoDB item.

- **`PUT /notes/{noteId}`** — accept an optional `tags` field to replace the note's tag list.
  - Same validation: all tag names must exist in the user's tag list.
  - If `tags` is omitted, existing tags are preserved (no change).
  - If `tags` is an empty array `[]`, all tags are removed from the note.

### REQ-11: Automatic tagging by the LLM

- The MCP server (`notlai-mcp`) should expose tools that enable the LLM to manage tags:
  - `mcp_notes_list_tags` — list the user's existing tags.
  - `mcp_notes_create_tag` — create a new tag.
  - `mcp_notes_delete_tag` — delete a tag.
- When creating or updating a note, the LLM is instructed (via tool descriptions) to:
  1. Fetch the existing tag list.
  2. Select relevant tags from existing ones based on the note content.
  3. If no existing tag fits, create a new tag first, then assign it.
  4. Pass the selected tag names in the `tags` field of the create/update call.
- This is **advisory behavior** driven by the tool descriptions and LLM reasoning — not enforced logic. The API simply accepts whatever valid tag names are passed.

### REQ-12: Tag deletion cascade

- When a tag is deleted via `DELETE /tags/{tagId}`, the backend must remove that tag name from the `tags` array of all notes belonging to the user that reference it.
- This ensures no orphan tag references remain on notes.

---

## Non-functional Requirements

### NFR-1: Responsive design

- Usable on mobile (≥ 320px width) and desktop.
- No external CSS framework; plain CSS following the existing project style.

### NFR-2: Performance

- Initial load (after cache) under 1s on 4G.
- Frontend bundle (JS + CSS) stays under 50 KB gzipped.

### NFR-3: Tech constraints

- React 19 (already in deps), no additional framework or routing library — state-based navigation.
- esbuild for bundling (already configured).
- Fully client-side SPA served from S3/CloudFront. No SSR.
- Tags DynamoDB table: same billing mode (PAY_PER_REQUEST) as notes table.

### NFR-4: Accessibility

- All interactive elements are keyboard-navigable.
- Form inputs have associated labels.
- Status messages and loading states use `aria-live` regions.

### NFR-5: API integration

- All API calls to `https://api.notlai.com`.
- Authorization: `Bearer <idToken>` header.
- Handle 401 responses by clearing session and redirecting to login.

---

## Business Rules

- **Strictly read-only web view**: no create, edit, or delete actions exposed in the web interface.
- **Isolation**: a user only sees their own notes and tags.
- **No stale data**: a note deleted via the LLM disappears from the web view on next consultation.
- **Tags scoped per user**: two users can have tags with the same name without conflict.
- **Tag validation on write**: notes can only be tagged with existing tags belonging to the same user.

## Out of Scope

- Creating, editing, or deleting notes from the web.
- Sharing notes with other users (treated separately).
- Organization into folders or workspaces.
- Offline support / service worker.
- Rich text rendering (notes displayed as plain text for now).
- Tag renaming (delete + recreate for now).

## Success Criterion

A user can find, filter by tag or date, and read any of their notes from a browser without ever needing to open their LLM, and without any possibility of accidentally altering content from this interface. Tags assigned automatically by the LLM provide meaningful categorization without manual effort.
