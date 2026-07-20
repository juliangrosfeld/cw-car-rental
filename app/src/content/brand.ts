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
  /** Tailwind class for the chapter ground. */
  ground: 'bg-cw-yellow' | 'bg-cw-peach' | 'bg-cw-mint'
  description: string
}

export const VALUES: Value[] = [
  {
    name: 'Pride',
    ground: 'bg-cw-yellow',
    description:
      'Every car is a small ambassador for Curaçao. That one is non negotiable: you get a car we would proudly hand to family.',
  },
  {
    name: 'Hospitality',
    ground: 'bg-cw-peach',
    description:
      'Every guest is family, never a booking number. From first message to drop off, you deal with people who care.',
  },
  {
    name: 'Respect',
    ground: 'bg-cw-mint',
    description:
      'Kept promises, a clean car, honest words, and patience. Always. That is the deal.',
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
  pricePerDay: number
  flagship?: boolean
  photo: string
  /** Accent assigned to this car across cards and wizard. */
  accent: 'peach' | 'yellow' | 'mint' | 'pink' | 'teal'
}

/** The real CW fleet. Prices are placeholders, confirm with Clay before launch. */
export const FLEET: Vehicle[] = [
  {
    id: 'hyundai-venue-red',
    name: 'Hyundai Venue',
    colorNote: 'Red',
    tagline: 'Our flagship, the red SUV from the hero. Compact outside, easy everywhere.',
    seats: 5,
    transmission: 'Automatic',
    pricePerDay: 55,
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
    pricePerDay: 52,
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
    pricePerDay: 45,
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
    pricePerDay: 45,
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
    pricePerDay: 35,
    photo: '/assets/fleet/chevrolet-spark-black-900.webp',
    accent: 'teal',
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
    tint: 'bg-cw-peach-soft',
    note: 'Cliff jumps at Playa Forti, grouper lunches at the beach shacks. Take the coast road slow.',
  },
  {
    name: 'Shete Boka',
    tint: 'bg-cw-yellow-soft',
    note: 'Seven inlets where the north coast hits back. Boka Tabla thunders after a windy night.',
  },
  {
    name: 'Willemstad',
    tint: 'bg-cw-mint-soft',
    note: 'Punda for the postcard, Otrobanda for the real thing. Park the car, cross the swinging bridge.',
  },
]
