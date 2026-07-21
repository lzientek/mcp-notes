# Document de Design

## Vue d'ensemble

Le front d'inscription est une application web statique (SPA) construite avec React 19 qui gère le flux d'inscription en deux étapes : saisie email/mot de passe → confirmation par code email. Elle communique directement avec Cognito depuis le navigateur via le SDK AWS v3, sans passer par l'API Gateway.

## Choix technologiques

| Choix | Technologie | Justification |
|-------|-------------|---------------|
| Langage | TypeScript | Cohérence avec le reste du projet, typage fort |
| Framework UI | React 19 | Composants réutilisables, hooks, écosystème mature, prépare les évolutions futures (pages login, dashboard, etc.) |
| Bundler | esbuild | Rapide, tree-shaking natif, réduit le bundle AWS SDK |
| SDK Cognito | @aws-sdk/client-cognito-identity-provider (v3 modulaire) | Déjà utilisé côté MCP server, tree-shakeable |
| Hébergement | S3 + CloudFront (CDK) | Statique, pas cher, HTTPS natif |
| CSS | CSS Modules | Scoping natif, pas de dépendance externe, bonne DX avec TypeScript |
| Tests | Vitest + React Testing Library | Cohérence avec les tests existants (vitest), testing-library pour tester le comportement utilisateur |

## Architecture des composants

```
src/frontend/
├── index.html                  # Page unique (SPA)
├── main.tsx                    # Point d'entrée React (createRoot)
├── App.tsx                     # Composant racine, gestion des étapes
├── components/
│   ├── SignupForm.tsx          # Formulaire email + mot de passe
│   ├── ConfirmForm.tsx         # Formulaire code de vérification
│   ├── SuccessMessage.tsx      # Message de succès + redirection
│   ├── ErrorAlert.tsx          # Composant d'erreur serveur (role="alert")
│   └── FieldError.tsx          # Message d'erreur inline par champ
├── hooks/
│   ├── useSignup.ts            # Hook gérant le flux SignUp
│   ├── useConfirm.ts           # Hook gérant le flux ConfirmSignUp
│   └── useResendCode.ts        # Hook gérant le renvoi de code (+ cooldown 30s)
├── services/
│   └── auth-service.ts         # Appels Cognito (SignUp, ConfirmSignUp, ResendCode)
├── validators/
│   └── index.ts                # Validation email, mot de passe, code
├── config.ts                   # Configuration (UserPoolClientId, region)
└── types.ts                    # Types partagés (AppState, FormErrors, etc.)
```

### Tests unitaires

```
tests/unit/frontend/
├── components/
│   ├── SignupForm.test.tsx      # Rendu, validation, soumission, états loading/erreur
│   ├── ConfirmForm.test.tsx     # Rendu, validation code, soumission, resend
│   ├── SuccessMessage.test.tsx  # Affichage message, redirection timer
│   ├── ErrorAlert.test.tsx      # Attributs ARIA, affichage conditionnel
│   └── FieldError.test.tsx      # aria-describedby, affichage conditionnel
├── hooks/
│   ├── useSignup.test.ts        # Appel SDK, gestion états, mapping erreurs
│   ├── useConfirm.test.ts       # Appel SDK, gestion états, mapping erreurs
│   └── useResendCode.test.ts    # Appel SDK, cooldown 30s, états
├── services/
│   └── auth-service.test.ts     # Appels Cognito mockés, mapping exceptions
└── validators/
    └── validators.test.ts       # Validation email/password/code (cas limites)
```

## Machine à états du flux d'inscription

