# Requirements Document

## Introduction

This feature adds note sharing to Notlai. Users can share notes in two ways: (1) generate a public link accessible by anyone without authentication (read-only), or (2) share directly with another registered user by email with configurable permissions (read or read+write), making the note appear in their account. Shares can be revoked at any time by the note owner. The feature integrates into the existing frontend (note detail page), backend (API Gateway + Lambda), MCP server (new tools), and infrastructure (new DynamoDB table).

## Glossary

- **Share_Service**: The backend Lambda function handling share creation, revocation, and public/private note retrieval via API Gateway endpoints.
- **Share_Record**: A DynamoDB item in the shares table containing shareId, userId (owner), noteId, type (public/user), permission (read/write), recipientEmail (optional), createdAt.
- **Share_Link**: A publicly accessible URL of the form `https://www.notlai.com/shared/{shareId}` that renders a note without authentication.
- **Share_ID**: A cryptographically random, URL-safe, unguessable identifier (minimum 128 bits of entropy) used as the primary key for share records.
- **Permission_Level**: Either "read" (view only) or "write" (view + edit title, content, tags). Only applicable to user shares. Public links are always read-only.
- **Frontend_App**: The React SPA served at www.notlai.com providing the user interface for note management and sharing controls.
- **MCP_Server**: The Model Context Protocol server (notlai-mcp) providing AI assistants with tools to manage notes and shares.
- **Note_Owner**: The authenticated user who created a note and has exclusive authority to share, unshare, or delete it.
- **Recipient**: A registered Notlai user who has been granted access to a note via their email address.
- **Shares_Table**: A dedicated DynamoDB table storing share records, separate from the notes table.
- **Shared_With_Me**: A section in the frontend where recipients can see notes shared with them by other users.

## Requirements

### Requirement 1: Generate a Public Share Link

**User Story:** As a note owner, I want to generate a public share link for one of my notes, so that I can share it with anyone without requiring them to have an account.

#### Acceptance Criteria

1. WHEN a Note_Owner requests to share a note publicly, THE Share_Service SHALL create a Share_Record with type "public", permission "read", and a cryptographically random Share_ID of at least 128 bits of entropy.
2. WHEN a Share_Record is created, THE Share_Service SHALL return the full Share_Link URL to the caller.
3. WHEN a Note_Owner requests to share a note that already has a public link, THE Share_Service SHALL return the existing Share_Link without creating a duplicate Share_Record.
4. Public share links SHALL always be read-only (no write permission possible for anonymous access).
5. IF an unauthenticated user attempts to create a share, THEN THE Share_Service SHALL reject the request with HTTP 401.
6. IF a user attempts to share a note they do not own, THEN THE Share_Service SHALL reject the request with HTTP 403.

### Requirement 2: Share a Note with a Specific User

**User Story:** As a note owner, I want to share a note with another user by email with a specific permission level, so that they can view or collaborate on the note depending on the access I grant.

#### Acceptance Criteria

1. WHEN a Note_Owner shares a note with a recipient email, THE Share_Service SHALL create a Share_Record with type "user", the recipient's email, the specified Permission_Level, and the note reference.
2. THE Permission_Level SHALL default to "read" if not explicitly specified by the Note_Owner.
3. WHEN permission is "read", THE Recipient SHALL be able to view the note but NOT modify it.
4. WHEN permission is "write", THE Recipient SHALL be able to modify the note's title, content, and tags, but SHALL NOT be able to delete the note, change its favorite status, or manage its shares.
5. THE Share_Service SHALL NOT verify that the recipient email exists in Cognito at share time (the share will appear when/if that user logs in).
6. WHEN a Note_Owner shares a note with an email that already has access, THE Share_Service SHALL update the existing Share_Record's permission level if it differs.
7. A note MAY be shared with multiple recipients simultaneously (one Share_Record per recipient), each with their own Permission_Level.
8. A note MAY have both a public link AND user-specific shares active at the same time.

### Requirement 3: View and Interact with Shared Notes

**User Story:** As a recipient, I want to see notes that others have shared with me and interact with them according to my permission level.

#### Acceptance Criteria

1. WHEN a Recipient logs in, THE Frontend_App SHALL provide a "Shared with me" section/filter that lists notes shared with their email address.
2. THE shared notes list SHALL display the note title, a preview, the permission level (read/write badge), and the share date.
3. WHEN a Recipient with "read" permission opens a shared note, THE Frontend_App SHALL render the full Markdown content in read-only mode (no edit controls).
4. WHEN a Recipient with "write" permission opens a shared note, THE Frontend_App SHALL render the note with edit capabilities (title, content, tags) but WITHOUT delete, favorite, or share management controls.
5. WHEN a Recipient with "write" permission saves changes, THE Share_Service SHALL update the note and set a new `updatedAt` timestamp.
6. THE shared notes SHALL be accessible via the MCP server with a `notlai_list_shared_with_me` tool that includes the permission level.
7. IF a Note_Owner revokes the share, THE note SHALL immediately disappear from the Recipient's shared list and any pending edits SHALL fail.

### Requirement 4: Revoke and Modify Shares

**User Story:** As a note owner, I want to revoke any share or change a recipient's permission level, so that I maintain full control over access to my notes.

#### Acceptance Criteria

1. WHEN a Note_Owner revokes a public share, THE Share_Service SHALL delete the public Share_Record and the Share_Link SHALL immediately return HTTP 404.
2. WHEN a Note_Owner revokes a user share, THE Share_Service SHALL delete the user Share_Record and the note SHALL immediately disappear from the Recipient's shared list.
3. THE Note_Owner SHALL be able to revoke individual user shares without affecting the public link or other user shares.
4. THE Note_Owner SHALL be able to change a Recipient's Permission_Level (e.g., downgrade from "write" to "read") without revoking and re-sharing.
5. IF a Note_Owner requests to unshare something that has no active share, THEN THE Share_Service SHALL return a success response without error.

