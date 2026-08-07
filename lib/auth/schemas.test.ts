import { describe, it, expect } from "vitest";
import { signupSchema } from "./schemas";

const base = () => ({
  email: "alice@example.com",
  password: "senha1234",
  password_confirm: "senha1234",
});

describe("signupSchema", () => {
  it("rejects missing org_name when there is no invite_token (self-service signup)", () => {
    const result = signupSchema.safeParse(base());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.org_name).toBeDefined();
    }
  });

  it("accepts org_name with 2+ chars when there is no invite_token", () => {
    const result = signupSchema.safeParse({ ...base(), org_name: "Acme" });
    expect(result.success).toBe(true);
  });

  it("accepts missing org_name when invite_token is present (invite-driven signup)", () => {
    const result = signupSchema.safeParse({ ...base(), invite_token: "abc.def" });
    expect(result.success).toBe(true);
  });

  it("still rejects password/password_confirm mismatch even with invite_token", () => {
    const result = signupSchema.safeParse({
      ...base(),
      password_confirm: "outraSenha1",
      invite_token: "abc.def",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password_confirm).toBeDefined();
    }
  });

  it("still rejects invalid email with invite_token present", () => {
    const result = signupSchema.safeParse({ ...base(), email: "not-an-email", invite_token: "abc.def" });
    expect(result.success).toBe(false);
  });
});
