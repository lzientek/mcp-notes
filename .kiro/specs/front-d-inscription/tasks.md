# Tâches d'implémentation — Front d'inscription

## 1. Infrastructure CDK — Retrait du PreSignUp et ajout hébergement statique

- [ ] 1.1 Retirer le trigger PreSignUp du User Pool
  - **Fichiers** : `lib/mcp-notes-stack.ts`, supprimer `src/lambda/pre-sign-up.ts`
  - **Critères** : La Lambda `PreSignUpFn` et l'appel `addTrigger(PRE_SIGN_UP)` sont supprimés du stack. Le User Pool ne possède plus de trigger PreSignUp. La Lambda `pre-sign-up.ts` est supprimée du dossier source.
  - **Dépendances** : Aucune

- [ ] 1.2 Ajouter le bucket S3 + distribution CloudFront pour l'hébergement statique
  - **Fichiers** : `lib/mcp-notes-stack.ts`
  - **Critères** : Un bucket S3 privé (`BlockPublicAccess.BLOCK_ALL`) est créé avec `removalPolicy: DESTROY` et `autoDeleteObjects: true`. Une distribution CloudFront est configurée avec OAC vers le bucket, `defaultRootObject: 'index.html'`, et une réponse 404→`/index.html` (status 200) pour le SPA routing. Un `BucketDeployment` source `./dist/frontend` est configuré avec invalidation CloudFront. Un output `FrontendUrl` expose l'URL de la distribution.
  - **Dépendances** : Aucune

## 2. Setup projet frontend

- [ ] 2.1 Ajouter les dépendances React 19 et dev tools
  - **Fichiers** : `package.json`
  - **Critères** : `react` et `react-dom` (^19.0.0) sont ajoutés en dependencies. `@types/react`, `@types/react-dom` (^19.0.0), `@testing-library/react` (^16.0.0), `@testing-library/user-event` (^14.0.0), `esbuild` (^0.25.0), et `jsdom` (^26.0.0) sont ajoutés en devDependencies. `npm install` s'exécute sans erreur.
  - **Dépendances** : Aucune

- [ ] 2.2 Configurer le tsconfig pour le JSX React
  - **Fichiers** : `tsconfig.json` ou créer `src/frontend/tsconfig.json`
  - **Critères** : Un `tsconfig.json` dédié au frontend est créé dans `src/frontend/` avec `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`, et `"moduleResolution": "bundler"`. Le tsconfig principal peut être étendu ou rester inchangé pour ne pas impacter le backend.
  - **Dépendances** : 2.1

- [ ] 2.3 Ajouter les scripts npm de build et dev frontend
  - **Fichiers** : `package.json`
  - **Critères** : Les scripts `build:frontend` et `dev:frontend` sont ajoutés conformément au design (esbuild avec `--bundle --format=esm --minify --sourcemap --loader:.tsx=tsx --jsx=automatic`). Le script `dev:frontend` lance un serveur local sur le port 3000.
  - **Dépendances** : 2.1

- [ ] 2.4 Créer le fichier `index.html` point d'entrée
  - **Fichiers** : `src/frontend/index.html`
  - **Critères** : Le fichier HTML contient un `<div id="root">`, un `<script type="module" src="./main.js">`, un charset UTF-8, un viewport meta, et un titre "mcp-notes — Inscription". Le fichier est copié dans `dist/frontend` lors du build.
  - **Dépendances** : 2.3

## 3. Types et configuration frontend

- [ ] 3.1 Créer les types partagés du frontend
  - **Fichiers** : `src/frontend/types.ts`
  - **Critères** : Exporte les types `AppStep` (`'signup' | 'confirm' | 'success'`), `FormErrors` (Record avec champs optionnels email, password, code), et les interfaces de retour des hooks (`UseSignupReturn`, `UseConfirmReturn`, `UseResendCodeReturn`) conformément au design.
  - **Dépendances** : 2.2

