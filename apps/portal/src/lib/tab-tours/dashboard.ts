/**
 * The Dashboard tab tour: five topics, top of the page to the bottom.
 *
 *   1 money     the money graph: the total, the lines, the forecast, the menu
 *   2 today     "Your business today": my summary, its questions, moving cards
 *   3 desk      Requests and the To do list
 *   4 insights  busy days and where bookings come from
 *   5 help      the Stripe line, Help, messages, notifications, tour buttons
 *
 * The quick tour also starts on this page. It is a separate tour with its own
 * steps (`lib/first-rental-tour.ts`); nothing here changes it.
 *
 * Anchors are `dash-*` markers in `components/dashboard-v2`. The Tour button
 * sits on the money graph's top row, because the page has no title row.
 */

import type { TabTour, TabTourTopic } from './index';

const REVENUE = '[data-tour="dash-revenue"]';
const BRIEF = '[data-tour="dash-brief"]';
const REQUESTS = '[data-tour="dash-requests"]';
const TODO = '[data-tour="dash-todo"]';
const PHONE_MENU = 'button[aria-label="Open menu"]';

const money: TabTourTopic = {
  id: 'dashboard.money',
  title: 'Your money graph',
  summary: 'What the big number counts, the three lines, and changing the period.',
  steps: [
    {
      id: 'dashboard.money.total',
      label: 'The total',
      title: 'Money that has come in',
      body: 'The big number is money actually collected in the period, the last 30 days unless you change it. Pending, reversed and refunded payments are left out.',
      route: '/',
      anchors: ['[data-tour="dash-revenue-total"]', REVENUE],
      side: 'bottom',
    },
    {
      id: 'dashboard.money.lines',
      label: 'The lines',
      title: 'A running total',
      body: 'The solid line adds up each day, so a steep step is a big day. The dashed line is the period before, so you can see if you are ahead.',
      route: '/',
      anchors: [REVENUE],
      side: 'bottom',
      notes: [{ text: 'Hover anywhere on the graph for the figures on that day.' }],
    },
    {
      id: 'dashboard.money.forecast',
      label: 'Coming in',
      title: 'What is on its way',
      body: 'On the day by day periods, the dotted line after today is money expected in the next 7 days: charges already on your books that fall due.',
      route: '/',
      anchors: [REVENUE],
      side: 'bottom',
    },
    {
      id: 'dashboard.money.info',
      label: 'How it works',
      title: 'The rules, any time',
      body: 'The small i beside the period explains what counts and what each line means, whenever you want a reminder.',
      route: '/',
      anchors: ['button[aria-label="How this chart works"]', REVENUE],
      side: 'bottom',
    },
    {
      id: 'dashboard.money.menu',
      label: 'Options',
      title: 'Change the period',
      body: 'This menu picks 7, 30 or 90 days, or 12 months, and turns the dashed and dotted lines on or off. I remember what you choose.',
      route: '/',
      anchors: ['button[aria-label="Chart options"]', REVENUE],
      side: 'bottom',
    },
  ],
};

const today: TabTourTopic = {
  id: 'dashboard.today',
  title: 'Your business today',
  summary: 'My short read of your business, and the questions you can ask me next.',
  steps: [
    {
      id: 'dashboard.today.brief',
      label: 'The summary',
      title: 'My read of today',
      body: 'This is my short summary of your business today, built from your rentals, payments, cars and requests. The top line is what I would look at first.',
      route: '/',
      anchors: ['[data-tour="dash-brief-headline"]', BRIEF],
      side: 'right',
    },
    {
      id: 'dashboard.today.points',
      label: 'The points',
      title: 'The few things worth knowing',
      body: 'Under it, a few short points with the numbers in bold. I show as many as fit on the card.',
      route: '/',
      anchors: ['[data-tour="dash-brief-points"]', BRIEF],
      side: 'right',
    },
    {
      id: 'dashboard.today.questions',
      label: 'Questions',
      title: 'Ask me the next thing',
      body: 'These are questions you might ask next. Tap one and I answer it in the Help panel.',
      route: '/',
      anchors: ['[data-tour="dash-brief-questions"]', BRIEF],
      side: 'top',
    },
    {
      id: 'dashboard.today.continue',
      label: 'Carry on',
      title: 'Talk it through',
      body: 'Tap anywhere else on the card and I open Help with this summary, so you can carry on from it.',
      route: '/',
      anchors: [BRIEF],
      side: 'right',
    },
    {
      id: 'dashboard.today.move',
      label: 'Move cards',
      title: 'Put the cards in your order',
      body: 'Each card in this row has a grip at the top. Drag it to set the order you like, and this browser remembers it.',
      route: '/',
      anchors: ['button[aria-label^="Move the "]'],
      side: 'bottom',
      // Phones stack the cards and draw no grip.
      requires: { desktop: true },
    },
  ],
};

