# Document de Requirements

## Introduction

Page d'inscription permettant aux utilisateurs de créer un compte sur l'application mcp-notes en fournissant leur email et un mot de passe. Le backend Cognito vérifie l'email de l'utilisateur via un code de confirmation à 6 chiffres envoyé par email. L'utilisateur doit saisir ce code pour activer son compte.

## Glossaire

- **Formulaire_Inscription** : Composant UI contenant les champs email et mot de passe, ainsi que le bouton de soumission
- **Formulaire_Confirmation** : Composant UI contenant le champ de saisie du code de vérification à 6 chiffres
- **Système** : L'application front-end dans son ensemble
- **Service_Auth** : Module côté client responsable de la communication avec le Cognito User Pool (SignUp, ConfirmSignUp, ResendConfirmationCode)
- **Utilisateur** : Personne interagissant avec les formulaires d'inscription et de confirmation

## Requirements

### Requirement 1 : Affichage du formulaire d'inscription

**User Story :** En tant qu'utilisateur, je veux accéder à un formulaire d'inscription clair, afin de pouvoir créer un compte rapidement.

#### Critères d'acceptation

1. WHEN l'utilisateur accède à la page d'inscription, THE Formulaire_Inscription SHALL afficher un champ email, un champ mot de passe, et un bouton de soumission
2. THE Formulaire_Inscription SHALL afficher un label associé à chaque champ de saisie
3. WHEN la page d'inscription est chargée, THE Formulaire_Inscription SHALL placer le focus sur le champ email

### Requirement 2 : Validation du champ email

**User Story :** En tant qu'utilisateur, je veux être informé si mon email est invalide avant de soumettre le formulaire, afin de corriger mes erreurs immédiatement.

#### Critères d'acceptation

1. WHEN l'utilisateur soumet le formulaire avec un champ email vide, THE Formulaire_Inscription SHALL afficher un message d'erreur indiquant que l'email est requis
2. WHEN l'utilisateur soumet le formulaire avec un email ne respectant pas le format standard (RFC 5322 simplifié), THE Formulaire_Inscription SHALL afficher un message d'erreur indiquant que le format email est invalide
3. WHEN l'utilisateur corrige une erreur de validation email, THE Formulaire_Inscription SHALL masquer le message d'erreur associé

### Requirement 3 : Validation du mot de passe

**User Story :** En tant qu'utilisateur, je veux être informé si mon mot de passe ne respecte pas les critères, afin de choisir un mot de passe conforme.

#### Critères d'acceptation

1. WHEN l'utilisateur soumet le formulaire avec un champ mot de passe vide, THE Formulaire_Inscription SHALL afficher un message d'erreur indiquant que le mot de passe est requis
2. WHEN l'utilisateur soumet le formulaire avec un mot de passe de moins de 8 caractères, THE Formulaire_Inscription SHALL afficher un message d'erreur indiquant que le mot de passe doit contenir au minimum 8 caractères
3. WHEN l'utilisateur corrige une erreur de validation mot de passe, THE Formulaire_Inscription SHALL masquer le message d'erreur associé

### Requirement 4 : Soumission de l'inscription

**User Story :** En tant qu'utilisateur, je veux soumettre mes identifiants pour créer un compte, afin de recevoir un code de vérification par email.

#### Critères d'acceptation

1. WHEN l'utilisateur soumet le formulaire avec des données valides, THE Service_Auth SHALL envoyer une requête SignUp au Cognito User Pool avec l'email et le mot de passe
2. WHILE la requête d'inscription est en cours, THE Formulaire_Inscription SHALL désactiver le bouton de soumission et afficher un indicateur de chargement
3. WHILE la requête d'inscription est en cours, THE Formulaire_Inscription SHALL empêcher toute soumission supplémentaire

### Requirement 5 : Affichage du formulaire de confirmation

**User Story :** En tant qu'utilisateur ayant soumis mon inscription, je veux saisir le code reçu par email, afin de valider mon adresse email et activer mon compte.

#### Critères d'acceptation

1. WHEN le Service_Auth reçoit une réponse de succès de Cognito pour le SignUp, THE Système SHALL afficher le Formulaire_Confirmation avec un message indiquant qu'un code a été envoyé à l'adresse email saisie
2. THE Formulaire_Confirmation SHALL afficher un champ de saisie pour le code à 6 chiffres et un bouton de validation
3. WHEN le Formulaire_Confirmation est affiché, THE Système SHALL placer le focus sur le champ de saisie du code
4. THE Formulaire_Confirmation SHALL afficher un lien "Renvoyer le code" permettant de demander un nouveau code de vérification

### Requirement 6 : Validation et soumission du code de confirmation

**User Story :** En tant qu'utilisateur, je veux soumettre mon code de vérification pour activer mon compte.

#### Critères d'acceptation

