import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionMemberDirect } from "@/lib/auth/provision-member";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
}));
vi.mock("@/lib/auth/provision-member", () => ({ provisionMemberDirect: vi.fn() }));

const ADMIN_ID = "admin-1";
const ORG_ID = "org-1";

function adminSession() {
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
  vi.mocked(createClient).mockResolvedValue({
    rpc: async (fn: string) =>
      fn === "fn_user_role_in_org" ? { data: "admin", error: null } : { data: null, error: null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function agentSession() {
  const user: AuthUser = {
    id: "agent-1",
    email: "agent@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(loadAuthUser).mockResolvedValue(user);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "agent" });
  vi.mocked(createClient).mockResolvedValue({
    rpc: async (fn: string) =>
      fn === "fn_user_role_in_org" ? { data: "agent", error: null } : { data: null, error: null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function stubAdminClient(
  existingRows: Array<{ user_id: string; revoked_at: string | null }>,
  emailByUserId: Record<string, string>,
) {
  return {
    from: (table: string) => {
      if (table !== "user_organizations") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: async () => ({ data: existingRows, error: null }) }) };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: emailByUserId[id] ? { user: { email: emailByUserId[id] } } : { user: null },
        }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/team/members", () => {
  it("agent (abaixo de admin) → 403, provisionMemberDirect nunca chamado", async () => {
    agentSession();
    const { POST } = await import("@/app/api/v1/team/members/route");
    const req = new NextRequest("http://localhost/api/v1/team/members", {
      method: "POST",
      body: JSON.stringify({ members: [{ email: "novo@example.com", role: "agent" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(provisionMemberDirect).not.toHaveBeenCalled();
  });

  it("admin: resolve o mapa de e-mails da org (ativos e revogados) e chama provisionMemberDirect por item", async () => {
    adminSession();
    vi.mocked(createAdminClient).mockReturnValue(
      stubAdminClient(
        [
          { user_id: "u-ativo", revoked_at: null },
          { user_id: "u-revogado", revoked_at: "2026-01-01T00:00:00Z" },
        ],
        { "u-ativo": "ativo@example.com", "u-revogado": "revogado@example.com" },
      ) as never,
    );
    vi.mocked(provisionMemberDirect).mockResolvedValue({
      email: "novo@example.com",
      ok: true,
      password: "TempPass1234567",
    });

    const { POST } = await import("@/app/api/v1/team/members/route");
    const req = new NextRequest("http://localhost/api/v1/team/members", {
      method: "POST",
      body: JSON.stringify({ members: [{ email: "novo@example.com", role: "agent" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { results: unknown[] } };
    expect(body.data.results).toEqual([{ email: "novo@example.com", ok: true, password: "TempPass1234567" }]);

    expect(provisionMemberDirect).toHaveBeenCalledTimes(1);
    const [actorId, input, map] = vi.mocked(provisionMemberDirect).mock.calls[0]!;
    expect(actorId).toBe(ADMIN_ID);
    expect(input).toEqual({ email: "novo@example.com", role: "agent", organizationId: ORG_ID });
    expect(map.get("ativo@example.com")).toEqual({ revokedAt: null });
    expect(map.get("revogado@example.com")).toEqual({ revokedAt: "2026-01-01T00:00:00Z" });
  });

  it("body vazio (sem members) → 422 validation_error, sem chamar o admin client", async () => {
    adminSession();
    const { POST } = await import("@/app/api/v1/team/members/route");
    const req = new NextRequest("http://localhost/api/v1/team/members", {
      method: "POST",
      body: JSON.stringify({ members: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
