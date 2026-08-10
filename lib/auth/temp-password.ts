/**
 * Senha temporária gerada server-side para cadastro direto de membro
 * (admin cria conta ativa, sem e-mail de confirmação). Mesmo alfabeto livre
 * de ambiguidade e mesma amostragem por rejeição de
 * lib/auth/recovery-codes.ts, comprimento maior por ser senha de login (não
 * só um código de recuperação de uso único).
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const LENGTH = 16;
// Reject bytes >= MAX_VALID to avoid modulo bias.
const MAX_VALID = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function generateTempPassword(): string {
  let out = "";
  while (out.length < LENGTH) {
    const buf = randomBytes(LENGTH);
    for (let i = 0; i < buf.length && out.length < LENGTH; i++) {
      const b = buf[i];
      if (b !== undefined && b < MAX_VALID) {
        out += ALPHABET[b % ALPHABET.length];
      }
    }
  }
  return out;
}
