/**
 * PATCH /api/v1/team/[user_id]/department — admin edita a Função/Departamento
 * de um membro (psicologo | assistente_social | administrativo, migration 0107).
 *
 * "Nome" NÃO tem endpoint equivalente aqui: já reaproveita user_metadata.full_name,
 * editável pelo próprio dono da conta em /app/settings/profile (app/actions/settings/updateProfile.ts).
 * Função/Departamento é dado organizacional — no mesmo espírito de `role`, só admin edita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { updateMemberDepartmentSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { user_id: targetUserId } = await ctx.params;

  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(updateMemberDepartmentSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();

  const { data: target, error: fetchErr } = await supabase
    .from("user_organizations")
    .select("id, department, revoked_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!target) return fail("not_found", "Membro não encontrado.", 404, { requestId });
  if (target.revoked_at) {
    return fail("state_conflict", "Membro está revogado.", 409, { requestId });
  }

  const { error: updErr } = await supabase
    .from("user_organizations")
    .update({ department: input.department, updated_at: new Date().toISOString() })
    .eq("id", target.id);
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  await audit({
    action: "team.department_changed",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "membership",
    resourceId: target.id,
    requestId,
    metadata: {
      target_user_id: targetUserId,
      old_department: target.department,
      new_department: input.department,
    },
  });

  return ok({ user_id: targetUserId, department: input.department }, { requestId });
}
