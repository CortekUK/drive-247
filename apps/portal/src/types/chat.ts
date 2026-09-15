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
  /**
   * Files the operator attached to THIS user message (v2 Trax only).
   *
   * In-memory only: the edge function has no attachments column and no bucket,
   * so a reopened conversation carries just the `[Attached: …]` note the
   * function writes into `content`. `dataUrl` is kept for image thumbnails in
   * the live thread and never persisted.
   */
  attachments?: Array<Pick<ChatAttachment, 'id' | 'name' | 'mimeType' | 'size' | 'kind' | 'dataUrl'>>;
  /**
   * Set once the reply lands: `false` when the function did not confirm every
   * file it was sent (an older deployment silently ignores unknown JSON keys),
   * so the thread can say "Not delivered" instead of implying the model saw it.
   */
  attachmentsDelivered?: boolean;
}

// ─── Attachments (v2 Trax) ───────────────────────────────────────────────────

export type TraxAttachmentKind = 'image' | 'text';

/** A file prepared in the browser and sent inline with one chat turn. */
export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes actually sent (after downscaling / truncation). */
  size: number;
  kind: TraxAttachmentKind;
  /** `data:<mimeType>;base64,…` — images only. */
  dataUrl?: string;
  /** Decoded file text — text files only. */
  text?: string;
  /** True when a text file was cut to the function's `maxTextBytes`. */
  truncated?: boolean;
}

/**
 * What the deployed chat function says it can accept. Returned by its
 * `{ type: 'capabilities' }` route; `null` on the client means "this deployment
 * cannot take files", and every attach affordance stays inert.
 */
export interface TraxAttachmentCapability {
  version: number;
  maxFiles: number;
  maxImageBytes: number;
  maxTextBytes: number;
  maxTotalBytes: number;
  imageTypes: string[];
  textTypes: string[];
}

export interface SendMessageOptions {
  attachments?: ChatAttachment[];
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userName?: string;
}

export interface ChatApiResponse {
  response: string;
  conversationId: string;
  sources: ChatMessageSource[];
  chart?: ChartData;
  rentalRequests?: RentalRequestsData;
  action?: ActionProposal;
  actionResult?: ActionResult;
  /** Echo of the files the function consumed this turn. Absent on older deployments. */
  attachmentsReceived?: Array<{ name: string; kind: TraxAttachmentKind }>;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  conversationId: string | null;
  /**
   * `options` is additive and v2-only. Text-only calls (every v1 caller passes
   * a single string) send a byte-identical payload.
   */
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  confirmAction: (messageId: string) => Promise<void>;
  rejectAction: (messageId: string) => void;
  clearChat: () => void;
  /**
   * Replace the live thread with a conversation read back from the database.
   *
   * Added for the v2 Trax surfaces, which can list past conversations and reopen
   * one. Purely ADDITIVE: every existing consumer destructures named fields
   * (TraxAIDialog:356, ChatSidebar:24), so neither sees a change.
   *
   * Passing the id matters as much as the messages — `sendMessage` threads
   * `conversationId` back to the edge function, so without it a reopened
   * conversation would fork into a new one on the next reply.
   */
  loadConversation: (conversationId: string, messages: ChatMessage[]) => void;
}