- [ ] 3.2 Créer le fichier de configuration
  - **Fichiers** : `src/frontend/config.ts`
  - **Critères** : Exporte un objet `CONFIG` avec `cognitoClientId` et `region` (valeurs lues depuis des variables d'environnement ou constantes de build). Les valeurs par défaut pointent vers la région `eu-west-1` et un placeholder pour le client ID.
  - **Dépendances** : 2.2

## 4. Validators (fonctions pures)

- [ ] 4.1 Implémenter les fonctions de validation
  - **Fichiers** : `src/frontend/validators/index.ts`
  - **Critères** : Exporte `validateEmail(value: string): string | null`, `validatePassword(value: string): string | null`, et `validateCode(value: string): string | null`. Email : retourne un message si vide ou si ne matche pas `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Password : retourne un message si vide ou < 8 caractères. Code : retourne un message si vide ou ne matche pas `/^\d{6}$/`. Retourne `null` si valide.
  - **Dépendances** : 3.1

- [ ] 4.2 Tests unitaires des validators
  - **Fichiers** : `tests/unit/frontend/validators/validators.test.ts`
  - **Critères** : Couvre les cas : email vide, email invalide (formats divers), email valide. Password vide, password < 8 caractères, password valide. Code vide, code != 6 chiffres (lettres, trop court, trop long), code valide. Tous les tests passent.
  - **Dépendances** : 4.1

## 5. Service d'authentification (appels Cognito)

- [ ] 5.1 Implémenter le service auth
  - **Fichiers** : `src/frontend/services/auth-service.ts`
  - **Critères** : Exporte les fonctions `signUp(email, password)`, `confirmSignUp(email, code)`, et `resendConfirmationCode(email)`. Chaque fonction instancie les commandes SDK appropriées (`SignUpCommand`, `ConfirmSignUpCommand`, `ResendConfirmationCodeCommand`) avec le `ClientId` depuis la config. Les erreurs Cognito sont propagées telles quelles (le mapping se fait dans les hooks).
  - **Dépendances** : 3.2

- [ ] 5.2 Tests unitaires du service auth
  - **Fichiers** : `tests/unit/frontend/services/auth-service.test.ts`
  - **Critères** : Mock du client Cognito SDK. Vérifie que `signUp` envoie un `SignUpCommand` avec les bons paramètres (ClientId, Username, Password, UserAttributes). Vérifie que `confirmSignUp` envoie un `ConfirmSignUpCommand`. Vérifie que `resendConfirmationCode` envoie un `ResendConfirmationCodeCommand`. Vérifie que les erreurs sont propagées. Tous les tests passent.
  - **Dépendances** : 5.1

## 6. Hooks personnalisés

- [ ] 6.1 Implémenter le hook `useSignup`
  - **Fichiers** : `src/frontend/hooks/useSignup.ts`
  - **Critères** : Retourne `{ signup, isLoading, error, clearError }`. Appelle `authService.signUp`. Gère les états loading/error. Mappe les exceptions Cognito (`UsernameExistsException` → message FR, erreur réseau → message FR, autre → message générique). Appelle un callback `onSuccess` fourni en paramètre.
  - **Dépendances** : 5.1, 3.1

- [ ] 6.2 Implémenter le hook `useConfirm`
  - **Fichiers** : `src/frontend/hooks/useConfirm.ts`
  - **Critères** : Retourne `{ confirm, isLoading, error, clearError }`. Appelle `authService.confirmSignUp`. Mappe `CodeMismatchException` et `ExpiredCodeException` en messages FR. Appelle un callback `onSuccess` fourni en paramètre.
  - **Dépendances** : 5.1, 3.1

- [ ] 6.3 Implémenter le hook `useResendCode`
  - **Fichiers** : `src/frontend/hooks/useResendCode.ts`
  - **Critères** : Retourne `{ resend, isLoading, cooldownRemaining, message }`. Appelle `authService.resendConfirmationCode`. Après succès, déclenche un cooldown de 30 secondes (compteur décrémenté chaque seconde via `setInterval`). Affiche un message "Code renvoyé" pendant le cooldown. Nettoie l'interval au démontage.
  - **Dépendances** : 5.1, 3.1

- [ ] 6.4 Tests unitaires des hooks
  - **Fichiers** : `tests/unit/frontend/hooks/useSignup.test.ts`, `tests/unit/frontend/hooks/useConfirm.test.ts`, `tests/unit/frontend/hooks/useResendCode.test.ts`
  - **Critères** : Mock du service auth. Teste les transitions d'état (idle → loading → success/error). Teste le mapping des erreurs Cognito. Teste le cooldown de 30s pour `useResendCode` (avec `vi.useFakeTimers`). Tous les tests passent.
  - **Dépendances** : 6.1, 6.2, 6.3

## 7. Composants React

- [ ] 7.1 Implémenter le composant `FieldError`
  - **Fichiers** : `src/frontend/components/FieldError.tsx`
  - **Critères** : Accepte `message: string | null` et `id: string`. Rend un `<span>` avec le message si non-null, sinon ne rend rien. L'id est utilisé pour le lien `aria-describedby` depuis le champ parent.
  - **Dépendances** : 3.1

- [ ] 7.2 Implémenter le composant `ErrorAlert`
  - **Fichiers** : `src/frontend/components/ErrorAlert.tsx`
  - **Critères** : Accepte `message: string | null`. Rend un `<div role="alert" aria-live="assertive">` avec le message si non-null. Ne rend rien si message est null.
  - **Dépendances** : 3.1

- [ ] 7.3 Implémenter le composant `SignupForm`
  - **Fichiers** : `src/frontend/components/SignupForm.tsx`
  - **Critères** : Affiche un champ email avec label, un champ mot de passe avec label, un bouton "S'inscrire". Validation à la soumission via les validators. Affiche les erreurs inline via `FieldError`. Le bouton est désactivé pendant le loading avec un texte "Inscription...". Autofocus sur le champ email au montage. Chaque champ a `aria-describedby` pointant vers son `FieldError` et `aria-invalid` si en erreur. Accepte les props : `onSubmit(email, password)`, `isLoading`, `serverError`.
  - **Dépendances** : 7.1, 7.2, 4.1

- [ ] 7.4 Implémenter le composant `ConfirmForm`
  - **Fichiers** : `src/frontend/components/ConfirmForm.tsx`
  - **Critères** : Affiche un message "Un code a été envoyé à {email}". Champ code (6 chiffres) avec label. Bouton "Valider" désactivé pendant le loading. Lien "Renvoyer le code" désactivé pendant le cooldown (affiche le temps restant). Autofocus sur le champ code au montage. Validation à la soumission. Attributs ARIA conformes (aria-describedby, aria-invalid, role="alert" pour les messages). Accepte les props : `email`, `onSubmit(code)`, `isLoading`, `serverError`, `resend`, `resendState`.
  - **Dépendances** : 7.1, 7.2, 4.1

- [ ] 7.5 Implémenter le composant `SuccessMessage`
  - **Fichiers** : `src/frontend/components/SuccessMessage.tsx`
  - **Critères** : Affiche "Compte activé avec succès !" avec `role="alert"`. Affiche un compteur de secondes avant redirection ("Redirection dans X secondes..."). Affiche un lien pour redirection immédiate. Déclenche un `setTimeout` de 3s pour la redirection (vers `/login` ou `window.location`).
  - **Dépendances** : 3.1

- [ ] 7.6 Tests unitaires des composants
  - **Fichiers** : `tests/unit/frontend/components/SignupForm.test.tsx`, `tests/unit/frontend/components/ConfirmForm.test.tsx`, `tests/unit/frontend/components/SuccessMessage.test.tsx`, `tests/unit/frontend/components/ErrorAlert.test.tsx`, `tests/unit/frontend/components/FieldError.test.tsx`
  - **Critères** : Teste le rendu initial (champs, labels, boutons). Teste la validation (soumission avec champs vides/invalides → messages d'erreur). Teste l'état loading (bouton désactivé, texte modifié). Teste l'affichage des erreurs serveur. Teste les attributs ARIA (aria-describedby, aria-invalid, role="alert"). Teste l'autofocus. Teste le cooldown du resend dans ConfirmForm. Teste le timer de redirection dans SuccessMessage. Utilise React Testing Library + userEvent. Tous les tests passent.
  - **Dépendances** : 7.1, 7.2, 7.3, 7.4, 7.5

## 8. Orchestration de l'application

- [ ] 8.1 Implémenter `App.tsx`
  - **Fichiers** : `src/frontend/App.tsx`
  - **Critères** : Gère l'état `step: 'signup' | 'confirm' | 'success'` et conserve l'email entre les étapes. Utilise les hooks `useSignup`, `useConfirm`, `useResendCode`. Affiche `SignupForm` quand step='signup', `ConfirmForm` quand step='confirm', `SuccessMessage` quand step='success'. Transitionne automatiquement entre les étapes sur succès des hooks.
  - **Dépendances** : 6.1, 6.2, 6.3, 7.3, 7.4, 7.5

- [ ] 8.2 Implémenter `main.tsx`
  - **Fichiers** : `src/frontend/main.tsx`
  - **Critères** : Importe React et ReactDOM. Appelle `createRoot(document.getElementById('root')!)` et rend `<App />`. Point d'entrée du bundle esbuild.
  - **Dépendances** : 8.1

## 9. Styling CSS

- [ ] 9.1 Créer les styles de l'application
  - **Fichiers** : `src/frontend/styles.css`
  - **Critères** : Styles minimalistes pour les formulaires : centrage de la page, espacement des champs, style des boutons (états normal/disabled/loading), style des messages d'erreur (rouge), style du message de succès (vert), style du lien "Renvoyer le code". Responsive (mobile-first). Pas de framework CSS externe.
  - **Dépendances** : Aucune

## 10. Configuration Vitest pour le frontend

- [ ] 10.1 Adapter la configuration Vitest pour supporter JSX et jsdom
  - **Fichiers** : `vitest.config.ts`
  - **Critères** : L'environnement `jsdom` est configuré pour les tests frontend (via un pattern sur le chemin `tests/unit/frontend/**`). Les fichiers `.tsx` sont inclus dans les patterns de test. La config existante pour les tests backend reste inchangée.
  - **Dépendances** : 2.1

## 11. Build et déploiement

- [ ] 11.1 Configurer le script de build complet avec copie de `index.html`
  - **Fichiers** : `package.json`, éventuellement un script `scripts/build-frontend.sh` ou ajout dans le script npm
  - **Critères** : Le script `build:frontend` produit un dossier `dist/frontend/` contenant `main.js`, `main.js.map`, et `index.html`. Le `index.html` est copié depuis `src/frontend/index.html`. La commande `npm run build:frontend` s'exécute sans erreur et produit un bundle fonctionnel.
  - **Dépendances** : 2.3, 2.4, 8.2, 9.1

- [ ] 11.2 Déployer le stack CDK mis à jour
  - **Fichiers** : Aucun (commande uniquement)
  - **Critères** : `npx cdk deploy --profile mcp-notes` s'exécute avec succès. Le trigger PreSignUp est retiré. Le bucket S3 et la distribution CloudFront sont créés. Le frontend est déployé et accessible via l'URL CloudFront. L'inscription envoie bien un vrai code de vérification par email.
  - **Dépendances** : 1.1, 1.2, 11.1
