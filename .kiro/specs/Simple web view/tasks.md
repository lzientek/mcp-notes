# Simple Web View — Tasks

## Overview

Implementation tasks for the read-only web view with tag system. Tasks are ordered by dependency: backend data model first, then API, then MCP tools, then frontend.

---

## Phase 1: Backend — Tags Infrastructure

### Task 1.1: Add Tags DynamoDB table to CDK stack
- [ ] Add `McpNotesTagsTable` to `lib/mcp-notes-stack.ts`
  - PK: `userId` (String), SK: `tagId` (String)
  - BillingMode: PAY_PER_REQUEST
  - RemovalPolicy: RETAIN
- [ ] Export table name as `TagsTableName` CfnOutput

### Task 1.2: Create `list-tags` Lambda
- [ ] Create `src/lambda/list-tags.ts`
  - Extract `userId` from Cognito authorizer claims
  - Query Tags table with `KeyConditionExpression: userId = :uid`
  - Return `{ "tags": [...] }` sorted by `name`
- [ ] Add Lambda to CDK stack with `TAGS_TABLE_NAME` env var
- [ ] Grant `tagsTable.grantReadData(listTagsFn)`
- [ ] Add route: `GET /tags` → `listTagsFn` (with Cognito authorizer)

### Task 1.3: Create `create-tag` Lambda
- [ ] Create `src/lambda/create-tag.ts`
  - Parse body: `{ "name": string }`
  - Validate: name required, 1–50 chars, trim + lowercase
  - Query user's existing tags, check name uniqueness
  - If duplicate: return 409 `{ "code": "TAG_EXISTS", "message": "..." }`
  - Otherwise: generate ULID, PutItem, return 201 with the new tag
- [ ] Add Lambda to CDK stack with `TAGS_TABLE_NAME` env var
- [ ] Grant `tagsTable.grantReadWriteData(createTagFn)`
- [ ] Add route: `POST /tags` → `createTagFn` (with Cognito authorizer)

### Task 1.4: Create `delete-tag` Lambda
- [ ] Create `src/lambda/delete-tag.ts`
  - Extract `tagId` from path parameters
  - Get the tag item (to retrieve its `name`); return 404 if not found
  - Query all notes for the user (`TABLE_NAME`)
  - For each note containing the tag name in its `tags` array:
    - Update the note: remove the tag name, set `updatedAt` to now
  - Delete the tag item from Tags table
  - Return 204
- [ ] Add Lambda to CDK stack with `TAGS_TABLE_NAME` + `TABLE_NAME` env vars
- [ ] Grant `tagsTable.grantReadWriteData(deleteTagFn)` + `notesTable.grantReadWriteData(deleteTagFn)`
- [ ] Add route: `DELETE /tags/{tagId}` → `deleteTagFn` (with Cognito authorizer)

---

## Phase 2: Backend — Notes Endpoints Modifications

### Task 2.1: Add tag validation helper
- [ ] Create `src/lambda/helpers/validate-tags.ts`
  - Accepts `userId`, `tags: string[]`, and DynamoDB client + tags table name
  - Queries all user tags, checks each provided name exists
  - Returns `{ valid: true }` or `{ valid: false, invalidTags: string[] }`

### Task 2.2: Modify `create-note` to support tags
- [ ] Update `src/lambda/create-note.ts`
  - Parse optional `tags` field from body (default: `[]`)
  - If tags provided: validate with `validate-tags` helper
  - If invalid: return 400 `{ "code": "INVALID_TAGS", "invalidTags": [...] }`
  - Store `tags` array on the note item
- [ ] Grant `tagsTable.grantReadData(createNoteFn)` in CDK stack
- [ ] Add `TAGS_TABLE_NAME` env var to `createNoteFn`

### Task 2.3: Modify `update-note` to support tags
- [ ] Update `src/lambda/update-note.ts`
  - Parse optional `tags` field from body
  - If `tags` is present (including `[]`): validate + replace note's tags
  - If `tags` is absent/undefined: preserve existing tags
  - If invalid: return 400 `{ "code": "INVALID_TAGS", "invalidTags": [...] }`
