/**
 * The Insights tab tour: six topics, in the order an operator meets them.
 *
 *   1 overview    the views, search and the period
 *   2 receipt     "Where your money went", line by line
 *   3 lines       opening a line to see and correct its entries
 *   4 calculator  the "What if" calculator
 *   5 pnl         P&L per car, and the Analytics charts
 *   6 reports     Reports and the Trax summary
 *
 * Insights keeps its view in `?view=` but reads it only on mount, so a route
 * cannot switch views. A step that needs a view clicks its tab instead
 * (`opens`, with the view's own wrapper as the thing to wait for). Anchors live
 * in `app/(dashboard)/insights/*`, which only Northwind (v2) renders.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

type View = 'numbers' | 'pnl' | 'analytics' | 'reports' | 'trax';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const t = (id: string) => `[data-tour="${id}"]`;
const VIEW = (v: View) => t(`insights-view-${v}`);
const DIALOG = t('insights-dialog');
const REPORT_DIALOG = t('insights-report-dialog');

/** Click the view's tab unless that view is already showing. */
const showView = (v: View): TourStep['opens'] => ({ trigger: [t(`insights-tab-${v}`)], dialog: VIEW(v) });

/** A step on one view, which switches to it first. */
const viewStep = (v: View, s: Omit<TourStep, 'route' | 'opens'>): TourStep => ({
  route: '/insights',
  opens: showView(v),
  ...s,
});

