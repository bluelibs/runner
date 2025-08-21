/**
 * Core authentication types and interfaces for the BlueLibs Runner auth system
 */

/**
 * Basic user interface
 */
export interface IUser {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastPasswordChangedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Internal user interface with password (for storage)
 */
export interface IUserWithPassword extends IUser {
  hashedPassword: string;
}

/**
 * User credentials for authentication
 */
export interface IUserCredentials {
  email: string;
  password: string;
}

/**
 * User registration data
 */
export interface IUserRegistration extends IUserCredentials {
  roles?: string[];
  metadata?: Record<string, any>;
}

/**
 * JWT token payload
 */
export interface IJWTPayload {
  userId: string;
  email: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

/**
 * Authentication result
 */
export interface IAuthResult {
  user: IUser;
  token: string;
  expiresAt: Date;
}

/**
 * Permission check context
 */
export interface IPermissionContext {
  user: IUser;
  resource?: string;
  action?: string;
  data?: any;
}

/**
 * Abstract user storage interface
 * Implement this interface to provide custom persistence layers
 */
export interface IUserStore {
  /**
   * Create a new user (with hashed password)
   */
  createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser>;

  /**
   * Find user by email (returns user with password for authentication)
   */
  findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null>;

  /**
   * Find user by ID (returns user with password for authentication)
   */
  findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null>;

  /**
   * Update user data
   */
  updateUser(id: string, updates: Partial<IUser>): Promise<IUser>;

  /**
   * Update user password and track change time
   */
  updatePassword(id: string, hashedPassword: string): Promise<IUser>;

  /**
   * Delete user
   */
  deleteUser(id: string): Promise<void>;

  /**
   * Check if user exists by email
   */
  existsByEmail(email: string): Promise<boolean>;

  /**
   * List users with optional filtering (without passwords)
   */
  listUsers(options?: {
    limit?: number;
    offset?: number;
    roles?: string[];
    isActive?: boolean;
  }): Promise<{ users: IUser[]; total: number }>;
}

/**
 * Abstract password hasher interface
 */
export interface IPasswordHasher {
  /**
   * Hash a password
   */
  hash(password: string): Promise<string>;

  /**
   * Verify a password against its hash
   */
  verify(password: string, hash: string): Promise<boolean>;
}

/**
 * Abstract JWT manager interface
 */
export interface IJWTManager {
  /**
   * Generate a JWT token for a user
   */
  generate(payload: IJWTPayload): Promise<string>;

  /**
   * Verify and decode a JWT token
   */
  verify(token: string): Promise<IJWTPayload>;

  /**
   * Check if a token is expired
   */
  isExpired(token: string): Promise<boolean>;
}

/**
 * Permission checker interface
 */
export interface IPermissionChecker {
  /**
   * Check if user has permission for a specific action
   */
  hasPermission(context: IPermissionContext): Promise<boolean>;

  /**
   * Check if user has any of the specified roles
   */
  hasRole(user: IUser, roles: string[]): Promise<boolean>;

  /**
   * Check if user has all of the specified roles
   */
  hasAllRoles(user: IUser, roles: string[]): Promise<boolean>;
}

/**
 * Authentication service configuration
 */
export interface IAuthConfig {
  /**
   * JWT secret key
   */
  jwtSecret: string;

  /**
   * JWT token expiration time in seconds (default: 24 hours)
   */
  jwtExpiresIn?: number;

  /**
   * Password minimum length (default: 8)
   */
  passwordMinLength?: number;

  /**
   * Default roles for new users
   */
  defaultRoles?: string[];

  /**
   * Enable user registration (default: true)
   */
  allowRegistration?: boolean;

  /**
   * Require email verification (default: false)
   */
  requireEmailVerification?: boolean;
}

/**
 * Authentication errors
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User with email ${email} already exists`);
    this.name = "UserAlreadyExistsError";
  }
}

export class UserNotFoundError extends Error {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`);
    this.name = "UserNotFoundError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Brute force protection errors
 */
export class TooManyAttemptsError extends Error {
  constructor(public cooldownUntil: Date) {
    super("Too many failed attempts. Please try again later.");
    this.name = "TooManyAttemptsError";
  }
}

/**
 * Password reset errors
 */
export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super("Invalid or expired password reset token");
    this.name = "InvalidPasswordResetTokenError";
  }
}

