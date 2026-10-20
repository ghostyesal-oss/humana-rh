export function assertJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "");
  if (secret.length < 32) {
    throw new Error("JWT_SECRET doit faire au moins 32 caractères.");
  }
  if (/^changez-moi-/i.test(secret)) {
    throw new Error("JWT_SECRET ne doit pas rester une valeur d'exemple.");
  }
  return secret;
}
