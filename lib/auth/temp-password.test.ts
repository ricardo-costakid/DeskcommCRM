import { describe, expect, it } from "vitest";
import { generateTempPassword } from "@/lib/auth/temp-password";

describe("generateTempPassword", () => {
  it("gera 16 caracteres do alfabeto livre de ambiguidade", () => {
    const pw = generateTempPassword();
    expect(pw).toHaveLength(16);
    expect(pw).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/);
  });

  it("gera senhas diferentes a cada chamada", () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).not.toBe(b);
  });

  it("satisfaz o mínimo de 8 caracteres exigido por resetPasswordSchema", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(8);
  });
});
