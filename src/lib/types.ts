export type Network = "instagram" | "facebook" | "x" | "linkedin";

export type PostStatus = "draft" | "scheduled" | "published" | "failed";

export type Account = {
  id: string;
  network: Network;
  name: string;
  handle: string;
  /** Hue used for the generated avatar. */
  hue: number;
  followers: number;
  connected: boolean;
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
  /** Two hues for the generated thumbnail until real files exist. */
  hues: [number, number];
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
};
