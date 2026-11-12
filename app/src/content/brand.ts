/**
 * CW Car Rental. Brand voice and content, the single copy source.
 * "The friend in Curacao who happens to run a car rental."
 * Naming rule: "CW Car Rental" in legal and footer contexts, "CW" everywhere else.
 * Copy rule: no em or en dashes anywhere visible.
 */

export const POSITIONING =
  'Think of us as the friend in Curaçao who happens to run a car rental.'

export const MISSION =
  'Give every guest the freedom to explore Curaçao without a single worry, through quality vehicles, honest service, and real local hospitality.'

export const VISION =
  'Become a trusted, proudly local name in car rental that gives every visitor freedom, confidence, and warmth.'

export const FOUNDER_NAME = 'Clay Winklaar'

export const FOUNDER_QUOTE =
  'I always loved seeing people enjoy the place I call home. Helping them explore it, that means a lot to me.'

/**
 * Real contact details, confirmed with Clay. THE single source for the phone
 * number: `phone` is the display form, `whatsapp` is the same number in E.164.
 * Every tel: link, wa.me link, email and screen reads it from here (via
 * PHONE_HREF and WHATSAPP_URL below), so changing the number is a one-line edit.
 * There is no Facebook page, so none is listed. `email` is still unconfirmed:
 * cwcarrental.com was not registered as of Oct 2026, so it cannot receive mail.
 */
export const CONTACT = {
  email: 'hello@cwcarrental.com',
  phone: '+599 9 521 8775',
  whatsapp: '+59995218775',
  instagram: 'https://www.instagram.com/cw_car_rentals/',
}

/** `tel:` target for CONTACT.phone. */
export const PHONE_HREF = `tel:${CONTACT.whatsapp}`

/** wa.me wants the number as bare digits, no plus. */
export const WHATSAPP_URL = `https://wa.me/${CONTACT.whatsapp.replace(/\D/g, '')}`

export interface Value {
  name: string
  /** Tailwind class for the chapter's colour wash, laid over `image`. */
  ground: 'bg-cw-yellow' | 'bg-cw-peach' | 'bg-cw-mint' | 'bg-cw-teal'
  /** Full-bleed island photo behind the wash. */
  image: string
  /** Alt text is empty on render (decorative); this is the described place. */
  place: string
  /** CSS object-position for `image`, when the subject is not in the middle
   *  and a tall crop would otherwise cut it off. Defaults to centre. */
  focus?: string
  description: string
}

/**
 * Each chapter pairs a brand colour with an island photo. Reliable and
 * Experience match the About page's waypoints (peach/Westpunt,
 * mint/Willemstad); Trust deliberately takes teal here rather than the
 * waypoints' yellow for Hofi Mango.
 */
export const VALUES: Value[] = [
  {
    name: 'Trust',
    ground: 'bg-cw-teal',
    image: '/assets/about/hofi-mango-cw-image.png',
    place: 'the gardens and old mill tower at Hofi Mango',
    // The photo is a wide panorama with the yellow tower right of centre.
    focus: '66% 50%',
    description:
      "You know exactly what you're getting: the car you booked, the price you agreed to, no surprises at the counter.",
  },
  {
    name: 'Reliable',
    ground: 'bg-cw-peach',
    image: '/assets/about/westpunt-cw-image.png',
    place: 'the coast road out to Westpunt',
    description:
      "Every car checked before every handover. If something's wrong, we fix it before you ever see it.",
  },
  {
    name: 'Experience',
    ground: 'bg-cw-mint',
    image: '/assets/about/willemstad-cw-images.png',
    place: 'the waterfront in Willemstad',
    description:
      "We're not behind a counter, we're on the island. Ask us anything: the roads, the beaches, the best lunch spot.",
  },
]

