"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email("Format email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
  next: z.string().optional(),
});

export type LoginState = { error: string | null };

export async function signIn(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately vague: distinguishing "no such user" from "wrong password"
    // turns the login form into an account-enumeration oracle.
    return { error: "Email atau password salah" };
  }

  // Only accept internal paths — an open redirect here would let a phishing
  // link bounce a freshly authenticated user to an attacker's page.
  const next = parsed.data.next;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(target);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
