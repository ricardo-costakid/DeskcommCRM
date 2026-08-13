/**
 * EPIC-09 Team & Permissions — Zod schemas for invite, accept, role change, and api token.
 *
 * Roles are stored as `text` with a check constraint (not enum) on
 * `user_organizations.role` per project doctrine — keep this list in sync
 * with the DB constraint when adding/removing roles.
 */
import { z } from "zod";

export const ROLES = ["viewer", "agent", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Função/Departamento do membro dentro do tenant — distinto de `role` (RBAC).
 * Vocabulário fechado (CHECK em user_organizations.department, migration 0107)
 * pela lista real da equipe da Madre — manter em sincronia com o DB.
 */
export const DEPARTMENTS = ["psicologo", "assistente_social", "administrativo"] as const;
export type Department = (typeof DEPARTMENTS)[number];
export const DEPARTMENT_LABEL: Record<Department, string> = {
  psicologo: "Psicólogo",
  assistente_social: "Assistente Social",
  administrativo: "Administrativo",
};

export const inviteMemberSchema = z.object({
  invitations: z
    .array(
      z.object({
        email: z.string().email(),
        role: z.enum(ROLES),
      }),
    )
    .min(1)
    .max(20),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const provisionMembersSchema = z.object({
  members: z
    .array(
      z.object({
        email: z.string().email(),
        full_name: z.string().trim().min(1).max(120),
        department: z.enum(DEPARTMENTS),
        role: z.enum(ROLES),
      }),
    )
    .min(1)
    .max(20),
});
export type ProvisionMembersInput = z.infer<typeof provisionMembersSchema>;

export const updateMemberDepartmentSchema = z.object({
  department: z.enum(DEPARTMENTS),
});
export type UpdateMemberDepartmentInput = z.infer<typeof updateMemberDepartmentSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(ROLES),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const createApiTokenSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(z.string()).min(1),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
