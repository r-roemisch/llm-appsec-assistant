import type { ApprovalFilters, FeedbackFilters, GuardEventAuditFilters, ToolCallAuditFilters } from "@/lib/api";

export const queryKeys = {
  session: ["session"] as const,
  health: ["health"] as const,
  models: ["models"] as const,
  conversations: ["conversations"] as const,
  conversationList: ["conversations", "list"] as const,
  conversation: (id: string) => ["conversations", "detail", id] as const,
  myUsage: ["usage", "me"] as const,
  adminUsers: ["admin", "users"] as const,
  adminUsage: ["admin", "usage"] as const,
  knowledgeStatus: ["knowledge", "status"] as const,
  knowledgeSources: ["knowledge", "sources"] as const,
  passage: (id: string) => ["knowledge", "passages", id] as const,
  profile: ["profile"] as const,
  helpDocs: ["help", "docs"] as const,
  targets: ["targets"] as const,
  targetList: ["targets", "list"] as const,
  tools: ["tools"] as const,
  reports: ["reports"] as const,
  reportList: ["reports", "list"] as const,
  report: (id: string) => ["reports", "detail", id] as const,
  adminTools: ["admin", "tools"] as const,
  /** Prefix of every Approvals list. */
  adminApprovals: ["admin", "approvals"] as const,
  adminApprovalList: (filters: ApprovalFilters) => ["admin", "approvals", filters] as const,
  adminToolCalls: (filters: ToolCallAuditFilters) => ["admin", "audit", "tool-calls", filters] as const,
  adminGuardEvents: (filters: GuardEventAuditFilters) => ["admin", "audit", "guard-events", filters] as const,
  adminSettings: ["admin", "settings"] as const,
  /** Prefix of the Plugin catalog and every Plugin detail (M5). */
  adminPlugins: ["admin", "plugins"] as const,
  adminPluginList: ["admin", "plugins", "list"] as const,
  adminPlugin: (id: string) => ["admin", "plugins", "detail", id] as const,
  /** Prefix of every Feedback dashboard query (M6). */
  adminFeedback: ["admin", "feedback"] as const,
  adminFeedbackList: (filters: FeedbackFilters) => ["admin", "feedback", filters] as const,
  adminEvaluationCases: ["admin", "evaluation-cases"] as const,
  /** Prefix of the evaluation queries (M6). */
  adminEval: ["admin", "eval"] as const,
  adminEvalDatasets: ["admin", "eval", "datasets"] as const,
  /** Prefix of the run list and every run detail. */
  adminEvalRuns: ["admin", "eval", "runs"] as const,
  adminEvalRunList: ["admin", "eval", "runs", "list"] as const,
  adminEvalRun: (id: string) => ["admin", "eval", "runs", "detail", id] as const,
};
