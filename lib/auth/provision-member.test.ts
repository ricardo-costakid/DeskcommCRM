import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { linkUserToOrganization } from "@/lib/auth/link-membership";
import { audit } from "@/lib/audit";
import { provisionMemberDirect } from "@/lib/auth/provision-member";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/link-membership", () => ({ linkUserToOrganization: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/temp-password", () => ({ generateTempPassword: vi.fn(() => "TempPass1234567") }));

const ACTOR_ID = "admin-1";
const ORG_ID = "org-1";

function stubAdmin(createUserImpl: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  return { auth: { admin: { createUser: vi.fn(createUserImpl) } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionMemberDirect", () => {
  it("já é membro ativo desta org → already_member, sem chamar createUser", async () => {
    const admin = stubAdmin(async () => ({ data: null, error: null }));
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const map = new Map([["ativo@example.com", { revokedAt: null }]]);

    const res = await provisionMemberDirect(
      ACTOR_ID,
      { email: "ativo@example.com", role: "agent", organizationId: ORG_ID },
      map,
    );

    expect(res).toEqual({
      email: "ativo@example.com",
      ok: false,
      error: "already_member",
      message: "Este e-mail já é membro ativo desta organização.",
    });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("é membro revogado desta org → revoked_member, mensagem distinta, sem chamar createUser", async () => {
    const admin = stubAdmin(async () => ({ data: null, error: null }));
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const map = new Map([["revogado@example.com", { revokedAt: "2026-01-01T00:00:00Z" }]]);

    const res = await provisionMemberDirect(
      ACTOR_ID,
      { email: "revogado@example.com", role: "agent", organizationId: ORG_ID },
      map,
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("revoked_member");
    expect(res.message).toContain("revogado");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("e-mail novo → cria usuário, vincula à org, audita member.provisioned, devolve a senha", async () => {
    const admin = stubAdmin(async () => ({ data: { user: { id: "new-user-1" } }, error: null }));
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(linkUserToOrganization).mockResolvedValue({ membershipId: "m-1", reactivated: false });

    const res = await provisionMemberDirect(
      ACTOR_ID,
      { email: "novo@example.com", role: "manager", organizationId: ORG_ID },
      new Map(),
    );

    expect(res).toEqual({ email: "novo@example.com", ok: true, password: "TempPass1234567" });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "novo@example.com",
      password: "TempPass1234567",
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });
    expect(linkUserToOrganization).toHaveBeenCalledWith("new-user-1", {
      organizationId: ORG_ID,
      role: "manager",
      invitedBy: ACTOR_ID,
    });
    expect(audit).toHaveBeenCalledWith({
      action: "member.provisioned",
      actorUserId: ACTOR_ID,
      organizationId: ORG_ID,
      resourceType: "membership",
      resourceId: "m-1",
      metadata: { role: "manager" },
    });
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0]![0])).not.toContain("TempPass1234567");
  });

  it("e-mail já cadastrado no GoTrue (fora desta org) → email_already_registered", async () => {
    const admin = stubAdmin(async () => ({
      data: null,
      error: { message: "A user with this email address has already been registered" },
    }));
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await provisionMemberDirect(
      ACTOR_ID,
      { email: "outraorg@example.com", role: "agent", organizationId: ORG_ID },
      new Map(),
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("email_already_registered");
    expect(res.message).toContain("peça para essa pessoa entrar");
  });

  it("erro genérico do createUser → provision_failed", async () => {
    const admin = stubAdmin(async () => ({ data: null, error: { message: "unexpected upstream failure" } }));
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await provisionMemberDirect(
      ACTOR_ID,
      { email: "falha@example.com", role: "agent", organizationId: ORG_ID },
      new Map(),
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("provision_failed");
  });
});
