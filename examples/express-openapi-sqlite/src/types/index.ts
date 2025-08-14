import z from "zod";

export interface HttpRouteConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  requiresAuth?: boolean;
  paramsSchema?: z.ZodSchema;
  querySchema?: z.ZodSchema;
  requestBodySchema?: z.ZodSchema;
  responseSchema?: z.ZodSchema;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  createdAt: Date;
}

export interface UserSession {
  userId: string;
  email: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginResponse {
  token: string;
  user: Omit<User, "passwordHash">;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
