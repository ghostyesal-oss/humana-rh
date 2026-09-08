# Rappel de pointage - Edge Function

Envoie une notification Web Push aux collaborateurs qui n'ont pas encore pointé
leur arrivée 3 minutes après leur heure de shift (CS 09:03, R&D 10:03), même si
Humana n'est pas ouvert.

## Prérequis

1. Table `public.push_subscriptions` créée (`supabase/push-subscriptions.sql`).
2. Colonne `shift_code` sur `public.profiles` (schéma existant).
3. Clés VAPID (à générer une seule fois).

## Générer les clés VAPID (une seule fois)

```powershell
npx web-push generate-vapid-keys
```

Vous obtenez `publicKey` et `privateKey`. Notez-les.

## Configurer les secrets Supabase

Depuis le Dashboard Supabase > Project Settings > Functions > Secrets, ajoutez :

- `VAPID_PUBLIC_KEY` : la clé publique
- `VAPID_PRIVATE_KEY` : la clé privée
- `VAPID_SUBJECT` : `mailto:rh@humaine.fr`

Côté client, exposez la clé publique dans `config.js` :

```js
window.HUMANA_CONFIG = {
  SUPABASE_URL: "…",
  SUPABASE_ANON_KEY: "…",
  VAPID_PUBLIC_KEY: "BExemple…"
};
```

## Déployer la fonction

```powershell
npm install -g supabase
supabase login
supabase link --project-ref VOTRE_REF
supabase functions deploy late-punch-reminder --no-verify-jwt
```

## Planifier l'exécution (toutes les minutes 08h45 - 11h30 Paris)

Dans Supabase Dashboard > Database > Cron Jobs, créez :

- **Nom** : `late-punch-reminder`
- **Schedule** : `*/1 8-10 * * 1-5` (lun-ven, chaque minute entre 08h et 10h59 UTC ≈ 09h à 12h Paris hiver)
- **HTTP method** : `POST`
- **URL** : `https://VOTRE_REF.functions.supabase.co/late-punch-reminder`
- **HTTP Headers** : `Authorization: Bearer <ANON_KEY>`

Ajustez la plage horaire selon l'heure de shift la plus tardive de vos
collaborateurs.

## Comment ça marche

1. La fonction lit tous les profils et leurs shifts.
2. Pour chaque collaborateur sans pointage `in` du jour, si l'heure actuelle
   Paris dépasse `shift.start + 3 min`, on retrouve ses abonnements push.
3. Un Web Push est envoyé à chaque endpoint. Le service worker `sw.js` reçoit
   l'événement et affiche la notification.
4. Les endpoints morts (410/404) sont automatiquement supprimés.
