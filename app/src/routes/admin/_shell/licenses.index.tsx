/**
 * /admin/licenses — every driver's license on file, in one place.
 *
 * WHAT THIS PAGE IS FOR: Clay needs a guest's license photo and remembers the
 * name, not which booking it arrived with. So this is one search box over every
 * client who has a license on file, with the photo, the number, the expiry and
 * links to each of their bookings on the same row.
 *
 * THE PHOTOS ARE NOT IN THIS PAGE'S DATA. The loader returns names and numbers
 * only; each thumbnail asks the server for its own one-minute signed link when
 * it is drawn (see components/admin/license-photo). The bucket is private and
 * stays that way.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { LicenceBadge } from "../../../components/admin/client-badges";
import { LicensePhoto } from "../../../components/admin/license-photo";
import AdminShell from "../../../components/admin/shell";
import { Button, EmptyState, Panel } from "../../../components/admin/ui";
import { fetchAdminLicenses } from "../../../lib/api/admin.functions";
import { formatDateLong, formatDateShort } from "../../../lib/admin/format";

interface LicensesSearch {
  q?: string;
}

export const Route = createFileRoute("/admin/_shell/licenses/")({
  validateSearch: (search: Record<string, unknown>): LicensesSearch => ({
    q: typeof search.q === "string" && search.q.trim() !== "" ? search.q.slice(0, 120) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => fetchAdminLicenses({ data: { query: deps.q ?? null } }),
  head: () => ({ meta: [{ title: "Licenses | CW back office" }] }),
  component: LicensesPage,
});

function LicensesPage() {
  const { admin, list } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [draft, setDraft] = useState(search.q ?? "");

  const submit = () =>
    navigate({ search: { q: draft.trim() === "" ? undefined : draft.trim() } });

  return (
    <AdminShell
      admin={admin}
      title="Licenses"
      subtitle={`${list.onFile} on file · ${list.withPhoto} with a photo`}
    >
      <Panel title="Find a license" className="mb-3">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Guest name (email or phone also work)"
            aria-label="Search licenses by guest name"
            className="min-w-[260px] flex-1 rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20"
          />
          <Button variant="primary" onClick={submit}>
            Search
          </Button>
          {search.q && (
            <Link
              to="/admin/licenses"
              search={{}}
              onClick={() => setDraft("")}
              className="py-1.5 text-[13px] font-semibold text-cw-ink/55 underline underline-offset-2 hover:text-cw-teal"
            >
              Clear
            </Link>
          )}
        </div>
      </Panel>

      <Panel
        title="Licenses on file"
        subtitle={
          list.query
            ? `${list.total} matching "${list.query}"`
            : `${list.total} ${list.total === 1 ? "guest" : "guests"}, most recently updated first`
        }
        action={
          list.truncated ? (
            <span className="text-[12px] text-[#b3261e]">
              Showing the first {list.rows.length}. Narrow the search.
            </span>
          ) : undefined
        }
      >
        {list.rows.length === 0 ? (
          <EmptyState>
            {list.onFile === 0 ? (
              <>No licenses yet. One is saved each time a guest books on the website.</>
            ) : (
              <>
                Nothing matches.{" "}
                <Link to="/admin/licenses" search={{}} className="underline">
                  Clear the search
                </Link>
                .
              </>
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-cw-navy/8">
            {list.rows.map((row) => (
              <li key={row.clientId} className="grid gap-4 px-4 py-4 md:grid-cols-[auto_1fr_1.2fr]">
                <LicensePhoto
                  clientId={row.clientId}
                  hasPhoto={row.hasPhoto}
                  guestName={row.fullName}
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      to="/admin/clients/$clientId"
                      params={{ clientId: row.clientId }}
                      className="text-[14px] font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                    >
                      {row.fullName}
                    </Link>
                    <LicenceBadge level={row.licenceLevel} expiry={row.licenseExpiry} />
                  </div>
                  <p className="mt-0.5 break-all text-[12px] text-cw-ink/55">
                    {row.phone} · {row.email}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                    <dt className="text-cw-ink/50">Number</dt>
                    <dd className="tabular-nums text-cw-ink">
                      {row.licenseNumber ?? <span className="text-cw-ink/35">None</span>}
                    </dd>
                    <dt className="text-cw-ink/50">Expires</dt>
                    <dd className="text-cw-ink">
                      {row.licenseExpiry ? (
                        formatDateLong(row.licenseExpiry)
                      ) : (
                        <span className="text-cw-ink/35">None</span>
                      )}
                    </dd>
                  </dl>
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
                    Bookings
                  </p>
                  {row.bookings.length === 0 ? (
                    <p className="mt-1 text-[13px] text-cw-ink/40">None on record.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {row.bookings.map((b) => (
                        <li key={b.id} className="text-[13px]">
                          <Link
                            to="/admin/bookings/$bookingId"
                            params={{ bookingId: b.id }}
                            className="font-semibold text-cw-teal underline underline-offset-2 hover:text-cw-teal-dark"
                          >
                            {b.ref.toUpperCase()}
                          </Link>{" "}
                          <span className={b.cancelled ? "text-cw-ink/40 line-through" : "text-cw-ink/75"}>
                            {b.carLabel} · {formatDateShort(b.pickupDate)} to{" "}
                            {formatDateShort(b.returnDate)}
                          </span>
                          {b.cancelled && <span className="ml-1 text-[11px] text-cw-ink/45">cancelled</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminShell>
  );
}