export interface Vehicle {
  id: string
  name: string
  /** Shown wherever two of the same model exist (the two Versas). */
  colorNote: string
  tagline: string
  seats: number
  transmission: 'Automatic' | 'Manual'
  /** Whole XCG per rental day. Mirrors cars.daily_rate in the
   *  database (which is in cents) — the marketing grid is static content, so
   *  the two are kept in step by hand whenever rates move. */
  pricePerDay: number
  /** Whole XCG for a ~30-day monthly rental. Flat, not 30 x pricePerDay.
   *  Mirrors cars.monthly_rate. */
  pricePerMonth: number
  flagship?: boolean
  photo: string
  /** Accent assigned to this car across cards and wizard. */
  accent: 'peach' | 'yellow' | 'mint' | 'pink' | 'teal'
}

/** The real CW fleet, at the confirmed XCG price list (Aug 2026). A daily
 *  rental is days x pricePerDay and a monthly one is pricePerMonth, flat;
 *  see quoteRental in src/lib/booking/rental.ts. */
export const FLEET: Vehicle[] = [
  {
    id: 'mazda-3-grey',
    name: 'Mazda 3',
    colorNote: 'Grey',
    tagline: 'The sharp one. Comfortable on long days, happy on the road to Westpunt.',
    seats: 5,
    transmission: 'Automatic',
    pricePerDay: 70,
    pricePerMonth: 1900,
    photo: '/assets/fleet/mazda-3-grey-900.webp',
    accent: 'yellow',
  },
  {
    id: 'nissan-versa-red',
    name: 'Nissan Versa',
    colorNote: 'Red',
    tagline: 'The reliable all rounder. Beach bags fit, fuel bills stay tiny.',
    seats: 5,
    transmission: 'Automatic',
    pricePerDay: 70,
    pricePerMonth: 1900,
    photo: '/assets/fleet/nissan-versa-red-900.webp',
    accent: 'mint',
  },
  {
    id: 'nissan-versa-silver',
    name: 'Nissan Versa',
    colorNote: 'Silver',
    tagline: 'Same easy Versa in cool silver, great for families heading to Hofi Mango.',
    seats: 5,
    transmission: 'Automatic',
    pricePerDay: 70,
    pricePerMonth: 1900,
    photo: '/assets/fleet/nissan-versa-silver-900.webp',
    accent: 'pink',
  },
  {
    id: 'chevrolet-spark-black',
    name: 'Chevrolet Spark',
    colorNote: 'Black',
    tagline: 'Small, nimble, perfect for Willemstad streets and easy parking.',
    seats: 4,
    transmission: 'Automatic',
    pricePerDay: 60,
    pricePerMonth: 1600,
    photo: '/assets/fleet/chevrolet-spark-black-900.webp',
    accent: 'teal',
  },
]

export interface Testimonial {
  /** Stable key. Any unique string; not shown.  */
  id: string
  name: string
  /** Where they travelled from. Shown small under the name; may be ''. */
  from: string
  /** 1 to 5. Anything under 5 renders the remaining stars hollow. */
  rating: 1 | 2 | 3 | 4 | 5
  /** Two or three sentences. No surrounding quote marks, the section adds them. */
  quote: string
}

/**
 * PLACEHOLDER testimonials. Written in CW's voice so the section reads true
 * before real reviews exist, but none of these are real guests.
 *
 * To swap in real ones: replace the objects below and nothing else. The
 * carousel reads length, order and rating straight off this array, so adding a
 * sixth or dropping to three needs no code change. Keep quotes to roughly two
 * or three sentences: the section sizes itself to the longest one.
 */
