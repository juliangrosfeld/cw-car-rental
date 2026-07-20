/**
 * The welcome strip: one centered statement between mint waypoint hairlines.
 * A breather after the 3D journey, before the fleet.
 */
export default function BonBini() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[820px] px-5 py-24 text-center md:py-32">
        <p className="cw-waypoint justify-center text-cw-teal">
          <span className="h-2 w-2 rounded-full bg-cw-mint" />
        </p>
        <h2 className="mt-6 font-display text-[clamp(1.9rem,3.6vw,3rem)] font-extrabold leading-tight tracking-tight text-cw-navy">
          No counters. No queues. Just keys.
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-base leading-relaxed text-cw-ink/85 md:text-lg">
          You land, we meet you, you drive. Booking takes two minutes, and a real person answers
          every message.
        </p>
      </div>
    </section>
  )
}