```
┌──────────────┐
│ SIGNUP_FORM  │ ← État initial
└──────┬───────┘
       │ submit (email + password valides)
       ▼
┌──────────────────┐
│ SIGNUP_LOADING   │
└──────┬───────────┘
       │ succès          │ erreur
       ▼                 ▼
┌──────────────┐   ┌──────────────┐
│ CONFIRM_FORM │   │ SIGNUP_FORM  │ (avec message erreur)
└──────┬───────┘   └──────────────┘
       │ submit (code 6 chiffres)
       ▼
┌──────────────────┐
│ CONFIRM_LOADING  │
└──────┬───────────┘
       │ succès          │ erreur
       ▼                 ▼
┌──────────────┐   ┌──────────────┐
│   SUCCESS    │   │ CONFIRM_FORM │ (avec message erreur)
└──────┬───────┘   └──────────────┘
       │ 3s / clic lien
       ▼
   [Redirection → /login]
```

## Composants React — Responsabilités

### `App.tsx`
- Gère l'état global de l'application (step: 'signup' | 'confirm' | 'success')
- Conserve l'email entre les étapes (passé de SignupForm à ConfirmForm)
- Orchestre les transitions entre composants

### `SignupForm.tsx`
- Champs email + mot de passe avec labels
- Validation à la soumission (pas en temps réel)
- Affiche les erreurs de validation inline (FieldError)
- Bouton désactivé + spinner pendant le loading
- Autofocus sur le champ email au montage

### `ConfirmForm.tsx`
- Champ code (6 chiffres) avec label
- Affiche l'email de destination
- Bouton "Valider" + état loading
- Lien "Renvoyer le code" avec cooldown 30s (useResendCode)
- Autofocus sur le champ code au montage

### `SuccessMessage.tsx`
- Message "Compte activé avec succès"
- Timer de 3s avant redirection
- Lien pour redirection immédiate

## Hooks personnalisés

### `useSignup()`
```typescript
interface UseSignupReturn {
  signup: (email: string, password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}
```

### `useConfirm()`
```typescript
interface UseConfirmReturn {
  confirm: (email: string, code: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}
```

### `useResendCode()`
```typescript
interface UseResendCodeReturn {
  resend: (email: string) => Promise<void>;
  isLoading: boolean;
  cooldownRemaining: number; // secondes restantes (0 = actif)
  message: string | null;    // "Code renvoyé" ou erreur
}
```

## Interactions avec Cognito

### 1. SignUp

```typescript
import { SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';

await cognitoClient.send(new SignUpCommand({
  ClientId: CONFIG.cognitoClientId,
  Username: email,
  Password: password,
  UserAttributes: [{ Name: 'email', Value: email }],
}));
```

### 2. ConfirmSignUp

```typescript
import { ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';

await cognitoClient.send(new ConfirmSignUpCommand({
  ClientId: CONFIG.cognitoClientId,
  Username: email,
  ConfirmationCode: code,
}));
```

### 3. ResendConfirmationCode

```typescript
import { ResendConfirmationCodeCommand } from '@aws-sdk/client-cognito-identity-provider';

await cognitoClient.send(new ResendConfirmationCodeCommand({
  ClientId: CONFIG.cognitoClientId,
  Username: email,
}));
```

## Gestion des erreurs Cognito

| Exception Cognito | État cible | Message utilisateur |
|-------------------|-----------|---------------------|
| UsernameExistsException | SIGNUP_FORM | "Un compte avec cet email existe déjà" |
| CodeMismatchException | CONFIRM_FORM | "Le code saisi est incorrect" |
| ExpiredCodeException | CONFIRM_FORM | "Le code a expiré. Demandez-en un nouveau." |
| NetworkError / Timeout | État courant | "Erreur de connexion. Veuillez réessayer." |
| Autre | État courant | "Une erreur est survenue. Veuillez réessayer." |

## Modifications de l'infrastructure CDK

### Retrait du trigger PreSignUp

```typescript
// AVANT: this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);
// APRÈS: Supprimer ces lignes + la Lambda PreSignUpFn
```

### Ajout de l'hébergement statique

