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
}
