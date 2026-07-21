# Simple Web View — Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  User's machine                                                 │
│                                                                 │
│  ┌───────────┐     tools      ┌──────────────┐                 │
│  │    LLM    │ ◄────────────► │  notlai-mcp  │                 │
│  │(Claude…)  │                │  (local MCP) │                 │
│  └───────────┘                └──────┬───────┘                 │
│                                      │ HTTP (Bearer token)      │
└──────────────────────────────────────┼──────────────────────────┘
                                       │
                          ┌────────────▼────────────┐
                          │   api.notlai.com        │
                          │   (API Gateway + Lambda)│
                          └────────────┬────────────┘
                                       │
                          ┌────────────▼────────────┐
                          │      DynamoDB           │
                          │  ┌───────┐ ┌────────┐  │
                          │  │ Notes │ │  Tags  │  │
                          │  └───────┘ └────────┘  │
                          └────────────▲────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │   api.notlai.com        │
                          │   (same API Gateway)    │
                          └────────────▲────────────┘
                                       │ HTTP (Bearer token)
                          ┌────────────┴────────────┐
                          │   www.notlai.com        │
                          │   (S3 + CloudFront)     │
                          │   Read-only SPA         │
                          └─────────────────────────┘
```

Both the MCP server and the web frontend call the same API Gateway. The web frontend only uses read endpoints (`GET`). The MCP server uses all endpoints (CRUD).

---

## 1. Data Model

### 1.1 Notes Table (existing — modified)

| Attribute | Type | Description |
|-----------|------|-------------|
| `userId` | String (PK) | Cognito user sub |
| `noteId` | String (SK) | ULID |
| `title` | String | Note title |
| `content` | String | Note body (plain text) |
| `tags` | List\<String\> | Tag names attached to this note (new field, optional, defaults to `[]`) |
| `createdAt` | String (ISO 8601) | Creation timestamp |
| `updatedAt` | String (ISO 8601) | Last modification timestamp |

Notes:
- `tags` is stored as a DynamoDB List (`L`) of strings via the DocumentClient.
- Empty array `[]` is valid (note with no tags). The attribute can also be absent on legacy notes (treated as `[]`).

### 1.2 Tags Table (new)

| Attribute | Type | Description |
|-----------|------|-------------|
| `userId` | String (PK) | Cognito user sub |
| `tagId` | String (SK) | ULID |
| `name` | String | Tag display name (stored lowercase for uniqueness) |
| `createdAt` | String (ISO 8601) | Creation timestamp |

Table config:
- Billing: PAY_PER_REQUEST
- Removal policy: RETAIN

Uniqueness enforcement: On `POST /tags`, query all tags for the user, check if the normalized name already exists. The expected volume is <100 tags per user, making a full query + in-memory check acceptable.

---

## 2. API Design

### 2.1 Tags Endpoints (new)

#### `GET /tags`

Returns all tags for the authenticated user.

**Response 200:**
```json
{
  "tags": [
    { "tagId": "01J...", "name": "work", "createdAt": "2026-07-21T10:00:00Z" }
  ]
}
```

#### `POST /tags`

Creates a new tag.

**Request body:**
```json
{ "name": "work" }
```

Validation:
- `name` required, 1–50 characters, trimmed, stored lowercase.
- 409 Conflict if a tag with the same normalized name already exists for this user.

**Response 201:**
```json
{ "tagId": "01J...", "name": "work", "createdAt": "2026-07-21T10:00:00Z" }
```

#### `DELETE /tags/{tagId}`

Deletes a tag and removes it from all notes that reference it.

**Cascade logic:**
1. Get the tag item to retrieve its `name`.
2. Query all notes for the user.
3. For each note whose `tags` array contains the tag name: update the note, removing the tag name from the array.
4. Delete the tag item.

**Response 204:** (no body)

### 2.2 Modified Notes Endpoints

#### `POST /notes` (modified)

New optional field in request body:

```json
{
  "title": "My note",
  "content": "Some text",
  "tags": ["work", "ideas"]
}
```

Validation:
- If `tags` is provided, each name must exist in the user's tag list.
- If any tag name is invalid, return 400:
  ```json
  {
    "code": "INVALID_TAGS",
    "message": "Some tags do not exist.",
    "invalidTags": ["nonexistent-tag"]
  }
  ```
- If `tags` is omitted, the note is created with `tags: []`.

#### `PUT /notes/{noteId}` (modified)

New optional field in request body:

```json
{
  "title": "Updated title",
  "tags": ["work"]
}
```

Behavior:
- If `tags` is present (including `[]`): replace the note's tag list entirely.
- If `tags` is absent/undefined: preserve existing tags (no change).
- Same validation as create: all names must exist in user's tag list.

---

## 3. Lambda Functions

### 3.1 New Lambdas

| Lambda | Handler | Table access |
|--------|---------|-------------|
| `ListTagsFn` | `list-tags.handler` | Tags table (read) |
| `CreateTagFn` | `create-tag.handler` | Tags table (read + write) |
| `DeleteTagFn` | `delete-tag.handler` | Tags table (read + write) + Notes table (read + write) |

All lambdas share the same code asset (same pattern as existing notes lambdas).

Environment variables:
- `TAGS_TABLE_NAME` — for all tag lambdas
- `TABLE_NAME` — for `DeleteTagFn` (to cascade on notes)

### 3.2 Modified Lambdas

| Lambda | Change |
|--------|--------|
| `CreateNoteFn` | Accept `tags` field, validate against Tags table, store on note item |
| `UpdateNoteFn` | Accept `tags` field, validate against Tags table, update note item |

These need read access to the Tags table (for validation) in addition to their existing Notes table access.

---

## 4. CDK Stack Changes

```typescript
// New Tags table
const tagsTable = new dynamodb.Table(this, 'McpNotesTagsTable', {
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// New Lambda functions for tags (same code asset as notes)
// Grant: tagsTable.grantReadData(listTagsFn)
// Grant: tagsTable.grantReadWriteData(createTagFn)
// Grant: tagsTable.grantReadWriteData(deleteTagFn) + notesTable.grantReadWriteData(deleteTagFn)

// Modified grants for note lambdas
// tagsTable.grantReadData(createNoteFn)
// tagsTable.grantReadData(updateNoteFn)

// API routes
// /tags          GET  → listTagsFn
// /tags          POST → createTagFn
// /tags/{tagId}  DELETE → deleteTagFn
```

---

## 5. MCP Server Changes (notlai-mcp)

### 5.1 New Tools

```typescript
server.tool('mcp_notes_list_tags',
  'List all your existing tags. Use this before creating a note to find relevant tags to assign.',
  {},
  async () => { /* GET /tags */ }
);

server.tool('mcp_notes_create_tag',
  'Create a new tag for categorizing notes. Check existing tags first with mcp_notes_list_tags to avoid duplicates.',
  { name: z.string().describe('Tag name (e.g., "work", "ideas", "project-x")') },
  async ({ name }) => { /* POST /tags */ }
);

server.tool('mcp_notes_delete_tag',
  'Delete a tag. This also removes the tag from all notes that use it.',
  { tagId: z.string().describe('The tag ID to delete') },
  async ({ tagId }) => { /* DELETE /tags/{tagId} */ }
);
```

### 5.2 Modified Tools (note CRUD)

When the MCP server implements note creation/update tools, they should:
1. Call `GET /tags` to fetch available tags.
2. Include relevant `tags` in the request body.
3. The tool description should instruct the LLM:

> "When creating or updating a note, first check existing tags with mcp_notes_list_tags. Assign relevant existing tags to the note. If the note's topic doesn't match any existing tag, create a new tag first with mcp_notes_create_tag, then include it."

---

## 6. Frontend Architecture (www.notlai.com)

### 6.1 State Machine

```
login ──► dashboard (list + filters) ──► detail
  ▲                                         │
  └─────────── (401 / logout) ◄─────────────┘
```

No client-side router. Navigation managed via `useState<'login' | 'dashboard' | 'detail'>`.

### 6.2 Component Tree

```
App
├── LoginForm (existing)
├── Dashboard
│   ├── Header (logo + logout button)
│   ├── SearchBar
│   ├── Filters
│   │   ├── TagFilter (chip-based multi-select)
│   │   └── DateFilter (presets + custom range)
│   ├── NotesList
│   │   ├── NoteCard (excerpt + tags + date)
│   │   └── EmptyState
│   └── Pagination
└── NoteDetail
    ├── BackButton
    ├── NoteContent (full text)
    └── NoteMetadata (tags + dates)
```

### 6.3 Services

```
src/frontend/services/
├── auth-service.ts      (existing — handles tokens, refresh, login)
├── api-client.ts        (new — fetch wrapper with auth headers + 401 handling)
├── notes-service.ts     (new — GET /notes, GET /notes/{id}, with query params)
└── tags-service.ts      (new — GET /tags)
```

**api-client.ts** pattern:
```typescript
async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = getIdToken();
  if (!token) { redirectToLogin(); throw new Error('No token'); }

  const url = new URL(path, 'https://api.notlai.com');
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { clearSession(); redirectToLogin(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

### 6.4 Filtering & Search Strategy

All filtering and search is done **server-side** via query parameters on `GET /notes`:

| Param | Type | Description |
|-------|------|-------------|
| `tags` | string (comma-separated) | Filter by tag names |
| `from` | ISO date | Start of date range |
| `to` | ISO date | End of date range |
| `search` | string | Free-text search on title + content |
| `limit` | number | Page size (default 20) |
| `cursor` | string | Pagination cursor (last noteId of previous page) |

This requires modifying the `list-notes` Lambda to support these query parameters:
- **Tags filter**: `FilterExpression` checking if any of the provided tags exist in the `tags` list.
- **Date filter**: `FilterExpression` on `createdAt` range.
- **Search**: `FilterExpression` with `contains()` on title + content. For a personal app with <1000 notes, a DynamoDB scan with filter is acceptable. No full-text search engine needed.
- **Pagination**: Use `Limit` + `ExclusiveStartKey` with the last noteId.

### 6.5 Pagination

Cursor-based pagination using DynamoDB's `ExclusiveStartKey`:
- Response includes `nextCursor` (the last noteId) if more results exist.
- Frontend passes `cursor` param on next page request.

---

## 7. Security Considerations

- The web frontend never calls write endpoints — this is enforced by simply not implementing those calls in the frontend code. The API itself still allows writes (needed by the MCP server).
- All API calls require a valid Cognito ID token.
- Tags and notes are isolated per `userId` — partition key ensures no cross-user access.
- Tag validation on note write prevents injection of arbitrary tag names that could confuse the UI.

---

## 8. Migration Strategy

- Existing notes (without `tags` attribute) continue to work. The frontend and list-notes Lambda treat missing `tags` as `[]`.
- No backfill needed. Tags will be added to notes as users interact via the LLM going forward.
- The Tags table starts empty; the LLM will populate it organically as it creates tags for new notes.

---

## 9. File Changes Summary

### mcp-notes (backend)

| Action | File | Description |
|--------|------|-------------|
| Create | `src/lambda/list-tags.ts` | List user tags |
| Create | `src/lambda/create-tag.ts` | Create tag with uniqueness check |
| Create | `src/lambda/delete-tag.ts` | Delete tag + cascade removal from notes |
| Modify | `src/lambda/create-note.ts` | Accept + validate `tags` field |
| Modify | `src/lambda/update-note.ts` | Accept + validate `tags` field |
| Modify | `src/lambda/list-notes.ts` | Support query params (tags, date, search, pagination) |
| Modify | `lib/mcp-notes-stack.ts` | Add Tags table, new lambdas, new routes, permissions |
| Create | `src/frontend/services/api-client.ts` | Authenticated fetch wrapper |
| Create | `src/frontend/services/notes-service.ts` | Notes API calls |
| Create | `src/frontend/services/tags-service.ts` | Tags API calls |
| Create | `src/frontend/components/Dashboard.tsx` | Main authenticated view |
| Create | `src/frontend/components/NoteCard.tsx` | Note list item |
| Create | `src/frontend/components/NoteDetail.tsx` | Full note view |
| Create | `src/frontend/components/TagFilter.tsx` | Tag multi-select filter |
| Create | `src/frontend/components/DateFilter.tsx` | Date range filter |
| Create | `src/frontend/components/SearchBar.tsx` | Search input |
| Create | `src/frontend/components/Pagination.tsx` | Page navigation |
| Modify | `src/frontend/App.tsx` | Add dashboard + detail states |
| Modify | `src/frontend/types.ts` | Add new types (Note, Tag, AppStep) |

### notlai-mcp (MCP server)

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/server.ts` | Add `mcp_notes_list_tags`, `mcp_notes_create_tag`, `mcp_notes_delete_tag` tools |
