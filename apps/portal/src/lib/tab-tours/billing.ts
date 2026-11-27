/**
 * The Billing tab tour: what you pay Drive247. Four topics.
 *
 *   1 plan   the plan and changing it, or choosing one (and what a trial means)
 *   2 bills  the next bill, past bills and their receipts
 *   3 card   the card on file
 *   4 late   what happens when a payment does not go through
 *
 * The page is `components/billing-v2/billing-page-v2.tsx`. Before a tenant
 * subscribes it is the plan picker, marked `billing-empty`, and the topics
 * that need a subscription say so. The tour never presses a pay, subscribe,
 * upgrade or cancel button: it only points at them.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const t = (id: string) => `[data-tour="${id}"]`;
const HAS_DATA = { tabHasData: 'billing' } as const;
const EMPTY = { tabIsEmpty: 'billing' } as const;
const NEEDS_PLAN = 'This part shows once you have a plan.';
const CARDS = t('billing-cards');
const CARD_BUTTON = 'button[aria-label="Manage cards"]';

const step = (s: Omit<TourStep, 'route'>): TourStep => ({ route: '/subscription', ...s });

const plan: TabTourTopic = {
  id: 'billing.plan',
  title: 'Your plan',
  summary: 'What you pay each month and changing it, or choosing a plan.',
  steps: [
    step({
      id: 'billing.plan.page',
      label: 'Billing',
      title: 'What you pay us',
      body: 'Billing is your Drive247 subscription: your plan, the card it is charged to and your bills. Your customers’ payments are in Finances, not here.',
      anchors: [...LIST_HEADING],
      side: 'bottom',
    }),
    step({
      id: 'billing.plan.price',
      label: 'Price',
      title: 'One number',
      body: 'This is what you pay each month, with any running discounts, such as referral rewards, already taken off.',
      anchors: [t('billing-price')],
      side: 'bottom',
      requires: HAS_DATA,
    }),
    step({
      id: 'billing.plan.pick',
      label: 'Plans',
      title: 'Pick a plan',
      body: 'Each card is a plan, with its price and what it includes. Subscribe takes you to Stripe to pay, and this page updates once Stripe confirms.',
      anchors: [t('billing-plans'), t('billing-no-plans')],
      side: 'bottom',
      requires: EMPTY,
      notes: [{ text: 'No plans yet? We set them up for you. Email support@drive-247.com.' }],
    }),
    step({
      id: 'billing.plan.trial',
      label: 'Free trial',
      title: 'A free trial',
      body: 'A plan with a free trial takes only a $1 card check today, refunded automatically. Nothing is charged for the plan until the trial ends.',
      anchors: [t('billing-plans'), t('billing-no-plans')],
      side: 'bottom',
      requires: EMPTY,
    }),
    step({
      id: 'billing.plan.upgrade',
      label: 'Upgrade',
      title: 'Upgrade',
      body: 'Upgrade shows the plans with yours marked. Pick another and it shows what is due today and the new monthly price before you go on to Stripe.',
      anchors: [t('billing-upgrade')],
      requires: HAS_DATA,
      side: 'bottom',
    }),
    step({
      id: 'billing.plan.cancel',
      label: 'Cancel',
      title: 'Cancel',
      body: 'Cancel asks what is wrong first, in case we can help. Going ahead sends a request to our team, so nothing ends in one click, and it shows when your access would end.',
      anchors: [t('billing-cancel')],
      requires: HAS_DATA,
      notes: [{ text: 'Pause, when your account has it, stops billing for a quiet spell. A bill that falls inside the pause is skipped.', anchors: [t('billing-pause')] }],
      side: 'bottom',
    }),
    step({
      id: 'billing.plan.after',
      label: 'After',
      title: 'Once you subscribe',
      body: 'This page then shows your monthly price, the card it is charged to and every bill, and you can change plan from here.',
      anchors: [t('billing-plans'), t('billing-no-plans')],
      side: 'bottom',
      requires: EMPTY,
    }),
  ],
};

const bills: TabTourTopic = {
  id: 'billing.bills',
  title: 'Bills and receipts',
  summary: 'Your next bill, every bill before it, and their receipts.',
  requires: HAS_DATA,
  unavailableText: NEEDS_PLAN,
  steps: [
    step({
      id: 'billing.bills.next',
      label: 'Next bill',
      title: 'Your next bill',
      body: 'The highlighted row is the next bill: how much, when, and how many days away.',
      anchors: [t('billing-next-bill'), t('billing-payments')],
      side: 'bottom',
    }),
    step({
      id: 'billing.bills.breakdown',
      label: 'Breakdown',
      title: 'How the price is made',
      body: 'Breakdown shows the price step by step: the base plan, any add-ons, and each discount taken off.',
      anchors: [t('billing-breakdown'), t('billing-next-bill')],
      side: 'bottom',
    }),
    step({
      id: 'billing.bills.list',
      label: 'Past bills',
      title: 'Every bill before it',
      body: 'Below are all your past bills, newest first, each with its status in colour: Paid, Failed, Overdue, Due or Refunded. Scroll for older ones.',
      anchors: [t('billing-bill'), t('billing-payments')],
      side: 'bottom',
    }),
    step({
      id: 'billing.bills.receipt',
      label: 'Receipts',
      title: 'Receipts and PDFs',
      body: 'View receipt opens a paid bill’s receipt, and View invoice an unpaid one. The arrow downloads Stripe’s invoice as a PDF.',
      anchors: [`${t('billing-bill')} button`, t('billing-bill')],
      side: 'bottom',
    }),
  ],
};

const card: TabTourTopic = {
  id: 'billing.card',
  title: 'Your card',
  summary: 'The card your subscription is charged to.',
  requires: HAS_DATA,
  unavailableText: NEEDS_PLAN,
  steps: [
    step({
      id: 'billing.card.card',
      label: 'Card on file',
      title: 'The card we charge',
      body: 'This is the card your subscription is charged to. Click it to manage your cards.',
      mobileBody: 'This is the card your subscription is charged to. Tap it to manage your cards.',
      anchors: [CARD_BUTTON],
      mobileAnchors: [CARD_BUTTON],
      side: 'left',
    }),
    step({
      id: 'billing.card.list',
      label: 'Cards',
      title: 'Every card on the account',
      body: 'Each card shows its last four digits and expiry. The filled star marks the primary card, the one that is charged.',
      anchors: [`${CARDS} ul`, CARDS],
      side: 'left',
      opens: { trigger: [CARD_BUTTON], dialog: CARDS },
    }),
    step({
      id: 'billing.card.actions',
      label: 'Change a card',
      title: 'Edit, remove or switch',
      body: 'Edit changes a card’s name or expiry, and the star makes another card primary. The primary card cannot be removed until another one takes its place.',
      anchors: [`${CARDS} li`, CARDS],
      side: 'left',
      opens: { trigger: [CARD_BUTTON], dialog: CARDS },
    }),
    step({
      id: 'billing.card.add',
      label: 'Add a card',
      title: 'Adding a card',
      body: 'Add card adds a new one. Card numbers are handled by Stripe and never touch Drive247.',
      anchors: [`${CARDS} [data-slot="dialog-footer"]`, CARDS],
      side: 'top',
      opens: { trigger: [CARD_BUTTON], dialog: CARDS },
    }),
  ],
};

const late: TabTourTopic = {
  id: 'billing.late',
  title: 'If a payment fails',
  summary: 'The warning you see, how long you have, and how to settle it.',
  requires: HAS_DATA,
  unavailableText: NEEDS_PLAN,
  steps: [
    step({
      id: 'billing.late.failed',
      label: 'Failed bill',
      title: 'A bill that did not go through',
      body: 'A bill the card did not pay shows Failed or Overdue in red here. An unpaid bill also has Pay now, which opens Stripe’s page for that invoice.',
      anchors: [`${t('billing-bill')}[data-bill-state="failed"]`, `${t('billing-bill')}[data-bill-state="overdue"]`, t('billing-payments')],
      side: 'bottom',
    }),
    step({
      id: 'billing.late.chip',
      label: 'The warning',
      title: 'Your payment is due',
      body: 'While a bill is unpaid, the sidebar says Your payment is due, in amber, turning red as time runs short. Until the grace period ends, everything keeps working.',
      mobileBody: 'While a bill is unpaid, a bar above the page says Your payment is due. Until the grace period ends, everything keeps working.',
      anchors: ['[data-payment-due-bar]', t('billing-past-due'), `${t('billing-bill')}[data-bill-state="failed"]`, t('billing-payments')],
      side: 'bottom',
    }),
    step({
      id: 'billing.late.window',
      label: 'Grace period',
      title: 'How long you have',
      body: 'You get a grace period to pay, set by Drive247. Once it ends, the warning says Overdue and the portal is locked until the bill is paid.',
      anchors: [t('billing-past-due'), `${t('billing-bill')}[data-bill-state="failed"]`, t('billing-payments')],
      side: 'bottom',
    }),
    step({
      id: 'billing.late.settle',
      label: 'Settle it',
      title: 'Paying to unlock',
      body: 'Billing and Settings stay open even while locked. Here you can pay the pending invoice, or update the card so the next bill goes through.',
      anchors: [t('billing-past-due'), CARD_BUTTON, t('billing-payments')],
      side: 'left',
    }),
  ],
};

export const BILLING_TAB_TOUR: TabTour = {
  id: 'billing',
  label: 'Billing',
  homeRoute: '/subscription',
  emptyMessage: 'There is not enough of this tab open to you to walk through.',
  topics: [plan, bills, card, late],
};
