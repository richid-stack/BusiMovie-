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
