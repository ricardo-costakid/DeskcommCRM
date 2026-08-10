import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function stubDb(opts: { existing?: { id: string; revoked_at: string | null } | null; insertedId?: string }) {
  const fetchResult = { data: opts.existing ?? null, error: null };
  const updateEq = vi.fn(async () => ({ error: null }));
  const insertSingle = vi.fn(async () => ({
    data: opts.insertedId ? { id: opts.insertedId } : null,
    error: null,
  }));
  return {
    from: (table: string) => {
      if (table !== "user_organizations") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => fetchResult }),
          }),
        }),
        update: () => ({ eq: updateEq }),
        insert: () => ({ select: () => ({ single: insertSingle }) }),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkUserToOrganization", () => {
  it("insere nova membership quando não existe linha prévia", async () => {
    const db = stubDb({ existing: null, insertedId: "m-1" });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    const { linkUserToOrganization } = await import("@/lib/auth/link-membership");
    const res = await linkUserToOrganization(USER_ID, { organizationId: ORG_ID, role: "agent" });

    expect(res).toEqual({ membershipId: "m-1", reactivated: false });
  });

  it("reativa membership revogada (revoked_at volta a null, reactivated=true)", async () => {
    const db = stubDb({ existing: { id: "m-2", revoked_at: "2026-01-01T00:00:00Z" } });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    const { linkUserToOrganization } = await import("@/lib/auth/link-membership");
    const res = await linkUserToOrganization(USER_ID, { organizationId: ORG_ID, role: "manager" });

    expect(res).toEqual({ membershipId: "m-2", reactivated: true });
  });

  it("membership já ativa (não revogada) atualiza role mas reactivated=false", async () => {
    const db = stubDb({ existing: { id: "m-3", revoked_at: null } });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    const { linkUserToOrganization } = await import("@/lib/auth/link-membership");
    const res = await linkUserToOrganization(USER_ID, { organizationId: ORG_ID, role: "manager" });

    expect(res).toEqual({ membershipId: "m-3", reactivated: false });
  });
});
