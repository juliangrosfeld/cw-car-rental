/**
 * /admin/clients — the guest directory.
 *
 * WHAT THIS PAGE IS FOR: a guest is on the phone and Clay needs their record.
 * So search is the whole interface — one box that takes a name, an email or a
 * phone number in whatever form it was read out — and the two things worth
 * knowing before the conversation starts are on every row: how many times they
 * have rented, and what they have actually paid.
 *
 * THE BADGES ARE COMPUTED, NEVER STORED. "Repeat" is a count of their
 * non-cancelled bookings; "licence" is a comparison against today and their own
 * rental dates. Neither can drift out of date because neither is written down —
 * see src/lib/admin/clients.ts.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import AdminShell from "../../../components/admin/shell";
import { LicenceBadge, RepeatBadge } from "../../../components/admin/client-badges";
import { Button, EmptyState, Panel, Td, Th } from "../../../components/admin/ui";
import { fetchAdminClients } from "../../../lib/api/admin.functions";
import { formatDateShort, formatMoney } from "../../../lib/admin/format";
import type { ClientFilter } from "../../../lib/admin/types";

interface ClientsSearch {
  /** What was typed in the box. Absent means everyone. */
  q?: string;
  /** Absent means "all" — the default view needs no query string. */
  filter?: Exclude<ClientFilter, "all">;
}

const FILTERS = ["repeat", "licence", "duplicates"] as const;

export const Route = createFileRoute("/admin/_shell/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => ({
    q: typeof search.q === "string" && search.q.trim() !== "" ? search.q.slice(0, 120) : undefined,
    filter: FILTERS.includes(search.filter as (typeof FILTERS)[number])
      ? (search.filter as Exclude<ClientFilter, "all">)
      : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    fetchAdminClients({ data: { query: deps.q ?? null, filter: deps.filter ?? null } }),
  head: () => ({ meta: [{ title: "Clients | CW back office" }] }),
  component: ClientsPage,
});

const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = {
  repeat: "Repeat customers",
  licence: "Licence needs attention",
  duplicates: "Possible duplicates",
};

