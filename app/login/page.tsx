import { LoginForm } from "./login-form";

export const metadata = { title: "Masuk — Facility Fix" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <LoginForm next={next} />
    </main>
  );
}
