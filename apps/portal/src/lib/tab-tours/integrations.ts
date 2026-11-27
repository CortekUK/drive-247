/**
 * The Integrations tab tour: six topics, in the order an operator meets them.
 *
 *   1 board       the cards, search, the tags and pins
 *   2 stripe      Stripe Connect: what it does (the tour never presses connect)
 *   3 turo        Turo Sync
 *   4 accounting  Xero and Zoho
 *   5 cover       Bonzah, Inshur, BoldSign and CheckMyDriver
 *   6 more        Square, Twilio, Tesla and a custom domain
 *
 * Every card carries `data-tour="integration-<name>"` and the dialog carries
 * `data-tour="integration-dialog"` (`app/(dashboard)/integrations/integrations-board.tsx`).
 * A topic that opens a dialog only opens it: what an operator sees inside is
 * the integration's own introduction (`_panels/_intros.ts`) while it is not
 * set up, or its working screens once it is, so the words here hold for both.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const DIALOG = '[data-tour="integration-dialog"]';
const card = (slug: string) => `[data-tour="integration-${slug}"]`;
const opensCard = (slug: string): TourStep['opens'] => ({ trigger: [card(slug)], dialog: DIALOG });

/** A step about one card on the board. */
const cardStep = (slug: string, s: Omit<TourStep, 'route' | 'anchors' | 'side'> & { side?: TourStep['side'] }): TourStep => ({
  route: '/integrations',
  anchors: [card(slug)],
  side: 'bottom',
  ...s,
});

/** A step inside a card's dialog, which it opens first. */
const dialogStep = (slug: string, s: Omit<TourStep, 'route' | 'anchors' | 'side' | 'opens'> & { anchors?: readonly string[]; side?: TourStep['side'] }): TourStep => ({
  route: '/integrations',
  anchors: [`${DIALOG} h3`, DIALOG],
  side: 'left',
  opens: opensCard(slug),
  ...s,
});

