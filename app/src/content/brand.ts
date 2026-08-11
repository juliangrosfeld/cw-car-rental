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

/** Contact placeholders. Confirm the real ones with Clay before launch. */
export const CONTACT = {
  email: 'hello@cwcarrental.com',
  phone: '+599 9 123 4567',
  whatsapp: '+59991234567',
  instagram: 'https://instagram.com/cwcarrental',
  facebook: 'https://facebook.com/cwcarrental',
}

export interface Value {
  name: string
  /** Tailwind class for the chapter's colour wash, laid over `image`. */
  ground: 'bg-cw-yellow' | 'bg-cw-peach' | 'bg-cw-mint'
  /** Full-bleed island photo behind the wash. */
  image: string
  /** Alt text is empty on render (decorative); this is the described place. */
  place: string
  description: string
}

/**
 * Each chapter pairs a brand colour with an island photo. The colour->photo
 * pairings are the ones the About page's waypoints already use (peach/Westpunt,
 * yellow/Shete Boka, mint/Willemstad), so a place always arrives in the same
 * colour wherever it appears on the site.
 */
export const VALUES: Value[] = [
  {
    name: 'Trust',
    ground: 'bg-cw-yellow',
    image: '/assets/about/sheteboka-cw-image.png',
    place: 'the north coast at Shete Boka',
    description:
      "You know exactly what you're getting — the car you booked, the price you agreed to, no surprises at the counter.",
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
      "We're not behind a counter, we're on the island. Ask us anything — the roads, the beaches, the best lunch spot.",
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
  /** Whole XCG per rental day, undiscounted. Mirrors cars.daily_rate in the
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

/** The real CW fleet, at the confirmed XCG price list (Aug 2026). Length
 *  discounts are NOT baked into these numbers — they are applied by the server
 *  at quote time; see DISCOUNT_TIERS in src/lib/booking/rental.ts. */
export const FLEET: Vehicle[] = [
  {
    id: 'hyundai-venue-red',
    name: 'Hyundai Venue',
    colorNote: 'Red',
    tagline: 'Our flagship, the red SUV from the hero. Compact outside, easy everywhere.',
    seats: 5,
    transmission: 'Automatic',
    pricePerDay: 100,
    pricePerMonth: 2600,
    flagship: true,
    photo: '/assets/fleet/hyundai-venue-red-900.webp',
    accent: 'peach',
  },
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
    tagline: 'Same easy Versa in cool silver, great for families heading to Shete Boka.',
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
      'Travelling with two kids means the small things matter, and CW made all of them easy. They met us at the hotel, walked us through the car properly, and answered a WhatsApp about the road to Shete Boka within a minute.',
  },
]

export interface PickupLocation {
  id: string
  label: string
}

export const PICKUP_LOCATIONS: PickupLocation[] = [
  { id: 'airport', label: 'Curaçao International Airport (CUR)' },
  { id: 'willemstad', label: 'Willemstad, Punda or Otrobanda' },
  { id: 'hotel', label: 'Your hotel or resort' },
]

/** Island waypoints for the About page. Real places, local tone. */
export const WAYPOINTS = [
  {
    name: 'Westpunt',
    accent: 'peach',
    image: '/assets/about/westpunt-cw-image.png',
    note: 'Cliff jumps at Playa Forti, grouper lunches at the beach shacks. Take the coast road slow.',
  },
  {
    name: 'Shete Boka',
    accent: 'yellow',
    image: '/assets/about/sheteboka-cw-image.png',
    note: 'Seven inlets where the north coast hits back. Boka Tabla thunders after a windy night.',
  },
  {
    name: 'Willemstad',
    accent: 'mint',
    image: '/assets/about/willemstad-cw-images.png',
    note: 'Punda for the postcard, Otrobanda for the real thing. Park the car, cross the swinging bridge.',
  },
] as const
