# Simple Web View — Requirements

## Overview

Provide a minimal web interface at `www.notlai.com` where authenticated users can view, create, edit, and delete their personal notes. The app currently only exposes signup/login screens; this spec adds the authenticated "notes dashboard" experience.

## Actors

- **Authenticated User**: A user who has signed up and confirmed their email via Cognito, and holds a valid session (ID token).

## Functional Requirements

### REQ-1: Authentication gate

- After login, the user is redirected to the notes dashboard.
- If the user's token is expired or absent, redirect to the login page (`?action=login`).
- Tokens (idToken, refreshToken) are stored in `localStorage`.
- Silently refresh the session using the refresh token when the ID token expires.

### REQ-2: Notes list view

- Display all user notes in reverse-chronological order (most recent first, by `updatedAt`).
- Each note shows: title, first 120 characters of content as preview, and relative time since last update.
- Empty state: display a message inviting the user to create their first note.
- A "New note" button is always visible.

### REQ-3: Create a note

- Clicking "New note" opens an inline editor (not a separate page).
- Fields: title (required, max 200 chars) and content (plain text, optional, max 10 000 chars).
- On submit, call `POST /notes` on `api.notlai.com` with the Cognito ID token as `Authorization` header.
- On success, prepend the new note to the list and close the editor.
- On error, display the error message inline.

### REQ-4: View / Edit a note

- Clicking a note in the list opens it in the editor with pre-filled title and content.
- The user can modify title and/or content and save (`PUT /notes/{noteId}`).
- A "Cancel" action discards unsaved changes and returns to the list.
- On success, update the note in the list.

### REQ-5: Delete a note

- Each note (in list or in editor view) has a delete action.
- Deletion requires confirmation (e.g., "Supprimer cette note ?").
- On confirm, call `DELETE /notes/{noteId}`.
- On success, remove the note from the list.

### REQ-6: Logout

- A logout button clears stored tokens and redirects to the login page.

### REQ-7: Responsive design

- The view must be usable on mobile (≥ 320px) and desktop.
- No external CSS framework; use the existing `styles.css` approach (plain CSS).

### REQ-8: API integration

- All API calls go to `https://api.notlai.com` (the custom domain configured for API Gateway).
- Authorization header: `Bearer <idToken>`.
- Handle 401 responses by redirecting to login.

## Non-functional Requirements

### NFR-1: Performance

- Initial load (after cache) under 1s on 4G.
- The frontend bundle (JS + CSS) stays under 50 KB gzipped.

### NFR-2: Tech constraints

- React 19 (already in deps), no additional framework (no router library — simple state-based navigation).
- esbuild for bundling (already configured).
- No SSR — fully client-side SPA served from S3/CloudFront.

### NFR-3: Accessibility

- All interactive elements are keyboard-navigable.
- Form inputs have associated labels.
- Status messages use `aria-live` regions.

## Out of scope

- Rich text / markdown editing (plain text only for now).
- Search or filtering of notes.
- Sharing notes with other users.
- Offline support / service worker.
- Note tagging or categorization.
