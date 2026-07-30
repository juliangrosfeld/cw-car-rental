/**
 * Create or promote a CW admin. Run it with bun, from `app/`:
 *
 *   bun run scripts/create-admin.ts clay@cwcarrental.com 'a-long-passphrase'
 *   bun run scripts/create-admin.ts clay@cwcarrental.com          # promote only
 *   bun run scripts/create-admin.ts --list
 *   bun run scripts/create-admin.ts --revoke clay@cwcarrental.com
 *
 * WHY A SCRIPT AND NOT A SIGNUP PAGE
 * Admin is `app_metadata.role = 'admin'`, and app_metadata is writable only with
 * the service role key. That is the entire security model: there is no code path
 * anywhere in the app — no form, no server function, no RLS policy — that can
 * grant admin, so a compromised browser session or a hostile POST cannot mint
 * one. Promotion has to happen out of band, from a machine holding the secret
 * key. This script is that out-of-band path; the Supabase dashboard is the
 * other, and both do exactly the same thing.
 *
 * The key is read from the environment (bun loads app/.env automatically) and is
 * never printed. It must be the SERVICE ROLE key, not the publishable one.
 */
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const [, , ...argv] = process.argv;

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  fail(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "    Copy .env.example to .env and fill both in, then re-run with bun.",
  );
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Page through auth.users to find one address. There is no get-by-email in the
 *  admin API; at CW's scale a couple of pages is nothing. */
async function findUserByEmail(email: string) {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function listAdmins() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);

  const rows = data.users.map((u) => ({
    email: u.email ?? "(no email)",
    role: (u.app_metadata as { role?: string } | null)?.role ?? "—",
    confirmed: u.email_confirmed_at ? "yes" : "NO",
    lastSignIn: u.last_sign_in_at ?? "never",
  }));

  if (rows.length === 0) {
    console.log("\n  No users exist in this Supabase project yet.\n");
    return;
  }
  console.log("\n  Users in this project:\n");
  console.table(rows);
  const admins = rows.filter((r) => r.role === "admin");
  console.log(
    `  ${admins.length} of ${rows.length} ${admins.length === 1 ? "user is" : "users are"} an admin.\n`,
  );
}

async function revoke(email: string) {
  const user = await findUserByEmail(email);
  if (!user) fail(`No user with the address ${email}.`);

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    // Replaces app_metadata wholesale, so anything else stored there would be
    // lost. Nothing else is stored there today; if that changes, spread the
    // existing object here instead.
    app_metadata: { role: null },
  });
  if (error) fail(`Could not revoke admin: ${error.message}`);

  console.log(
    `\n  ✓ ${email} is no longer an admin.\n` +
      "    Their next request loses access — the app resolves the role live\n" +
      "    against Supabase rather than trusting the JWT they already hold.\n",
  );
}

async function grant(email: string, password: string | undefined) {
  const existing = await findUserByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      app_metadata: { role: "admin" },
      ...(password ? { password } : {}),
    });
    if (error) fail(`Could not promote ${email}: ${error.message}`);

    console.log(
      `\n  ✓ ${email} is now an admin${password ? " and the password was reset" : ""}.\n` +
        "    Sign in at /admin/login.\n",
    );
    return;
  }

  if (!password) {
    fail(
      `No user with the address ${email}, so a password is required to create one:\n` +
        `    bun run scripts/create-admin.ts ${email} 'a-long-passphrase'`,
    );
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    // Confirmed on creation: there is no inbox round trip for a staff account
    // the owner is provisioning deliberately, and an unconfirmed user cannot
    // sign in with a password.
    email_confirm: true,
    app_metadata: { role: "admin" },
  });
  if (error) fail(`Could not create ${email}: ${error.message}`);

  console.log(
    `\n  ✓ Created ${email} as an admin.\n` +
      "    Sign in at /admin/login with the password you just set.\n",
  );
}

const [first, second] = argv;

if (!first || first === "--help" || first === "-h") {
  console.log(
    "\n  Usage:\n" +
      "    bun run scripts/create-admin.ts <email> [password]   create or promote\n" +
      "    bun run scripts/create-admin.ts --list               show users and roles\n" +
      "    bun run scripts/create-admin.ts --revoke <email>     remove admin\n",
  );
  process.exit(first ? 0 : 1);
}

if (first === "--list") {
  await listAdmins();
} else if (first === "--revoke") {
  if (!second) fail("--revoke needs an email address.");
  await revoke(second);
} else {
  if (second !== undefined && second.length < 12) {
    fail(
      "Use a password of at least 12 characters. This account can read every\n" +
        "    guest record and every payment in the business.",
    );
  }
  await grant(first.trim().toLowerCase(), second);
}
