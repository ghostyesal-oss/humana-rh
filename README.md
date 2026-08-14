# Humana — RH App

Application RH React/TypeScript avec authentification Microsoft Entra ID via Supabase.

## Fonctionnalités incluses

- tableau de bord RH ;
- annuaire des collaborateurs ;
- congés et absences ;
- documents ;
- recrutement ;
- campagnes d’évaluation ;
- connexion Microsoft limitée au tenant de l’entreprise ;
- schéma Supabase avec Row Level Security (RLS).

## Lancer le projet

```bash
npm install
copy .env.example .env.local
npm run dev
```

Renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans `.env.local`.
Sans ces variables, l’interface reste accessible avec le bouton d’aperçu de démonstration, mais la connexion réelle est désactivée.

## Créer et configurer Supabase

1. Créez un nouveau projet sur Supabase.
2. Ouvrez **SQL Editor** et exécutez `supabase/schema.sql`.
3. Dans **Authentication → URL Configuration**, ajoutez `http://localhost:5173` aux URL de redirection autorisées.
4. Copiez l’URL du projet et la clé publique `anon` dans `.env.local`.
5. Après la première connexion, attribuez le rôle administrateur depuis le SQL Editor :

```sql
update public.profiles
set role = 'admin'
where email = 'votre-adresse@entreprise.com';
```

## Configurer Microsoft Entra ID

1. Dans le portail Azure, ouvrez **Microsoft Entra ID → App registrations → New registration**.
2. Choisissez **Accounts in this organizational directory only**.
3. Ajoutez une plateforme **Web** avec l’URI :
   `https://<project-ref>.supabase.co/auth/v1/callback`
4. Créez un secret client et copiez sa **valeur**.
5. Dans Supabase, ouvrez **Authentication → Providers → Azure** puis renseignez le Client ID et le secret.
6. Pour empêcher les comptes d’autres entreprises, renseignez **Azure Tenant URL** avec :
   `https://login.microsoftonline.com/<tenant-id>`

Le client demande explicitement le scope `email`, requis par Supabase pour Azure.

Documentation officielle : https://supabase.com/docs/guides/auth/social-login/auth-azure

## Vérifications

```bash
npm run lint
npm run build
```
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
