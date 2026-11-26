/**
 * The Finances tab tour: six topics, in the order an operator meets them.
 *
 *   1 overview   the page, the graph, the card, search, and the empty page
 *   2 list       one row per invoice: entity, due date, the sum, the menu, export
 *   3 invoice    the invoice sheet: details, the sum and its statuses
 *   4 charges    the charges on an invoice and the payments under each one
 *   5 receipts   refunds, and the receipt each landed payment has
 *   6 change     editing, cancelling and deleting an invoice (edit form opened, never saved)
 *
 * Record Payment is a shared v1 dialog that draws above the tour card, so the
 * tour points at its button and lists its fields instead of opening it.
 *
 * `/finances` is one screen with no tab strip: payments live under their
 * invoices (`components/finances-v2`). The old Payments list keeps its own
 * tour (`payments.ts`).
 *
 * There is no `/finances/<id>` route, so emptiness is read from the teaching
 * empty state (`data-tour="finances-empty"`, see `invoices-tab.tsx`) with
 * `tabHasData` / `tabIsEmpty`, as the Payments tour does.
 *
 * Topics 3 to 6 open the first invoice in the list with `opens`, and each of
 * their steps repeats it, so the sheet stays open while they run. Each topic's
 * first step opens the sheet; the triggers fall back to the row, so a topic
 * resumed part way still gets there.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const EMPTY = '[data-tour="finances-empty"]';
const SHEET = '[data-tour="invoice-sheet"]';
const t = (id: string) => `[data-tour="${id}"]`;

const HAS_DATA = { tabHasData: 'finances' } as const;
const NEEDS_INVOICE_TEXT = 'This opens up once your first invoice is made.';

/** Open the first invoice in the list. */
const OPEN_SHEET = { trigger: [t('invoice-row')], dialog: SHEET } as const;
/** Inside the open invoice, open its first charge. */
const OPEN_CHARGE = { trigger: [`${SHEET} ${t('invoice-charge')}`, t('invoice-row')], dialog: t('invoice-charge-open') } as const;
/** Inside the open charge, open the first payment's receipt. */
const OPEN_RECEIPT = {
  trigger: [`${SHEET} ${t('invoice-payment')}`, `${SHEET} ${t('invoice-charge')}`, t('invoice-row')],
  dialog: t('invoice-receipt'),
} as const;

/** The invoice's edit form, opened from the pencil in the sheet. */
const EDIT_BUTTON = `${SHEET} button[aria-label="Edit invoice"]`;
const EDIT_DIALOG = t('invoice-edit-dialog');
const OPEN_EDIT = { trigger: [EDIT_BUTTON, t('invoice-row')], dialog: EDIT_DIALOG } as const;

const sheetStep = (s: Omit<TourStep, 'route' | 'opens'> & { opens?: TourStep['opens'] }): TourStep => ({
  route: '/finances',
  opens: OPEN_SHEET,
  ...s,
  requires: { ...HAS_DATA, ...s.requires },
});

