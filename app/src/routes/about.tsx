import { useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FOUNDER_NAME,
  FOUNDER_QUOTE,
  POSITIONING,
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
      <Waypoints />
      <ReadyBand />
    </main>
  );
}

/**
 * Editorial opener: the Clay story told over the diamond it came from. The
 * photo is the section's full-bleed background; a navy scrim (same treatment
 * direction as the Three Stops cards, scaled to cover the whole block) sits
 * between image and copy so the heading, story and quote read in white on top.
 */
function StorySection() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Full-bleed background: Clay on the ball field. */}
      <img
        src="/assets/about/claywinklaar-cw-images.png"
        alt={`${FOUNDER_NAME} at bat on a Curaçao ball field`}
        className="absolute inset-0 -z-10 h-full w-full object-cover object-[70%_30%]"
      />
      {/* Scrim: navy, darkest at the base and along the left where the copy
          lives, so type stays fully legible over the photo. */}
      <span
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-cw-navy/95 via-cw-navy/80 to-cw-navy/60"
      />
      <span
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-r from-cw-navy/80 via-cw-navy/45 to-transparent"
      />

      <div className="mx-auto max-w-[1160px] px-5 py-28 md:px-8 md:py-36">
        <div className="grid gap-12 md:grid-cols-[1fr_1.1fr] md:gap-20">
          <div className="md:pt-6">
            <p className="cw-waypoint text-cw-peach">
              <span className="h-2 w-2 rounded-full bg-cw-peach" />
            </p>
            <h1 className="mt-6 font-display text-[clamp(2.4rem,4.6vw,4rem)] font-extrabold leading-[1.05] tracking-tight text-white">
              From the ballpark to the coast road.
            </h1>
          </div>
          <div className="space-y-6 text-base leading-relaxed text-white/90 md:pt-10 md:text-lg">
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
            <blockquote className="border-l-4 border-cw-peach pl-5 font-display text-lg font-bold leading-snug text-white md:text-xl">
              "{FOUNDER_QUOTE}"
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Centered statement: the positioning line gets the whole room. */
function WhyCw() {
  return (
    <section className="bg-cw-teal-soft">
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

/** Accent hairline colours, pulled from the CW palette per stop. */
const WAYPOINT_ACCENT: Record<string, string> = {
  peach: "bg-cw-peach",
  yellow: "bg-cw-yellow",
  mint: "bg-cw-mint",
  teal: "bg-cw-teal",
  pink: "bg-cw-pink",
};

/**
 * Island waypoints: three tall, photo-led cards. The photo IS the card — a
 * bottom-up gradient scrim carries the name and note over the image, so type
 * stays legible without a flat block sitting on the picture. Hover eases a slow
 * zoom and deepens the scrim; cards reveal on scroll with the same staggered
 * fade-and-rise the fleet grid uses.
 */
function Waypoints() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const section = sectionRef.current;
    if (!section) return;

    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(
      ([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        ctx = gsap.context(() => {
          gsap.from("[data-waypoint-card]", {
            autoAlpha: 0,
            y: 44,
            duration: 0.9,
            ease: "power3.out",
            stagger: 0.09,
            scrollTrigger: { trigger: section, start: "top 78%" },
          });
        }, section);
      },
    );
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} className="overflow-hidden bg-white">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-tight text-cw-navy">
          Three stops we always recommend
        </h2>
        <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-cw-ink/85">
          Ask us for the full list at pickup. It changes with the wind, honestly.
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3 md:gap-6">
          {WAYPOINTS.map((stop, i) => (
            <article
              key={stop.name}
              data-waypoint-card
              className="group relative isolate aspect-[4/5] overflow-hidden rounded-2xl cw-shadow-soft transition-shadow duration-500 hover:cw-shadow-lift md:aspect-[3/4]"
            >
              <img
                src={stop.image}
                alt={`${stop.name}, Curaçao`}
                loading={i === 0 ? "eager" : "lazy"}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-out will-change-transform group-hover:scale-[1.06]"
              />

              {/* Scrim: dark at the base, clearing toward the top. Deepens on
                  hover to pull focus onto the type. */}
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-cw-navy/90 via-cw-navy/25 to-transparent opacity-90 transition-opacity duration-500 group-hover:opacity-100"
              />

              <div className="absolute inset-x-0 bottom-0 p-6 md:p-7">
                <span
                  className={`block h-[3px] w-10 rounded-full transition-all duration-500 ease-out group-hover:w-16 ${WAYPOINT_ACCENT[stop.accent]}`}
                />
                <h3 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight text-white">
                  {stop.name}
                </h3>
                <p className="mt-2 max-w-[34ch] font-body text-[15px] leading-relaxed text-white/85">
                  {stop.note}
                </p>
              </div>
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