export const TESTIMONIALS: Testimonial[] = [
  {
    id: 'marieke-tom',
    name: 'Marieke & Tom van der Berg',
    from: 'Utrecht, Netherlands',
    rating: 5,
    quote:
      'We landed late and still had the keys in hand ten minutes after baggage claim. No counter, no queue, just someone waiting for us outside with a smile. That set the tone for the whole week.',
  },
  {
    id: 'danielle-foster',
    name: 'Danielle Foster',
    from: 'Austin, Texas',
    rating: 5,
    quote:
      'We drove the Venue all the way out to Westpunt on our second day and it took the coast road beautifully. They told us where to stop for lunch on the way, which is the kind of thing you only get from someone who actually lives here.',
  },
  {
    id: 'jerome-baptiste',
    name: 'Jerome Baptiste',
    from: 'Montreal, Canada',
    rating: 5,
    quote:
      'Parking in Willemstad is its own sport, so the little Spark was exactly right. Punda one morning, Otrobanda the next, and we never circled the block twice.',
  },
  {
    id: 'sofia-ricci',
    name: 'Sofia Ricci',
    from: 'Milan, Italy',
    rating: 5,
    quote:
      'The car was spotless and the price at the end was the price we agreed on, with nothing added. After a few bad rental experiences elsewhere, that alone was worth writing about.',
  },
  {
    id: 'nathan-priya',
    name: 'Nathan & Priya Mehta',
    from: 'London, UK',
    rating: 5,
    quote:
      'Travelling with two kids means the small things matter, and CW made all of them easy. They met us at the hotel, walked us through the car properly, and answered every WhatsApp question within a minute.',
  },
]

export interface PickupLocation {
  id: string
  /** What an old booking that stored the bare `id` is displayed as. */
  label: string
  /** The quick-fill chip's own short text. */
  chip: string
  /** What tapping the chip writes into the address field. The hotel chip
   *  writes a prefix for the guest to finish, since "your hotel" is not an
   *  address anyone can drive to. */
  fill: string
}

/**
 * Pickup and drop-off are FREE-TEXT addresses anywhere in Curaçao (Terms 5.2:
 * CW delivers and collects anywhere on the island). These three are only
 * quick-fill chips beside the field, for the answers most guests give.
 */
export const PICKUP_LOCATIONS: PickupLocation[] = [
  {
    id: 'airport',
    label: 'Curaçao International Airport (CUR)',
    chip: 'Airport (CUR)',
    fill: 'Curaçao International Airport (CUR)',
  },
  {
    id: 'willemstad',
    label: 'Willemstad, Punda or Otrobanda',
    chip: 'Willemstad',
    fill: 'Willemstad',
  },
  { id: 'hotel', label: 'Your hotel or resort', chip: 'Your hotel', fill: 'Hotel: ' },
]

/** Longest address the booking form and the server accept. */
export const LOCATION_MAX_LENGTH = 200

/** Shown under both address fields. */
export const LOCATION_HELPER = 'Anywhere in Curaçao'

/**
 * A stored pickup or drop-off location, as it should be shown.
 *
 * Locations are free text now, but the field was once a dropdown, and a booking
 * that stored the option's id ("airport") must not be shown to Clay or a guest
 * as that bare word. Anything that is not one of those ids is already an
 * address and is returned as written. Use this at every place a booking's
 * location is read for display.
 */
export function locationLabel(stored: string | null | undefined): string {
  const value = (stored ?? '').trim()
  return PICKUP_LOCATIONS.find((l) => l.id === value.toLowerCase())?.label ?? value
}

/** True when the hotel chip's prefix was left unfinished ("Hotel:"). */
export function isUnfinishedLocation(value: string): boolean {
  return /^hotel\s*:?\s*$/i.test(value.trim())
}

/** Island waypoints for the About page, in display order: Westpunt, Hofi
 *  Mango, Willemstad. Real places, local tone. */
export const WAYPOINTS = [
  {
    name: 'Westpunt',
    accent: 'peach',
    image: '/assets/about/westpunt-cw-image.png',
    focus: undefined as string | undefined,
    note: 'Cliff jumps at Playa Forti, grouper lunches at the beach shacks. Take the coast road slow.',
  },
  {
    name: 'Hofi Mango',
    accent: 'yellow',
    image: '/assets/about/hofi-mango-cw-image.png',
    // Wide panorama, yellow tower right of centre: keep it in the tall crop.
    focus: '68% 50%',
    note: 'An old plantation garden out west. Shady trails under giant mango trees, and the yellow mill tower you cannot miss.',
  },
  {
    name: 'Willemstad',
    accent: 'mint',
    image: '/assets/about/willemstad-cw-images.png',
    focus: undefined as string | undefined,
    note: 'Punda for the postcard, Otrobanda for the real thing. Park the car, cross the swinging bridge.',
  },
] as const
