# Implementation Plan: Share Notes

## Overview

This plan implements note sharing across all layers of the Notlai application: CDK infrastructure (new DynamoDB Shares table with GSIs, new Lambda functions, new API Gateway routes), backend Lambda functions (share-note, unshare-note, get-shared-note, modified list-notes/update-note/delete-note), React frontend (ShareModal, SharedNotePage, SharedWithMe section, permission-aware NoteDetail), and MCP server (new tools + scope parameter).

The implementation language is **TypeScript** (matching the existing codebase).

## Tasks

- [ ] 1. Infrastructure — Shares Table and API Gateway Routes
  - [ ] 1.1 Create Shares DynamoDB table with GSIs in CDK stack
    - File: `lib/mcp-notes-stack.ts`
    - Add `McpNotesSharesTable` with PK `shareId` (String), billing PAY_PER_REQUEST, removalPolicy RETAIN
    - Add GSI1 `NoteIdIndex` with PK `noteId`, projection ALL
    - Add GSI2 `RecipientEmailIndex` with PK `recipientEmail`, projection ALL
    - Export table name as CfnOutput
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 1.2 Add share-note, unshare-note, get-shared-note Lambda functions to CDK stack
    - File: `lib/mcp-notes-stack.ts`
    - Create `ShareNoteFn` (entry: `src/lambda/share-note.ts`), env: TABLE_NAME (notes), SHARES_TABLE_NAME (shares)
    - Create `UnshareNoteFn` (entry: `src/lambda/unshare-note.ts`), env: TABLE_NAME (notes), SHARES_TABLE_NAME (shares)
    - Create `GetSharedNoteFn` (entry: `src/lambda/get-shared-note.ts`), env: TABLE_NAME (notes), SHARES_TABLE_NAME (shares)
    - Grant appropriate DynamoDB permissions (read/write on shares table, read on notes table for get-shared-note)
    - _Requirements: 1.1, 2.1, 7.1_

  - [ ] 1.3 Add API Gateway routes for sharing endpoints
    - File: `lib/mcp-notes-stack.ts`
    - Add `POST /notes/{noteId}/share` → ShareNoteFn (with Cognito authorizer)
    - Add `DELETE /notes/{noteId}/share` → UnshareNoteFn (with Cognito authorizer)
    - Add `GET /shared/{shareId}` → GetSharedNoteFn (**no auth**, public endpoint)
    - Configure CORS on `/shared/{shareId}` to allow all origins (public page)
    - _Requirements: 1.1, 4.1, 7.1_

  - [ ] 1.4 Update existing Lambda environment variables for shares table access
    - File: `lib/mcp-notes-stack.ts`
    - Add `SHARES_TABLE_NAME` env var to `ListNotesFn`, `UpdateNoteFn`, `DeleteNoteFn`
    - Grant shares table read permissions to `ListNotesFn` and `UpdateNoteFn`
    - Grant shares table read/write permissions to `DeleteNoteFn` (cascade delete)
    - _Requirements: 8.4, 8.6, 3.1_

- [ ] 2. Checkpoint — Verify CDK synth passes
  - Run `npx cdk synth --profile mcp-notes` to validate the stack compiles and generates the expected CloudFormation template.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Backend — Share Note Lambda
  - [ ] 3.1 Create TypeScript types for share records
    - File: `src/types/shares.ts`
    - Define `ShareRecord`, `ShareNoteRequest`, `SharedNoteResponse`, `SharedNoteItem`, `ListNotesScope` interfaces (as per design)
    - Export from `src/types/index.ts`
    - _Requirements: 8.1_

  - [ ] 3.2 Create share ID generation helper
    - File: `src/lambda/helpers/share-id.ts`
    - Implement `generateShareId()` using `crypto.randomBytes(16).toString('base64url')` → 22 chars, 128 bits entropy
    - _Requirements: 9.1_

  - [ ] 3.3 Implement share-note Lambda handler
    - File: `src/lambda/share-note.ts`
    - Parse request body: validate `type` ("public" | "user"), validate `email` format when type="user", default `permission` to "read"
    - Ownership check: GetItem on notes table, verify `userId` matches caller's Cognito sub. Return 403 if mismatch, 404 if note not found.
    - **Public link flow**: Query GSI1 filtered by type="public". If exists, return 200 with existing shareId/shareUrl. If not, generate shareId, PutItem, return 201.
    - **User share flow**: Query GSI1 filtered by recipientEmail. If exists with different permission, update it. If not exists, PutItem new record. Return 201/200.
    - Return CORS headers.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.5, 2.6_

