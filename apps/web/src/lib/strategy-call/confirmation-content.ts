export const CONTENT_VERSION = "2026-08-v1";

export type ConfirmationVideoSlug =
  | "marketplace-control"
  | "system-walkthrough"
  | "faqs"
  | "who-its-for";

export type ConfirmationVideo = {
  slug: ConfirmationVideoSlug;
  order: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  takeaway: string;
  src: string;
  poster: string;
  /**
   * WebVTT caption file, or null when none has been supplied yet. Null renders
   * no <track> at all; it must never point at a file that does not exist.
   */
  captions: string | null;
  /**
   * Full spoken text, split into paragraphs. Generated from the same
   * transcription pass as the caption files and carrying the same caveat:
   * machine-produced, spot-checked, not yet line-by-line proofread.
   */
  transcript: readonly string[] | null;
};

export const CONFIRMATION_VIDEOS = [
  {
    slug: "marketplace-control",
    order: 1,
    title: "Marketplace Dependency vs Independent Rentals",
    description:
      "See why owning the customer relationship, brand, pricing and process matters more than relying on one marketplace.",
    takeaway:
      "Build a rental operation that still exists outside any single marketplace.",
    src: "/strategy-call/videos/01-marketplace-dependency.mp4",
    poster: "/strategy-call/posters/01-marketplace-dependency.webp",
    captions: "/strategy-call/captions/01-marketplace-dependency.en.vtt",
    transcript: [
      "If your Turo account got suspended tomorrow, how much of your business would disappear with it? Not would it hurt? How much would be gone? The bookings, the reviews, you spent two years building the customers who rented from you five times, all lives on someone else's platform, and they can shut the door whenever they want. Now, I'm not saying quit the marketplaces, quit your Turo account, they bring demand and the demand is good, but I want to show",
      "you something most operators don't realise until it's too late.",
      "Because let's do the maths. Say you're running 8, 10, 12 vehicles on a marketplace. You're handing over nearly 40-50% of every single booking. Run that over a year, That's not a fee. That's a partner you never actually agreed to take on, who does none of the work and takes a cut of everything. And it's not just the money, three things are quietly working against you.",
      "1. You don't own the customers. Every booking goes through them. The renter belongs to the platform, not you. And you can't follow up, you can't build loyalty, you can't bring them back on your own terms. 2. You pay for every booking forever.",
      "There's no volume, there's no discount on graduation. The bigger you get, the more you hand over, you're being punished for growing. 3. Your brand stays invisible.",
      "Renters remember the marketplace, not you. You're building someone else's reputation with your cars, your service and your risk.",
      "So here's the shift. The operators who win long term don't just pick marketplaces or they don't just pick direct. They run both. But they build a direct channel they actually own, running right alongside the marketplace traffic they already have. Their own booking sites, their own domain, their own brand. Customers book directly and they keep 100% of them and every one of those bookings has zero commission attached.",
      "One operator who I'll show you, Douglas, he went from 12 vehicles out of Atlanta, went from a 100% marketplace to 60% direct in 4 months.",
      "That move alone recovered $18,000 in fees. Same cars, same demand. He just stopped renting his own business back from a platform.",
      "Now you're probably thinking it sounds too good in theory, but is it real? Is it actually built or is it just slides and a promise? I mean, very fair question.",
      "So the next video I'm going to show you, I'm not just going to pitch, I'm going to actually open up the actual system and walk you through the real screens, booking sites, your customers see and the dashboard you'd run everything from. No animation, the real thing.",
    ],
  },
  {
    slug: "system-walkthrough",
    order: 2,
    title: "Drive247 System Walkthrough",
    description:
      "Follow the direct-booking journey from the customer experience through the tools used to run the operation.",
    takeaway: "Picture how your rental business could run through Drive247.",
    src: "/strategy-call/videos/02-drive247-system-walkthrough.mp4",
    poster: "/strategy-call/posters/02-drive247-system-walkthrough.webp",
    captions: "/strategy-call/captions/02-drive247-system-walkthrough.en.vtt",
    transcript: [
      "So you've already seen those last few videos so pretty much so I just want to run through like a short demo with you of the actual site and the back office so when we actually jump on the call you have everything that you need in order to get rocking and rolling. So pretty much I'm just going to briefly go over RevTek rentals here for you guys this is one of our existing clients they've been with us for the last six months and I want to show off these guys' site because",
      "one it looks absolutely amazing but two because they've done such a good job in configuring everything exactly how they want to run their business which is the whole point of Drive247 right taking control back for your business. So obviously here is their existing system so this is their site with their logo their name, their about you page, their fleet and pricing, reviews, promotions, FAQs, contacts and blogs. Okay absolutely everything has been custom built out and",
      "personalized for them on this site which means they have a brand they have their own solid site which means when the customer books there's more trust built out.",
      "So just to go through as a customer here we can obviously select for a few different pickup locations. Now as the host you have a few different options where obviously your customers can pick up and return the vehicles because you have like a static or you can have the option to deliver it to a specific location i.e. the airport or to a hotel like these guys do but also you have the option to deliver it to a specific address within a tiered area so 10 bucks for 2 miles away 50 bucks for 20 miles",
      "away whatever it is right you have that option. So obviously your customers come through here select the pickup the return locations with the day and time obviously that they want to rent in. The most important thing they can go through and it's all done on a real-time calendar.",
      "Let's say you have 10 vehicles that you want to rent out and that you have available.",
      "Five of them are already out with existing customers that means that the calendar is real-time updated and it's only going to show the five vehicles which are actually available in your current fleet. So they select the date and time if the vehicles are available then they can go ahead they can select one of those they can then go to insurance on this tab here where they can enter in their own personal policy it'll be verified and scanned through the whole system the AI which is already built",
      "in there for you or they can actually go ahead and they can purchase external insurance through Bonzah. Now these guys are a partner with us so they've been on us since pretty much inception so we've got a super great relationship with them but what it also means is you can offer out insurance to your customers when they're booking so you can offer out you know CDW or CLI you can offer it as a bundle you could do the you know the supplementary liability on there",
      "as well and your customers can purchase insurance direct through your site through Bonzah because it's all built-in integration it's already in the box so as soon as you get set up with your system it's going to be in there. The only thing you have to go set up an account with them obviously is you are providing insurance they need to have your details but they go through the engine their customer details i .e their address their phone number their",
      "location their you know name and everything right that data one you have it captured anyway to build loyalty customer base promotions anything like that but also it means it automatically does the insurance for you as well so they go through they upload all of that information then they are prompted with a driver's license identification so they upload the front and the back of the driver's license they take a selfie it's going to go through all of that data which they just",
      "uploaded process it all with the AI built-in and it's going to verify everything for you once they get the green light they can then review and confirm automatically they get a rental agreement sent over to their email for ready for an e -signature they get a rental invoice generated for them and they also get a rental summary as well this you don't have to touch it's already done for you to save you going to another software save you having to faff",
      "about and do it yourself once that's all done everything is ready to be paid just simple stripe check out once they pay everything the whole flow is completed you haven't even had to touch the thing to get the customer rented in and then you can see everything in the back office here so this is one of our demo accounts actually which is why there is really isn't much business activity going on here but there's a full proprietary AI built out into the system which can do actions",
      "check all your data and help you learn and navigate the system following that we can see all of our vehicles all of our rentals from the calendar view for the week for the month or just from this view here it should be actually clicking we can see all of this information in terms of rental pickups handovers mileage summaries insurance verification everything is in there from customers we can catch all of this data as well you can block anyone and also you can just do in-app messaging so",
      "saves you having 50 different contacts in your phone trying to juggle emails from juggle text messages to make sure if they need to pay if they're going to return the vehicle you have it all in here in one place with the emails calling sms or whatsapp as well all of your payments you can see all of these here all time invoices any fines as well as you know related to customers expenses so you can almost use this accounting as well specific for your business whether it's",
      "insurance whether it's tolls whether it's valet each month get AI summaries and also it will show you absolutely everywhere that you're spending your your minute your money so insurances this is where you can keep track of all of these along with your agreements your reminders and reporting across the board for each specific customer each specific vehicle now it wouldn't be a system didn't have a full -on profit in us across the whole board so you can see obviously",
      "globally tracked from month from year each vehicle profitability how much you're actually pulling in and how much your total costs are we don't just stop there with like building the system out for you have full autonomy and customization and control over your site so if you ever wanted to tweak anything whether it's you know the images on the front page whether it's the headline or the sub header you can obviously go ahead and do that as well",
      "now for the guys who have like a few different users maybe you're running a business with two three four other people and you want to have them inside and not just keep on sharing each other's passwords you can set each other up with other managers operations admins just means that you can simultaneously both be inside the system and using the platform now this is just where you kind of configure everything and this is something",
      "more for the actual call where we go through everything and sort of figure out the game plan but this is obviously where you can go through your locations all of your branding how long they can rent out the vehicle for pricing rules fees pre-authorization on the cards instalments pay as you go then of course notifications emails and rental agreements as well so yeah wanted just to to run through actual live system and do that",
      "if you have any other questions I'm sure save them for the call but make sure you join from a laptop just how I am on the desk make sure we're ready for a proper conversation see you inside",
    ],
  },
  {
    slug: "faqs",
    order: 3,
    title: "Frequently Asked Questions",
    description:
      "Get clear answers to the common setup, marketplace, branding, payments and support questions before the call.",
    takeaway:
      "Use the strategy call for questions specific to your operation, not the basics.",
    src: "/strategy-call/videos/03-frequently-asked-questions.mp4",
    poster: "/strategy-call/posters/03-frequently-asked-questions.webp",
    captions: "/strategy-call/captions/03-frequently-asked-questions.en.vtt",
    transcript: [
      "Alright, you've seen the system work. Now let's deal with the real questions. The ones you're actually thinking in your head right now. I'm just going to hit them straight along.",
      "Marketplaces bring me demand. I don't have my own traffic.",
      "Right. and you keep them. Nothing about this is shutting off your marketplace bookings.",
      "Direct is an additive. It runs alongside what you've already got. And when you're ready to grow it, we support you with meta ads guidance that drives traffic directly into your funnel on your site, not a listing you're sharing with hundreds of other operators. You're not replacing your demand.",
      "You're building a second engine you actually own. Setup sounds like a nightmare. I don't have time for a big tech project.",
      "We say seven days, and that's done with you. Not dumped on you. Kick a call, then within an hour your system and your dashboard is live and your branded site is ready to review. About a week in payments verification are all connected and you're taking direct bookings.",
      "James, he had an eight vehicle fleet in Phoenix. He was live in five days. And here's the part that should tell you something. If you're not live in seven days, we don't charge you for a month one. We put our money where our mouth is. It's actually worth the cost. Compared to what you already pay, 15, 30, 45% on every booking forever versus a flat platform you own. Sarah said in Miami that a branded site paid for itself. Customers trust her more,",
      "booking on her own site than a marketplace listing. And Marcus, did I even mention, recovered 18 grand in four months. The question is whether you can afford this. It's whether you can afford to keep handing over a third of every single booking.",
      "Will customers actually book on my site instead of a marketplace they already trust?",
      "This surprises people. Trust transfers. When someone lands on a clean branded site with real time availability, insurance and ID handled at checkout, a proper booking flow, they trust you more. not less. You stop looking like a listing and start looking more like a real business.",
      "Because you are. Here's the honest part. This isn't for everyone. If you've got one car and you're just starting out, this is too much system for you right now. This is built for operators who are already doing a real volume, four, five or more. Already taking bookings, who are ready to stop being dependent on a platform they don't control. If that's you, the last video shows you exactly what happens next and how to get your direct site maxed out.",
      "Go watch it now.",
    ],
  },
  {
    slug: "who-its-for",
    order: 4,
    title: "Who This Is Actually For",
    description:
      "Decide whether the system, launch process and responsibility of building direct demand match your goals.",
    takeaway:
      "Know whether this fits—and what fleet details, blockers and launch goal to bring to the call.",
    src: "/strategy-call/videos/04-who-this-is-for.mp4",
    poster: "/strategy-call/posters/04-who-this-is-for.webp",
    captions: "/strategy-call/captions/04-who-this-is-for.en.vtt",
    transcript: [
      "Alright, let me be straight with you exactly who this call is for. Alright, so for operators who run four or five vehicles who are already taking bookings and who are done being fully dependent on marketplaces. Alright, if you're just getting started, this probably isn't the right fit just yet and that's totally okay. But if you are an established operator, maybe a Turo Power Host or an airport local fleet, someone who's ready to own their customers and their",
      "pricing, then just keep listening. Because here's exactly what the call is, it's around about 45 minutes, it's not a hard pitch and on the call will look at your fleet and your pricing, will map out your direct channel and will actually mock up a branded booking site that you could look like.",
      "You'll leave with a 7 day launch plan whether you work together or not.",
      "And remember, the guarantee if we don't get you live within 2 weeks, the first month is on us.",
      "There's genuinely no risk in finding out if this is a good fit for you.",
      "To make the call worth your time, come with 3 things.",
      "Your fleet size, roughly how your bookings are split between marketplaces and direct right now, and your monthly revenue.",
      "Just a ballpark. With those we can give you real numbers instead of a generic advice.",
      "The button below, this is the booking, grab a time that works, but also just show up on a laptop, professional in a good environment and we'll go through absolutely everything.",
      "Right, how we can actually turn your marketplaces into direct bookings like yourself.",
      "So just send me a text, just confirm the times that it works that you booked in and show up and we'll get you all sorted.",
    ],
  },
] as const satisfies readonly [
  ConfirmationVideo,
  ConfirmationVideo,
  ConfirmationVideo,
  ConfirmationVideo,
];
