// Types for the RAG chatbot

export interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

export interface ChatMessageSource {
  table: string;
  id: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatMessageSource[];
  chart?: ChartData;
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
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  conversationId: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearChat: () => void;
}
