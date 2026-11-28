/**
 * The Agreements tab tour: five topics, in the order an operator meets them.
 *
 *   1 list       the page: graph, Template Studio, one row per agreement; or the empty page
 *   2 status     Pending, Signed and Failed, and what a row tells you
 *   3 send       the Send agreement form, opened by the tour itself
 *   4 open       opening an agreement: the document, Details, Activity, the PDF, Resend
 *   5 templates  the templates window, opened by the tour through `?view=templates`
 *
 * Agreements have no record route, so "the tab has agreements" is read from
 * the empty state's marker (`data-tour="agreements-empty"`, put round it in
 * `agreements-page-v2.tsx`): `tabHasData` / `tabIsEmpty` split the steps.
 *
 * The open agreement and the list's table are drawn by `shared/portal-v2`
 * (the customer portal draws them too), so those steps point at the row
 * marker set through `rowProps` and at the dialog's own roles.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const ROUTE = '/agreements';

const HAS = { tabHasData: 'agreements' } as const;
const EMPTY = { tabIsEmpty: 'agreements' } as const;
const NEEDS_ONE_TEXT = 'Send your first agreement to open this topic.';

const EMPTY_STATE = '[data-tour="agreements-empty"]';
const ROW = '[data-tour="agreement-row"]';

const SEND_DIALOG = '[data-tour="send-agreement-dialog"]';
const OPEN_SEND = {
  trigger: ['[data-tour="agreements-send"]', `${EMPTY_STATE} button[aria-label="Send agreement"]`],
  dialog: SEND_DIALOG,
} as const;
const CAN_SEND = { tab: 'agreements', edit: true } as const;

/** The open agreement: the only dialog on this page with a Details / Activity switch. */
const VIEW = '[role="dialog"]:has([role="tablist"])';
const OPEN_VIEW = { trigger: [ROW], dialog: VIEW } as const;

const TEMPLATES = '[data-tour="agreement-templates-dialog"]';
const TEMPLATES_TABLE = 'table[aria-label="Agreement templates"]';
const TEMPLATES_ROUTE = '/agreements?view=templates';

const at = (s: Omit<TourStep, 'route'>): TourStep => ({ route: ROUTE, ...s });

