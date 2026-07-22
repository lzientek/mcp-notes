# Architecture technique

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Utilisateur                                    │
└───────┬──────────────────────────────────────────────────────┬──────────┘
        │                                                      │
        ▼                                                      ▼
┌───────────────┐                                    ┌─────────────────┐
│ Claude Desktop│                                    │   Navigateur    │
│   + LLM       │                                    │  www.notlai.com │
└───────┬───────┘                                    └────────┬────────┘
        │ stdio                                               │ HTTPS
        ▼                                                     │
┌───────────────┐                                             │
│  notlai-mcp   │◀── tokens via POST localhost ───────────────┤
│ (MCP Server)  │                                             │
└───────┬───────┘                                             │
        │ HTTPS                                               │
        │         ┌──────────────────────────────┐            │
        └────────▶│     api.notlai.com           │◀───────────┘
                  │   (API Gateway + Cognito     │
                  │    Authorizer)               │
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────┼───────────────┐
                  ▼              ▼               ▼
           ┌──────────┐  ┌──────────┐   ┌──────────┐
           │  Lambda   │  │  Lambda   │   │  Lambda   │
           │ (notes)   │  │ (tags)    │   │(pre-sign) │
           └─────┬─────┘  └─────┬─────┘   └──────────┘
                 │              │
                 ▼              ▼
           ┌──────────┐  ┌──────────┐
           │ DynamoDB  │  │ DynamoDB  │
           │  Notes    │  │   Tags    │
           └──────────┘  └──────────┘
```

---

## Services AWS

| Service | Ressource | Rôle |
|---------|-----------|------|
| **Cognito** | User Pool `eu-west-1_OG5PnPje2` | Gestion des comptes, auth USER_PASSWORD_AUTH, tokens JWT |
| **API Gateway** | REST API avec custom domain `api.notlai.com` | Point d'entrée HTTP, authorizer Cognito |
| **Lambda** | 8 fonctions (Node.js 20, arm64) | Logique métier notes + tags + pre-signup |
| **DynamoDB** | Table Notes (userId/noteId) | Stockage des notes, PAY_PER_REQUEST |
| **DynamoDB** | Table Tags (userId/tagId) | Stockage des tags, PAY_PER_REQUEST |
| **S3** | Bucket frontend | Hébergement du SPA |
| **CloudFront** | Distribution + certificat ACM | CDN, HTTPS, SPA routing (403/404 → index.html) |
| **Route53** | Zone `notlai.com` | DNS : www → CloudFront, api → API Gateway |

---

## API REST

### Notes

| Méthode | Path | Description |
|---------|------|-------------|
| `GET` | `/notes` | Liste les notes (filtres: tags, from, to, search, cursor) |
| `POST` | `/notes` | Crée une note (title, content, tags?) |
| `GET` | `/notes/{noteId}` | Récupère une note |
| `PUT` | `/notes/{noteId}` | Met à jour une note (title?, content?, tags?) |
| `DELETE` | `/notes/{noteId}` | Supprime une note |

### Tags

| Méthode | Path | Description |
|---------|------|-------------|
| `GET` | `/tags` | Liste tous les tags de l'utilisateur |
| `POST` | `/tags` | Crée un tag (name) |
| `DELETE` | `/tags/{tagId}` | Supprime un tag + cascade sur les notes |

Toutes les routes nécessitent un header `Authorization: Bearer <idToken>`.

---

## Outils MCP exposés

Le serveur MCP local (`notlai-mcp`) expose ces tools au LLM :

| Tool | Description |
|------|-------------|
| `mcp_notes_register` | Créer un compte (email + password) |
| `mcp_notes_login` | Authentification email/password |
| `mcp_notes_web_login` | Démarrer le flow de login web (ouvre un serveur local) |
| `mcp_notes_logout` | Supprimer les credentials locaux |
| `mcp_notes_status` | Vérifier le statut d'auth, refresh si nécessaire |
| `mcp_notes_list_tags` | Lister les tags |
| `mcp_notes_create_tag` | Créer un tag |
| `mcp_notes_delete_tag` | Supprimer un tag |

Les opérations CRUD sur les notes sont faites via l'API client intégré au MCP server (pas via des tools dédiés "create_note" etc. — le LLM appelle directement l'API via le client).

---

## Frontend (SPA React)

### Stack

- React 19 (react-dom, react-router-dom)
- Bundlé avec esbuild
- Pas de framework CSS (CSS natif avec variables custom)
- Servi depuis S3 via CloudFront

### Routing

| Route | Composant | Auth requise |
|-------|-----------|:---:|
| `/` | DashboardPage | Oui |
| `/notes/:noteId` | NoteDetailPage | Oui |
| `/signup` | SignupPage | Non (redirige vers / si déjà auth) |
| `/login` | LoginPage | Non |
| `*` | Redirect → `/` | — |

### Build

```bash
node scripts/build-frontend.js
```

Output dans `dist/frontend/` (copié dans S3 au deploy CDK).

---

## Déploiement

```bash
# Profil AWS (access keys, pas SSO)
npx cdk deploy --profile mcp-notes
```

Le deploy :
1. Compile les lambdas (TypeScript → JS via esbuild interne CDK)
2. Build le frontend (`scripts/build-frontend.js`)
3. Déploie le stack CloudFormation
4. Upload le frontend dans S3
5. Invalide le cache CloudFront

---

## Configuration Kiro (.kiro/)

### Steering

- `aws.md` : Force l'utilisation du profil AWS `mcp-notes` pour toutes les opérations

### Specs

| Spec | Description |
|------|-------------|
| `create-project` | Auth utilisateur : inscription, login, tokens, isolation |
| `front-d-inscription` | Frontend d'inscription avec confirmation email |
| `easy-login-into-mcp-via-web` | Login web → transfert tokens au MCP local |
| `Simple web view` | Dashboard read-only : liste, filtres, recherche, détail |

---

## Coûts (Free Tier AWS)

| Service | Free Tier | Usage attendu |
|---------|-----------|---------------|
| Cognito | 50 000 MAU | 1-10 utilisateurs |
| API Gateway | 1M req/mois | ~100/jour |
| Lambda | 1M req + 400K GB-sec | Négligeable |
| DynamoDB | 25 GB + 25 RCU/WCU | Quelques KB |
| S3 + CloudFront | 5 GB + 2M req | ~1 MB frontend |
