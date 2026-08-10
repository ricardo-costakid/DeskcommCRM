import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function stubSupabase(opts: { appMetadata?: Record<string, unknown> }) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "novo@example.com", app_metadata: opts.appMetadata ?? {} } },
      }),
    },
    from: (table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          }),
        };
      }
      if (table === "user_organizations") {
        return { select: () => ({ eq: () => ({ is: async () => ({ data: [], error: null }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadAuthUser — must_change_password", () => {
  it("app_metadata.must_change_password true → AuthUser.must_change_password true", async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ appMetadata: { must_change_password: true } }) as never,
    );
    const user = await loadAuthUser();
    expect(user?.must_change_password).toBe(true);
  });

  it("sem must_change_password no metadata → false", async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ appMetadata: {} }) as never);
    const user = await loadAuthUser();
    expect(user?.must_change_password).toBe(false);
  });

  it("must_change_password não-booleano no metadata (ex.: string) → false, não passa adiante o valor cru", async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ appMetadata: { must_change_password: "true" } }) as never,
    );
    const user = await loadAuthUser();
    expect(user?.must_change_password).toBe(false);
  });
});
