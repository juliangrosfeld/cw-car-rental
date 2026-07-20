import { FLEET, type Vehicle } from '../../content/brand'

/**
 * Booking domain data and helpers.
 *
 * Availability is SAMPLE DATA: per-vehicle blocked-out days relative to
 * today. Replace VEHICLE_UNAVAILABLE with the live source when the booking
 * backend exists; everything else (pricing, range math) stays.
 *
 * Day model: a rental occupies [pickup, dropoff). The car comes back on the
 * morning of the drop-off day, so that day can start someone else's booking.
 */

export const DAY_MS = 86_400_000

export const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

const blocked = (offsets: number[]) =>
  new Set(offsets.map((o) => toKey(new Date(Date.now() + o * DAY_MS))))

/** Sample blocked days per vehicle id. Replace with the live source. */
export const VEHICLE_UNAVAILABLE: Record<string, Set<string>> = {
  'hyundai-venue-red': blocked([3, 4, 5, 17, 18]),
  'chevrolet-spark-black': blocked([6, 7, 11, 12, 13]),
  'mazda-3-grey': blocked([3, 4, 20, 21, 22]),
  'nissan-versa-red': blocked([9, 10, 25, 26]),
  'nissan-versa-silver': blocked([3, 4, 5, 6, 7, 8, 9]),
}

/** True if this vehicle is free every day of [pickup, dropoff). */
export function vehicleFree(vehicleId: string, pickup: Date, dropoff: Date) {
  const days = VEHICLE_UNAVAILABLE[vehicleId]
  if (!days) return true
  for (let t = pickup.getTime(); t < dropoff.getTime(); t += DAY_MS) {
    if (days.has(toKey(new Date(t)))) return false
  }
  return true
}

/** Fleet split for a date range: bookable cars first, then the taken ones. */
export function splitFleet(pickup: Date, dropoff: Date) {
  const available: Vehicle[] = []
  const unavailable: Vehicle[] = []
  for (const v of FLEET) {
    ;(vehicleFree(v.id, pickup, dropoff) ? available : unavailable).push(v)
  }
  return { available, unavailable }
}

/** True when EVERY car is blocked on this day (calendar hard-disable). */
export function dayFullyBooked(day: Date) {
  const key = toKey(day)
  return FLEET.every((v) => VEHICLE_UNAVAILABLE[v.id]?.has(key))
}

export function rentalDays(pickup: Date, dropoff: Date) {
  return Math.max(1, Math.round((dropoff.getTime() - pickup.getTime()) / DAY_MS))
}

export function quote(vehicle: Vehicle, pickup: Date, dropoff: Date) {
  const days = rentalDays(pickup, dropoff)
  return { days, perDay: vehicle.pricePerDay, total: days * vehicle.pricePerDay }
}