const overview: TabTourTopic = {
  id: 'finances.overview',
  title: 'Your money at a glance',
  summary: 'What this page holds, the graph, the card and search.',
  steps: [
    {
      id: 'finances.overview.page',
      label: 'Finances',
      title: 'Invoices, payments and receipts',
      body: 'Each rental makes its own invoice here. Under every invoice sit the payments made against it, and each payment has a receipt.',
      route: '/finances',
      anchors: [...LIST_HEADING],
      side: 'bottom',
    },
    {
      id: 'finances.overview.chart',
      label: 'Invoiced',
      title: 'Invoiced and collected',
      body: 'The dark line adds up your invoices by their invoice date. The lighter line is the money collected against them, on the day it landed, less any refund.',
      route: '/finances',
      anchors: [t('finances-chart')],
      side: 'bottom',
      requires: HAS_DATA,
      notes: [{ text: 'Pick the period at the top right of the graph. The dotted line is the period before it.' }],
    },
    {
      id: 'finances.overview.card',
      label: 'The card',
      title: 'One setting worth a look',
      body: 'This card points at Auto-charge, which bills a customer’s saved card without sending them a pay link. Open takes you to the setting.',
      route: '/finances',
      anchors: [t('finances-featured')],
      side: 'bottom',
      requires: HAS_DATA,
    },
    {
      id: 'finances.overview.search',
      label: 'Search',
      title: 'Find an invoice fast',
      body: 'I search invoice numbers, customer names, plates, makes and models as you type.',
      route: '/finances',
      anchors: ['input[placeholder="Search by invoice #, customer, or vehicle…"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. Here it finds invoices by number, customer name, plate, make or model.',
      side: 'bottom',
      requires: HAS_DATA,
    },
    // Before the first invoice: the page is one teaching card.
    {
      id: 'finances.overview.empty-made',
      label: 'Made for you',
      title: 'Invoices make themselves',
      body: 'There is nothing to set up here. When you create a rental, its invoice is made for you, with what the customer owes and what is paid.',
      route: '/finances',
      anchors: [`${EMPTY} h3`, ...LIST_HEADING],
      side: 'bottom',
      requires: { tabIsEmpty: 'finances' },
    },
    {
      id: 'finances.overview.empty-first',
      label: 'First rental',
      title: 'Start with a rental',
      body: 'The plus button opens the new rental form. The button beside it plays a short video on how invoices work.',
      route: '/finances',
      anchors: [`${EMPTY} button[aria-label="Create your first rental"]`, `${EMPTY} h3`, ...LIST_HEADING],
      side: 'top',
      requires: { tabIsEmpty: 'finances' },
    },
    {
      id: 'finances.overview.empty-later',
      label: 'When it fills',
      title: 'What this page becomes',
      body: 'Once invoices exist, this page shows a graph of what you invoiced and collected, then one row per invoice. I will walk you through it then.',
      route: '/finances',
      anchors: [EMPTY, ...LIST_HEADING],
      side: 'bottom',
      requires: { tabIsEmpty: 'finances' },
    },
    {
      id: 'finances.overview.record',
      label: 'Record Payment',
      title: 'Money that came in elsewhere',
      body: 'Cash in hand or a bank transfer never touches your booking site. Record Payment opens a short form for it: customer, car, amount, method, date and a reference.',
      route: '/finances',
      anchors: [t('finances-record')],
      side: 'bottom',
      requires: { tab: 'payments', edit: true },
    },
  ],
};

const list: TabTourTopic = {
  id: 'finances.list',
  title: 'The invoice list',
  summary: 'What each row says, what the colours mean, and the row menu.',
  requires: HAS_DATA,
  unavailableText: NEEDS_INVOICE_TEXT,
  steps: [
    {
      id: 'finances.list.row',
      label: 'An invoice',
      title: 'Each row is one invoice',
      body: 'Its number, what it is for, the customer and when it is due. Click anywhere on the row to open it, or hover the number to copy it.',
      mobileBody: 'Its number, what it is for, the customer and when it is due, newest first. Tap it to open it.',
      mobileAnchors: [t('invoice-row')],
      route: '/finances',
      anchors: [t('invoice-row')],
      side: 'bottom',
      requires: HAS_DATA,
    },
    {
      id: 'finances.list.entity',
      label: 'Entity',
      title: 'What the invoice is for',
      body: 'Entity says what it bills: a rental, a fine or a customer account. Entity ref says which one, like the rental’s number.',
      route: '/finances',
      anchors: [t('invoice-entity'), t('invoice-row')],
      side: 'bottom',
      requires: HAS_DATA,
    },
    {
      id: 'finances.list.due',
      label: 'Due date',
      title: 'Red means overdue',
      body: 'This date turns red once money on the invoice is late. While something is owed, it shows the earliest unpaid charge’s date.',
      route: '/finances',
      anchors: [t('invoice-due'), t('invoice-row')],
      side: 'bottom',
      requires: HAS_DATA,
      notes: [{ text: 'A security deposit is a hold, not a debt, so it never makes an invoice overdue.' }],
    },
    {
      id: 'finances.list.sum',
      label: 'The sum',
      title: 'Total minus paid equals remaining',
      body: 'The last figure is what is left to collect, and its colour is the status: green paid, amber part paid, grey unpaid. Hover it to see how it adds up.',
      mobileBody: 'The last figure is what is left to collect, and its colour is the status: green paid, amber part paid, grey unpaid.',
      mobileAnchors: [t('invoice-amount'), t('invoice-row')],
      route: '/finances',
      anchors: [t('invoice-amount'), t('invoice-row')],
      side: 'left',
      requires: HAS_DATA,
      notes: [{ text: 'A cancelled invoice has a red line through the sum.' }],
    },
    {
      id: 'finances.list.menu',
      label: 'Row menu',
      title: 'Email it, or delete it',
      body: 'The menu at the end of a row sends the invoice to the customer by email, or deletes it. Delete asks you first.',
      route: '/finances',
      anchors: [t('invoice-row-menu')],
      side: 'left',
      requires: { ...HAS_DATA, tab: 'invoices', edit: true },
    },
    {
      id: 'finances.list.export',
      label: 'Export',
      title: 'Take the list with you',
      body: 'This downloads the invoices you are looking at as a spreadsheet, with your search applied.',
      route: '/finances',
      anchors: [t('finances-export'), 'button[aria-label="Export CSV"]'],
      side: 'bottom',
      requires: HAS_DATA,
    },
  ],
};

const invoice: TabTourTopic = {
  id: 'finances.invoice',
  title: 'Opening an invoice',
  summary: 'The invoice sheet: its details, its sum and its statuses. I open one for you.',
  requires: HAS_DATA,
  unavailableText: NEEDS_INVOICE_TEXT,
  steps: [
    {
      id: 'finances.invoice.open',
      label: 'Open one',
      title: 'Click a row to open it',
      body: 'The invoice slides in from the right, with the list still beside it. I will open the first one now.',
      route: '/finances',
      anchors: [t('invoice-row')],
      side: 'bottom',
      requires: HAS_DATA,
    },
    sheetStep({
      id: 'finances.invoice.header',
      label: 'The invoice',
      title: 'One invoice, everything on it',
      body: 'Its number is at the top. Esc or a click outside closes it again.',
      mobileBody: 'Its number is at the top, and everything about it is underneath.',
      mobileAnchors: [`${SHEET} [data-slot="sheet-title"]`, SHEET],
      anchors: [`${SHEET} [data-slot="sheet-title"]`, SHEET],
      side: 'left',
    }),
    sheetStep({
      id: 'finances.invoice.details',
      label: 'Details',
      title: 'The facts, folded away',
      body: 'Details opens the customer, car and rental with links to each, what it is for, the issue and due dates, the payment status and any notes.',
      anchors: [t('invoice-details'), SHEET],
      side: 'left',
    }),
    sheetStep({
      id: 'finances.invoice.sum',
      label: 'The sum',
      title: 'The invoice as one sum',
      body: 'Total, minus what is paid, minus anything credited, equals what is still owed.',
      anchors: [t('invoice-sum'), SHEET],
      side: 'left',
    }),
    sheetStep({
      id: 'finances.invoice.pills',
      label: 'Statuses',
      title: 'Paid, and on time?',
      body: 'At the bottom: what it is for, how much is paid, and whether it is late. While money is owed it reads Upcoming, Due today, Due on receipt, Overdue or No due date.',
      anchors: [t('invoice-pills'), SHEET],
      side: 'top',
    }),
  ],
};

const charges: TabTourTopic = {
  id: 'finances.charges',
  title: 'Charges and payments',
  summary: 'The lines on an invoice, and the payments that paid each one.',
  requires: HAS_DATA,
  unavailableText: NEEDS_INVOICE_TEXT,
  steps: [
    sheetStep({
      id: 'finances.charges.lines',
      label: 'Charges',
      title: 'Each line is a charge',
      body: 'The rental, the deposit, extras and the rest. A charge’s amount is green when paid, amber when part paid and grey when nothing is paid yet.',
      anchors: [t('invoice-charges'), t('invoice-sum'), SHEET],
      side: 'left',
    }),
    sheetStep({
      id: 'finances.charges.open',
      label: 'Open a charge',
      title: 'What paid it',
      body: 'I opened the first charge. Under it are the payments that paid it, then what is paid and what remains on that line.',
      anchors: [t('invoice-charge-open'), t('invoice-charges'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
    }),
    sheetStep({
      id: 'finances.charges.payment',
      label: 'A payment',
      title: 'Where the money came from',
      body: 'Each payment shows how it came in: Manual with its method, At booking, Link emailed or Auto-charge, and the date. A link not paid yet says it is waiting.',
      anchors: [t('invoice-payment'), t('invoice-payment-pending'), t('invoice-charge-open'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
    }),
    sheetStep({
      id: 'finances.charges.remaining',
      label: 'Remaining',
      title: 'Paid and remaining',
      body: 'Under the line, Paid is what was kept on this charge and Remaining is what is still owed on it.',
      anchors: [t('invoice-charge-open'), t('invoice-charges'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
      notes: [
        {
          text: 'Add payment records one against this charge for what is left.',
          anchors: [t('invoice-add-payment')],
        },
      ],
    }),
    sheetStep({
      id: 'finances.charges.deposit',
      label: 'Deposits',
      title: 'Deposits are holds',
      body: 'A security deposit is a hold on the customer’s card, not a debt, so it never makes an invoice overdue.',
      anchors: [t('invoice-charges'), t('invoice-sum'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
    }),
  ],
};

const receipts: TabTourTopic = {
  id: 'finances.receipts',
  title: 'Refunds and receipts',
  summary: 'How a refund shows, and the receipt every payment has.',
  requires: HAS_DATA,
  unavailableText: NEEDS_INVOICE_TEXT,
  steps: [
    sheetStep({
      id: 'finances.receipts.open',
      label: 'Inside an invoice',
      title: 'Receipts live in the invoice',
      body: 'Every payment sits under the charge it paid, inside its invoice. I opened the first invoice.',
      anchors: [t('invoice-charges'), t('invoice-sum'), SHEET],
      side: 'left',
    }),
    sheetStep({
      id: 'finances.receipts.payment',
      label: 'A payment',
      title: 'Every payment has a receipt',
      body: 'Once a payment’s money has landed, its row opens its receipt. Hover it and View receipt takes the place of the amount.',
      mobileBody: 'Once a payment’s money has landed, tapping its row opens its receipt.',
      mobileAnchors: [t('invoice-payment'), t('invoice-charge-open'), SHEET],
      anchors: [t('invoice-payment'), t('invoice-charge-open'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
    }),
    sheetStep({
      id: 'finances.receipts.refund',
      label: 'Refunds',
      title: 'Money given back',
      body: 'A refund shows in red under the payment it gave back, as Refund to card or Manual refund. It never changes what a charge still owes.',
      anchors: [t('invoice-refund'), t('invoice-charge-open'), SHEET],
      side: 'left',
      opens: OPEN_CHARGE,
      notes: [{ text: 'Refunds are given from the rental the invoice belongs to.' }],
    }),
    sheetStep({
      id: 'finances.receipts.slip',
      label: 'Receipt',
      title: 'Proof of payment',
      body: 'The receipt says when it was paid, who paid, how, which invoice it was for, and what it paid. One payment, one receipt.',
      anchors: [t('invoice-receipt')],
      side: 'left',
      opens: OPEN_RECEIPT,
    }),
    sheetStep({
      id: 'finances.receipts.print',
      label: 'Print',
      title: 'Print it',
      body: 'Print receipt prints the slip on its own, ready to hand to the customer.',
      anchors: [t('receipt-print'), t('invoice-receipt')],
      side: 'top',
      opens: OPEN_RECEIPT,
    }),
    sheetStep({
      id: 'finances.receipts.back',
      label: 'Back',
      title: 'Back to the invoice',
      body: 'This takes you back to the invoice’s charges.',
      anchors: [t('invoice-receipt-back'), t('invoice-receipt')],
      side: 'bottom',
      opens: OPEN_RECEIPT,
    }),
  ],
};

const change: TabTourTopic = {
  id: 'finances.change',
  title: 'Changing an invoice',
  summary: 'Editing its dates and notes, cancelling it, and deleting it. I open the edit form and save nothing.',
  requires: HAS_DATA,
  unavailableText: NEEDS_INVOICE_TEXT,
  steps: [
    sheetStep({
      id: 'finances.change.edit',
      label: 'Edit',
      title: 'The pencil edits it',
      body: 'Its actions sit at the top right of the invoice. I will open the edit form so you can see what it changes.',
      anchors: [EDIT_BUTTON, t('invoice-actions')],
      side: 'left',
      requires: { tab: 'invoices', edit: true },
    }),
    sheetStep({
      id: 'finances.change.form',
      label: 'Dates and notes',
      title: 'Only dates and notes',
      body: 'Here you change when it was issued, when it is due, and its notes. The amounts come from its charges, so they never change here.',
      anchors: [EDIT_DIALOG],
      side: 'left',
      opens: OPEN_EDIT,
      requires: { tab: 'invoices', edit: true },
    }),
    sheetStep({
      id: 'finances.change.save',
      label: 'Save',
      title: 'Save, or leave it',
      body: 'Save keeps your changes and Cancel closes the form without them. I will close it without saving.',
      anchors: [`${EDIT_DIALOG} [data-slot="dialog-footer"]`, EDIT_DIALOG],
      side: 'top',
      opens: OPEN_EDIT,
      requires: { tab: 'invoices', edit: true },
    }),
    {
      id: 'finances.change.cancel',
      label: 'Cancel invoice',
      title: 'Cancelling an invoice',
      body: 'Cancel keeps the invoice on record but nothing more is collected on it. Payments already made are not refunded, and you can restore it later.',
      route: '/finances',
      anchors: [`${SHEET} button[aria-label="Cancel invoice"]`, `${SHEET} button[aria-label="Restore invoice"]`],
      side: 'left',
      requires: { ...HAS_DATA, tab: 'invoices', edit: true },
      notes: [
        {
          text: 'Pay shows while money is owed, and opens the Record Payment form for what is left.',
          anchors: [t('invoice-pay')],
        },
      ],
    },
    {
      id: 'finances.change.delete',
      label: 'Delete',
      title: 'Deleting an invoice',
      body: 'The bin deletes the invoice. It asks you first, and I only point at it.',
      route: '/finances',
      anchors: [`${SHEET} button[aria-label="Delete invoice"]`],
      side: 'left',
      requires: { ...HAS_DATA, tab: 'invoices', edit: true },
    },
  ],
};

export const FINANCES_TAB_TOUR: TabTour = {
  id: 'finances',
  label: 'Finances',
  homeRoute: '/finances',
  emptyMessage: 'There is not enough of this tab open to you to walk through.',
  topics: [overview, list, invoice, charges, receipts, change],
};