- [ ] Grant `tagsTable.grantReadData(updateNoteFn)` in CDK stack
- [ ] Add `TAGS_TABLE_NAME` env var to `updateNoteFn`

### Task 2.4: Modify `list-notes` to support filtering, search, and pagination
- [ ] Update `src/lambda/list-notes.ts`
  - Parse query string params: `tags`, `from`, `to`, `search`, `limit`, `cursor`
  - Apply `FilterExpression` for:
    - Tags: check if note's `tags` list contains any of the requested tag names
    - Date range: `createdAt BETWEEN :from AND :to`
    - Search: `contains(title, :search) OR contains(content, :search)`
  - Implement cursor-based pagination with `Limit` + `ExclusiveStartKey`
  - Return `{ "notes": [...], "nextCursor": "..." | null }`
- [ ] Ensure `ScanIndexForward: false` for reverse-chronological order (or sort in-memory since PK query doesn't guarantee order by `updatedAt`)

---

## Phase 3: MCP Server — Tag Tools (notlai-mcp)

### Task 3.1: Add `mcp_notes_list_tags` tool
- [ ] In `notlai-mcp/src/server.ts`, add tool:
  - Name: `mcp_notes_list_tags`
  - Description: "List all your existing tags. Use this before creating or updating a note to find relevant tags to assign."
  - No parameters
  - Calls `GET /tags` with Bearer token
  - Returns formatted tag list

### Task 3.2: Add `mcp_notes_create_tag` tool
- [ ] In `notlai-mcp/src/server.ts`, add tool:
  - Name: `mcp_notes_create_tag`
  - Description: "Create a new tag for categorizing notes. Check existing tags first with mcp_notes_list_tags to avoid duplicates."
  - Param: `name` (string)
  - Calls `POST /tags` with Bearer token
  - Returns created tag info or error

### Task 3.3: Add `mcp_notes_delete_tag` tool
- [ ] In `notlai-mcp/src/server.ts`, add tool:
  - Name: `mcp_notes_delete_tag`
  - Description: "Delete a tag. This also removes the tag from all notes that use it."
  - Param: `tagId` (string)
  - Calls `DELETE /tags/{tagId}` with Bearer token
  - Returns success or error

### Task 3.4: Add API helper for authenticated requests
- [ ] Create `notlai-mcp/src/api/client.ts`
  - Wrapper function that loads tokens from credential store, refreshes if needed, and makes authenticated HTTP requests to `apiGatewayUrl`
  - Used by all tag tools (and future note tools)

---

## Phase 4: Frontend — Core Infrastructure

### Task 4.1: Create API client service
- [ ] Create `src/frontend/services/api-client.ts`
  - `apiGet<T>(path, params?)` — authenticated GET with Bearer token
  - `getIdToken()` — reads from localStorage
  - `clearSession()` + `redirectToLogin()` on 401
  - Silent token refresh on expired token before retry

### Task 4.2: Create notes service
- [ ] Create `src/frontend/services/notes-service.ts`
  - `fetchNotes(filters)` → calls `GET /notes` with query params
  - `fetchNote(noteId)` → calls `GET /notes/{noteId}`
  - Types: `Note`, `NotesListResponse`, `NotesFilters`

### Task 4.3: Create tags service
- [ ] Create `src/frontend/services/tags-service.ts`
  - `fetchTags()` → calls `GET /tags`
  - Type: `Tag`

### Task 4.4: Update App types and state machine
- [ ] Update `src/frontend/types.ts`
  - Add `'dashboard' | 'detail'` to `AppStep`
  - Add `Note`, `Tag`, `NotesFilters` interfaces
- [ ] Update `src/frontend/App.tsx`
  - After successful login, transition to `'dashboard'` state
  - Pass `selectedNoteId` for detail view navigation

---

## Phase 5: Frontend — Dashboard Components

### Task 5.1: Create SearchBar component
- [ ] Create `src/frontend/components/SearchBar.tsx`
  - Input field with search icon
  - Submits on Enter or button click
  - Clear button when search is active
  - `onSearch(query: string)` callback

### Task 5.2: Create TagFilter component
- [ ] Create `src/frontend/components/TagFilter.tsx`
  - Displays all user tags as clickable chips
  - Multi-select: toggle tag on/off
  - Active tags visually highlighted
  - `onFilterChange(selectedTags: string[])` callback

### Task 5.3: Create DateFilter component
- [ ] Create `src/frontend/components/DateFilter.tsx`
  - Predefined shortcuts: "Cette semaine", "Ce mois-ci", "Tout"
  - Custom date range with from/to date inputs
  - `onFilterChange(from: string | null, to: string | null)` callback

### Task 5.4: Create NoteCard component
- [ ] Create `src/frontend/components/NoteCard.tsx`
  - Displays: title excerpt, content excerpt (~120 chars), tags as chips, relative date
  - Clickable — calls `onSelect(noteId)` callback
  - Accessible: proper button/link semantics, keyboard focusable

### Task 5.5: Create Pagination component
- [ ] Create `src/frontend/components/Pagination.tsx`
  - "Load more" button (or next/previous pages)
  - Shows current count / loading state
  - `onLoadMore()` callback triggered when cursor exists

### Task 5.6: Create Dashboard component
- [ ] Create `src/frontend/components/Dashboard.tsx`
  - Orchestrates: Header, SearchBar, TagFilter, DateFilter, NotesList, Pagination
  - Manages filter state and fetches notes when filters change
  - Fetches tags on mount
  - Handles loading/error states
  - Logout button in header

---

## Phase 6: Frontend — Note Detail

### Task 6.1: Create NoteDetail component
- [ ] Create `src/frontend/components/NoteDetail.tsx`
  - Fetches full note by ID (`GET /notes/{noteId}`)
  - Displays: full title, full content, all tags, creation date, last modified date
  - "← Retour" button to go back to dashboard
  - No edit/delete actions — read-only
  - Loading/error states

---

## Phase 7: Styling & Polish

### Task 7.1: Dashboard styles
- [ ] Add CSS for Dashboard layout (responsive grid/flex)
- [ ] Style NoteCard (hover state, tag chips, truncation)
- [ ] Style filters (tag chips active/inactive, date inputs)
- [ ] Style SearchBar
- [ ] Style Pagination
- [ ] Mobile-first responsive breakpoints (≥320px, ≥768px)

### Task 7.2: NoteDetail styles
- [ ] Full-width content display
- [ ] Tag badges
- [ ] Metadata (dates) styling
- [ ] Back button styling

---

## Phase 8: Deploy & Verify

### Task 8.1: Deploy backend changes
- [ ] Run `npm run lint` (type-check)
- [ ] Deploy CDK stack: `npx cdk deploy --profile mcp-notes`
- [ ] Verify new endpoints: `GET /tags`, `POST /tags`, `DELETE /tags/{tagId}`
- [ ] Verify modified endpoints: `POST /notes` with tags, `PUT /notes/{noteId}` with tags
- [ ] Verify `GET /notes` with filter params

### Task 8.2: Deploy MCP server changes
- [ ] Build `notlai-mcp`: `npm run build`
- [ ] Test tools locally: create tag → create note with tag → list tags → delete tag
- [ ] Verify cascade: deleting a tag removes it from affected notes

### Task 8.3: Deploy frontend
- [ ] Build frontend: `npm run build:frontend`
- [ ] Deploy (frontend is bundled in CDK deploy via S3 bucket deployment)
- [ ] Verify end-to-end: login → see notes → filter by tag → search → view detail → logout

---

## Dependency Graph

```
Phase 1 (Tags infra)
  └──► Phase 2 (Notes modifications)
         └──► Phase 3 (MCP tools) — can start after Phase 1
         └──► Phase 4 (Frontend core) — can start after Phase 2
                └──► Phase 5 (Dashboard components)
                       └──► Phase 6 (Note detail)
                              └──► Phase 7 (Styling)
                                     └──► Phase 8 (Deploy)
```

Phases 3 and 4 can be worked in parallel once Phase 2 is done.
