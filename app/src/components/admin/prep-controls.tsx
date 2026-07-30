/**
 * The prep pipeline, as controls.
 *
 * TWO SHAPES, ONE WRITE PATH
 *   PrepAdvanceButton  one tap, one step forward. Lives in list rows and beside
 *                      the booking header, because moving a car from "needs
 *                      prep" to "ready" is the single most repeated action in
 *                      the back office and must not cost a form.
 *   PrepPipeline       the whole pipeline as five steps, any of which can be
 *                      set. This is the escape hatch: a car marked ready and
 *                      then found with a flat tyre has to be able to go back.
 *
 * Both call `updateBookingPrepStatus`, which runs requireAdmin() server-side and
 * writes with the status the admin was looking at in the WHERE clause. If the row
 * moved in the meantime the call comes back as `stale` rather than overwriting,
 * and both shapes below surface that message instead of pretending it worked.
 *
 * After a successful write they call `router.invalidate()`, which re-runs the
 * page loader: the timeline, the queue counts and the row all redraw from the
 * database rather than from an optimistic guess. At CRM scale that round trip is
 * cheaper than the class of bug where the screen and the database disagree.
 */
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { updateBookingPrepStatus } from "../../lib/api/admin.functions";
import {
  PREP_ADVANCE_LABEL,
  PREP_FLOW,
  PREP_LABEL,
  PREP_MEANING,
  nextPrepStatus,
} from "../../lib/admin/prep";
import type { BookingStatus, PrepStatus } from "../../lib/supabase/types";
import { Button, statusTone, toneBarClass } from "./ui";

/**
 * A cancelled booking has no prep work: the car was released the moment it was
 * cancelled (that is exactly what the exclusion constraint's partial WHERE says),
 * so its prep_status is a leftover and offering to advance it would invite an
 * admin to wash a car for a guest who is not coming. Both controls below go
 * read-only for one, rather than hiding the status they already hold.
 */
function isCancelled(bookingStatus?: BookingStatus): boolean {
  return bookingStatus === "cancelled";
}

/** Called with a human-readable problem, or null to clear one. The page decides
 *  where to show it — a row cannot grow a banner without shifting the table. */
type NoticeHandler = (message: string | null) => void;

function usePrepWrite(onNotice?: NoticeHandler) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function write(bookingId: string, from: PrepStatus, to: PrepStatus) {
    if (busy) return;
    setBusy(true);
    onNotice?.(null);
    try {
      const result = await updateBookingPrepStatus({
        data: { bookingId, to, expectedFrom: from },
      });
      // A stale or missing row still needs the page redrawn: whatever the
      // database now holds is what the admin should be looking at.
      await router.invalidate();
      if (!result.ok) onNotice?.(result.message);
    } catch (cause) {
      console.error(cause);
      onNotice?.("Could not save that change. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, write };
}

export function PrepAdvanceButton({
  bookingId,
  prepStatus,
  bookingStatus,
  size = "sm",
  variant = "secondary",
  onNotice,
}: {
  bookingId: string;
  prepStatus: PrepStatus;
  /** Pass it wherever it is to hand: a cancelled booking gets no action. */
  bookingStatus?: BookingStatus;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
  onNotice?: NoticeHandler;
}) {
  const { busy, write } = usePrepWrite(onNotice);
  const next = nextPrepStatus(prepStatus);
  const label = PREP_ADVANCE_LABEL[prepStatus];

  if (isCancelled(bookingStatus)) {
    return (
      <span
        className="text-[12px] text-cw-ink/35"
        title="This booking was cancelled — the car was released."
      >
        No prep
      </span>
    );
  }

  // End of the pipeline. A disabled button here would be five pixels of noise on
  // every returned booking in the list.
  if (!next || !label) {
    return <span className="text-[12px] text-cw-ink/35">Done</span>;
  }

  return (
    <Button
      size={size}
      variant={variant}
      disabled={busy}
      title={`Set prep status to "${PREP_LABEL[next]}"`}
      onClick={() => write(bookingId, prepStatus, next)}
    >
      {busy ? "Saving…" : label}
      <span aria-hidden className="opacity-60">
        →
      </span>
    </Button>
  );
}

/**
 * The five steps, with the current one filled in its status colour and the rest
 * offered as buttons. The step labels are the pipeline in reading order, which is
 * also the order the work happens in, so the strip doubles as an explanation of
 * what the statuses mean.
 */
export function PrepPipeline({
  bookingId,
  prepStatus,
  bookingStatus,
  onNotice,
}: {
  bookingId: string;
  prepStatus: PrepStatus;
  bookingStatus?: BookingStatus;
  onNotice?: NoticeHandler;
}) {
  const { busy, write } = usePrepWrite(onNotice);
  const currentIndex = PREP_FLOW.indexOf(prepStatus);
  const cancelled = isCancelled(bookingStatus);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PREP_FLOW.map((status, i) => {
          const isCurrent = status === prepStatus;
          const isPast = i < currentIndex;

          return (
            <button
              key={status}
              type="button"
              disabled={busy || isCurrent || cancelled}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => write(bookingId, prepStatus, status)}
              title={
                cancelled
                  ? "This booking was cancelled — the car was released, so there is no prep to track."
                  : isCurrent
                    ? `Currently ${PREP_LABEL[status]}`
                    : `Set to ${PREP_LABEL[status]} — ${PREP_MEANING[status]}`
              }
              className={`rounded-lg border-l-[3px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-default ${
                isCurrent
                  ? `${toneBarClass(status)} ring-1 ring-inset ring-current/20`
                  : isPast
                    ? "border-cw-navy/20 bg-cw-navy/[0.04] text-cw-ink/55 hover:bg-cw-navy/[0.08]"
                    : "border-cw-navy/12 bg-white text-cw-ink/45 hover:border-cw-teal hover:text-cw-teal"
              }`}
            >
              {PREP_LABEL[status]}
              {isCurrent && <span className="ml-1.5 text-[10px] uppercase opacity-70">now</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[12px] text-cw-ink/60">
        {cancelled ? (
          <>
            This booking was cancelled, so the car was released and there is no prep to do. The
            status above is what it held at the time.
          </>
        ) : (
          <>
            {PREP_MEANING[prepStatus]}
            {statusTone(prepStatus) === "amber" && (
              <span className="font-semibold text-[#8a6a04]"> This one is waiting on you.</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
