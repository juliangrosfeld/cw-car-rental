/**
 * Shared by the browser (the reset form) and the server (admin.server.ts).
 * Kept out of admin.server.ts because a `.server.ts` file cannot be imported
 * into a route component.
 *
 * Same floor as scripts/create-admin.ts: an admin account reads every guest
 * record and every payment in the business.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
