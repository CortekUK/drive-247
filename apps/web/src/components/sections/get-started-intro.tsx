import { Accent, SectionHeading } from "./section-heading";

/*
 * The main heading over the last part of the page: getting started. It sits inside the
 * "Launch in minutes" screen (launch-section.tsx), above its four cards, so the screen that
 * holds while the cards fill is the heading and the cards together. The pricing follows,
 * left-aligned, so the three read as one part of the page.
 */
export function GetStartedHeading() {
  return (
    <div className="gs-intro">
      <SectionHeading
        id="get-started-title"
        align="left"
        titleClassName="gs-title"
        subClassName="gs-sub"
        title={
          <>
            Your business, online in&nbsp;minutes.
            <br />
            <Accent>With simple pricing.</Accent>
          </>
        }
        sub="Pick a plan and name your business, and your portal and booking site are built and online, ready for your cars. Every plan is the whole platform, with a 14-day free trial."
      />
    </div>
  );
}
