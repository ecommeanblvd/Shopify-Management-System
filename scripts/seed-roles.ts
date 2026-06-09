/**
 * Deploy/runtime entry to seed RBAC roles. Runs on every deploy (after
 * db:migrate, before the server starts) so app_roles + role_permissions are
 * populated and roles.role_id is backfilled. Idempotent — safe to re-run.
 *
 *   npm run db:seed-roles
 */
import { seedRoles } from '@/db/seed-roles';

seedRoles()
  .then(() => {
    process.stdout.write('seed-roles: done\n');
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`seed-roles: failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
