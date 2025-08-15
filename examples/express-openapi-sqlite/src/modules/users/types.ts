import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

export const UserSessionSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
});

export type UserSession = z.infer<typeof UserSessionSchema>;

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  name: z.string().min(1),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export type ApiResponse<T = any> = z.infer<typeof ApiResponseSchema>;
