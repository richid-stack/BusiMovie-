export interface MediaFile {
  id: number;
  movie_id: string;
  movie_title: string;
  year?: string;
  telegram_file_id: string;
  file_name?: string;
  file_size?: number;
  quality?: string;
  poster_url?: string;
  trailer_url?: string;
}

export interface RequestItem {
  id: number;
  telegram_id: string;
  title: string;
  status: string;
}

export interface SearchResult {
  id: string;
  title: string;
  year?: string;
  overview: string;
  poster_path: string | null;
}

export interface ChannelLog {
  id: number;
  channel_id: string;
  channel_title: string;
  message_id: string;
  parsed_title: string;
  quality?: string;
  file_size?: number;
  created_at: string;
}

export interface TelegramUpdateLog {
  id: string;
  time: string;
  updateType: string;
  chatTitle?: string;
  text?: string;
  chatType?: string;
  chatId?: string;
}

export interface Status {
  botRunning: boolean;
  stats: {
    users: number;
    searches: number;
    requests: number;
    pendingRequests: number;
    libraryFiles: number;
    totalVaultBytes: number;
  };
  recentUpdates: TelegramUpdateLog[];
}

export interface CrawlerTarget {
  id: number;
  channel_identifier: string;
  title: string;
  status: "active" | "paused" | "syncing";
  min_file_size_mb: number;
  quality_filter: string;
  last_crawled_at: string | null;
  total_files_found: number;
  created_at: string;
}

export interface SearchBot {
  id: number;
  bot_username: string;
  bot_type: "inline" | "command";
  command_template: string;
  status: "active" | "degraded" | "inactive";
  priority: number;
  success_count: number;
  last_queried_at: string | null;
  created_at: string;
}

export interface SearchJob {
  id: number;
  query: string;
  user_telegram_id: string;
  status: "pending" | "searching" | "fulfilled" | "failed";
  bot_used?: string;
  file_name?: string;
  telegram_file_id?: string;
  file_size?: number;
  quality?: string;
  error?: string;
  created_at: string;
  fulfilled_at?: string;
}

export interface CrawlerActivityLog {
  id: string;
  timestamp: string;
  type: "channel_crawl" | "bot_search" | "vault_forward" | "flood_wait";
  source: string;
  title: string;
  details: string;
  status: "success" | "filtered" | "cooldown" | "error";
}

export interface CrawlerStatus {
  workerActive: boolean;
  floodWaitActive: boolean;
  floodWaitCooldownSeconds: number;
  targetsCount: number;
  activeTargets: number;
  searchBotsCount: number;
  activeBots: number;
  pendingJobsCount: number;
  fulfilledJobsCount: number;
  sessionConfigured: boolean;
  auxiliarySession?: {
    apiIdConfigured: boolean;
    apiHashConfigured: boolean;
    sessionConfigured: boolean;
    connected: boolean;
    username: string;
    firstName: string;
    phone: string;
    hasPendingCode: boolean;
    pendingPhone: string | null;
    vaultChannelId: string;
  };
}
