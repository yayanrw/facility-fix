import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { runDeadlineCron } from "@/lib/notifications";

export async function GET(req: Request) {
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const result = await runDeadlineCron(sendEmail, appUrl);
  return Response.json(result);
}
