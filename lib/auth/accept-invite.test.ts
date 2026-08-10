import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { linkUserToOrganization } from "@/lib/auth/link-membership";
import { joinOrganizationFromInvite } from "@/lib/auth/accept-invite";
import type { InvitePayload } from "@/lib/auth/invite-token";

vi.mock("@/lib/auth/link-membership", () => ({ linkUserToOrganization: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function payload(overrides: Partial<InvitePayload> = {}): InvitePayload {
  return {
    invite_id: "inv-1",
    email: "convidado@example.com",
    organization_id: ORG_ID,
    role: "agent",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("joinOrganizationFromInvite (wrapper fino sobre linkUserToOrganization)", () => {
  it("chama o core com org/role do payload e invitedAt reconstruído do exp - 24h", async () => {
    vi.mocked(linkUserToOrganization).mockResolvedValue({ membershipId: "m-1", reactivated: false });
    const p = payload();

    await joinOrganizationFromInvite(USER_ID, p);

    expect(linkUserToOrganization).toHaveBeenCalledWith(USER_ID, {
      organizationId: ORG_ID,
      role: "agent",
      invitedAt: new Date(p.exp * 1000 - 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("audita member.accepted com invite_id, role e reactivated; devolve o resultado do core", async () => {
    vi.mocked(linkUserToOrganization).mockResolvedValue({ membershipId: "m-2", reactivated: true });
    const p = payload({ invite_id: "inv-9", role: "manager" });

    const res = await joinOrganizationFromInvite(USER_ID, p);

    expect(res).toEqual({ membershipId: "m-2", reactivated: true });
    expect(audit).toHaveBeenCalledWith({
      action: "member.accepted",
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      resourceType: "membership",
      resourceId: "m-2",
      metadata: { invite_id: "inv-9", role: "manager", reactivated: true },
    });
  });
});
