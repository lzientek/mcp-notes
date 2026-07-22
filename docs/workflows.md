# Flux de travail

## 1. Inscription d'un nouvel utilisateur

```
Utilisateur                  Web Frontend                 Cognito
    │                            │                          │
    ├── accède /signup ─────────▶│                          │
    │                            │                          │
    ├── saisit email + mdp ─────▶│                          │
    │                            ├── SignUp ────────────────▶│
    │                            │                          ├── envoie email avec code
    │                            │◀── succès ───────────────┤
    │◀── affiche formulaire code─┤                          │
    │                            │                          │
    ├── saisit code 6 chiffres ─▶│                          │
    │                            ├── ConfirmSignUp ────────▶│
    │                            │◀── compte activé ────────┤
    │◀── "Compte activé !" ──────┤                          │
    │                            │                          │
    ├── (auto-redirect 3s) ─────▶│ /login                   │
```

**Cas d'erreur** :
- Email déjà utilisé → message "Un compte avec cet email existe déjà"
- Code incorrect → "Le code saisi est incorrect"
- Code expiré → "Le code a expiré, demandez un nouveau code"
- Renvoi du code possible (cooldown 30s entre chaque renvoi)

---

## 2. Connexion web (consultation des notes)

```
Utilisateur                  Web Frontend                 Cognito
    │                            │                          │
    ├── accède /login ──────────▶│                          │
    │                            │                          │
    ├── saisit email + mdp ─────▶│                          │
    │                            ├── InitiateAuth ─────────▶│
    │                            │   (USER_PASSWORD_AUTH)    │
    │                            │◀── tokens (id, access, ──┤
    │                            │    refresh, expiresIn)    │
    │                            ├── stocke en localStorage  │
    │◀── redirect vers / ────────┤                          │
    │    (dashboard)             │                          │
```

---

## 3. Connexion MCP (depuis Claude Desktop)

```
Claude Desktop        MCP Server (local)      Web Frontend         Cognito
    │                      │                      │                   │
    │── "connecte-moi" ───▶│                      │                   │
    │                      ├── démarre serveur     │                   │
    │                      │   HTTP local:9876     │                   │
    │◀── "allez sur        │                      │                   │
    │    notlai.com/login   │                      │                   │
    │    ?port=9876" ──────│                      │                   │
    │                      │                      │                   │
    │          Utilisateur ouvre le lien          │                   │
    │                      │                      │                   │
    │                      │      ┌── login ─────▶│── InitiateAuth ──▶│
    │                      │      │               │◀── tokens ────────┤
    │                      │◀─────┼── POST /auth/callback             │
    │                      │      │   (tokens)    │                   │
    │                      ├── stocke dans        │                   │
    │                      │   ~/.mcp-notes/      │                   │
    │                      │   credentials.json   │                   │
    │                      │─────▶│               │                   │
    │                      │      │◀── "Connexion │                   │
    │                      │      │    réussie,   │                   │
    │                      │      │    retournez  │                   │
    │                      │      │    dans Claude"│                   │
    │◀── prêt à utiliser ──┤                      │                   │
    │    les notes          │                      │                   │
```

**Sécurité** :
- Le serveur local écoute uniquement sur 127.0.0.1
- Tokens transmis via POST (pas dans l'URL)
- Le serveur refuse une seconde soumission (anti-replay)
- Fichier credentials.json en permissions 0600

---

## 4. Création d'une note (via MCP)

```
Utilisateur (via LLM)     MCP Server              API Gateway          Lambda           DynamoDB
    │                        │                        │                   │                │
    │── "note: acheter       │                        │                   │                │
    │    du lait" ──────────▶│                        │                   │                │
    │                        ├── GET /tags ──────────▶│──────────────────▶│── Query ──────▶│
    │                        │◀── [courses, perso] ──┤◀──────────────────┤◀───────────────┤
    │                        │                        │                   │                │
    │                        ├── POST /notes ────────▶│──────────────────▶│                │
    │                        │   {title, content,     │                   ├── Validate ────┤
    │                        │    tags:["courses"]}   │                   │   tags exist    │
    │                        │                        │                   ├── PutItem ─────▶│
    │                        │◀── 201 {noteId} ──────┤◀──────────────────┤◀───────────────┤
    │◀── "Note créée !" ─────┤                        │                   │                │
```

**Validation** :
- Tous les tags doivent exister dans la liste de l'utilisateur → 400 sinon
- Title et content obligatoires
- Le userId est extrait du token Cognito (pas passé par le client)

---

## 5. Consultation des notes (web)

```
Utilisateur                  Web Frontend                 API Gateway      Lambda
    │                            │                          │               │
    ├── accède / ───────────────▶│                          │               │
    │                            ├── GET /notes ───────────▶│──────────────▶│
    │                            │   Authorization: Bearer  │               ├── Query DDB
    │                            │                          │               │   (userId)
    │                            │◀── {notes, nextCursor} ──┤◀──────────────┤
    │◀── affiche la liste ───────┤                          │               │
    │                            │                          │               │
    ├── clique sur une note ────▶│                          │               │
    │                            ├── GET /notes/{id} ──────▶│──────────────▶│
    │                            │◀── {note complète} ──────┤◀──────────────┤
    │◀── affiche le détail ──────┤                          │               │
```

**Filtres** (passés en query params à GET /notes) :
- `tags=tag1,tag2` — filtre par tags
- `from=2024-01-01&to=2024-12-31` — filtre par période
- `search=texte` — recherche full-text (titre + contenu)
- `cursor=xxx` — pagination
- Le filtrage est effectué in-memory côté Lambda après le Query DynamoDB

---

## 6. Suppression d'un tag (cascade)

```
LLM / MCP Server            API Gateway          Lambda                  DynamoDB
    │                          │                    │                       │
    ├── DELETE /tags/{id} ────▶│───────────────────▶│                       │
    │                          │                    ├── Query: toutes les   │
    │                          │                    │   notes avec ce tag ─▶│
    │                          │                    │◀── liste de notes ────┤
    │                          │                    │                       │
    │                          │                    ├── Pour chaque note:   │
    │                          │                    │   UpdateItem           │
    │                          │                    │   (retire le tag) ───▶│
    │                          │                    │                       │
    │                          │                    ├── DeleteItem          │
    │                          │                    │   (supprime le tag) ─▶│
    │◀── 204 No Content ──────┤◀───────────────────┤◀──────────────────────┤
```

---

## 7. Refresh de session

```
MCP Server / Web Frontend      Cognito
    │                            │
    ├── (token expiré)           │
    ├── InitiateAuth ───────────▶│
    │   (REFRESH_TOKEN_AUTH,     │
    │    refreshToken)           │
    │◀── nouveaux tokens ────────┤
    ├── met à jour le store      │
    │                            │
    ├── reprend la requête       │
    │   API avec le nouveau      │
    │   idToken                  │
```

Si le refresh token est lui-même expiré → l'utilisateur doit se reconnecter.
