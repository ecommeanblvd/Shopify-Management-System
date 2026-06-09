/** Trim + lowercase an email for consistent comparison and storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse BOOTSTRAP_ADMIN_EMAILS (csv) into a normalized list. Read directly
 *  from process.env so this module is build-safe even when the var is unset. */
export function bootstrapAdminEmails(): string[] {
  const raw = process.env.BOOTSTRAP_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 0);
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().includes(normalizeEmail(email));
}

/** Closed-model gate decision (pure). The caller supplies the DB lookup result. */
export function shouldAllowSignup(args: { email: string; hasPendingInvite: boolean }): boolean {
  return isBootstrapAdmin(args.email) || args.hasPendingInvite;
}
