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
};
