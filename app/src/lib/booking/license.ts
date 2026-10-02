/**
 * Driver's license photo constants, shared by the wizard (which uploads) and
 * the server (which issues upload slots and validates what comes back).
 *
 * The photo goes from the browser straight to Storage, never through our
 * server, but on a path and with a token the server issued. The bucket is
 * private with no RLS policies at all (migration 0007), so a signed upload URL
 * is the ONLY way anything gets into it from outside, and nothing comes out
 * except through the service role.
 */

export const LICENSE_BUCKET = "license-photos";

/** Image types the bucket accepts, mapped to the extension the key gets. The
 *  bucket enforces the same list itself; this is so a refusal happens before
 *  an upload rather than after it. */
export const LICENSE_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Mirrors the bucket's file_size_limit. */
export const LICENSE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** The only shape of key the server ever hands out. createBooking refuses any
 *  other, so a request cannot point a client row at an arbitrary object. */
export const LICENSE_PHOTO_PATH_RE = /^licenses\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$/;
