// Copiez ce fichier en "config.js" et renseignez vos clés Supabase.
// config.js n'est pas versionné (voir .gitignore).
window.HUMANA_CONFIG = {
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "votre-cle-anon-ici",
  // Facultatif : clé publique VAPID pour activer les notifications Web Push
  // lorsque l'onglet Humana n'est pas ouvert. Générez-la avec :
  //   npx web-push generate-vapid-keys
  // La clé privée reste côté serveur (Edge Function Supabase).
  VAPID_PUBLIC_KEY: ""
};
