/**
 * Placeholder body for a CRM section that is routed but not built yet.
 *
 * These pages exist in phase 1 on purpose. The navigation is the map of the
 * tool: shipping a rail with five links where two of them 404 teaches an owner
 * not to trust the rail. A named, reachable page that says what is coming keeps
 * the shape of the finished product visible while the phases land.
 */
import { Panel } from "./ui";
import AdminShell from "./shell";
import type { AdminIdentity } from "../../lib/admin/types";

export default function SectionStub({
  admin,
  title,
  subtitle,
  summary,
  planned,
}: {
  admin: AdminIdentity;
  title: string;
  subtitle: string;
  summary: string;
  /** The work this page will do, in the order it will be built. */
  planned: string[];
}) {
  return (
    <AdminShell admin={admin} title={title} subtitle={subtitle}>
      <Panel title="Coming next">
        <div className="px-4 py-4">
          <p className="max-w-[62ch] text-[13px] leading-relaxed text-cw-ink/70">{summary}</p>
          <ul className="mt-4 space-y-2">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] text-cw-ink/75">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cw-teal"
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-lg bg-cw-mint-soft px-3 py-2 text-[12px] text-cw-ink/65">
            The data behind this page is already live in Supabase — the booking flow writes to it.
            Only the screen is missing.
          </p>
        </div>
      </Panel>
    </AdminShell>
  );
}
