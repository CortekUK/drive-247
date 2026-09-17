// Types for the RAG chatbot

export interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

export interface RentalRequestItem {
  rental_id: string;
  rental_number: string;
  customer_name: string;
  vehicle: string;
  status: string;
  // Extension fields
  current_end_date?: string;
  requested_end_date?: string;
  // Cancellation fields
  start_date?: string;
  end_date?: string;
  cancellation_reason?: string;
}

export interface RentalRequestsData {
  type: 'extensions' | 'cancellations' | 'both';
  title: string;
  extensions?: RentalRequestItem[];
  cancellations?: RentalRequestItem[];
}

export interface ChatMessageSource {
  table: string;
  id: string;
  title?: string;
  knowledgeVersion?: string;
  sourceCommit?: string;
  verifiedAt?: string;
  observedAt?: string;
}

export interface TraxNavigation { target: string; label: string; entityId?: string }
export interface TraxProvenance {
  kind: 'application_guidance' | 'operational_support';
  liveDataChecked: boolean;
  protocolVersion?: 2;
  engine?: 'prepared_fallback' | 'model';
  model?: string;
  observedAt?: string;
  knowledgeVersion: string;
  sourceCommit: string;
  verifiedAt: string;
  productionReleaseVerified: false;
  conversationStorage: 'browser_memory_only' | 'tenant_scoped_support_store';
}

// Action proposal from the AI (needs user confirmation)
export interface ActionProposal {
  actionId: string;
  actionName: string;
  displayTitle: string;
  summary: string;
  details: Record<string, string>;
  destructive: boolean;
  resolvedParams: Record<string, unknown>;
}

// Result after executing an action
export interface ActionResult {
  success: boolean;
  message: string;
  entityType?: string;
  entityId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatMessageSource[];
  chart?: ChartData;
  rentalRequests?: RentalRequestsData;
  action?: ActionProposal;
  actionResult?: ActionResult;
  timestamp: Date;
  navigation?: TraxNavigation[];
  provenance?: TraxProvenance;
  evidence?: TraxEvidence[];
  canRecheck?: boolean;
  /** The support ticket the server created or reused for this issue. */
  ticket?: { id: string; reference: string };
  /** The automatic handoff failed; offer the retry rather than a false success. */
  ticketRetry?: boolean;
}
/** Server-built, allowlisted destinations only. The model never supplies these. */
export interface TraxPaymentAction { kind:'stripe_dashboard'|'receipt'; label:'Open in Stripe'|'View receipt'; href:string; note:string }
export interface TraxPaymentCard {
  paymentId:string;
  reference:{internal:string;stripe:string|null};
  amount:{display:string;basis:'stripe'|'recorded'}|null;
  date:{display:string;basis:'stripe'|'recorded'}|null;
  drive247Status:string; stripeStatus:string|null;
  account:{label:string;mode:'live'|'test'}|null;
  verification:{result:'verified'|'discrepancy'|'offline'|'unable';reason:string;detail:string};
  actions:TraxPaymentAction[]; limitation:string|null;
}
export interface TraxPaymentTotal { currency:string; captured:string; refunded:string; heldNotCaptured:string }
export interface TraxPaymentExplanation { kind:'evidence'|'suggestion'; text:string }
export interface TraxEvidence {
  status:'verified'|'partial'|'restricted'|'missing'|'error'|'needs_input';
  observedAt:string;
  findings:{code:string;summary:string;sourceIds:string[];blocking:boolean}[];
  checks:string[];limitations:string[];
  data?:{paymentCards?:TraxPaymentCard[];totals?:TraxPaymentTotal[];explanations?:TraxPaymentExplanation[];coverage?:string;[key:string]:unknown};
}
export interface TraxCapabilities { modelReady:boolean; operationalChecks:boolean; finance:boolean;supportStorage?:boolean;supportSubmission?:boolean;supportAgent?:boolean;managePolicy?:boolean }
/** No escalation score and no check counter: support policy state stays on the
 * server (supabase/functions/trax-support/support/issues.ts:issueView). */
export interface TraxIssue {id:string;topic:string;summary:string;state:'investigating'|'needs_support'|'resolved'|'submitted';ticketId?:string}
export interface TraxTicket {id:string;reference:string;tenant_id:string;user_id:string;issue_id:string;summary:string;status:'open'|'in_progress'|'closed';created_at:string;updated_at:string;closed_at:string|null;handoff?:Record<string,unknown>;staff_note?:string;retention_hold:boolean;review_due?:boolean}
export interface TraxRetentionPolicy {conversation_days:number;closed_ticket_days:number;inactive_open_days:number;cleanup_enabled:boolean}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userName?: string;
}

export interface ChatApiResponse {
  response: string;
  conversationId: string;
  sources: ChatMessageSource[];
  contextScope: string;
  provenance: TraxProvenance;
  navigation?: TraxNavigation[];
  href?: string;
  chart?: ChartData;
  rentalRequests?: RentalRequestsData;
  action?: ActionProposal;
  actionResult?: ActionResult;
  capabilities?: TraxCapabilities;
  evidence?: TraxEvidence[];
  canRecheck?: boolean;
  issues?:TraxIssue[];
  activeIssueId?:string;
  ticketRetry?:boolean;
  recentConversations?:{id:string;lastActivityAt:string;summary:string}[];
  /** A reopened conversation replays what each answer carried, not only its text. */
  resumedMessages?:{role:'user'|'assistant';content:string;at:string;sources?:ChatMessageSource[];provenance?:TraxProvenance;evidence?:TraxEvidence[];navigation?:TraxNavigation[];canRecheck?:boolean;ticket?:{id:string;reference:string}}[];
  ticket?:TraxTicket;
  ticketPage?:{tickets:TraxTicket[];nextOffset:number|null};
  retentionPolicy?:TraxRetentionPolicy;
  retentionPreview?:Record<string,unknown>;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  conversationId: string | null;
  sendMessage: (content: string) => Promise<void>;
  confirmAction: (messageId: string) => Promise<void>;
  rejectAction: (messageId: string) => void;
  clearChat: () => void;
  navigate: (action: TraxNavigation) => Promise<boolean>;
  capabilities?: TraxCapabilities;
  checkAgain?: () => Promise<void>;
  /** Retry the automatic support handoff for an issue whose ticket did not persist. */
  requestTicket?: (issueId?: string) => Promise<ChatApiResponse | null>;
  issues?:TraxIssue[];
  activeIssueId?:string;
  recentConversations?:ChatApiResponse['recentConversations'];
  contextKey?:string;
  supportRequest?:(type:string,payload?:Record<string,unknown>)=>Promise<ChatApiResponse|null>;
}