const desk: TabTourTopic = {
  id: 'dashboard.desk',
  title: 'Requests and your to-do list',
  summary: 'Customers waiting on you, and your own list with reminders.',
  steps: [
    {
      id: 'dashboard.desk.requests',
      label: 'Requests',
      title: 'Who is waiting on you',
      body: 'A booking to approve, an extension or a cancellation a customer asked for. Newest first, with how long each has waited.',
      route: '/',
      anchors: [REQUESTS],
      side: 'left',
      notes: [{ text: 'When nobody is waiting it says All caught up.' }],
    },
    {
      id: 'dashboard.desk.review',
      label: 'Review',
      title: 'Deal with one',
      body: 'Review takes you to that rental so you can answer it. Messages from customers are not here: they have their own place.',
      route: '/',
      anchors: [`${REQUESTS} li`, REQUESTS],
      side: 'bottom',
    },
    {
      id: 'dashboard.desk.all',
      label: 'All requests',
      title: 'See them all',
      body: 'This opens every request in a bigger window, with a filter for each kind and how many there are.',
      route: '/',
      anchors: ['button[aria-label="See all requests"]', REQUESTS],
      side: 'bottom',
    },
    {
      id: 'dashboard.desk.todo',
      label: 'To do',
      title: 'Your own list',
      body: 'Jot down anything you need to remember, and give it a time if you want a nudge.',
      route: '/',
      anchors: [TODO],
      side: 'left',
    },
    {
      id: 'dashboard.desk.add',
      label: 'Add one',
      title: 'Add a to-do',
      body: 'Tap here, type it and press Enter. The clock sets a time: in an hour, this evening, tomorrow, next week or a day you pick.',
      route: '/',
      anchors: ['[data-tour="dash-todo-add"]', TODO],
      side: 'bottom',
    },
    {
      id: 'dashboard.desk.tick',
      label: 'Done',
      title: 'Tick it off',
      body: 'A ticked item is struck through and moves below the open ones. A time turns red once it has passed.',
      route: '/',
      anchors: [TODO],
      side: 'left',
    },
    {
      id: 'dashboard.desk.full',
      label: 'Full list',
      title: 'The whole list',
      body: 'This opens your full list, where you can change an item, change or remove its time, or delete it.',
      route: '/',
      anchors: ['button[aria-label="Open the full list"]', TODO],
      side: 'bottom',
    },
  ],
};

const insights: TabTourTopic = {
  id: 'dashboard.insights',
  title: 'Busy days and bookings',
  summary: 'How full your fleet was, day by day, and where bookings come from.',
  steps: [
    {
      id: 'dashboard.insights.busy',
      label: 'Busy days',
      title: 'How busy each day was',
      body: 'I shade each day by how much of your fleet was out on rent, over three months. The deeper the colour, the busier the day.',
      route: '/',
      anchors: ['[data-tour="dash-busy-head"]', '[data-tour="dash-busy"]'],
      side: 'bottom',
    },
    {
      id: 'dashboard.insights.highlights',
      label: 'Highlights',
      title: 'Three things to know',
      body: 'Your busiest day, your quietest day of the week, and how much of the fleet is out on an average day.',
      route: '/',
      anchors: ['[data-tour="dash-busy-highlights"]', '[data-tour="dash-busy-head"]'],
      side: 'bottom',
      notes: [{ text: 'Before any car has gone out, this says No cars out yet instead.' }],
    },
    {
      id: 'dashboard.insights.months',
      label: 'The months',
      title: 'Day by day',
      body: 'Three months side by side. Hover a day to see its exact figure.',
      route: '/',
      anchors: ['[data-tour="dash-busy-months"]', '[data-tour="dash-busy-head"]'],
      mobileBody: 'One month at a time, opening on this one. Swipe sideways for the other two.',
      side: 'top',
    },
    {
      id: 'dashboard.insights.sources',
      label: 'Sources',
      title: 'Where bookings come from',
      body: 'Your bookings from the last 90 days, split into your website, your team (phone and walk-in) and Turo. Each tile is sized by its share.',
      route: '/',
      anchors: ['[data-tour="dash-sources-head"]', '[data-tour="dash-sources"]'],
      side: 'bottom',
    },
  ],
};

const help: TabTourTopic = {
  id: 'dashboard.help',
  title: 'Help and getting set up',
  summary: 'Connecting Stripe, asking me, messages, notifications and tours.',
  steps: [
    {
      id: 'dashboard.help.stripe',
      label: 'Stripe',
      title: 'Getting paid',
      body: 'Until Stripe is connected, a line at the top of this page says so, with Connect Stripe beside it. Stripe and your other connections live under Integrations.',
      route: '/',
      anchors: ['[data-tour="dash-stripe"]', '[data-sidebar="sidebar"] [data-tour="nav-integrations"]'],
      mobileAnchors: ['[data-tour="dash-stripe"]', PHONE_MENU],
      mobileBody: 'Until Stripe is connected, a line at the top of this page says so, with Connect Stripe beside it. Stripe and your other connections are under Integrations, in this menu.',
      side: 'right',
    },
    {
      id: 'dashboard.help.trax',
      label: 'Help',
      title: 'Ask me anything',
      body: 'Press Help to ask me how to do something, or anything about your business.',
      route: '/',
      anchors: ['[data-tour="trax-help"]'],
      side: 'bottom',
    },
    {
      id: 'dashboard.help.messages',
      label: 'Messages',
      title: 'Talking to customers',
      body: 'Texts, emails and calls with your customers, all in one place.',
      route: '/',
      anchors: ['[aria-label^="Multi Chat"]'],
      side: 'bottom',
    },
    {
      id: 'dashboard.help.bell',
      label: 'Notifications',
      title: 'What needs a look',
      body: 'The bell collects your notifications. A red number on it says how many you have not read yet.',
      route: '/',
      anchors: ['button[aria-label="Notifications"]'],
      side: 'bottom',
    },
    {
      id: 'dashboard.help.tours',
      label: 'Tours',
      title: 'A tour on every tab',
      body: 'Every tab has a Tour button like this one. Its topics teach that tab one at a time, and I remember where you stopped.',
      route: '/',
      anchors: ['[data-tour="take-tab-tour"]'],
      side: 'bottom',
    },
  ],
};

export const DASHBOARD_TAB_TOUR: TabTour = {
  id: 'dashboard',
  label: 'Dashboard',
  homeRoute: '/',
  emptyMessage: 'There is not enough of this tab open to you to walk through.',
  topics: [money, today, desk, insights, help],
};
