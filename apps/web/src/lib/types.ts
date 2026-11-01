export type AuthUser = {
  id: string;
  username: string;
  mediawiki_user_id: number;
};

export type AuthState = {
  authenticated: boolean;
  user: AuthUser | null;
};

export type AnswerMode = "auto" | "grounded" | "general";

export type RelatedArticle = {
  title: string;
  url: string;
  page_id?: string | null;
  snippet: string;
  relevance_score: number;
};

export type Source = {
  id: string;
  title: string;
  url: string;
  page_id?: string | null;
  snippet: string;
  section_title?: string | null;
  relevance_score: number;
};

export type ResponseTelemetry = {
  cache_hit: boolean;
  ttft_ms: number;
  total_ms: number;
  model: string;
  provider: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  model?: string | null;
  created_at: string;
  sources: Source[];
  related_articles?: RelatedArticle[];
  suggested_questions?: string[];
  telemetry?: ResponseTelemetry;
};

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string | null;
};

export type FeedbackPayload = {
  message_id: string;
  rating: "positive" | "negative";
  reason?: string | null;
  comment?: string | null;
};

export type ChatRequest = {
  conversation_id?: string | null;
  message: string;
  article_action?: string | null;
  article_page_id?: string | null;
  answer_mode?: AnswerMode;
  response_language?: string | null;
};

export type StreamEvent =
  | { event: "conversation"; data: Conversation }
  | { event: "user_message"; data: Message }
  | { event: "assistant_message"; data: Message }
  | { event: "status"; data: { message: string } }
  | { event: "chunk"; data: { text: string } }
  | { event: "final"; data: { conversation: Conversation; message: Message; related_articles: RelatedArticle[]; suggested_questions: string[] } }
  | { event: "error"; data: { message: string } };
