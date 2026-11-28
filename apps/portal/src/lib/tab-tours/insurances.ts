/**
 * The Insurances tab tour: four topics, in the order an operator meets them.
 *
 *   1 list    the page: the two tabs, one row per policy, the Bonzah filter; or the empty page
 *   2 status  policy status, payment and premium
 *   3 buy     how a policy is bought: at checkout, or with Generate Insurance
 *   4 open    opening the rental, downloading a policy, exporting them all
 *
 * The page itself (`app/(dashboard)/insurances/page.tsx`) is shared with every
 * other company, so only the policies table (`insurance-v2`) carries markers.
 * Its rows name their rental (`data-record-kind="rentals"`), which is how
 * `requires.record: 'rentalId'` tells a list with policies from an empty one.
 * Everything else is found by what the shared page already draws: its heading,
 * the tab triggers' ids, aria labels and the empty state's own button.
 *
 * There is no Tour button on this tab yet: the header lives in the shared page.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const ROUTE = '/insurances';

const ROW = '[data-tour="insurance-row"]';
const HAS = { record: 'rentalId' } as const;
const EMPTY = { noRecord: 'rentalId' } as const;
const NEEDS_ONE = { record: 'rentalId' } as const;
const NEEDS_ONE_TEXT = 'Your first policy opens this topic.';

/** Radix gives each tab trigger an id ending in its value. */
const POLICIES_TAB = '[id$="-trigger-policies"]';
const VERIFY_TAB = '[id$="-trigger-verifications"]';
const EMPTY_HEADLINE = '[role="tabpanel"] h3';
const SET_UP = 'button[aria-label="Set up Bonzah insurance"]';

const at = (s: Omit<TourStep, 'route'>): TourStep => ({ route: ROUTE, ...s });