function ClientsPage() {
  const { admin, list } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // The search box is the one piece of component state on the page: a
  // navigation per keystroke would fight the input and re-run the loader on
  // every letter. It submits on Enter or on the button.
  const [draft, setDraft] = useState(search.q ?? "");

  // Built explicitly rather than spread from the previous search: TanStack types
  // `prev` as the union of every route's search params, and this page owns only
  // these two. Naming them is also what keeps a stale key from riding along.
  function submit() {
    navigate({
      search: {
        q: draft.trim() === "" ? undefined : draft.trim(),
        filter: search.filter,
      },
    });
  }

  return (
    <AdminShell
      admin={admin}
      title="Clients"
      subtitle={`${list.totals.clients} on file · ${list.totals.repeat} ${
        list.totals.repeat === 1 ? "has" : "have"
      } rented more than once`}
    >
      <Panel title="Find a guest" className="mb-3">
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Name, email, or phone — 512 8823 finds +599 9 512 8823"
              aria-label="Search clients"
              className="min-w-[280px] flex-1 rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20"
            />
            <Button variant="primary" onClick={submit}>
              Search
            </Button>
            {(search.q || search.filter) && (
              <Link
                to="/admin/clients"
                search={{}}
                onClick={() => setDraft("")}
                className="py-1.5 text-[13px] font-semibold text-cw-ink/55 underline underline-offset-2 hover:text-cw-teal"
              >
                Clear
              </Link>
            )}
          </div>

          {/* Counts are across every client, never the filtered set, so a number
              cannot move as a result of clicking it. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to="/admin/clients"
              search={{ q: search.q, filter: undefined }}
              className={chipClass(!search.filter)}
            >
              Everyone <span className="tabular-nums opacity-70">{list.totals.clients}</span>
            </Link>
            {FILTERS.map((filter) => (
              <Link
                key={filter}
                to="/admin/clients"
                search={{
                  q: search.q,
                  filter: search.filter === filter ? undefined : filter,
                }}
                className={chipClass(search.filter === filter)}
              >
                {FILTER_LABEL[filter]}{" "}
                <span className="tabular-nums opacity-70">
                  {filter === "repeat"
                    ? list.totals.repeat
                    : filter === "licence"
                      ? list.totals.licenceAttention
                      : list.totals.duplicates}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="Guests"
        subtitle={describe(list.query, list.filter, list.total)}
        action={
          list.truncated ? (
            <span className="text-[12px] text-[#b3261e]">
              Showing the first {list.rows.length} — narrow the search.
            </span>
          ) : undefined
        }
      >
        {list.rows.length === 0 ? (
          <EmptyState>
            {list.totals.clients === 0 ? (
              <>No guests yet. A client record is created the first time someone books.</>
            ) : (
              <>
                Nothing matches.{" "}
                <Link to="/admin/clients" search={{}} className="underline">
                  Clear the search
                </Link>
                .
              </>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="border-b border-cw-navy/8">
                <tr>
                  <Th>Guest</Th>
                  <Th>Contact</Th>
                  <Th align="right">Rentals</Th>
                  <Th align="right">Paid</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Last rental</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cw-navy/8">
                {list.rows.map((client) => (
                  <tr key={client.id} className="hover:bg-cw-teal-soft/25">
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          to="/admin/clients/$clientId"
                          params={{ clientId: client.id }}
                          className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                        >
                          {client.fullName}
                        </Link>
                        {client.isRepeat && <RepeatBadge rentals={client.value.rentals} />}
                        <LicenceBadge level={client.licenceLevel} expiry={client.licenseExpiry} />
                        {client.possibleDuplicates > 0 && (
                          <span
                            className="rounded-md bg-cw-navy/6 px-1.5 py-0.5 text-[11px] font-semibold text-cw-navy/70 ring-1 ring-inset ring-cw-navy/10"
                            title="Another record shares this email or phone number"
                          >
                            {client.possibleDuplicates === 1
                              ? "1 similar record"
                              : `${client.possibleDuplicates} similar records`}
                          </span>
                        )}
                      </div>
                      {client.countryOfResidence && (
                        <span className="block text-[11px] text-cw-ink/45">
                          {client.countryOfResidence}
                        </span>
                      )}
                    </Td>
                    <Td className="text-cw-ink/70">
                      <span className="block tabular-nums">{client.phone}</span>
                      <span className="block text-[11px] text-cw-ink/45">{client.email}</span>
                    </Td>
                    <Td align="right">
                      <span className="font-semibold text-cw-navy">{client.value.rentals}</span>
                      {client.value.upcoming > 0 && (
                        <span className="block text-[11px] text-cw-teal">
                          {client.value.upcoming} open
                        </span>
                      )}
                      {client.value.cancelled > 0 && (
                        <span className="block text-[11px] text-cw-ink/40">
                          {client.value.cancelled} cancelled
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="font-semibold text-cw-navy">
                      {formatMoney(client.value.paidCents)}
                    </Td>
                    <Td
                      align="right"
                      className={
                        client.value.outstandingCents > 0 ? "text-[#b3261e]" : "text-cw-ink/35"
                      }
                    >
                      {client.value.outstandingCents > 0
                        ? formatMoney(client.value.outstandingCents)
                        : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-cw-ink/70">
                      {client.value.lastPickup ? (
                        formatDateShort(client.value.lastPickup)
                      ) : (
                        <span className="text-cw-ink/35">Never rented</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AdminShell>
  );
}

function chipClass(active: boolean): string {
  return `flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
    active
      ? "border-cw-teal bg-cw-teal-soft text-cw-teal-dark"
      : "border-cw-navy/12 bg-white text-cw-ink/65 hover:border-cw-teal hover:text-cw-teal"
  }`;
}

/** Says what the table is showing, so the reader never has to infer it from the
 *  state of the chips. */
function describe(query: string, filter: ClientFilter, total: number): string {
  const parts: string[] = [];
  if (query) parts.push(`matching "${query}"`);
  if (filter !== "all") parts.push(FILTER_LABEL[filter].toLowerCase());

  const noun = total === 1 ? "guest" : "guests";
  return parts.length === 0
    ? `${total} ${noun}, most recent rental first`
    : `${total} ${noun} ${parts.join(", ")}`;
}