1. WHEN l'utilisateur soumet le Formulaire_Confirmation avec un code vide, THE Formulaire_Confirmation SHALL afficher un message d'erreur indiquant que le code est requis
2. WHEN l'utilisateur soumet le Formulaire_Confirmation avec un code ne contenant pas exactement 6 chiffres, THE Formulaire_Confirmation SHALL afficher un message d'erreur indiquant que le code doit contenir 6 chiffres
3. WHEN l'utilisateur soumet le Formulaire_Confirmation avec un code valide, THE Service_Auth SHALL envoyer une requête ConfirmSignUp au Cognito User Pool avec l'email et le code
4. WHILE la requête ConfirmSignUp est en cours, THE Formulaire_Confirmation SHALL désactiver le bouton de validation et afficher un indicateur de chargement

### Requirement 7 : Renvoi du code de confirmation

**User Story :** En tant qu'utilisateur n'ayant pas reçu le code, je veux pouvoir demander un renvoi, afin de ne pas rester bloqué.

#### Critères d'acceptation

1. WHEN l'utilisateur clique sur "Renvoyer le code", THE Service_Auth SHALL envoyer une requête ResendConfirmationCode au Cognito User Pool
2. WHEN le renvoi réussit, THE Formulaire_Confirmation SHALL afficher un message confirmant que le code a été renvoyé
3. AFTER un renvoi réussi, THE Formulaire_Confirmation SHALL désactiver le lien "Renvoyer le code" pendant 30 secondes pour éviter le spam

### Requirement 8 : Succès de la confirmation

**User Story :** En tant qu'utilisateur, je veux recevoir un retour clair après confirmation de mon email, afin de savoir que mon compte est actif.

#### Critères d'acceptation

1. WHEN le Service_Auth reçoit une réponse de succès de Cognito pour ConfirmSignUp, THE Système SHALL afficher un message de confirmation indiquant que le compte a été activé avec succès
2. WHEN la confirmation réussit, THE Système SHALL rediriger l'utilisateur vers la page de connexion dans un délai de 3 secondes ou permettre une redirection immédiate via un lien

### Requirement 9 : Gestion des erreurs serveur

**User Story :** En tant qu'utilisateur, je veux être informé des erreurs lors de l'inscription ou de la confirmation, afin de comprendre ce qui s'est passé et agir en conséquence.

#### Critères d'acceptation

1. IF le Service_Auth reçoit une erreur "UsernameExistsException" de Cognito, THEN THE Formulaire_Inscription SHALL afficher un message indiquant qu'un compte avec cet email existe déjà
2. IF le Service_Auth reçoit une erreur "CodeMismatchException" de Cognito, THEN THE Formulaire_Confirmation SHALL afficher un message indiquant que le code saisi est incorrect
3. IF le Service_Auth reçoit une erreur "ExpiredCodeException" de Cognito, THEN THE Formulaire_Confirmation SHALL afficher un message indiquant que le code a expiré et invitant l'utilisateur à en demander un nouveau
4. IF le Service_Auth reçoit une erreur réseau ou un timeout, THEN THE Système SHALL afficher un message indiquant qu'une erreur de connexion est survenue et invitant l'utilisateur à réessayer
5. IF le Service_Auth reçoit une erreur inattendue de Cognito, THEN THE Système SHALL afficher un message d'erreur générique sans exposer de détails techniques
6. WHEN une erreur serveur est affichée, THE Système SHALL réactiver le bouton de soumission/validation pour permettre un nouvel essai

### Requirement 10 : Accessibilité

**User Story :** En tant qu'utilisateur utilisant des technologies d'assistance, je veux que les formulaires soient accessibles, afin de pouvoir m'inscrire de manière autonome.

#### Critères d'acceptation

1. THE Formulaire_Inscription et THE Formulaire_Confirmation SHALL associer chaque champ de saisie à un label via l'attribut "for/id"
2. WHEN une erreur de validation est affichée, THE Système SHALL associer le message d'erreur au champ concerné via l'attribut "aria-describedby"
3. WHEN une erreur de validation est affichée, THE Système SHALL marquer le champ concerné avec l'attribut "aria-invalid" à la valeur "true"
4. THE Formulaire_Inscription et THE Formulaire_Confirmation SHALL être entièrement navigables au clavier (Tab, Shift+Tab, Enter pour soumettre)
5. WHEN un message de succès ou d'erreur serveur est affiché, THE Système SHALL utiliser un élément avec le rôle ARIA "alert" pour notifier les lecteurs d'écran

### Requirement 11 : Modification backend — Retrait de l'auto-confirmation

**User Story :** En tant que développeur, je veux retirer le trigger PreSignUp d'auto-confirmation, afin que Cognito envoie un vrai code de vérification par email.

#### Critères d'acceptation

1. THE infrastructure CDK SHALL retirer le trigger Lambda PreSignUp du User Pool (ou le modifier pour ne plus auto-confirmer ni auto-vérifier l'email)
2. AFTER le déploiement, WHEN un utilisateur s'inscrit via SignUp, THE Cognito User Pool SHALL envoyer un email contenant un code de vérification à 6 chiffres
3. AFTER le déploiement, THE utilisateur ne SHALL pas être confirmé tant qu'il n'a pas fourni le code via ConfirmSignUp
