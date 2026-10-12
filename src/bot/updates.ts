/** Every update type the bot listens to (webhook and polling must agree). */
export const BOT_ALLOWED_UPDATES = [
  "message", "edited_message", "channel_post", "edited_channel_post",
  "callback_query", "inline_query", "chosen_inline_result",
  "chat_member", "my_chat_member", "chat_join_request",
] as const;
