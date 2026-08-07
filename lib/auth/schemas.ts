import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    // Opcional: quem entra via convite (invite_token presente) não cria
    // organização própria, então não preenche este campo — ver refine abaixo.
    org_name: z.string().max(120, "Nome da empresa deve ter no máximo 120 caracteres").optional(),
    email: z.string().email("Email inválido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    password_confirm: z.string(),
    invite_token: z.string().optional(),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ["password_confirm"],
    message: "As senhas não coincidem",
  })
  .refine((v) => !!v.invite_token || (v.org_name?.trim().length ?? 0) >= 2, {
    path: ["org_name"],
    message: "Nome da empresa deve ter pelo menos 2 caracteres",
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    password_confirm: z.string(),
    // Código TOTP: só exigido quando a conta tem MFA (a sessão de recovery é
    // AAL1 e o GoTrue pede AAL2 para trocar a senha). Opcional no schema; a
    // action decide se é obrigatório.
    mfa_code: z.string().optional(),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ["password_confirm"],
    message: "As senhas não coincidem",
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
