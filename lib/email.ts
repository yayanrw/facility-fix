import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

const RESEND_API_KEY = () => required("RESEND_API_KEY", process.env.RESEND_API_KEY);
const EMAIL_FROM = () => process.env.EMAIL_FROM ?? "Facility Fix <onboarding@resend.dev>";

/**
 * Plain fetch to the Resend REST API — no SDK dependency for one POST request.
 * Swap this function's body if the provider ever changes.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM(), to, subject, text }),
  });

  if (!res.ok) {
    throw new Error(`sendEmail failed (${res.status}): ${await res.text()}`);
  }
}
