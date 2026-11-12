/**
 * Driver's license photos, for the CRM. Service role, RLS bypassed: import ONLY
 * from server functions that have already called requireAdmin().
 *
 * THE BUCKET STAYS PRIVATE. `license-photos` has RLS on and no policies at all
 * (migration 0007), so nothing in a browser can read it. The only way a photo
 * reaches a screen is a SIGNED URL minted here, by the service role, for an
 * admin, and good for about a minute. A link that leaks from a browser history
 * or a screenshot is dead before anyone can use it.
 *
 * THE BROWSER NEVER NAMES AN OBJECT. Every function takes a CLIENT id and reads
 * that client's stored path itself. Accepting a path would let a request ask
 * for any object in the bucket; accepting an id can only ever return the photo
 * that belongs to that record.
 */
import { LICENSE_BUCKET, LICENSE_PHOTO_PATH_RE } from "../booking/license";
import { supabaseAdmin } from "../supabase/admin.server";
import { curacaoNow } from "./clock";
import { licenceLevel, matchesQuery } from "./clients";
import type { LicensePhotoLink, LicenseRow, LicensesListData } from "./types";

/** Seconds a signed URL lives. Long enough to load and to click Download,
 *  short enough that a copied link is useless. The viewer asks for a fresh one
 *  whenever it needs to. */
export const LICENSE_URL_TTL_SECONDS = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How the viewer should treat a file, from its extension. Chrome and Firefox
 *  cannot draw HEIC, and a PDF is not an <img> at all, so both get a
 *  download-first tile instead of a broken picture. */
function fileKind(path: string): "image" | "heic" | "pdf" | "other" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["heic", "heif"].includes(ext)) return "heic";
  if (ext === "pdf") return "pdf";
  return "other";
}

/** "License - Jane Doe.jpg": what the file is called when Clay saves it. */
function downloadName(fullName: string, path: string): string {
  const ext = path.split(".").pop() ?? "jpg";
  const safe = fullName.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || "guest";
  return `License - ${safe}.${ext}`;
}

/**
 * A short-lived link to one client's license photo.
 *
 * `none` and `missing` are different facts and are reported apart: `none` means
 * no photo was ever attached to this record; `missing` means the record points
 * at an object that is no longer in the bucket, which is worth knowing about.
 */
export async function getLicensePhotoLink(clientId: string): Promise<LicensePhotoLink> {
  if (!UUID_RE.test(clientId)) return { status: "none" };
  const db = supabaseAdmin();

  const { data: client, error } = await db
    .from("clients")
    .select("full_name, license_photo_path")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load client: ${error.message}`);

  const path = client?.license_photo_path;
  if (!client || !path) return { status: "none" };
  // Belt and braces: only keys this app issued are ever signed.
  if (!LICENSE_PHOTO_PATH_RE.test(path)) return { status: "missing" };

  const bucket = db.storage.from(LICENSE_BUCKET);
  const name = downloadName(client.full_name, path);
  const [view, download] = await Promise.all([
    bucket.createSignedUrl(path, LICENSE_URL_TTL_SECONDS),
    bucket.createSignedUrl(path, LICENSE_URL_TTL_SECONDS, { download: name }),
  ]);

  // Storage answers "Object not found" for a key that is not there. Anything
  // else (an outage) is a real error and should look like one.
  if (view.error || download.error) {
    const message = (view.error ?? download.error)!.message;
    if (/not found/i.test(message)) return { status: "missing" };
    throw new Error(`Failed to sign license photo: ${message}`);
  }

  return {
    status: "ok",
    url: view.data.signedUrl,
    downloadUrl: download.data.signedUrl,
    kind: fileKind(path),
    fileName: name,
    expiresAt: Date.now() + LICENSE_URL_TTL_SECONDS * 1000,
  };
}

const LICENSES_DISPLAY_LIMIT = 100;

/**
 * Every client with a license on file, and the bookings each one has, so a
 * photo can be found from a name without knowing which booking it came with.
 *
 * No URLs are signed here: a list of a hundred one-minute links would mostly
 * expire unread. Each row's thumbnail asks for its own link when it is drawn.
 */
export async function getLicensesList(query: string): Promise<LicensesListData> {
  const db = supabaseAdmin();
  const now = curacaoNow();

  const [clientsRes, bookingsRes] = await Promise.all([
    db
      .from("clients")
      .select("id, full_name, email, phone, license_number, license_expiry, license_photo_path, updated_at")
      .or("license_photo_path.not.is.null,license_number.not.is.null")
      .order("updated_at", { ascending: false })
      .limit(2000),
    db
      .from("bookings")
      .select("id, client_id, pickup_date, return_date, booking_status, cars ( model, color )")
      .order("pickup_date", { ascending: false }),
  ]);
  if (clientsRes.error) throw new Error(`Failed to load clients: ${clientsRes.error.message}`);
  if (bookingsRes.error) throw new Error(`Failed to load bookings: ${bookingsRes.error.message}`);

  const byClient = new Map<string, LicenseRow["bookings"]>();
  for (const b of bookingsRes.data ?? []) {
    const car = b.cars as unknown as { model: string; color: string } | null;
    const entry = {
      id: b.id,
      ref: b.id.slice(0, 8),
      pickupDate: b.pickup_date,
      returnDate: b.return_date,
      carLabel: car ? `${car.model}, ${car.color.toLowerCase()}` : "Unknown car",
      cancelled: b.booking_status === "cancelled",
    };
    const list = byClient.get(b.client_id);
    if (list) list.push(entry);
    else byClient.set(b.client_id, [entry]);
  }

  const all: LicenseRow[] = (clientsRes.data ?? []).map((c) => {
    const bookings = byClient.get(c.id) ?? [];
    const lastReturn = bookings
      .filter((b) => !b.cancelled)
      .reduce<string | null>((max, b) => (max && max > b.returnDate ? max : b.returnDate), null);
    return {
      clientId: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      licenseNumber: c.license_number,
      licenseExpiry: c.license_expiry,
      licenceLevel: licenceLevel(c.license_expiry, now.today, lastReturn),
      hasPhoto: Boolean(c.license_photo_path),
      bookings,
    };
  });

  const matched = all.filter((row) => matchesQuery(row, query));
  return {
    query: query.trim(),
    total: matched.length,
    onFile: all.length,
    withPhoto: all.filter((r) => r.hasPhoto).length,
    truncated: matched.length > LICENSES_DISPLAY_LIMIT,
    rows: matched.slice(0, LICENSES_DISPLAY_LIMIT),
  };
}
