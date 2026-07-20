import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FOUNDER_NAME,
  FOUNDER_QUOTE,
  MISSION,
  POSITIONING,
  VISION,
  VALUES,
  WAYPOINTS,
} from "../content/brand";
import { BookCta } from "../components/site/nav";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About CW | The friend in Curaçao" },
      {
        name: "description",
        content:
          "Meet Clay Winklaar and the proudly local car rental he built. Pride, hospitality, and respect, with a full tank of island tips.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="bg-white pt-[72px]">
      <StorySection />
      <WhyCw />
      <VisionMission />
      <Waypoints />
      <ReadyBand />
    </main>
  );
}

/** Editorial offset opener: the Clay story, told the way he'd tell it. */
function StorySection() {
  return (
    <section className="bg-cw-peach-soft">
      <div className="mx-auto grid max-w-[1160px] gap-12 px-5 py-24 md:grid-cols-[1fr_1.1fr] md:gap-20 md:px-8 md:py-32">
        <div className="md:pt-6">
          <p className="cw-waypoint text-cw-teal-dark">
            <span className="h-2 w-2 rounded-full bg-cw-peach" />
          </p>
          <h1 className="mt-6 font-display text-[clamp(2.4rem,4.6vw,4rem)] font-extrabold leading-[1.05] tracking-tight text-cw-navy">
            From the ballpark to the coast road.
          </h1>
        </div>
        <div className="space-y-6 text-base leading-relaxed text-cw-ink/90 md:pt-10 md:text-lg">
          <p>
            {FOUNDER_NAME} is nineteen, born and raised in Curaçao, and spent most of those years
            on a baseball diamond. Professional ball teaches you two things fast: show up
            prepared, and never coast on talent. He runs CW the same way.
          </p>
          <p>
            Every car gets checked before every handover. Every message gets a real answer from a
            real person. And every guest gets the version of Curaçao that locals actually love,
            not the one printed on a brochure.
          </p>
          <blockquote className="border-l-4 border-cw-peach pl-5 font-display text-lg font-bold leading-snug text-cw-navy md:text-xl">
            "{FOUNDER_QUOTE}"
          </blockquote>
        </div>
      </div>
    </section>
  );
}

/** Centered statement: the positioning line gets the whole room. */
function WhyCw() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[900px] px-5 py-24 text-center md:py-32">
        <h2 className="font-display text-[clamp(1.8rem,3.4vw,2.9rem)] font-extrabold leading-tight tracking-tight text-cw-navy">
          {POSITIONING}
        </h2>
        <p className="mx-auto mt-6 max-w-[56ch] text-base leading-relaxed text-cw-ink/85 md:text-lg">
          That friend meets you at the airport, tells you where the grouper is actually good, and
          hands you keys instead of paperwork. Renting local means the money stays on the island
          and the service stays personal.
        </p>
      </div>
    </section>
  );
}

/** Vision and mission as alternating editorial rows, values as a quiet list. */
function VisionMission() {
  return (
    <section className="bg-cw-teal-soft">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="font-display text-xl font-bold text-cw-teal-dark">Where we're going</p>
            <p className="mt-4 text-lg leading-relaxed text-cw-navy">{VISION}</p>
          </div>
          <div className="md:pt-14">
            <p className="font-display text-xl font-bold text-cw-teal-dark">How we get there</p>
            <p className="mt-4 text-lg leading-relaxed text-cw-navy">{MISSION}</p>
          </div>
        </div>

        <ul className="mt-16 divide-y divide-cw-navy/10 border-y border-cw-navy/10">
          {VALUES.map((value) => (
            <li key={value.name} className="flex flex-col gap-2 py-6 md:flex-row md:items-baseline md:gap-10">
              <span className="flex w-40 shrink-0 items-center gap-3 font-display text-xl font-extrabold text-cw-navy">
                <span className={`h-2.5 w-2.5 rounded-full ${value.ground}`} />
                {value.name}
              </span>
              <p className="text-[15px] leading-relaxed text-cw-ink/85 md:text-base">
                {value.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Island waypoints: an offset strip of tinted stop cards, journey motif. */
function Waypoints() {
  return (
    <section className="overflow-hidden bg-white">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-tight text-cw-navy">
          Three stops we always recommend
        </h2>
        <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-cw-ink/85">
          Ask us for the full list at pickup. It changes with the wind, honestly.
        </p>

        <div className="mt-12 flex snap-x gap-6 overflow-x-auto pb-4 md:overflow-visible">
          {WAYPOINTS.map((stop, i) => (
            <article
              key={stop.name}
              className={`w-[300px] shrink-0 snap-start rounded-xl p-7 md:w-auto md:flex-1 ${stop.tint} ${
                i === 1 ? "md:mt-10" : i === 2 ? "md:mt-4" : ""
              }`}
            >
              <p className="font-display text-2xl font-extrabold text-cw-navy">{stop.name}</p>
              <p className="mt-3 text-[15px] leading-relaxed text-cw-ink/85">{stop.note}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The close: one warm line, one CTA, nothing else. */
function ReadyBand() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[820px] px-5 pb-28 pt-4 text-center">
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-tight text-cw-navy">
          Ready when you are.
        </h2>
        <div className="mt-8 flex justify-center">
          <BookCta large />
        </div>
      </div>
    </section>
  );
}