const board: TabTourTopic = {
  id: 'integrations.board',
  title: 'The integrations board',
  summary: 'What a card does, searching the board, the tags and pins.',
  steps: [
    {
      id: 'integrations.board.page',
      label: 'Integrations',
      title: 'Tools that plug in',
      body: 'Each card is a service that works with Drive247: payments, insurance, signing, messages, accounting and more. Click a card to see what it does and set it up.',
      route: '/integrations',
      anchors: [...LIST_HEADING],
      side: 'bottom',
    },
    {
      id: 'integrations.board.search',
      label: 'Search',
      title: 'Find one fast',
      body: 'Search matches a card’s name, its category and its description, so typing insurance finds Bonzah and Inshur.',
      route: '/integrations',
      anchors: ['input[placeholder="Search integrations…"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. It matches a card’s name, category and description, so typing insurance finds Bonzah and Inshur.',
      side: 'bottom',
    },
    {
      id: 'integrations.board.tags',
      label: 'Tags',
      title: 'The tag in the corner',
      body: 'Live means it is working for you, and a mark beside it means it needs a look. Soon is not ready yet, Add-on costs extra, and Unavailable is not open to your account.',
      route: '/integrations',
      anchors: ['[data-tour="integration-tag"]:not(:empty)'],
      side: 'bottom',
    },
    {
      id: 'integrations.board.pin',
      label: 'Pin',
      title: 'Keep your favourites on top',
      body: 'The pin moves a card into a Pinned row at the top of the board. Pins are yours alone, kept on this device.',
      route: '/integrations',
      anchors: ['[data-tour^="integration-"] button[aria-label^="Pin "]', '[data-tour^="integration-"] button[aria-label^="Unpin "]'],
      side: 'bottom',
    },
  ],
};

const stripe: TabTourTopic = {
  id: 'integrations.stripe',
  title: 'Stripe: getting paid',
  summary: 'What connecting Stripe does for your bookings. I only look, I never connect.',
  steps: [
    cardStep('stripe-connect', {
      id: 'integrations.stripe.card',
      label: 'Stripe Connect',
      title: 'How customers pay you',
      body: 'Stripe Connect takes your customers’ card payments when they book, then pays the money out to your bank. I will open its card.',
    }),
    dialogStep('stripe-connect', {
      id: 'integrations.stripe.open',
      label: 'Inside',
      title: 'Read first, then set up',
      body: 'Until Stripe is set up, its card opens a few short screens about it, ending in Set up Stripe. Once it works, the card opens on your Stripe account instead.',
    }),
    dialogStep('stripe-connect', {
      anchors: [DIALOG],
      id: 'integrations.stripe.two',
      label: 'Two Stripes',
      title: 'Not your subscription',
      body: 'Your Drive247 subscription is billed by us through our own Stripe. Stripe Connect is yours: it is where your customers’ booking payments land.',
    }),
    dialogStep('stripe-connect', {
      anchors: [DIALOG],
      id: 'integrations.stripe.deposits',
      label: 'Deposits',
      title: 'Deposits on the card',
      body: 'With Stripe I can hold a security deposit on the customer’s card and release it after the rental. The money only moves if you need it.',
    }),
    dialogStep('stripe-connect', {
      anchors: [DIALOG],
      id: 'integrations.stripe.setup',
      label: 'Set up',
      title: 'Setting it up',
      body: 'Set up Stripe sends you to Stripe to sign in or make an account and confirm your business and bank details. Once Stripe approves you, bookings start paying into it.',
      notes: [{ text: 'I do not press it for you. Do it when you have your bank details to hand.' }],
    }),
  ],
};

const turo: TabTourTopic = {
  id: 'integrations.turo',
  title: 'Turo Sync',
  summary: 'Bringing your Turo trips in, so no car is booked twice.',
  steps: [
    cardStep('turo-sync', {
      id: 'integrations.turo.card',
      label: 'Turo Sync',
      title: 'Your Turo trips, here too',
      body: 'Turo Sync brings the trips you take on Turo into Drive247, so one calendar shows every booking wherever it came from.',
    }),
    dialogStep('turo-sync', {
      id: 'integrations.turo.double',
      label: 'No double booking',
      title: 'No more double booking',
      body: 'A Turo trip holds its car’s dates here too, so the same car cannot be sold twice. Any trip can become an ordinary Drive247 rental.',
    }),
    dialogStep('turo-sync', {
      id: 'integrations.turo.extension',
      label: 'The extension',
      title: 'Your Turo password stays yours',
      body: 'A Chrome extension reads the Turo session already open in your browser. It never asks for your password and never writes anything back to Turo.',
    }),
    dialogStep('turo-sync', {
      id: 'integrations.turo.start',
      label: 'Getting started',
      title: 'Four short steps',
      body: 'After these screens I walk you through it: sign in to Turo, add the Drive247 Turo Bridge extension, paste a pairing code and run a sync.',
      notes: [{ text: 'In Chrome the extension is called Drive247 Turo Bridge.' }],
    }),
  ],
};

const accounting: TabTourTopic = {
  id: 'integrations.accounting',
  title: 'Accounting',
  summary: 'Sending your invoices and payments to Xero or Zoho Books.',
  steps: [
    cardStep('xero', {
      id: 'integrations.accounting.xero',
      label: 'Xero',
      title: 'Your books, kept for you',
      body: 'Connect Xero and the invoices and payments from Drive247 go to it, so your books follow your business without retyping.',
    }),
    cardStep('zoho', {
      id: 'integrations.accounting.zoho',
      label: 'Zoho',
      title: 'Or Zoho Books',
      body: 'Zoho does the same for Zoho Books. You confirm which accounts things land in before anything is sent.',
    }),
    dialogStep('xero', {
      id: 'integrations.accounting.accounts',
      label: 'Accounts',
      title: 'You choose where things land',
      body: 'You pick which Xero accounts your sales and payments are recorded against.',
    }),
    dialogStep('xero', {
      id: 'integrations.accounting.connect',
      label: 'Connect',
      title: 'Connecting',
      body: 'You sign in to Xero and approve Drive247. After that I show you what has been sent and anything still waiting.',
    }),
  ],
};

const cover: TabTourTopic = {
  id: 'integrations.cover',
  title: 'Insurance, signing and checks',
  summary: 'Bonzah, Inshur, BoldSign and CheckMyDriver.',
  steps: [
    cardStep('bonzah', {
      id: 'integrations.cover.bonzah',
      label: 'Bonzah',
      title: 'Cover sold at checkout',
      body: 'Bonzah lets customers buy insurance for their rental as they book. You apply from its card, and Bonzah switches it on once they approve you.',
    }),
    cardStep('inshur', {
      id: 'integrations.cover.inshur',
      label: 'Inshur',
      title: 'Fleet cover, coming soon',
      body: 'Inshur is insurance for your cars between rentals. It is marked Soon, so there is nothing to connect yet.',
    }),
    cardStep('boldsign', {
      id: 'integrations.cover.boldsign',
      label: 'BoldSign',
      title: 'Agreements signed online',
      body: 'BoldSign is how customers sign your rental agreements. It is already on for every account, so there is nothing to connect.',
    }),
    cardStep('checkmydriver', {
      id: 'integrations.cover.checkmydriver',
      label: 'CheckMyDriver',
      title: 'Licence checks, coming soon',
      body: 'CheckMyDriver will check driving licences and identity. It is marked Soon for now.',
    }),
  ],
};

const more: TabTourTopic = {
  id: 'integrations.more',
  title: 'Messages, calls and the rest',
  summary: 'Square, Twilio, Tesla and your own web address.',
  steps: [
    cardStep('square', {
      id: 'integrations.more.square',
      label: 'Square',
      title: 'Square instead of Stripe',
      body: 'If you already run your business on Square, booking payments can go through it instead of Stripe. You use one or the other, and I confirm with you before switching.',
    }),
    cardStep('twilio-messages', {
      id: 'integrations.more.texts',
      label: 'Twilio Messages',
      title: 'Text messages',
      body: 'Twilio Messages sends text notifications and reminders, and lets customers text you back.',
    }),
    cardStep('twilio-calling', {
      id: 'integrations.more.calls',
      label: 'Twilio Calling',
      title: 'Phone calls',
      body: 'Twilio Calling gives you call forwarding, voicemail and recordings.',
    }),
    cardStep('tesla', {
      id: 'integrations.more.tesla',
      label: 'Tesla',
      title: 'Tesla cars',
      body: 'Tesla brings in Supercharging and car data through Tesla’s Fleet API.',
    }),
    cardStep('custom-domain', {
      id: 'integrations.more.domain',
      label: 'Custom Domain',
      title: 'Your own web address',
      body: 'Custom Domain puts your booking site and portal on a web address of your own.',
    }),
  ],
};

export const INTEGRATIONS_TAB_TOUR: TabTour = {
  id: 'integrations',
  label: 'Integrations',
  homeRoute: '/integrations',
  emptyMessage: 'There is not enough of this tab open to you to walk through.',
  topics: [board, stripe, turo, accounting, cover, more],
};
