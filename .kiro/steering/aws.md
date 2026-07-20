# AWS Profile

Toujours utiliser le profil AWS `mcp-notes` pour toutes les opérations AWS (CLI, CDK, SDK) dans ce projet.

- Commandes AWS CLI : `--profile mcp-notes`
- CDK deploy : `npx cdk deploy --profile mcp-notes`
- CDK synth : `npx cdk synth --profile mcp-notes`
- CDK bootstrap : `npx cdk bootstrap --profile mcp-notes`
- Variables d'environnement si nécessaire : `export AWS_PROFILE=mcp-notes`

Ce n'est PAS un compte SSO. Le profil est configuré avec des access keys dans `~/.aws/credentials`.
