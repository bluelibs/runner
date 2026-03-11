import { Match } from "@bluelibs/runner";

export const UserSchema = Match.compile({
  id: Match.NonEmptyString,
  email: Match.Email,
  name: Match.NonEmptyString,
  createdAt: Match.IsoDateString,
});

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export const UserSessionSchema = Match.compile({
  id: Match.NonEmptyString,
  email: Match.Email,
  name: Match.NonEmptyString,
});

export interface UserSession {
  id: string;
  email: string;
  name: string;
}

export const LoginRequestSchema = Match.compile({
  email: Match.Email,
  password: Match.NonEmptyString,
});

export interface LoginRequest {
  email: string;
  password: string;
}

export const RegisterRequestSchema = Match.compile({
  email: Match.Email,
  password: Match.RegExp(/^.{8,}$/),
  name: Match.RegExp(/^.{2,}$/),
});

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export const LoginResponseSchema = Match.compile({
  token: Match.NonEmptyString,
  user: UserSchema.pattern,
});

export interface LoginResponse {
  token: string;
  user: User;
}

export const ApiResponseSchema = Match.compile({
  success: Boolean,
  data: Match.Optional(Match.Any),
  error: Match.Optional(String),
  message: Match.Optional(String),
});

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