const overview: TabTourTopic = {
  id: 'insights.overview',
  title: 'Insights at a glance',
  summary: 'The five views, search, and choosing the period.',
  steps: [
    {
      id: 'insights.overview.page',
      label: 'Insights',
      title: 'What you earned and spent',
      body: 'Insights shows what the business earned, what it cost to run and what is still owed, worked out from your rentals, payments and costs.',
      route: '/insights',
      anchors: [...LIST_HEADING],
      side: 'bottom',
    },
    {
      id: 'insights.overview.views',
      label: 'Views',
      title: 'Five ways to look at it',
      body: 'Numbers is the summary, P&L goes car by car, Analytics draws charts, Reports are ready to download, and Trax summary is a written review.',
      route: '/insights',
      anchors: ['[role="tablist"][aria-label="Insights view"]'],
      side: 'bottom',
    },
    {
      id: 'insights.overview.search',
      label: 'Search',
      title: 'Find any entry',
      body: 'Search finds the entries behind the figures: a charge, a cost, a car or a refund, by name or amount.',
      route: '/insights',
      anchors: ['input[placeholder="Search entries, cars, customers, amounts…"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. It finds the entries behind the figures: a charge, a cost, a car or a refund.',
      side: 'bottom',
    },
    {
      id: 'insights.overview.period',
      label: 'Period',
      title: 'Choose the period',
      body: 'Filters set the period: the last 3, 6 or 12 months. Every view follows it, and it starts on 12.',
      route: '/insights',
      anchors: ['button[aria-label="Show filters"]', 'button[aria-label="Hide filters"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]'],
      mobileBody: 'The period is a filter, next to search at the bottom: the last 3, 6 or 12 months. Every view follows it.',
      side: 'bottom',
    },
  ],
};

const receipt: TabTourTopic = {
  id: 'insights.receipt',
  title: 'Where your money went',
  summary: 'The Numbers view, written as a sum from top to bottom.',
  steps: [
    viewStep('numbers', {
      id: 'insights.receipt.in',
      label: 'Took in',
      title: 'Money you took in',
      body: 'Everything charged to customers in the period: rentals, extras, delivery and insurance. It is the top of the sum.',
      anchors: [t('insights-took-in')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.back',
      label: 'Gave back',
      title: 'Money you gave back',
      body: 'Refunds you paid to customers come off first.',
      anchors: [t('insights-gave-back')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.never',
      label: 'Never yours',
      title: 'Money that was never yours',
      body: 'Sales tax and refundable deposits passed through your hands but belong to someone else, so they come off too.',
      anchors: [t('insights-never-yours')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.spent',
      label: 'Spent',
      title: 'Money you spent',
      body: 'Servicing, repairs and the other costs of running the cars. A line with nothing in it says none.',
      anchors: [t('insights-spent')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.kept',
      label: 'Kept',
      title: 'Money you kept',
      body: 'What is left is what the business kept, with its share of what you took in. Green is a profit, red a loss.',
      anchors: [t('insights-kept')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.owed',
      label: 'Owed',
      title: 'Still owed to you',
      body: 'Unpaid balances as of today, and how many customers owe them. It sits beside the sum, not in it.',
      anchors: [t('insights-owed')],
      side: 'right',
    }),
    viewStep('numbers', {
      id: 'insights.receipt.rules',
      label: 'What counts where',
      title: 'What counts where',
      body: 'Each kind of charge or cost lands on one line. Here an admin can move a kind to a different line, and every figure on the page follows.',
      anchors: [t('insights-categories')],
      side: 'bottom',
    }),
  ],
};

const lines: TabTourTopic = {
  id: 'insights.lines',
  title: 'Checking a line',
  summary: 'Opening a line to see what is behind it, and correcting an entry.',
  steps: [
    viewStep('numbers', {
      id: 'insights.lines.row',
      label: 'Open a line',
      title: 'Every line opens',
      body: 'Click a line to see the entries behind it. I will open Money you took in.',
      anchors: [t('insights-took-in')],
      side: 'right',
    }),
    {
      id: 'insights.lines.dialog',
      label: 'Behind the line',
      title: 'The summary first',
      body: 'First it breaks the total down, here by what each charge was for, then lists every entry, newest first.',
      route: '/insights',
      anchors: [`${DIALOG} section`, DIALOG],
      side: 'left',
      opens: { trigger: [t('insights-took-in')], dialog: DIALOG },
    },
    {
      id: 'insights.lines.search',
      label: 'Search',
      title: 'Search inside it',
      body: 'Search narrows the list by charge, car, date or amount.',
      route: '/insights',
      anchors: [`${DIALOG} input[type="search"]`, DIALOG],
      side: 'left',
      opens: { trigger: [t('insights-took-in')], dialog: DIALOG },
    },
    {
      id: 'insights.lines.fix',
      label: 'Correct it',
      title: 'Make it match your books',
      body: 'If an entry was really a different amount, an admin can type the right one here. The original stays shown beside it.',
      route: '/insights',
      anchors: [`${DIALOG} input[aria-label^="Amount for"]`, DIALOG],
      side: 'left',
      opens: { trigger: [t('insights-took-in')], dialog: DIALOG },
      notes: [{ text: 'A correction only changes Insights. Invoices and exports keep the recorded figure.' }],
    },
    {
      id: 'insights.lines.leave-out',
      label: 'Leave it out',
      title: 'Leave an entry out',
      body: 'Switch an entry off to leave it out of every figure, for example a test payment. An undo button then puts the original back.',
      route: '/insights',
      anchors: [`${DIALOG} button[role="switch"]`, DIALOG],
      side: 'left',
      opens: { trigger: [t('insights-took-in')], dialog: DIALOG },
    },
  ],
};

const calculator: TabTourTopic = {
  id: 'insights.calculator',
  title: 'The what-if calculator',
  summary: 'Trying more cars, more days or a new price on your own numbers.',
  steps: [
    viewStep('numbers', {
      id: 'insights.calculator.display',
      label: 'What if',
      title: 'Starts from today',
      body: 'The big figure is what you keep a month today, worked out from the same numbers as the sum. Change anything below and it shows the difference.',
      anchors: [t('insights-calc-display')],
      side: 'left',
    }),
    viewStep('numbers', {
      id: 'insights.calculator.keys',
      label: 'The dials',
      title: 'Four dials',
      body: 'Cars on the fleet, days each car is rented a month, the price per day and the running cost per car. Turn one and watch the figure move.',
      anchors: [t('insights-calc-keys')],
      side: 'left',
    }),
    viewStep('numbers', {
      id: 'insights.calculator.quick',
      label: 'Quick tries',
      title: 'One-tap questions',
      body: '+1 car, +2 days, +10% price and −10% costs try the common questions in one tap. My numbers puts everything back.',
      anchors: [t('insights-calc-functions')],
      side: 'left',
    }),
    viewStep('numbers', {
      id: 'insights.calculator.breakeven',
      label: 'Break even',
      title: 'When a car pays for itself',
      body: 'The strip of days shows how many rented days a car needs each month to cover its running cost. Every rented day after that is money you keep.',
      anchors: [t('insights-calc-breakeven')],
      side: 'left',
    }),
  ],
};

const pnl: TabTourTopic = {
  id: 'insights.pnl',
  title: 'Car by car',
  summary: 'P&L for each car, and the Analytics charts.',
  steps: [
    viewStep('pnl', {
      id: 'insights.pnl.table',
      label: 'P&L',
      title: 'One row per car',
      body: 'Each car shows its money in, what it cost, what it kept, its margin, how often it was out and what each day out earned.',
      anchors: [`${VIEW('pnl')} tbody tr`, VIEW('pnl')],
      side: 'bottom',
    }),
    viewStep('pnl', {
      id: 'insights.pnl.sort',
      label: 'Sort',
      title: 'Sort by any column',
      body: 'Click a column heading to sort by it, so the best or worst car comes to the top.',
      mobileBody: 'Tap a heading in this strip to sort the cars by it, so the best or worst car comes to the top.',
      anchors: [`${VIEW('pnl')} thead tr`, VIEW('pnl')],
      mobileAnchors: [`${VIEW('pnl')} thead tr`, VIEW('pnl')],
      side: 'bottom',
    }),
    viewStep('pnl', {
      id: 'insights.pnl.fleet',
      label: 'Whole fleet',
      title: 'The whole fleet',
      body: 'The last row adds every car together, and vs last month shows how this month moved against the one before.',
      anchors: [`${VIEW('pnl')} tfoot tr`, VIEW('pnl')],
      side: 'top',
    }),
    viewStep('analytics', {
      id: 'insights.pnl.analytics',
      label: 'Analytics',
      title: 'The same figures, drawn',
      body: 'Analytics turns the same figures into charts, for the same period. Every mark comes from your real numbers.',
      anchors: [VIEW('analytics')],
      side: 'left',
    }),
  ],
};

const reports: TabTourTopic = {
  id: 'insights.reports',
  title: 'Reports and the Trax summary',
  summary: 'Ready-made reports to download, and a written review of your numbers.',
  steps: [
    viewStep('reports', {
      id: 'insights.reports.grid',
      label: 'Reports',
      title: 'Ready-made reports',
      body: 'Profit and loss, payments received, sales tax, who owes you and more, each built from the same figures for the period you picked.',
      anchors: [t('insights-report'), VIEW('reports')],
      side: 'bottom',
    }),
    {
      id: 'insights.reports.open',
      label: 'Open one',
      title: 'Read it first',
      body: 'A report opens as a table, with how many rows it holds and when its figures were read.',
      route: '/insights',
      anchors: [`${REPORT_DIALOG} h2`, REPORT_DIALOG],
      side: 'left',
      opens: { trigger: [t('insights-report')], dialog: REPORT_DIALOG },
    },
    {
      id: 'insights.reports.download',
      label: 'Download',
      title: 'PDF or CSV',
      body: 'Download it as a PDF to send, or a CSV for a spreadsheet or your accountant. Regenerate reads the figures again first.',
      route: '/insights',
      anchors: [t('insights-report-downloads'), REPORT_DIALOG],
      side: 'bottom',
      opens: { trigger: [t('insights-report')], dialog: REPORT_DIALOG },
    },
    viewStep('trax', {
      id: 'insights.reports.trax',
      label: 'Trax summary',
      title: 'A review written for you',
      body: 'I read every figure on this page and write you a review: what is working, what is not and what to do this week. It is written when you ask, once a week at most, and your whole team reads the same one.',
      anchors: [`${VIEW('trax')} h2`, VIEW('trax')],
      side: 'bottom',
    }),
  ],
};

export const INSIGHTS_TAB_TOUR: TabTour = {
  id: 'insights',
  label: 'Insights',
  homeRoute: '/insights',
  emptyMessage: 'There is not enough of this tab open to you to walk through.',
  topics: [overview, receipt, lines, calculator, pnl, reports],
};