- [ ] 4. Backend — Unshare Note Lambda
  - [ ] 4.1 Implement unshare-note Lambda handler
    - File: `src/lambda/unshare-note.ts`
    - Parse query params: `type=public` or `email=...`
    - Ownership check: GetItem on notes table, verify userId. Return 403 if mismatch.
    - **Public revocation**: Query GSI1 for type="public" record, DeleteItem by shareId.
    - **User revocation**: Query GSI1 for matching recipientEmail, DeleteItem by shareId.
    - If no matching share found, return 204 (idempotent success per req 4.5).
    - Return 204 No Content on success.
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

- [ ] 5. Backend — Get Shared Note Lambda (Public Endpoint)
  - [ ] 5.1 Implement get-shared-note Lambda handler
    - File: `src/lambda/get-shared-note.ts`
    - Extract `shareId` from path parameters
    - GetItem from Shares table by shareId. If not found → 404.
    - GetItem from Notes table using `userId` + `noteId` from share record. If note not found → 404 (orphaned share, shouldn't happen normally).
    - Return ONLY `title`, `content`, `createdAt`, `updatedAt` (no userId, noteId, tags, isFavorite for privacy).
    - CORS headers: allow all origins (`*`) since this is a public page.
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 9.6_

- [ ] 6. Backend — Modify list-notes Lambda (scope parameter)
  - [ ] 6.1 Add scope query parameter support to list-notes
    - File: `src/lambda/list-notes.ts`
    - Parse `scope` query param: "own" (default) | "shared" | "all". Return 400 for invalid values.
    - **scope=own**: existing behavior unchanged (Query notes table by userId).
    - **scope=shared**: extract caller's email from Cognito token claims (`event.requestContext.authorizer.claims.email`). Query GSI2 (RecipientEmailIndex) by recipientEmail. BatchGetItem notes from Notes table using noteId+userId from share records. Merge share metadata (isShared, ownerEmail, permission, sharedAt) into response.
    - **scope=all**: execute both queries and merge results.
    - _Requirements: 3.1, 3.2, 9.7_

- [ ] 7. Backend — Modify update-note Lambda (permission check)
  - [ ] 7.1 Add share permission check to update-note
    - File: `src/lambda/update-note.ts`
    - After GetItem on notes table: if `note.userId !== caller userId` → recipient path.
    - Extract caller email from Cognito token claims.
    - Query Shares table GSI1 by noteId, filter recipientEmail = caller email.
    - If share exists with permission="write": allow update of title, content, tags ONLY. Reject isFavorite modifications. Set updatedAt.
    - If share exists with permission="read": return 403 `INSUFFICIENT_PERMISSIONS`.
    - If no share exists: return 404 `NOTE_NOT_FOUND` (don't reveal existence).
    - _Requirements: 2.3, 2.4, 3.5, 8.6, 9.8_

- [ ] 8. Backend — Modify delete-note Lambda (cascade deletion)
  - [ ] 8.1 Add cascade deletion of share records on note delete
    - File: `src/lambda/delete-note.ts`
    - After deleting the note, query Shares table GSI1 by noteId.
    - For each share record found, DeleteItem from Shares table by shareId.
    - Use BatchWriteItem if >1 record for efficiency (max 25 items per batch).
    - _Requirements: 8.4_

- [ ] 9. Checkpoint — Backend verification
  - Ensure all Lambda handlers compile with `npm run lint`.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Frontend — Share Modal Component
  - [ ] 10.1 Create ShareModal component
    - File: `src/frontend/components/ShareModal.tsx`
    - Modal with two tabs/sections: "Public link" and "Share with user"
    - **Public link tab**: show "Generate link" button if no active link, or show URL + copy-to-clipboard button + "Revoke" button if active.
    - **User share tab**: email input with format validation, permission dropdown (Read / Read+Write), "Share" button.
    - List existing user shares: email, permission badge, "Change permission" dropdown, "Remove" button.
    - Call `POST /notes/{noteId}/share` and `DELETE /notes/{noteId}/share` endpoints.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 10.2 Create PermissionBadge component
    - File: `src/frontend/components/PermissionBadge.tsx`
    - Visually distinct badge for "read" vs "write" (e.g., different colors).
    - Accept `permission: 'read' | 'write'` prop.
    - _Requirements: 5.6, 3.2_

- [ ] 11. Frontend — Shared Note Public Page
  - [ ] 11.1 Create SharedNotePage component
    - File: `src/frontend/pages/SharedNotePage.tsx`
    - Route: `/shared/:shareId` (no auth required)
    - Fetch `GET /shared/{shareId}` from API on mount.
    - Render note content as formatted Markdown (use existing `marked` dependency).
    - Display Notlai branding (logo, app name).
    - Handle 404: display "Note not found" message.
    - Add SEO meta tags (title, description, Open Graph) via `document.head` or react-helmet equivalent.
    - Always read-only — no edit controls.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 12. Frontend — Shared With Me Section
  - [ ] 12.1 Create SharedWithMePage component
    - File: `src/frontend/pages/SharedWithMePage.tsx`
    - Call `GET /notes?scope=shared` on mount.
    - Display list of shared notes with: title, content preview, permission badge (read/write), share date, owner email.
    - Clicking a note navigates to NoteDetailPage with shared context.
    - Route: `/shared-with-me` (requires auth).
    - _Requirements: 3.1, 3.2_

  - [ ] 12.2 Update Router with new routes
    - File: `src/frontend/Router.tsx`
    - Add route `/shared/:shareId` → `SharedNotePage` (no auth guard)
    - Add route `/shared-with-me` → `SharedWithMePage` (with auth guard)
    - _Requirements: 7.1, 3.1_

  - [ ] 12.3 Update NoteDetail component for permission-aware editing
    - File: `src/frontend/components/NoteDetail.tsx`
    - Detect if note is shared (via `isShared` flag in note data).
    - If `permission="read"`: render read-only (disable edit controls).
    - If `permission="write"`: enable edit for title/content/tags, hide delete/favorite/share buttons.
    - If user is owner: existing full-access behavior + show share button to open ShareModal.
    - _Requirements: 3.3, 3.4, 2.4, 5.1_

- [ ] 13. Checkpoint — Frontend verification
  - Ensure frontend compiles with `npm run lint`.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. MCP Server — Share Tools
  - [ ] 14.1 Implement `notlai_share_note` MCP tool
    - File: MCP server source (likely `src/mcp-server/` or dedicated MCP package — create if not exists)
    - Parameters: `noteId` (required), `email` (optional), `permission` (optional, "read" | "write", default "read")
    - If email omitted → call `POST /notes/{noteId}/share` with type="public"
    - If email provided → call `POST /notes/{noteId}/share` with type="user", email, permission
    - Return shareUrl (for public) or confirmation message (for user share).
    - _Requirements: 6.1_

  - [ ] 14.2 Implement `notlai_unshare_note` MCP tool
    - File: MCP server source
    - Parameters: `noteId` (required), `email` (optional)
    - If email omitted → call `DELETE /notes/{noteId}/share?type=public`
    - If email provided → call `DELETE /notes/{noteId}/share?email=...`
    - Return confirmation message.
    - _Requirements: 6.2_

  - [ ] 14.3 Add `scope` parameter to existing `notlai_list_notes` tool
    - File: MCP server source (existing list notes tool)
    - Add optional `scope` parameter ("own" | "shared" | "all", defaults to "own")
    - Pass `scope` as query parameter to `GET /notes?scope=...`
    - For shared notes: include ownerEmail, permission in response formatting.
    - Add 🔗 indicator for notes that have active shares (when listing own notes).
    - _Requirements: 6.3, 6.5_

  - [ ] 14.4 Update `notlai_get_note` response to include share info
    - File: MCP server source (existing get note tool)
    - After fetching note, query shares for the note (via an additional API call or extended endpoint).
    - Include `shareUrl` if public link exists, `sharedWith` list of {email, permission}.
    - _Requirements: 6.4_

  - [ ] 14.5 Ensure `notlai_update_note` works for write-recipients
    - File: MCP server source (existing update note tool)
    - No changes needed to MCP tool itself — the backend handles permission enforcement.
    - Verify that error responses (403 INSUFFICIENT_PERMISSIONS) are properly surfaced to the AI with clear messages.
    - _Requirements: 6.6, 6.7_

- [ ] 15. Checkpoint — MCP Server verification
  - Ensure MCP server compiles and tools are registered correctly.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Tests — Unit Tests and Property-Based Tests
  - [ ]* 16.1 Write property test: Public share idempotence (Property 1)
    - File: `test/properties/share-idempotence.test.ts`
    - **Property 1: Public share idempotence**
    - For any note owned by a user, calling the public-share operation twice SHALL return the same shareId without creating a duplicate.
    - Use fast-check to generate random noteIds and userIds. Simulate two consecutive share-note calls and assert same shareId returned, single record in table.
    - **Validates: Requirements 1.3**

  - [ ]* 16.2 Write property test: Public shares are always read-only (Property 2)
    - File: `test/properties/share-readonly.test.ts`
    - **Property 2: Public shares are always read-only**
    - For any Share_Record with type "public", permission SHALL always be "read".
    - Generate random share creation requests with type="public" and arbitrary permission values. Assert created record always has permission="read".
    - **Validates: Requirements 1.4**

  - [ ]* 16.3 Write property test: Ownership authorization (Property 3)
    - File: `test/properties/share-ownership.test.ts`
    - **Property 3: Ownership authorization**
    - For any user A and note owned by user B where A ≠ B, attempting to create a share SHALL be rejected.
    - Generate random pairs of distinct user IDs and verify 403 response.
    - **Validates: Requirements 1.6**

  - [ ]* 16.4 Write property test: Permission enforcement for read recipients (Property 4)
    - File: `test/properties/share-read-permission.test.ts`
    - **Property 4: Permission enforcement for read recipients**
    - For any note shared with "read" permission, GET succeeds but PUT is rejected.
    - Generate random note content and recipients with read permission. Verify retrieval works, update fails.
    - **Validates: Requirements 2.3**

  - [ ]* 16.5 Write property test: Write permission boundaries (Property 5)
    - File: `test/properties/share-write-boundaries.test.ts`
    - **Property 5: Write permission boundaries**
    - For any write-recipient, updates to title/content/tags succeed, but isFavorite/delete/share management are rejected.
    - Generate random field updates. Assert only allowed fields pass.
    - **Validates: Requirements 2.4**

  - [ ]* 16.6 Write property test: User share upsert (Property 6)
    - File: `test/properties/share-upsert.test.ts`
    - **Property 6: User share upsert (no duplicates)**
    - For any note/email pair, sharing N times results in exactly 1 record with the latest permission.
    - Generate random sequences of share operations on same note/email. Assert single record.
    - **Validates: Requirements 2.6**

  - [ ]* 16.7 Write property test: Share isolation on revocation (Property 7)
    - File: `test/properties/share-isolation.test.ts`
    - **Property 7: Share isolation on revocation**
    - For any note with N shares, revoking one leaves N-1 intact.
    - Generate a random number of shares (public + users), revoke one at random, verify others still accessible.
    - **Validates: Requirements 4.3**

  - [ ]* 16.8 Write property test: Revocation invalidates access (Property 8)
    - File: `test/properties/share-revocation.test.ts`
    - **Property 8: Revocation invalidates access**
    - After revoking a public share, GET /shared/{shareId} returns 404. After revoking a user share, the note disappears from recipient's list.
    - **Validates: Requirements 4.1, 4.2, 3.7**

  - [ ]* 16.9 Write property test: Cascade deletion (Property 9)
    - File: `test/properties/share-cascade.test.ts`
    - **Property 9: Cascade deletion on note delete**
    - For any note with N share records, deleting the note results in 0 remaining records for that noteId.
    - Generate a random number of shares, delete the note, query GSI1 for noteId and assert empty result.
    - **Validates: Requirements 8.4**

  - [ ]* 16.10 Write property test: Share ID entropy (Property 10)
    - File: `test/properties/share-id-entropy.test.ts`
    - **Property 10: Share ID entropy**
    - For any generated Share_ID, decoding from base64url SHALL produce at least 16 bytes.
    - Generate 100+ share IDs and verify byte length.
    - **Validates: Requirements 9.1**

  - [ ]* 16.11 Write property test: Update timestamp progression (Property 11)
    - File: `test/properties/share-timestamp.test.ts`
    - **Property 11: Update timestamp progression**
    - For any note updated by a write-recipient, updatedAt is strictly greater than previous.
    - **Validates: Requirements 3.5**

  - [ ]* 16.12 Write unit tests for share-note Lambda
    - File: `test/unit/share-note.test.ts`
    - Test: valid public link creation, valid user share creation, 401 without auth, 403 for non-owner, 400 for invalid email, 400 for invalid permission value, idempotent public share, upsert user share permission.
    - _Requirements: 1.1–1.6, 2.1, 2.2, 2.6_

  - [ ]* 16.13 Write unit tests for unshare-note Lambda
    - File: `test/unit/unshare-note.test.ts`
    - Test: revoke public link → 204, revoke user share → 204, revoke non-existent share → 204 (idempotent), 403 for non-owner.
    - _Requirements: 4.1–4.5_

  - [ ]* 16.14 Write unit tests for get-shared-note Lambda
    - File: `test/unit/get-shared-note.test.ts`
    - Test: valid shareId returns note content (title, content, createdAt, updatedAt only), invalid shareId → 404, response does not contain userId/noteId/tags/isFavorite.
    - _Requirements: 7.1, 7.4, 7.6_

  - [ ]* 16.15 Write unit tests for modified list-notes Lambda (scope)
    - File: `test/unit/list-notes-scope.test.ts`
    - Test: scope=own → existing behavior, scope=shared → returns shared notes with metadata, scope=all → merges both, invalid scope → 400.
    - _Requirements: 3.1, 3.2, 9.7_

  - [ ]* 16.16 Write unit tests for modified update-note Lambda (permission check)
    - File: `test/unit/update-note-permissions.test.ts`
    - Test: owner can update all fields, write-recipient can update title/content/tags, write-recipient cannot update isFavorite, read-recipient gets 403, non-shared user gets 404.
    - _Requirements: 2.3, 2.4, 8.6, 9.8_

- [ ] 17. Final Checkpoint — Full verification
  - Run `npm run lint` and `npm run test` to ensure everything passes.
  - Run `npx cdk synth --profile mcp-notes` to verify infrastructure is valid.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests use `fast-check` (already in devDependencies) with `vitest` (existing test runner)
- The MCP server tools (Phase 4) depend on the backend API endpoints (Phases 3–8) being deployed
- The frontend (Phase 3) can be developed in parallel with backend once API contracts are defined
- All Lambda functions follow existing patterns in `src/lambda/` (NodejsFunction, same runtime)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "3.1", "3.2"] },
    { "id": 2, "tasks": ["3.3", "4.1", "5.1"] },
    { "id": 3, "tasks": ["6.1", "7.1", "8.1"] },
    { "id": 4, "tasks": ["10.1", "10.2", "11.1", "12.1", "12.2"] },
    { "id": 5, "tasks": ["12.3"] },
    { "id": 6, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 7, "tasks": ["16.1", "16.2", "16.3", "16.10"] },
    { "id": 8, "tasks": ["16.4", "16.5", "16.6", "16.7", "16.8", "16.9", "16.11"] },
    { "id": 9, "tasks": ["16.12", "16.13", "16.14", "16.15", "16.16"] }
  ]
}
```
