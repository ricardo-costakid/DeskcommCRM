"use server";
/**
 * Server Action: accept a team invite token.
 *
 * Steps:
 *   1. Verify HMAC token (signature + expiry).
 *   2. Get current authenticated user from cookie session.
 *   3. Email mismatch → return error (UI tells user to sign out / use the right account).
 *   4. INSERT user_organizations (organization_id, user_id, role, accepted_at, invited_by=null).
 *      If a revoked row already exists for (user, org), reactivate it instead.
 *   5. Audit `member.accepted` and redirect to /app/inbox.
 */
import { redirect } from "next/navigation";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { joinOrganizationFromInvite } from "@/lib/auth/accept-invite";
import { createClient } from "@/lib/supabase/server";

export type AcceptInviteResult =
  | { ok: true }
  | { ok: false; error: "invalid_or_expired" | "email_mismatch" | "not_authenticated" | "internal_error"; message?: string; expectedEmail?: string };

export async function acceptInviteAction(token: string): Promise<AcceptInviteResult> {
  const payload = verifyInviteToken(token);
  if (!payload) return { ok: false, error: "invalid_or_expired" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const userEmail = (user.email ?? "").trim().toLowerCase();
  const inviteEmail = payload.email.trim().toLowerCase();
  if (userEmail !== inviteEmail) {
    return { ok: false, error: "email_mismatch", expectedEmail: payload.email };
  }

  // Autorização: token HMAC verificado + email do usuário autenticado === email
  // do convite; org e role vêm do token assinado (fonte confiável), nunca do
  // body. joinOrganizationFromInvite escreve com service role (RLS exige admin
  // da org para INSERT/UPDATE, e o convidado ainda não é membro).
  try {
    await joinOrganizationFromInvite(user.id, payload);
  } catch (e) {
    return {
      ok: false,
      error: "internal_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  redirect("/app/inbox");
}
