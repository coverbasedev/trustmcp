"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { deleteAccount, unlinkProvider, updateUserName } from "@/lib/account";
import { requireUser } from "@/lib/trustcenter";

// Providers a user can link from settings (email link needs no linking — it
// always works for the account's own verified address).
const LINKABLE = ["google", "github", "sso"];

export async function connectProvider(formData: FormData) {
  const user = await requireUser();
  const provider = String(formData.get("provider") ?? "");
  if (!LINKABLE.includes(provider)) redirect("/account?error=link-failed");
  // Mark this account as the one to land on after the OAuth round-trip. If the
  // provider resolves to a different, pre-existing account, the jwt callback
  // merges that account's workspaces/trust centers into this one and deletes it.
  // Short-lived + httpOnly so it can't leak or linger.
  (await cookies()).set("tm_link_into", user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  try {
    // Run the full provider OAuth flow. allowDangerousEmailAccountLinking links
    // by verified email when it matches; the merge step handles the rest.
    await signIn(provider, { redirectTo: "/account?saved=linked" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/account?error=link-failed");
    throw err; // re-throw the NEXT_REDIRECT signIn issues on success
  }
}

export async function disconnectProvider(formData: FormData) {
  const user = await requireUser();
  const provider = String(formData.get("provider") ?? "");
  const emailAvailable = !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM;
  const res = await unlinkProvider(user.id, provider, emailAvailable);
  if (!res.ok) redirect(`/account?error=${res.reason}`);
  revalidatePath("/account");
  redirect("/account?saved=1");
}

export async function saveProfile(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "");
  await updateUserName(user.id, name);
  revalidatePath("/account");
  revalidatePath("/", "layout"); // refresh the name shown in the top-bar menu
}

export async function deleteMyAccount(formData: FormData) {
  const user = await requireUser();
  // Require an explicit typed confirmation to avoid accidental deletion.
  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirm !== "delete") {
    redirect("/account?error=confirm");
  }
  const result = await deleteAccount(user.id);
  if (!result.ok) {
    redirect(`/account?error=${result.reason}`);
  }
  await signOut({ redirectTo: "/login" });
}

export async function signOutEverywhere() {
  // With JWT sessions there is no server-side session store to purge; this signs
  // the current device out. (A future DB-session strategy would revoke all here.)
  await signOut({ redirectTo: "/login" });
}
