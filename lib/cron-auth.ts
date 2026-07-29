/**
 * Pure auth check for cron endpoints, no env access — kept free of
 * "server-only" imports so it is unit-testable with `npm test`.
 */
export function isAuthorizedCron(authHeader: string | null, secret: string | undefined): boolean {
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}
