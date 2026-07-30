/**
 * CRM primitives. Presentational only — no data fetching, no router.
 *
 * DESIGN NOTE — why this looks different from the public site.
 * The marketing pages are generous: big type, soft shadows, lots of air. A back
 * office is read, not browsed: Clay opens it to answer "what came in today" and
 * "who am I meeting at eleven". So the same brand tokens (teal, navy, ink,
 * Montserrat for figures) are used at a much tighter rhythm — hairline borders
 * instead of shadows, 13-14px body text, tables over cards. It should read as
 * the same company, in work clothes.
 *
 * Numbers are set in the display face with tabular figures so columns of money
 * line up digit for digit; that is the whole reason for `tabular-nums` below.
 */
import type { ReactNode } from "react";

/* ── panels ──────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // `min-w-0` is load-bearing, not tidiness. A grid item defaults to
    // `min-width: auto`, so a panel containing a wide table (`min-w-[520px]`
    // inside an overflow-x-auto wrapper) sizes its whole grid column to that
    // table's width instead of scrolling inside it — which pushes the document
    // wider than a phone viewport and drags every sibling panel out with it.
    <section
      className={`min-w-0 rounded-xl border border-cw-navy/10 bg-white shadow-[0_1px_2px_rgba(2,48,71,0.04)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-cw-navy/8 px-4 py-3">
          <div>
            {title && (
              <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-cw-navy">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-[12px] text-cw-ink/55">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* ── figures ─────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  delta,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Percentage change against a stated baseline. null renders nothing, which
   *  is the honest answer when there is no baseline to compare against. */
  delta?: { pct: number | null; label: string };
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        emphasis
          ? "border-cw-teal/25 bg-cw-teal-soft/60"
          : "border-cw-navy/10 bg-white shadow-[0_1px_2px_rgba(2,48,71,0.04)]"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-cw-ink/55">
        {label}
      </p>
      <p
        className={`mt-1.5 font-display font-extrabold tabular-nums tracking-tight text-cw-navy ${
          emphasis ? "text-[26px]" : "text-[22px]"
        }`}
      >
        {value}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {delta?.pct != null && (
          <span
            className={`text-[11px] font-semibold tabular-nums ${
              delta.pct >= 0 ? "text-[#1a7a45]" : "text-[#b3261e]"
            }`}
          >
            {delta.pct >= 0 ? "▲" : "▼"} {Math.abs(delta.pct)}%
          </span>
        )}
        {(hint || delta) && (
          <span className="text-[11px] text-cw-ink/50">{hint ?? delta?.label}</span>
        )}
      </div>
    </div>
  );
}

/* ── status pills ────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "teal" | "amber" | "green" | "red" | "peach";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-cw-navy/6 text-cw-navy/70 ring-cw-navy/10",
  teal: "bg-cw-teal-soft text-cw-teal-dark ring-cw-teal/25",
  amber: "bg-cw-yellow-soft text-[#8a6a04] ring-cw-yellow/45",
  green: "bg-[#e7f5ec] text-[#1a7a45] ring-[#1a7a45]/20",
  red: "bg-[#fdecec] text-[#b3261e] ring-[#b3261e]/20",
  peach: "bg-cw-peach-soft text-[#a3572a] ring-cw-peach/50",
};

/**
 * The same six tones as a filled block with a solid left edge — for the timeline
 * bars, which have to read as a colour from across the room rather than as a
 * small pill of text.
 *
 * Deliberately derived from the SAME status→tone map as the pills below: a
 * booking that shows as amber in a table must not show as green on the calendar,
 * and the only way to guarantee that is for both to look the tone up once.
 */
const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-cw-navy/10 text-cw-navy/80 border-cw-navy/25",
  teal: "bg-cw-teal-soft text-cw-teal-dark border-cw-teal",
  amber: "bg-cw-yellow-soft text-[#7a5d03] border-cw-yellow",
  green: "bg-[#e7f5ec] text-[#146237] border-[#1a7a45]",
  red: "bg-[#fdecec] text-[#b3261e] border-[#b3261e]",
  peach: "bg-cw-peach-soft text-[#8f4a22] border-cw-peach",
};

