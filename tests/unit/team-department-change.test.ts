/**
 * PATCH /api/v1/team/[user_id]/department — admin edita Função/Departamento.
 *
 * Prova, contra o Route Handler REAL (auth e Supabase mockados):
 *  - troca válida → 200, write efetuado, audita action='team.department_changed'
 *    com actor e antes/depois;
 *  - membro revogado → 409 state_conflict, sem write;
 *  - membro inexistente na org → 404, sem write;
 *  - valor fora do vocabulário fechado → 422 validation_error (Zod), sem write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => false,
  hashEmail: (e: string) => e,
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

interface StubState {
  target: { id: string; department: string | null; revoked_at: string | null } | null;
  updates: Array<Record<string, unknown>>;
}

function makeSupabaseStub(state: StubState) {
  return {
    from: (table: string) => {
      if (table !== "user_organizations") throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: () => Promise.resolve({ data: state.target, error: null }),
          };
          return chain;
        },
        update: (values: Record<string, unknown>) => ({
          eq: () => {
            state.updates.push(values);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    rpc: async (fn: string) =>
      fn === "fn_user_role_in_org" ? { data: "admin", error: null } : { data: null, error: null },
  };
}

function adminSession(state: StubState) {
  const user: AuthUser = {
    id: ADMIN_ID,
    email: "admin@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "admin" }],
  };
  vi.mocked(loadAuthUser).mockResolvedValue(user);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "admin" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(makeSupabaseStub(state) as any);
}

function patchReq(department: string) {
  return new NextRequest(`http://localhost/api/v1/team/${TARGET_ID}/department`, {
    method: "PATCH",
    body: JSON.stringify({ department }),
  });
}
const params = { params: Promise.resolve({ user_id: TARGET_ID }) };

function stubState(overrides: Partial<StubState> = {}): StubState {
  return {
    target: { id: MEMBERSHIP_ID, department: null, revoked_at: null },
    updates: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/team/[user_id]/department", () => {
  it("troca válida → 200, write efetuado, audita team.department_changed com antes/depois", async () => {
    const state = stubState({ target: { id: MEMBERSHIP_ID, department: "psicologo", revoked_at: null } });
    adminSession(state);
    const { PATCH } = await import("@/app/api/v1/team/[user_id]/department/route");
    const res = await PATCH(patchReq("administrativo"), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user_id: string; department: string } };
    expect(body.data).toMatchObject({ user_id: TARGET_ID, department: "administrativo" });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ department: "administrativo" });

    const entry = vi
      .mocked(audit)
      .mock.calls.map(([e]) => e)
      .find((e) => e.action === "team.department_changed");
    expect(entry).toMatchObject({
      action: "team.department_changed",
      actorUserId: ADMIN_ID,
      organizationId: ORG_ID,
      resourceType: "membership",
      resourceId: MEMBERSHIP_ID,
      metadata: {
        target_user_id: TARGET_ID,
        old_department: "psicologo",
        new_department: "administrativo",
      },
    });
  });

  it("membro revogado → 409 state_conflict, sem write", async () => {
    const state = stubState({
      target: { id: MEMBERSHIP_ID, department: null, revoked_at: "2026-01-01T00:00:00Z" },
    });
    adminSession(state);
    const { PATCH } = await import("@/app/api/v1/team/[user_id]/department/route");
    const res = await PATCH(patchReq("psicologo"), params);
    expect(res.status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  it("membro inexistente na org → 404, sem write", async () => {
    const state = stubState({ target: null });
    adminSession(state);
    const { PATCH } = await import("@/app/api/v1/team/[user_id]/department/route");
    const res = await PATCH(patchReq("psicologo"), params);
    expect(res.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  it("valor fora do vocabulário fechado → 422 validation_error, sem write", async () => {
    const state = stubState();
    adminSession(state);
    const { PATCH } = await import("@/app/api/v1/team/[user_id]/department/route");
    const res = await PATCH(patchReq("faxineiro"), params);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
    expect(state.updates).toHaveLength(0);
  });
});
