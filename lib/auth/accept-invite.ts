/**
 * Wrapper fino de linkUserToOrganization pro fluxo de convite por token:
 * extrai org/role do InvitePayload já verificado (assinatura + expiração +
 * email conferidos pelo caller) e audita member.accepted.
 *
 * Compartilhado por dois callers:
 *   - app/actions/team/acceptInvite.ts — usuário já tinha conta, loga e aceita.
 *   - lib/auth/provision.ts — usuário cria a conta AGORA (signup com convite
 *     pendente) e entra direto na org convidada em vez de ganhar uma órfã.
 */
import { audit } from "@/lib/audit";
import { linkUserToOrganization } from "@/lib/auth/link-membership";
import type { InvitePayload } from "@/lib/auth/invite-token";

export async function joinOrganizationFromInvite(
  userId: string,
  payload: InvitePayload,
): Promise<{ membershipId: string; reactivated: boolean }> {
  const result = await linkUserToOrganization(userId, {
    organizationId: payload.organization_id,
    role: payload.role,
    invitedAt: new Date(payload.exp * 1000 - 24 * 60 * 60 * 1000).toISOString(),
  });

  await audit({
    action: "member.accepted",
    actorUserId: userId,
    organizationId: payload.organization_id,
    resourceType: "membership",
    resourceId: result.membershipId,
    metadata: { invite_id: payload.invite_id, role: payload.role, reactivated: result.reactivated },
  });

  return result;
}
