// Shapes from docs/API.md (milestone M1). Keep in sync with the backend contract.

export type Role = "user" | "admin";

export interface UserOut {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface SessionOut {
  user: UserOut;
  csrf_token: string;
}

export type Provider = "openrouter" | "ollama";
export type Kind = "chat" | "embedding";
export type Tier = "cheap" | "powerful";
export type Slot = "chat" | "grader" | "judge" | "embedding";

export const SLOTS: readonly Slot[] = ["chat", "grader", "judge", "embedding"];

export interface ModelOut {
  id: string;
  provider: Provider;
  display_name: string;
  kind: Kind;
  tier: Tier;
  enabled: boolean;
  available: boolean;
  context_length: number | null;
  notes: string | null;
}

export interface SlotOut {
  model_id: string;
  source: "default" | "override";
  temperature: number | null;
  max_tokens: number | null;
}

export interface ModelsOut {
  models: ModelOut[];
  slots: Record<Slot, SlotOut>;
}

export interface SlotPatch {
  model_id?: string;
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface ConversationOut {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_cost_usd: number;
}

export type MessageStatus = "complete" | "streaming" | "error";

export interface MessageOut {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  model_id: string | null;
  provider: Provider | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  trace_id: string | null;
  status: MessageStatus;
  error: string | null;
}

export interface ConversationDetailOut {
  conversation: ConversationOut;
  messages: MessageOut[];
}

export interface UsageByModel {
  model_id: string;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageByUser {
  user_id: number;
  username: string;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageOut {
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  by_model: UsageByModel[];
}

export interface AdminUsageOut extends UsageOut {
  by_user: UsageByUser[];
}

export interface HealthOut {
  status: "ok";
  version: string;
  providers: { openrouter: boolean; ollama: boolean };
  tracing: "langfuse" | "jsonl";
}

// Server-sent events of POST /api/conversations/{id}/messages.

export interface TurnStartData {
  user_message: MessageOut;
  assistant_message_id: string;
  model_id: string;
}

export interface TurnDeltaData {
  text: string;
}

export interface TurnUsageData {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface TurnDoneData {
  assistant_message: MessageOut;
}

export interface TurnErrorData {
  message: string;
  assistant_message: MessageOut | null;
}

export type TurnEvent =
  | { event: "start"; data: TurnStartData }
  | { event: "delta"; data: TurnDeltaData }
  | { event: "usage"; data: TurnUsageData }
  | { event: "done"; data: TurnDoneData }
  | { event: "error"; data: TurnErrorData };
