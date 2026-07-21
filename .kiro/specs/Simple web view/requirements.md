# Simple Web View — Requirements

## Overview

A read-only web interface at `www.notlai.com` that lets an authenticated user browse, filter, search, and read notes they created via their LLM (Claude, ChatGPT, Mistral…) and the MCP server. This is **not** a second editing surface — no creation, modification, or deletion is possible from this view.

## Actors

- **Note owner**: The user who created notes via their LLM. They authenticate with the same Cognito account linked to the MCP server.

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
  - Associated tags.
  - Creation date.
- Pagination or infinite scroll when the number of notes exceeds a threshold (to be defined based on typical usage — start with paginated batches of 20).
- Empty state: message indicating no notes have been created yet, inviting the user to use their LLM.

### REQ-3: Filtering

- Filter by tag: select one or multiple tags; show only notes that carry at least one selected tag.
- Filter by period: predefined shortcuts ("cette semaine", "ce mois-ci") and a custom date range picker.
- Both filters can be combined (AND logic: matching tags AND within the selected period).
- Active filters are visually indicated and individually dismissable.

### REQ-4: Search

- Free-text search field over note content and title.
- Results updated after the user submits (press Enter / click search) — not real-time, to keep it simple with a server-side query.
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
- The list fetches fresh data from the API on every navigation to the list view (no aggressive client-side caching of note data).

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

### NFR-4: Accessibility

- All interactive elements are keyboard-navigable.
- Form inputs have associated labels.
- Status messages and loading states use `aria-live` regions.

### NFR-5: API integration

- All API calls to `https://api.notlai.com`.
- Authorization: `Bearer <idToken>` header.
- Handle 401 responses by clearing session and redirecting to login.

## Business Rules

- **Strictly read-only**: no create, edit, or delete actions exposed in this interface, even though the underlying API supports them.
- **Isolation**: a user only sees their own notes.
- **No stale data**: a note deleted via the LLM disappears from the web view on the next consultation (see REQ-7).

## Out of Scope

- Creating, editing, or deleting notes from the web.
- Sharing notes with other users (treated separately).
- Organization into folders or workspaces.
- Offline support / service worker.
- Rich text rendering (notes displayed as plain text for now).

## Success Criterion

A user can find, filter, and read any of their notes from a browser without ever needing to open their LLM, and without any possibility of accidentally altering content from this interface.
