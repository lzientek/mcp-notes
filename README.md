# mcp-notes

Personal note-taking app accessible via MCP from Claude Desktop. Capture, search, and manage notes directly from your LLM conversations — no GUI needed.

## Architecture

```
Claude Desktop → MCP Server (local) → API Gateway → Lambda → DynamoDB
                      ↕                      ↕
              ~/.mcp-notes/           AWS Cognito
              credentials.json        (auth)
```

- **MCP Server**: TypeScript process running locally, exposes tools to the LLM
- **AWS Cognito**: Manages user accounts, passwords, and token issuance
- **API Gateway**: REST API with Cognito Authorizer
- **Lambda**: Node.js 20 handlers for notes CRUD
- **DynamoDB**: Single-table design (userId/noteId), stores notes only

## Prerequisites

- Node.js >= 20
- AWS CLI configured with SSO (`aws sso login --profile <profile>`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- Claude Desktop (or any MCP-compatible client)

## Installation

### 1. Clone and install dependencies

```bash
git clone git@github.com:lzientek/mcp-notes.git
cd mcp-notes
npm install
```

### 2. Deploy the AWS stack

```bash
# Login to your AWS account
aws sso login --profile <your-profile>

# Deploy (first time will bootstrap CDK if needed)
npx cdk bootstrap --profile <your-profile>
npx cdk deploy --profile <your-profile>
```

After deployment, CDK outputs the values you need:

```
McpNotesStack.UserPoolClientId = xxxxxxxxx
McpNotesStack.ApiUrl = https://xxxxx.execute-api.eu-west-1.amazonaws.com/prod
```

### 3. Configure Claude Desktop

Add the MCP server to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcp-notes": {
      "command": "npx",
      "args": ["ts-node", "--esm", "/path/to/mcp-notes/src/mcp-server/server.ts"],
      "env": {
        "COGNITO_CLIENT_ID": "<UserPoolClientId from CDK output>",
        "API_GATEWAY_URL": "<ApiUrl from CDK output>",
        "AWS_REGION": "eu-west-1"
      }
    }
  }
}
```

Replace `/path/to/mcp-notes` with the absolute path to your cloned repo.

### 4. Create your account

In any Claude conversation, say:

> "Create me an account on mcp-notes with email my@email.com and password mysecurepassword"

Claude will call `mcp_notes_register` then `mcp_notes_login`. Your session is stored locally and persists across conversations.

## Usage

Once authenticated, just talk naturally to Claude:

| What you say | Tool called |
|---|---|
| "Note that I need to buy milk" | `mcp_notes_register` / `mcp_notes_login` (first time) |
| "Save this idea: ..." | Creates a note via API |
| "Show me my recent notes" | Lists notes via API |
| "Find my note about the meeting" | Searches notes |
| "Delete that last note" | Deletes a note |
| "Am I logged in?" | `mcp_notes_status` |
| "Log me out" | `mcp_notes_logout` |

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `mcp_notes_register` | Create a new account (email + password) |
| `mcp_notes_login` | Authenticate and store tokens locally |
| `mcp_notes_logout` | Delete local credentials |
| `mcp_notes_status` | Check auth status, refresh token if needed |

## Development

### Run tests

```bash
npm test
```

### Type-check

```bash
npm run lint
```

### Synth CDK (preview CloudFormation)

```bash
npm run synth
```

### Project structure

```
src/
  mcp-server/          # Local MCP server (runs on your machine)
    server.ts          # Main entry point, tool definitions
    validators/        # Email & password validation
    storage/           # Credential file management
    errors/            # Cognito error → structured response mapping
    auth/              # Token refresh logic
  lambda/              # AWS Lambda handlers (deployed)
    pre-sign-up.ts     # Auto-confirm Cognito users
    list-notes.ts      # GET /notes
    create-note.ts     # POST /notes
    get-note.ts        # GET /notes/{noteId}
    update-note.ts     # PUT /notes/{noteId}
    delete-note.ts     # DELETE /notes/{noteId}
  types/               # Shared TypeScript interfaces
lib/
  mcp-notes-stack.ts   # CDK infrastructure definition
tests/
  unit/                # Property-based + unit tests
  integration/         # End-to-end auth flow tests
  cdk/                 # CDK infrastructure assertion tests
```

## AWS Free Tier Usage

This project is designed to run at zero cost on the AWS free tier:

| Service | Free Tier | Expected usage |
|---------|-----------|---------------|
| Cognito | 50,000 MAU | 1 user |
| API Gateway | 1M requests/month | ~100/day |
| Lambda | 1M requests + 400K GB-sec | Negligible |
| DynamoDB | 25 GB + 25 RCU/WCU | A few KB of notes |

## License

ISC