### Requirement 5: Frontend Sharing Controls

**User Story:** As a note owner, I want to see the sharing status of my note and manage sharing from the note detail page, so that I can share and unshare directly from the interface.

#### Acceptance Criteria

1. WHEN a Note_Owner views a note's detail page, THE Frontend_App SHALL display the current sharing status (public link active, list of users with their permission levels).
2. THE Frontend_App SHALL provide a "Share" action that opens a modal/panel with two options: "Public link" and "Share with user (email + permission selector)".
3. WHEN the public link is active, THE Frontend_App SHALL display a copy-to-clipboard button and an "Unshare" action.
4. WHEN user shares exist, THE Frontend_App SHALL list each recipient email with their permission level and actions: "Change permission" and "Remove".
5. WHEN a Note_Owner enters an email to share with, THE Frontend_App SHALL validate email format and provide a permission dropdown (Read / Read+Write) before calling the API.
6. THE Frontend_App SHALL visually distinguish between "read" and "write" recipients (e.g., different badge colors or icons).

### Requirement 6: MCP Server Sharing Tools

**User Story:** As an AI assistant user, I want to share and unshare notes via MCP tools with permission control, so that I can manage note sharing through my AI workflow.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a `notlai_share_note` tool accepting: noteId, optional `email`, optional `permission` ("read" or "write", default "read"). If email is omitted, create a public link. If email is provided, share with that user at the specified permission.
2. THE MCP_Server SHALL expose a `notlai_unshare_note` tool accepting noteId and optional `email`. If email is omitted, revoke the public link. If email is provided, revoke only that user's access.
3. THE MCP_Server SHALL expose a `notlai_list_shared_with_me` tool that returns notes shared with the current user, including the permission level for each.
4. THE `notlai_get_note` tool SHALL include `shareUrl` (if public link exists) and `sharedWith` (list of {email, permission}) in its response.
5. THE `notlai_list_notes` tool SHALL indicate shared notes with a 🔗 indicator.
6. WHEN a Recipient with "write" permission uses `notlai_update_note` on a shared note, THE MCP_Server SHALL allow the update.
7. WHEN a Recipient with "read" permission uses `notlai_update_note` on a shared note, THE MCP_Server SHALL reject with an error explaining insufficient permissions.

### Requirement 7: Shared Note Public Page

**User Story:** As a visitor with a share link, I want to view the shared note rendered as a readable page, so that I can read the content without needing an account.

#### Acceptance Criteria

1. WHEN a visitor accesses a valid Share_Link, THE Frontend_App SHALL render the note content as formatted Markdown without requiring authentication.
2. WHEN a visitor accesses a valid Share_Link, THE Frontend_App SHALL display Notlai branding (logo, app name) on the shared note page.
3. WHEN a visitor accesses a valid Share_Link, THE Frontend_App SHALL include SEO-friendly meta tags (title, description, Open Graph) derived from the note title and content.
4. WHEN a visitor accesses an invalid or revoked Share_Link, THE Frontend_App SHALL display a "Note not found" message with HTTP 404 status.
5. THE shared note public page SHALL always be read-only (no editing even if logged in — editing requires a user share with "write" permission).
6. THE shared note public page SHALL NOT expose the Note_Owner's identity, email, or any personal information.

### Requirement 8: Data Model and Cascade Deletion

**User Story:** As a system operator, I want shares stored in a dedicated table with proper lifecycle management, so that data remains consistent when notes are deleted.

#### Acceptance Criteria

1. THE Shares_Table SHALL use Share_ID as partition key and store: userId (owner), noteId, type ("public" | "user"), permission ("read" | "write"), recipientEmail (for type "user"), createdAt.
2. THE Shares_Table SHALL have a Global Secondary Index (GSI1) on `noteId` to enable lookup of all shares for a given note.
3. THE Shares_Table SHALL have a Global Secondary Index (GSI2) on `recipientEmail` to enable lookup of all notes shared with a user.
4. WHEN a note is deleted (via API or MCP), THE Share_Service SHALL delete ALL Share_Records associated with that note (cascade).
5. WHEN a user account is deleted, THE Share_Service SHALL delete all Share_Records where the user is the owner.
6. THE update-note Lambda SHALL check Share_Records to authorize writes from Recipients with "write" permission.

### Requirement 9: Non-Functional Requirements

**User Story:** As a system operator, I want the sharing feature to be secure, performant, cost-effective, and backwards compatible, so that it does not degrade the existing service.

#### Acceptance Criteria

1. THE Share_Service SHALL generate Share_IDs using a cryptographically secure random number generator with at least 128 bits of entropy.
2. THE Share_Service SHALL apply rate limiting to public shared note endpoints to prevent abuse (maximum 100 requests per IP per minute).
3. WHEN a visitor requests a shared note, THE Share_Service SHALL return the response within 1 second under normal load conditions.
4. THE Shares_Table SHALL operate within DynamoDB free-tier capacity for projected usage (under 25 WCU and 25 RCU).
5. THE Share_Service SHALL maintain full backwards compatibility with existing note CRUD operations and API contracts.
6. THE shared note public page SHALL NOT include any information that could identify the Note_Owner beyond what is present in the note content itself.
7. Recipient lookups (shared with me) SHALL be efficient (GSI query, not table scan).
8. Permission checks on note updates SHALL add no more than one additional DynamoDB read (GetItem on Shares_Table).
