import type { ReactNode } from "react";

/**
 * The navy page and white card shared by the signed-out admin pages (forgot
 * password, reset password). The login page predates this and keeps its own
 * copy of the same markup.
 */
export function AuthCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cw-navy px-5 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex rounded-xl bg-white px-3 py-2">
            <img
              src="/assets/cw-logo-lockup-480.png"
              alt=""
              className="h-9 w-auto select-none"
              draggable={false}
            />
          </span>
          <span className="font-display text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] text-white/55">
            Back office
          </span>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          {children}
        </div>
        {footer && <p className="mt-4 text-center text-[12px] text-white/45">{footer}</p>}
      </div>
    </main>
  );
}

export const authInputClass =
  "mt-1.5 w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2.5 text-[14px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

export const authLabelClass = "block text-[12px] font-semibold text-cw-ink/70";

export const authButtonClass =
  "mt-5 w-full rounded-lg bg-cw-teal px-4 py-2.5 font-display text-[14px] font-bold text-white transition-colors hover:bg-cw-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
