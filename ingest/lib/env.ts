// Reads a required secret from the environment (GitHub Actions → Secrets).
export function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing secret ${name}. Add it in GitHub → Settings → Secrets and variables → Actions.`);
  }
  return v.trim();
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}
