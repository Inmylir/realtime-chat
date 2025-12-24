export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ASSETS: Fetcher;
  ALLOW_REGISTER?: string;
}

export type JwtUser = { id: number; username: string };
