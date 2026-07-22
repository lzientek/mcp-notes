# Fonctionnalités métier

## Vue d'ensemble

Notlai est une application de prise de notes personnelle conçue pour les workflows "AI-first". Les notes sont créées et gérées exclusivement via un serveur MCP (Model Context Protocol) connecté à un LLM (Claude, ChatGPT…). Une interface web en lecture seule permet de consulter, filtrer et rechercher ses notes depuis un navigateur.

## Acteurs

| Acteur | Description |
|--------|-------------|
| Utilisateur | Personne qui crée des notes via son LLM et les consulte via le web |
| LLM | Modèle de langage (Claude Desktop) qui interagit avec les notes via le MCP |
| MCP Server | Processus local qui expose les outils de gestion de notes au LLM |

---

## 1. Gestion des comptes

### Inscription

- L'utilisateur crée un compte avec email + mot de passe (min. 8 caractères)
- Un code de vérification à 6 chiffres est envoyé par email via Cognito
- L'utilisateur confirme son email en saisissant le code
- Après confirmation, redirection vers la page de connexion

### Connexion

Deux modes de connexion :

- **Web** : email/mot de passe → redirection vers le dashboard
- **MCP** (`/login?port=9876`) : email/mot de passe → tokens transmis au serveur MCP local → message confirmant le retour dans Claude Desktop

### Session

- Tokens stockés localement (localStorage côté web, fichier `~/.mcp-notes/credentials.json` côté MCP)
- Refresh automatique du token via le refresh token
- Déconnexion : suppression des tokens locaux

---

## 2. Notes

### Création (via MCP uniquement)

- Titre (obligatoire)
- Contenu (obligatoire)
- Tags (optionnel, doivent exister dans la liste de tags de l'utilisateur)
- ID généré automatiquement (ULID)
- Dates `createdAt` et `updatedAt` automatiques

### Consultation (web)

- Liste des notes triées par date de modification (plus récente en premier)
- Affichage : extrait du contenu (~120 chars), tags en badges, date de création
- Vue détail : contenu complet, tags, dates de création et modification
- Pagination par curseur (lots de 20)

### Modification (via MCP uniquement)

- Mise à jour du titre, contenu, et/ou tags
- Si `tags` omis → tags inchangés
- Si `tags: []` → suppression de tous les tags

### Suppression (via MCP uniquement)

- Suppression par noteId
- Suppression immédiate, pas de corbeille

---

## 3. Tags

### Modèle

- Scopés par utilisateur (isolation complète)
- Nom unique par utilisateur (stocké en minuscules)
- Identifiant ULID auto-généré

### Opérations (via MCP)

| Opération | Description |
|-----------|-------------|
| Créer | Nom unique, stocké en lowercase. Retourne 409 si déjà existant |
| Lister | Retourne tous les tags de l'utilisateur |
| Supprimer | Supprime le tag ET le retire de toutes les notes qui le référencent (cascade) |

### Tagging automatique par le LLM

Le LLM est guidé (via les descriptions des outils MCP) pour :
1. Consulter les tags existants avant de créer une note
2. Sélectionner les tags pertinents en fonction du contenu
3. Créer un nouveau tag si aucun existant ne convient
4. Assigner les tags lors de la création/mise à jour de la note

Ce comportement est consultatif (guidé par les descriptions des tools, pas forcé par la logique serveur).

---

## 4. Recherche et filtrage (web)

### Recherche texte

- Recherche libre sur le titre et le contenu des notes
- Côté serveur (in-memory sur les résultats DynamoDB)
- Combinable avec les filtres

### Filtrage par tags

- Sélection d'un ou plusieurs tags
- Affiche les notes ayant au moins un tag sélectionné

### Filtrage par date

- Raccourcis : "cette semaine", "ce mois-ci"
- Plage personnalisée (date début / date fin)
- Combinable avec le filtre tags (logique AND)

---

## 5. Interface web (lecture seule)

### Principes

- **Strictement en lecture seule** : aucune action de création, modification ou suppression
- Les notes sont créées uniquement via le LLM/MCP
- Données fraîches à chaque chargement (pas de cache stale)
- Responsive (mobile ≥ 320px, desktop)
- Accessible (navigation clavier, labels, aria-live, aria-invalid)

### Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard : liste des notes avec filtres |
| `/notes/:noteId` | Détail d'une note |
| `/signup` | Inscription (email + mot de passe + confirmation code) |
| `/login` | Connexion (web ou MCP selon le paramètre `?port=`) |

---

## 6. Isolation des données

- Chaque utilisateur ne voit que ses propres notes et tags
- Le userId est extrait du token Cognito côté serveur
- Toute tentative d'accès à une ressource d'un autre utilisateur retourne 404 (pas 403, pour ne pas révéler l'existence)