const list: TabTourTopic = {
  id: 'agreements.list',
  title: 'Your agreements',
  summary: 'The page: the graph, Template Studio, and one row per agreement.',
  steps: [
    at({
      id: 'agreements.list.chart',
      label: 'The graph',
      title: 'Is paperwork getting signed?',
      body: 'This graph counts agreements sent, with the ones signed as a second line. Switch it to Signed to count signatures as they come back.',
      anchors: ['[data-tour="agreements-chart"]', ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
      closesDialogs: true,
    }),
    at({
      id: 'agreements.list.studio',
      label: 'Template Studio',
      title: 'Your templates, one click away',
      body: 'Template Studio opens your agreement templates, where you write and edit them with Trax.',
      anchors: ['[data-tour="agreements-create-template"]', ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'agreements.list.row',
      label: 'An agreement',
      title: 'One row per agreement',
      body: 'Every agreement sent, from a rental or from this tab, newest first. Click a row to open it.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
      notes: [{ text: 'Linked to says Rental or Customer, and Reference gives the rental number or the customer ID.' }],
    }),
    at({
      id: 'agreements.list.send',
      label: 'Send agreement',
      title: 'Send one from here',
      body: 'Send agreement sends a document to anyone for e-signature, without a rental. Rentals send theirs from the rental itself.',
      anchors: ['[data-tour="agreements-send"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { ...HAS, ...CAN_SEND },
    }),
    // An empty tab: the page is one teaching card, so the topic teaches from it.
    at({
      id: 'agreements.list.empty',
      label: 'Nothing sent yet',
      title: 'Every agreement in one place',
      body: 'Each agreement you send lands here, from a rental or from this tab. I follow it until it comes back signed.',
      anchors: [`${EMPTY_STATE} h3`, EMPTY_STATE, ...LIST_HEADING],
      side: 'bottom',
      requires: EMPTY,
      closesDialogs: true,
    }),
    at({
      id: 'agreements.list.empty-send',
      label: 'Send agreement',
      title: 'Send your first one',
      body: 'This sends a document to anyone for e-signature. You pick who signs and a template, check it, then send.',
      anchors: [`${EMPTY_STATE} button[aria-label="Send agreement"]`, EMPTY_STATE],
      side: 'top',
      requires: { ...EMPTY, ...CAN_SEND },
    }),
    at({
      id: 'agreements.list.empty-template',
      label: 'Templates',
      title: 'Or write your template first',
      body: 'Create a template starts a new agreement template in the editor. Until you have one, rentals send the built-in agreement.',
      anchors: [`${EMPTY_STATE} button[aria-label="Create a template"]`, EMPTY_STATE],
      side: 'top',
      requires: EMPTY,
    }),
    at({
      id: 'agreements.list.empty-later',
      label: 'When it fills',
      title: 'What this page becomes',
      body: 'Once agreements go out, this page shows a graph of what was sent and signed, and one row per agreement.',
      anchors: [EMPTY_STATE, ...LIST_HEADING],
      side: 'bottom',
      requires: EMPTY,
    }),
  ],
};

const status: TabTourTopic = {
  id: 'agreements.status',
  title: 'What the status means',
  summary: 'Pending, Signed and Failed, and why one failed.',
  requires: HAS,
  unavailableText: NEEDS_ONE_TEXT,
  steps: [
    at({
      id: 'agreements.status.three',
      label: 'Status',
      title: 'Three statuses',
      body: 'Pending is out with the customer, Signed has come back signed, and Failed never got signed. Status is the last column.',
      anchors: [`${ROW}[data-agreement-status="pending"]`, ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'agreements.status.failed',
      label: 'Failed',
      title: 'Why one failed',
      body: 'Failed covers a customer who declined, one that expired, and one the signing service turned down. Open it and I say which.',
      anchors: [`${ROW}[data-agreement-status="failed"]`, ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
    at({
      id: 'agreements.status.signed',
      label: 'Signed',
      title: 'Signed means done',
      body: 'A signed agreement cannot be resent from here. Open it to download the signed PDF.',
      anchors: [`${ROW}[data-agreement-status="signed"]`, ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
      notes: [{ text: 'To change a signed rental’s terms, send an updated agreement from the rental.' }],
    }),
    at({
      id: 'agreements.status.cancelled',
      label: 'Replaced copies',
      title: 'A cancelled copy leaves the list',
      body: 'When a rental’s agreement is issued again, the copy before it is cancelled and drops off this list.',
      anchors: [`${ROW}[data-agreement-kind="rental"]`, ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
    }),
  ],
};

const send: TabTourTopic = {
  id: 'agreements.send',
  title: 'Sending an agreement',
  summary: 'The Send agreement form, step by step. I open it for you.',
  steps: [
    at({
      id: 'agreements.send.button',
      label: 'Send agreement',
      title: 'Sending starts here',
      body: 'Send agreement opens a short form in three steps. I will open it now so you can see it.',
      anchors: ['[data-tour="agreements-send"]', `${EMPTY_STATE} button[aria-label="Send agreement"]`],
      side: 'bottom',
      requires: CAN_SEND,
      closesDialogs: true,
    }),
    at({
      id: 'agreements.send.steps',
      label: 'Three steps',
      title: 'Details, Template, Preview',
      body: 'Next checks the step you are on before moving on, and Back keeps everything you typed.',
      anchors: ['[data-tour="send-agreement-steps"]', SEND_DIALOG],
      side: 'bottom',
      opens: OPEN_SEND,
      requires: CAN_SEND,
    }),
    at({
      id: 'agreements.send.recipient',
      label: 'Who signs',
      title: 'One person signs',
      body: 'A name and an email for the person who signs. The signing service emails them the agreement under your company name.',
      anchors: ['[data-tour="send-agreement-recipient"]', SEND_DIALOG],
      side: 'bottom',
      opens: OPEN_SEND,
      requires: CAN_SEND,
      notes: [
        { text: 'CC takes any number of emails, and each one gets a copy.' },
        { text: 'The message goes in their email and shows where they sign.' },
      ],
    }),
    at({
      id: 'agreements.send.template',
      label: 'Template',
      title: 'Pick the wording',
      body: 'Step two lists your templates with the default picked. Create new writes one just for this send, and no template is saved.',
      anchors: ['[data-tour="send-agreement-steps"]', SEND_DIALOG],
      side: 'bottom',
      opens: OPEN_SEND,
      requires: CAN_SEND,
    }),
    at({
      id: 'agreements.send.preview',
      label: 'Preview',
      title: 'See it before it goes',
      body: 'Step three shows the document exactly as it will be sent, with their details and yours filled in. Send is there.',
      anchors: ['[data-tour="send-agreement-steps"]', SEND_DIALOG],
      side: 'bottom',
      opens: OPEN_SEND,
      requires: CAN_SEND,
      notes: [{ text: 'Edit on the preview changes a copy for this send. Your template stays as it is.' }],
    }),
    at({
      id: 'agreements.send.after',
      label: 'Sent',
      title: 'After you send',
      body: 'It shows in this list as Pending while it waits. When they sign, it turns Signed the next time you open this tab.',
      anchors: [ROW, EMPTY_STATE, ...LIST_HEADING],
      side: 'bottom',
      closesDialogs: true,
    }),
  ],
};

const open: TabTourTopic = {
  id: 'agreements.open',
  title: 'Opening an agreement',
  summary: 'The document, its details and history, the PDF, and resending.',
  requires: HAS,
  unavailableText: NEEDS_ONE_TEXT,
  steps: [
    at({
      id: 'agreements.open.row',
      label: 'Open one',
      title: 'Click a row to open it',
      body: 'I will open the newest agreement for you. You see the document that was sent, or why it never went out.',
      anchors: [ROW, ...LIST_HEADING],
      side: 'bottom',
      requires: HAS,
      closesDialogs: true,
    }),
    at({
      id: 'agreements.open.details',
      label: 'Details',
      title: 'Details and Activity',
      body: 'Details shows who it went to, when, its status and what it is linked to. Activity lists everything that happened to it.',
      anchors: [`${VIEW} [role="tablist"]`, VIEW],
      side: 'left',
      opens: OPEN_VIEW,
      requires: HAS,
    }),
    at({
      id: 'agreements.open.pdf',
      label: 'The PDF',
      title: 'Download the signed copy',
      body: 'Once signed, Download signed PDF saves the signed copy, and New tab opens it in your browser.',
      mobileBody: 'Once signed, the download button at the top saves the signed copy, and the button beside it opens it in a new tab.',
      anchors: [`${VIEW} [role="tablist"]`, VIEW],
      mobileAnchors: [`${VIEW} button[aria-label="Download"]`, VIEW],
      side: 'left',
      opens: OPEN_VIEW,
      requires: HAS,
    }),
    at({
      id: 'agreements.open.resend',
      label: 'Resend',
      title: 'Resending one that is not signed',
      body: 'Resend asks first. For a rental, I send a reminder with the same signing link, and only issue a new copy if the old one cannot be signed.',
      anchors: [`${VIEW} [role="tablist"]`, VIEW],
      side: 'left',
      opens: OPEN_VIEW,
      requires: { ...HAS, ...CAN_SEND },
      notes: [
        { text: 'An agreement you sent from this tab goes again as a new row, and the first one stays as it was.' },
        { text: 'An extension agreement is sent again from its rental.' },
      ],
    }),
  ],
};

const templates: TabTourTopic = {
  id: 'agreements.templates',
  title: 'Templates',
  summary: 'Your agreement templates, the default, and writing a new one. I open them for you.',
  steps: [
    {
      id: 'agreements.templates.window',
      label: 'Templates',
      title: 'Your agreement templates',
      body: 'Your default template is the one sent from rentals. Until you make your own, rentals send the built-in agreement.',
      route: TEMPLATES_ROUTE,
      anchors: [TEMPLATES],
      side: 'center',
    },
    {
      id: 'agreements.templates.status',
      label: 'Status',
      title: 'Active, Draft or Archived',
      body: 'Only an Active template can be sent or picked for a rental. A Draft is still being written, and Archived is put away.',
      route: TEMPLATES_ROUTE,
      anchors: [TEMPLATES_TABLE, TEMPLATES],
      side: 'top',
    },
    {
      id: 'agreements.templates.default',
      label: 'Default',
      title: 'Choosing the default',
      body: 'Make default asks first, then rentals send that template. Only an Active template with wording can be the default.',
      route: TEMPLATES_ROUTE,
      anchors: [TEMPLATES_TABLE, TEMPLATES],
      side: 'top',
      notes: [
        { text: 'Agreements already sent do not change.' },
        { text: 'Your default cannot be deleted. Make another one the default first.' },
      ],
    },
    {
      id: 'agreements.templates.new',
      label: 'New template',
      title: 'Writing a new one',
      body: 'New template, or Create your template when you have none, opens the editor on a new one. It starts from your current default wording.',
      route: TEMPLATES_ROUTE,
      anchors: ['[data-tour="agreement-templates-new"]', TEMPLATES],
      side: 'bottom',
      notes: [
        { text: 'Trax can help you write it in the editor.' },
        { text: 'Close the editor without saving and the new template is thrown away.' },
      ],
    },
  ],
};

export const AGREEMENTS_TAB_TOUR: TabTour = {
  id: 'agreements',
  label: 'Agreements',
  homeRoute: ROUTE,
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Agreements.',
  topics: [list, status, send, open, templates],
};
