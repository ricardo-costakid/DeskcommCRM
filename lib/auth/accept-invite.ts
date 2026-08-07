/**
 * INSERT/UPDATE de user_organizations a partir de um InvitePayload já
 * verificado (assinatura + expiração + email conferidos pelo caller).
 *
 * Compartilhado por dois callers:
 *   - app/actions/team/acceptInvite.ts — usuário já tinha conta, loga e aceita.
 *   - lib/auth/provision.ts — usuário cria a conta AGORA (signup com convite
 *     pendente) e entra direto na org convidada em vez de ganhar uma órfã.
 *
 * Service role é intencional: RLS em user_organizations exige admin da org
 * para INSERT/UPDATE, e o convidado ainda não é membro. Autorização real é o
 * token HMAC verificado pelo caller — org e role vêm do payload assinado,
 * nunca do body.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import type { InvitePayload } from "@/lib/auth/invite-token";

export async function joinOrganizationFromInvite(
  userId: string,
  payload: InvitePayload,
): Promise<{ membershipId: string; reactivated: boolean }> {
  const db = createAdminClient();
  const { data: existing, error: fetchErr } = await db
    .from("user_organizations")
    .select("id, revoked_at")
    .eq("user_id", userId)
    .eq("organization_id", payload.organization_id)
    .maybeSingle();
  if (fetchErr) {
    throw new Error(`join invited org: fetch failed: ${fetchErr.message}`);
  }

  const nowIso = new Date().toISOString();

  if (existing?.id) {
    const { error: updErr } = await db
      .from("user_organizations")
      .update({
        role: payload.role,
        revoked_at: null,
        accepted_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (updErr) {
      throw new Error(`join invited org: update failed: ${updErr.message}`);
    }

    await audit({
      action: "member.accepted",
      actorUserId: userId,
      organizationId: payload.organization_id,
      resourceType: "membership",
      resourceId: existing.id,
      metadata: {
        invite_id: payload.invite_id,
        role: payload.role,
        reactivated: !!existing.revoked_at,
      },
    });
    return { membershipId: existing.id, reactivated: !!existing.revoked_at };
  }

  const { data: inserted, error: insErr } = await db
    .from("user_organizations")
    .insert({
      user_id: userId,
      organization_id: payload.organization_id,
      role: payload.role,
      invited_at: new Date(payload.exp * 1000 - 24 * 60 * 60 * 1000).toISOString(),
      accepted_at: nowIso,
    })
    .select("id")
    .single();
  if (insErr) {
    throw new Error(`join invited org: insert failed: ${insErr.message}`);
  }

  await audit({
    action: "member.accepted",
    actorUserId: userId,
    organizationId: payload.organization_id,
    resourceType: "membership",
    resourceId: inserted.id,
    metadata: { invite_id: payload.invite_id, role: payload.role },
  });
  return { membershipId: inserted.id, reactivated: false };
}