```typescript
// S3 bucket pour les assets statiques
const websiteBucket = new s3.Bucket(this, 'McpNotesFrontendBucket', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});

// CloudFront distribution
const distribution = new cloudfront.Distribution(this, 'McpNotesFrontendDist', {
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
  defaultRootObject: 'index.html',
  errorResponses: [{
    httpStatus: 404,
    responsePagePath: '/index.html',
    responseHttpStatus: 200,
  }],
});

// Déploiement des assets buildés
new s3deploy.BucketDeployment(this, 'McpNotesFrontendDeploy', {
  sources: [s3deploy.Source.asset('./dist/frontend')],
  destinationBucket: websiteBucket,
  distribution,
  distributionPaths: ['/*'],
});
```

### Nouveaux outputs CDK

```typescript
new cdk.CfnOutput(this, 'FrontendUrl', {
  value: `https://${distribution.distributionDomainName}`,
});
```

## Validation côté client

| Champ | Règle | Regex / Condition |
|-------|-------|-------------------|
| Email | Format RFC 5322 simplifié | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| Email | Non vide | `value.trim().length > 0` |
| Mot de passe | Min 8 caractères | `value.length >= 8` |
| Mot de passe | Non vide | `value.length > 0` |
| Code | Exactement 6 chiffres | `/^\d{6}$/` |

## Accessibilité

- Chaque `<input>` a un `<label htmlFor="...">` associé
- Les erreurs utilisent `aria-describedby` pointant vers un `<span>` d'erreur
- Les champs invalides ont `aria-invalid="true"`
- Les messages de succès/erreur serveur utilisent `role="alert"` + `aria-live="assertive"`
- Navigation complète au clavier (Tab, Shift+Tab, Enter)
- Focus automatique géré via `useEffect` + `ref.current.focus()` lors des transitions d'état

## Stratégie de tests

### Tests unitaires (Vitest + React Testing Library)

| Couche | Ce qui est testé | Approche |
|--------|-----------------|----------|
| Validators | Validation email/password/code | Tests purs (input → output) avec cas limites |
| Services | Appels Cognito | Mock du SDK, vérification des paramètres envoyés et du mapping d'erreurs |
| Hooks | Logique métier | renderHook avec mocks du service, vérification des états |
| Composants | Comportement utilisateur | render + userEvent : formulaire affiché, validation, soumission, messages d'erreur, ARIA |

### Principes de test

- Tester le **comportement** (ce que l'utilisateur voit/fait), pas l'implémentation
- Mocker uniquement la couche service (pas les hooks internes)
- Vérifier les attributs d'accessibilité dans les tests de composants
- Couvrir les cas d'erreur Cognito (UsernameExists, CodeMismatch, ExpiredCode, réseau)

## Build pipeline

```json
{
  "scripts": {
    "build:frontend": "esbuild src/frontend/main.tsx --bundle --outdir=dist/frontend --format=esm --minify --sourcemap --loader:.tsx=tsx --jsx=automatic",
    "dev:frontend": "esbuild src/frontend/main.tsx --bundle --outdir=dist/frontend --format=esm --servedir=dist/frontend --serve=3000 --loader:.tsx=tsx --jsx=automatic"
  }
}
```

Les fichiers `index.html` et assets statiques sont copiés dans `dist/frontend` lors du build.

## Dépendances à ajouter

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0"
  }
}
```

## Diagramme de séquence

```
Utilisateur          Frontend (React)     Cognito
    │                    │                   │
    │── Remplit form ──▶ │                   │
    │                    │── SignUp ────────▶ │
    │                    │◀── OK ────────────│
    │◀── Affiche form    │                   │
    │    confirmation    │                   │
    │                    │                   │── Email (code 6 chiffres)
    │                    │                   │
    │── Saisit code ───▶ │                   │
    │                    │── ConfirmSignUp ─▶ │
    │                    │◀── OK ────────────│
    │◀── Compte activé!  │                   │
    │                    │                   │
    │── [Redirection] ─▶ /login              │
```
