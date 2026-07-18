/**
 * Coarse shared-secret gate for the public approve/deny callbacks: the ntfy
 * action carries `Authorization: Bearer ${NTFY_TOKEN}`. Fail closed when no
 * expected secret is configured. The per-job single-use token (checked
 * separately) is the primary, job-scoped auth.
 */
export function bearerOk(authHeader: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  return authHeader === `Bearer ${expected}`;
}