/**
 * One map for every status vocabulary in the schema. Colour carries meaning
 * consistently across the CRM: amber is "needs a decision", green is "settled",
 * red is "wrong", teal is "on track", grey is "over and done".
 */
const STATUS_TONE: Record<string, Tone> = {
  // booking_status
  pending: "amber",
  confirmed: "teal",
  active: "peach",
  completed: "neutral",
  cancelled: "red",
  // payment_status ('pending' shared with the above, same amber meaning)
  unpaid: "red",
  paid: "green",
  refunded: "neutral",
  // prep_status
  booked: "neutral",
  needs_prep: "amber",
  ready: "green",
  out: "peach",
  returned: "neutral",
};

/** The tone for a status string, for anything that needs the colour without the
 *  pill — timeline bars, pipeline steps, filter chips. */
export function statusTone(value: string): Tone {
  return STATUS_TONE[value] ?? "neutral";
}

export function toneBarClass(value: string): string {
  return TONE_BAR[statusTone(value)];
}

export function StatusPill({ value, title }: { value: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${
        TONE_CLASS[statusTone(value)]
      }`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

/* ── empty state ─────────────────────────────────────────────────────────── */

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-[13px] text-cw-ink/50">{children}</div>;
}

/* ── trends ──────────────────────────────────────────────────────────────── */

/**
 * The two money series on this dashboard measure different things (cash
 * collected vs. bookings taken), so they are drawn in different colours
 * everywhere they appear. Keeping the mapping in one place is what stops a
 * later panel from quietly swapping them and making the pair meaningless.
 */
export type MetricAccent = "collected" | "booked";

const ACCENT_BAR: Record<MetricAccent, string> = {
  collected: "fill-cw-teal",
  booked: "fill-cw-navy",
};

const ACCENT_DOT: Record<MetricAccent, string> = {
  collected: "bg-cw-teal",
  booked: "bg-cw-navy",
};

const ACCENT_CARD: Record<MetricAccent, string> = {
  collected: "border-cw-teal/30 bg-cw-teal-soft/50",
  booked: "border-cw-navy/20 bg-cw-navy/[0.04]",
};

/**
 * Fourteen-day bars. Hand-rolled SVG rather than a chart library: this is a
 * sparkline with no axes, no tooltip and no interaction, and recharts would cost
 * more bytes than the whole dashboard.
 *
 * An all-zero fortnight is drawn as a flat baseline instead of dividing by a max
 * of zero.
 */
export function TrendBars({
  points,
  labelFor,
  ariaLabel,
  accent,
  className = "h-16 w-full",
}: {
  points: { date: string; cents: number }[];
  labelFor: (date: string, cents: number) => string;
  ariaLabel: string;
  accent: MetricAccent;
  className?: string;
}) {
  const max = Math.max(...points.map((p) => p.cents), 0);
  const gap = 3;
  const width = points.length * 10;

  return (
    <svg
      viewBox={`0 0 ${width} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      {points.map((p, i) => {
        const h = max === 0 ? 1 : Math.max(1, (p.cents / max) * 36);
        return (
          <rect
            key={p.date}
            x={i * 10}
            y={40 - h}
            width={10 - gap}
            height={h}
            rx={1.5}
            className={p.cents > 0 ? ACCENT_BAR[accent] : "fill-cw-navy/12"}
          >
            <title>{labelFor(p.date, p.cents)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/**
 * A headline monthly figure with its date basis, its own 14-day trend, and a
 * month-over-month delta.
 *
 * WHY THE DATE BASIS IS IN THE LABEL, NOT A FOOTNOTE
 * The dashboard carries two monthly money figures that will rarely agree, and
 * the failure mode is not a wrong number — it is Clay reading the larger one as
 * "this month's takings". So each card states what it counts and when it counts
 * it, right next to the figure: a colour-coded qualifier chip in the header, and
 * a plain-English sentence under the value. The two cards are also given
 * different accent colours, carried through to their bars, so they stay
 * distinguishable at a glance from across the office.
 */
export function MetricCard({
  label,
  basis,
  period,
  value,
  explain,
  footnote,
  delta,
  trend,
  accent,
}: {
  /** What is being measured, e.g. "Revenue collected". */
  label: string;
  /** The date basis, e.g. "by pickup date". Always shown beside the label. */
  basis: string;
  /** e.g. "July 2026". */
  period: string;
  value: string;
  /** One sentence saying what does and does not count. */
  explain: string;
  /** Secondary figure, e.g. "8 rentals". */
  footnote?: string;
  delta: { pct: number | null; label: string };
  trend: {
    points: { date: string; cents: number }[];
    labelFor: (date: string, cents: number) => string;
    startLabel: string;
    endLabel: string;
  };
  accent: MetricAccent;
}) {
  return (
    <section className={`min-w-0 rounded-xl border px-4 py-3.5 ${ACCENT_CARD[accent]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-[0.08em] text-cw-navy">
          <span aria-hidden className={`h-2 w-2 rounded-full ${ACCENT_DOT[accent]}`} />
          {label}
        </h2>
        <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-cw-ink/70 ring-1 ring-inset ring-cw-navy/10">
          {basis}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[30px] font-extrabold leading-none tabular-nums tracking-tight text-cw-navy">
          {value}
        </span>
        <span className="text-[12px] font-semibold text-cw-ink/60">{period}</span>
        {delta.pct != null ? (
          <span
            className={`text-[12px] font-semibold tabular-nums ${
              delta.pct >= 0 ? "text-[#1a7a45]" : "text-[#b3261e]"
            }`}
          >
            {delta.pct >= 0 ? "▲" : "▼"} {Math.abs(delta.pct)}% {delta.label}
          </span>
        ) : (
          <span className="text-[12px] text-cw-ink/45">{delta.label} unavailable</span>
        )}
      </div>

      <p className="mt-1.5 text-[12px] leading-relaxed text-cw-ink/65">
        {explain}
        {footnote && <span className="font-semibold text-cw-ink/80"> {footnote}</span>}
      </p>

      <TrendBars
        className="mt-3 h-[70px] w-full"
        accent={accent}
        points={trend.points}
        labelFor={trend.labelFor}
        ariaLabel={`${label}, ${basis}, last 14 days`}
      />
      <div className="mt-1 flex justify-between text-[11px] text-cw-ink/45">
        <span>{trend.startLabel}</span>
        <span>Last 14 days</span>
        <span>{trend.endLabel}</span>
      </div>
    </section>
  );
}

/* ── buttons ─────────────────────────────────────────────────────────────── */

/**
 * The CRM's button. Three weights, because the back office only needs three:
 * `primary` for the one action a screen is for (advance the pipeline, save the
 * notes), `secondary` for everything else, `danger` for the one that undoes.
 *
 * A native <button> with an explicit `type` — never a div with an onClick — so
 * keyboard, focus ring and form semantics come for free.
 */
export function Button({
  children,
  onClick,
  type = "button",
  variant = "secondary",
  disabled = false,
  size = "md",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  const variants = {
    primary: "border-cw-teal bg-cw-teal text-white hover:bg-cw-teal-dark hover:border-cw-teal-dark",
    secondary: "border-cw-navy/15 bg-white text-cw-navy hover:border-cw-teal hover:text-cw-teal",
    danger: "border-[#b3261e]/25 bg-white text-[#b3261e] hover:border-[#b3261e]",
  };

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-display font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
        size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/* ── labelled values ─────────────────────────────────────────────────────── */

/**
 * One fact on the detail page. An em dash for an absent value rather than an
 * empty gap: "we have no flight number" and "this field failed to render" must
 * not look the same.
 */
export function Field({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Tabular figures, for references and phone numbers. */
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
        {label}
      </p>
      <p
        className={`mt-0.5 text-[13px] ${empty ? "text-cw-ink/35" : "text-cw-ink"} ${
          mono ? "tabular-nums" : ""
        }`}
      >
        {empty ? "—" : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-cw-ink/45">{hint}</p>}
    </div>
  );
}

/* ── tables ──────────────────────────────────────────────────────────────── */

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-cw-ink/50 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-[13px] text-cw-ink ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