/**
 * OTP errors
 */
export class InvalidOTPError extends Error {
  constructor() {
    super("Invalid or expired OTP");
    this.name = "InvalidOTPError";
  }
}

export class OTPRequiredError extends Error {
  constructor() {
    super("OTP verification required");
    this.name = "OTPRequiredError";
  }
}

/**
 * Brute force protection tracking
 */
export interface IBruteForceAttempt {
  email: string;
  attempts: number;
  lastAttempt: Date;
  cooldownUntil?: Date;
}

/**
 * Brute force protection service interface
 */
export interface IBruteForceProtection {
  /**
   * Record a failed login attempt
   */
  recordFailedAttempt(email: string): Promise<void>;

  /**
   * Check if an email is currently locked due to too many attempts
   */
  isLocked(email: string): Promise<boolean>;

  /**
   * Get the cooldown period end time for an email
   */
  getCooldownUntil(email: string): Promise<Date | null>;

  /**
   * Reset failed attempts for an email (on successful login)
   */
  resetAttempts(email: string): Promise<void>;

  /**
   * Clear all tracking data (for testing)
   */
  clear(): Promise<void>;
}

/**
 * Password reset token
 */
export interface IPasswordResetToken {
  token: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
  used: boolean;
}

/**
 * Password reset service interface
 */
export interface IPasswordResetService {
  /**
   * Generate a password reset token for a user
   */
  generateResetToken(email: string): Promise<IPasswordResetToken>;

  /**
   * Verify a password reset token
   */
  verifyResetToken(token: string): Promise<IPasswordResetToken>;

  /**
   * Mark a reset token as used
   */
  markTokenAsUsed(token: string): Promise<void>;

  /**
   * Clean up expired tokens
   */
  cleanupExpiredTokens(): Promise<void>;
}

/**
 * OTP types
 */
export type OTPType = "email" | "sms" | "totp" | "backup";

/**
 * OTP token
 */
export interface IOTPToken {
  id: string;
  userId: string;
  type: OTPType;
  code: string;
  expiresAt: Date;
  createdAt: Date;
  used: boolean;
  metadata?: Record<string, any>;
}

/**
 * OTP verification result
 */
export interface IOTPVerificationResult {
  success: boolean;
  token?: IOTPToken;
  remaining?: number; // remaining attempts
}

/**
 * OTP service interface
 */
export interface IOTPService {
  /**
   * Generate an OTP for a user
   */
  generateOTP(userId: string, type: OTPType, metadata?: Record<string, any>): Promise<IOTPToken>;

  /**
   * Verify an OTP code
   */
  verifyOTP(userId: string, code: string, type?: OTPType): Promise<IOTPVerificationResult>;

  /**
   * Check if user has OTP enabled for a specific type
   */
  isOTPEnabled(userId: string, type: OTPType): Promise<boolean>;

  /**
   * Enable OTP for a user
   */
  enableOTP(userId: string, type: OTPType, metadata?: Record<string, any>): Promise<void>;

  /**
   * Disable OTP for a user
   */
  disableOTP(userId: string, type: OTPType): Promise<void>;

  /**
   * Clean up expired OTP tokens
   */
  cleanupExpiredTokens(): Promise<void>;
}

/**
 * Password reset request data
 */
export interface IPasswordResetRequest {
  email: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

/**
 * Password reset completion data
 */
export interface IPasswordResetCompletion {
  token: string;
  newPassword: string;
}

/**
 * OTP generation request
 */
export interface IOTPGenerationRequest {
  userId: string;
  type: OTPType;
  metadata?: Record<string, any>;
}

/**
 * OTP verification request
 */
export interface IOTPVerificationRequest {
  userId: string;
  code: string;
  type?: OTPType;
}