import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // 00:00 UTC = 07:00 WIB — before the workday's backlog builds up.
  crons: [{ path: "/api/cron/deadline", schedule: "0 0 * * *" }],
};