const list: TabTourTopic = {
  id: 'insurances.list',
  title: 'Your insurance list',
  summary: 'The two tabs, one row per policy, and finding Bonzah cover.',
  steps: [
    at({
      id: 'insurances.list.tabs',
      label: 'Two tabs',
      title: 'Policies and checks',
      body: 'Policies lists every insurance record. The tab beside it checks an insurance document a customer gives you and reads its details.',
      anchors: [POLICIES_TAB, 'main [role="tablist"]', ...LIST_HEADING],
      side: 'bottom',
      span: [VERIFY_TAB],
    }),
    at({
      id: 'insurances.list.row',
      label: 'A policy',
      title: 'One row per insurance',
      body: 'Bonzah policies, INSHUR cover and documents you uploaded, all in one list. A Bonzah or INSHUR row opens the rental it covers.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
      notes: [{ text: 'Under the name I show the cover dates, and for an uploaded document its insurer and policy number.' }],
    }),
    at({
      id: 'insurances.list.bonzah',
      label: 'Bonzah only',
      title: 'Only Bonzah policies',
      body: 'Bonzah Only narrows the list to policies sold through Bonzah. Click it again to see everything.',
      anchors: ['[role="tabpanel"] button[aria-pressed]', ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    // Nothing yet: the page is one teaching card, so the topic teaches from it.
    at({
      id: 'insurances.list.empty',
      label: 'No policies yet',
      title: 'Cover sold at checkout',
      body: 'With Bonzah on, customers add cover as they book, and each policy lands in this list.',
      anchors: [EMPTY_HEADLINE, ...LIST_HEADING],
      side: 'bottom',
      requires: EMPTY,
    }),
    at({
      id: 'insurances.list.empty-setup',
      label: 'Set up Bonzah',
      title: 'Start with Bonzah',
      body: 'This takes you to Insurance in Settings, where you apply for Bonzah so customers can buy cover as they book.',
      anchors: [SET_UP, EMPTY_HEADLINE, ...LIST_HEADING],
      side: 'top',
      requires: EMPTY,
    }),
    at({
      id: 'insurances.list.empty-later',
      label: 'When it fills',
      title: 'What this page becomes',
      body: 'Once policies come in, this page counts them, lets you filter to Bonzah, and shows one row per policy with its status and payment.',
      anchors: [EMPTY_HEADLINE, ...LIST_HEADING],
      side: 'bottom',
      requires: EMPTY,
    }),
  ],
};

const status: TabTourTopic = {
  id: 'insurances.status',
  title: 'Status and payment',
  summary: 'What each policy status means, and whether the cover is paid.',
  requires: NEEDS_ONE,
  unavailableText: NEEDS_ONE_TEXT,
  steps: [
    at({
      id: 'insurances.status.active',
      label: 'Status',
      title: 'Is the cover in force?',
      body: 'Active is in force. Quoted and Payment Pending are not paid for yet, and Cancelled or Failed give no cover.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.status.balance',
      label: 'Insufficient balance',
      title: 'Insufficient Balance',
      body: 'Insufficient Balance, in red, is a policy Bonzah refused to issue. The customer has no cover from it.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.status.premium',
      label: 'Premium',
      title: 'What the cover costs',
      body: 'Premium is the price of the cover. INSHUR cover shows Included, because the renter is not charged for it on its own.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.status.payment',
      label: 'Payment',
      title: 'Has it been paid?',
      body: 'Payment says Paid, Partial or Unpaid, from how much is still owed on the rental’s charge for the cover.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
  ],
};

const buy: TabTourTopic = {
  id: 'insurances.buy',
  title: 'How a policy is bought',
  summary: 'Cover bought at checkout, or added to a rental from here.',
  requires: NEEDS_ONE,
  unavailableText: NEEDS_ONE_TEXT,
  steps: [
    at({
      id: 'insurances.buy.checkout',
      label: 'At checkout',
      title: 'Most cover is bought online',
      body: 'With Bonzah on, customers add cover as they book on your site. Each policy shows up here with the rental it belongs to.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.buy.generate',
      label: 'Generate Insurance',
      title: 'Adding cover yourself',
      body: 'Generate Insurance asks which rental the cover is for, then lets you buy a Bonzah policy for it.',
      anchors: ['main button.bg-gradient-primary', ...LIST_HEADING],
      side: 'bottom',
      requires: { record: 'rentalId', tab: 'insurances', edit: true },
      notes: [{ text: 'While Bonzah is in test mode or turned off, this button is greyed out and existing policies stay viewable.' }],
    }),
    at({
      id: 'insurances.buy.pay',
      label: 'Add Payment',
      title: 'Taking the money for it',
      body: 'For cover that is Unpaid or Partial, the row’s menu has Add Payment, which records it against that rental.',
      anchors: [`${ROW} button[aria-label^="Actions for"]`, ROW, ...LIST_HEADING],
      side: 'left',
      requires: { record: 'rentalId', tab: 'insurances', edit: true },
    }),
  ],
};

const open: TabTourTopic = {
  id: 'insurances.open',
  title: 'Opening and downloading',
  summary: 'The rental behind a policy, the policy PDF, and exporting them all.',
  requires: NEEDS_ONE,
  unavailableText: NEEDS_ONE_TEXT,
  steps: [
    at({
      id: 'insurances.open.rental',
      label: 'The rental',
      title: 'Open the rental',
      body: 'Click a Bonzah or INSHUR row to open the rental it covers. An uploaded document does not open a rental.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.open.menu',
      label: 'Row menu',
      title: 'Download a policy',
      body: 'The row’s menu has Download PDF for a Bonzah policy and View Rental. An uploaded document offers Download and Open in new tab.',
      anchors: [`${ROW} button[aria-label^="Actions for"]`, ROW, ...LIST_HEADING],
      side: 'left',
      requires: HAS,
    }),
    at({
      id: 'insurances.open.export',
      label: 'Export PDFs',
      title: 'Every record at once',
      body: 'Export PDFs downloads one zip file with a PDF record for every insurance on this tab.',
      anchors: ['button[aria-label="Export PDFs"]', ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'insurances.open.analytics',
      label: 'Analytics',
      title: 'Insurance analytics',
      body: 'This opens charts and figures for your insurance records.',
      anchors: ['a[aria-label="Insurance analytics"]', ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
  ],
};

export const INSURANCES_TAB_TOUR: TabTour = {
  id: 'insurances',
  label: 'Insurances',
  homeRoute: ROUTE,
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Insurances.',
  topics: [list, status, buy, open],
};
