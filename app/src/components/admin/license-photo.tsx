/**
 * A client's driver's license photo, for the CRM: thumbnail, click to enlarge,
 * and a download button.
 *
 * THE LINK IS SHORT-LIVED BY DESIGN (about 60 seconds, see
 * lib/admin/licenses.server.ts), so this component treats "the URL has expired"
 * as the normal case rather than an error:
 *   · it fetches a link when it mounts;
 *   · enlarging or downloading after the link has aged asks for a fresh one
 *     first, so a page left open for an hour still works on the first click;
 *   · an <img> that fails to load triggers ONE refetch before giving up, which
 *     covers a link that expired between being issued and being drawn.
 *
 * It takes a CLIENT ID, never a path or a URL: the server decides which object
 * that is. Nothing here can be pointed at an arbitrary file.
 *
 * FILES THAT CANNOT BE DRAWN. iPhones save HEIC, which Chrome and Firefox do
 * not render, and a PDF is not an image at all. Both get a labelled tile with
 * Open and Download instead of a broken picture.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLicensePhoto } from "../../lib/api/admin.functions";
import type { LicensePhotoLink } from "../../lib/admin/types";

type Ok = Extract<LicensePhotoLink, { status: "ok" }>;

type State =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; link: LicensePhotoLink };

/** Refresh a link this long before it actually dies, so a click never races
 *  the expiry. */
const EXPIRY_MARGIN_MS = 10_000;

const isFresh = (link: Ok) => link.expiresAt - Date.now() > EXPIRY_MARGIN_MS;

export function LicensePhoto({
  clientId,
  hasPhoto,
  guestName,
  size = "md",
}: {
  clientId: string;
  /** From the record. When false nothing is fetched at all. */
  hasPhoto: boolean;
  guestName: string;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [enlarged, setEnlarged] = useState(false);
  /** The <img> could not draw the file even with a fresh link. */
  const [undrawable, setUndrawable] = useState(false);
  const retried = useRef(false);

  const load = useCallback(async (): Promise<LicensePhotoLink | null> => {
    try {
      const link = await fetchLicensePhoto({ data: { clientId } });
      setState({ phase: "ready", link });
      return link;
    } catch {
      setState({ phase: "error" });
      return null;
    }
  }, [clientId]);

  useEffect(() => {
    if (!hasPhoto) return;
    retried.current = false;
    setUndrawable(false);
    setState({ phase: "loading" });
    void load();
  }, [hasPhoto, load]);

  // Close the enlarged view on Escape.
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEnlarged(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged]);

  const box = size === "sm" ? "h-14 w-20" : "h-28 w-44";
  const tile = `flex ${box} shrink-0 items-center justify-center rounded-lg border border-cw-navy/12 bg-cw-navy/[0.03] px-2 text-center text-[11px] leading-tight text-cw-ink/55`;

  if (!hasPhoto) return <div className={tile}>No photo on file</div>;
  if (state.phase === "loading") return <div className={`${tile} animate-pulse`}>Loading…</div>;
  if (state.phase === "error") {
    return (
      <button type="button" onClick={() => void load()} className={`${tile} hover:border-cw-teal`}>
        Could not load. Retry
      </button>
    );
  }

  const link = state.link;
  if (link.status === "none") return <div className={tile}>No photo on file</div>;
  if (link.status === "missing") {
    return (
      <div className={`${tile} border-[#b3261e]/30 text-[#b3261e]`} role="alert">
        Photo file is missing from storage
      </div>
    );
  }

  /** A link that is still good, fetching a new one if this one has aged. */
  const freshLink = async (): Promise<Ok | null> => {
    if (isFresh(link)) return link;
    const next = await load();
    return next?.status === "ok" ? next : null;
  };

  const enlarge = async () => {
    if (await freshLink()) setEnlarged(true);
  };

  const download = async () => {
    const fresh = await freshLink();
    if (!fresh) return;
    // The signed URL carries Content-Disposition: attachment, so navigating to
    // it saves the file and leaves this page where it is.
    const a = document.createElement("a");
    a.href = fresh.downloadUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openInTab = async () => {
    const fresh = await freshLink();
    if (fresh) window.open(fresh.url, "_blank", "noopener,noreferrer");
  };

  const onImgError = () => {
    // Once: the link may simply have expired before the browser drew it.
    if (!retried.current) {
      retried.current = true;
      void load();
      return;
    }
    setUndrawable(true);
  };

  const drawable = link.kind === "image" && !undrawable;
  const kindLabel =
    link.kind === "heic"
      ? "HEIC photo. This browser cannot preview it"
      : link.kind === "pdf"
        ? "PDF document"
        : "Preview not available";

  const linkButton =
    "text-[12px] font-semibold text-cw-teal underline underline-offset-2 hover:text-cw-teal-dark";

  return (
    <div className="flex flex-wrap items-start gap-3">
      {drawable ? (
        <button
          type="button"
          onClick={() => void enlarge()}
          title="Click to enlarge"
          className={`${box} shrink-0 overflow-hidden rounded-lg border border-cw-navy/12 bg-cw-navy/[0.03] transition-shadow hover:ring-2 hover:ring-cw-teal/40`}
        >
          <img
            // Keyed on the URL so a refreshed link remounts the element and a
            // previous load error does not stick to the new one.
            key={link.url}
            src={link.url}
            alt={`Driver's license of ${guestName}`}
            onError={onImgError}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className={tile}>{kindLabel}</div>
      )}

      <div className="flex flex-col items-start gap-1.5 pt-0.5">
        {drawable ? (
          <button type="button" onClick={() => void enlarge()} className={linkButton}>
            Enlarge
          </button>
        ) : (
          <button type="button" onClick={() => void openInTab()} className={linkButton}>
            Open in new tab
          </button>
        )}
        <button type="button" onClick={() => void download()} className={linkButton}>
          Download
        </button>
      </div>

      {enlarged && drawable && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Driver's license of ${guestName}`}
          onClick={() => setEnlarged(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-cw-navy/80 p-4"
        >
          <div className="flex max-h-full max-w-[min(1100px,100%)] flex-col" onClick={(e) => e.stopPropagation()}>
            <img
              key={link.url}
              src={link.url}
              alt={`Driver's license of ${guestName}`}
              onError={onImgError}
              className="max-h-[80vh] w-auto rounded-lg bg-white object-contain"
            />
            <div className="mt-3 flex items-center justify-between gap-4 text-[13px] text-white">
              <span className="truncate">{guestName}</span>
              <span className="flex shrink-0 gap-4">
                <button type="button" onClick={() => void download()} className="font-semibold underline underline-offset-2">
                  Download
                </button>
                <button type="button" onClick={() => setEnlarged(false)} className="font-semibold underline underline-offset-2">
                  Close
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
