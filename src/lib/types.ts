export type Network = "instagram" | "facebook" | "x" | "linkedin" | "youtube" | "tiktok";

export type YouTubeOptions = {
  title: string;
  /** A Short is a vertical video of 3 minutes or less. */
  format: "video" | "short";
  privacy: "public" | "unlisted" | "private";
};

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type Account = {
  id: string;
  network: Network;
  name: string;
  handle: string;
  /** Hue used for the generated avatar. */
  hue: number;
  followers: number;
  connected: boolean;
  avatarUrl?: string;
  /** Id of the account on the publishing service (Postiz integration id, etc.). */
  externalId?: string;
  /** Provider type on the publishing service, e.g. "instagram-standalone" or "linkedin-page". */
  providerKind?: string;
};

export type MediaSource = "claude-code" | "upload" | "hermes";

export type Media = {
  id: string;
  title: string;
  /** Seconds. */
  duration: number;
  aspect: "9:16" | "1:1" | "16:9";
  source: MediaSource;
  createdAt: string;
  /** Two hues for the generated thumbnail when there is no poster image. */
  hues: [number, number];
  /** Public URL of the file, served by the app. */
  url?: string;
  /** Feed cover image (thumbnail shown on the profile grid), when there is one. */
  cover?: string;
};

/** Result of publishing a post on one account. */
export type TargetResult = {
  status: "published" | "failed";
  error?: string;
  externalId?: string;
  at: string;
};

export type Post = {
  id: string;
  accountIds: string[];
  caption: string;
  mediaId?: string;
  scheduledAt: string;
  status: PostStatus;
  /** Who created the post. */
  origin: "manual" | "claude-code" | "hermes";
  /** Only used when a YouTube channel is selected. */
  youtube?: YouTubeOptions;
  results?: Record<string, TargetResult>;
  error?: string;
};

/** A named group of accounts, e.g. one brand or one client. An account can be in several projects. */
export type Project = {
  id: string;
  name: string;
  hue: number;
  accountIds: string[];
};

export type AppState = {
  accounts: Account[];
  projects: Project[];
  media: Media[];
  posts: Post[];
  publisher: { name: string; label: string; ready: boolean; detail?: string };
  integrations: { hermes: boolean; inbox: boolean };
};
