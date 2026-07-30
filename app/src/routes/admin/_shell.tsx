/**
 * The guard for every CRM page. Pathless (`_shell`), so it wraps /admin,
 * /admin/bookings and friends without adding a segment to any URL — and
 * crucially it does NOT wrap /admin/login, which lives outside this file's
 * directory precisely so the login page is reachable without a session.
 *
 * WHAT THIS GUARD IS AND IS NOT
 * It is a redirect: an admin whose session has expired gets sent to the login
 * page instead of watching panels fail to load. It is NOT the security boundary
 * — `beforeLoad` runs in the browser on client-side navigations, and anyone can
 * skip a browser. The boundary is `requireAdmin()` inside each server function
 * (src/lib/api/admin.functions.ts), which is where the cookie is actually
 * resolved against Supabase Auth. Both layers exist and both are needed.
 *
 * The identity is returned into route context so child routes render the shell
 * without a second round trip.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { fetchAdminSession } from "../../lib/api/admin.functions";

export const Route = createFileRoute("/admin/_shell")({
  beforeLoad: async ({ location }) => {
    const { admin } = await fetchAdminSession();
    if (!admin) {
      throw redirect({
        to: "/admin/login",
        // Remembering where they were headed turns an expired session from "log
        // in, then find your way back" into "log in".
        search: { redirect: location.pathname },
      });
    }
    return { admin };
  },
  head: () => ({
    // The CRM must never be indexed. robots.txt disallows /admin/ as well; this
    // is the copy that survives someone linking straight to a page.
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: Outlet,
});
