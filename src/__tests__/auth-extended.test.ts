import { SimpleBruteForceProtection } from "../globals/auth/services/SimpleBruteForceProtection";
import { SimplePasswordResetService } from "../globals/auth/services/SimplePasswordResetService";
import { SimpleOTPService } from "../globals/auth/services/SimpleOTPService";
import { MemoryUserStore } from "../globals/auth/stores/MemoryUserStore";
import { TooManyAttemptsError, InvalidPasswordResetTokenError, InvalidOTPError } from "../globals/auth/types";

describe("Extended Authentication System", () => {
  describe("BruteForceProtection", () => {
    let bruteForceProtection: SimpleBruteForceProtection;

    beforeEach(() => {
      bruteForceProtection = new SimpleBruteForceProtection({
        maxAttempts: 3,
        initialCooldownSeconds: 1,
        cooldownMultiplier: 2,
        maxCooldownSeconds: 10,
        resetWindowSeconds: 3600,
      });
    });

    test("should allow login attempts under limit", async () => {
      const email = "test@example.com";
      
      expect(await bruteForceProtection.isLocked(email)).toBe(false);
      
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      
      expect(await bruteForceProtection.isLocked(email)).toBe(false);
      expect(await bruteForceProtection.getAttemptCount(email)).toBe(2);
    });

    test("should lock account after max attempts", async () => {
      const email = "test@example.com";
      
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      
      expect(await bruteForceProtection.isLocked(email)).toBe(true);
      const cooldownUntil = await bruteForceProtection.getCooldownUntil(email);
      expect(cooldownUntil).toBeTruthy();
    });

    test("should throw TooManyAttemptsError when locked", async () => {
      const email = "test@example.com";
      
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      
      await expect(bruteForceProtection.checkAndThrowIfLocked(email))
        .rejects.toThrow(TooManyAttemptsError);
    });

    test("should reset attempts on successful login", async () => {
      const email = "test@example.com";
      
      await bruteForceProtection.recordFailedAttempt(email);
      await bruteForceProtection.recordFailedAttempt(email);
      
      expect(await bruteForceProtection.getAttemptCount(email)).toBe(2);
      
      await bruteForceProtection.resetAttempts(email);
      
      expect(await bruteForceProtection.getAttemptCount(email)).toBe(0);
    });
  });

  describe("PasswordResetService", () => {
    let passwordResetService: SimplePasswordResetService;

    beforeEach(() => {
      passwordResetService = new SimplePasswordResetService({
        tokenExpirationSeconds: 3600,
        tokenLength: 32,
      });
    });

    test("should generate unique reset tokens", async () => {
      const email = "test@example.com";
      
      const token1 = await passwordResetService.generateResetToken(email);
      const token2 = await passwordResetService.generateResetToken(email);
      
      expect(token1.token).not.toBe(token2.token);
      expect(token1.email).toBe(email);
      expect(token2.email).toBe(email);
      expect(token1.expiresAt).toBeTruthy();
    });

    test("should verify valid tokens", async () => {
      const email = "test@example.com";
      
      const generatedToken = await passwordResetService.generateResetToken(email);
      const verifiedToken = await passwordResetService.verifyResetToken(generatedToken.token);
      
      expect(verifiedToken.email).toBe(email);
      expect(verifiedToken.used).toBe(false);
    });

    test("should reject invalid tokens", async () => {
      await expect(passwordResetService.verifyResetToken("invalid-token"))
        .rejects.toThrow(InvalidPasswordResetTokenError);
    });

    test("should mark tokens as used", async () => {
      const email = "test@example.com";
      
      const generatedToken = await passwordResetService.generateResetToken(email);
      await passwordResetService.markTokenAsUsed(generatedToken.token);
      
      await expect(passwordResetService.verifyResetToken(generatedToken.token))
        .rejects.toThrow(InvalidPasswordResetTokenError);
    });

    test("should clean up expired tokens", async () => {
      const service = new SimplePasswordResetService({
        tokenExpirationSeconds: 0.1, // Very short expiration
      });
      
      const email = "test@example.com";
      const token = await service.generateResetToken(email);
      
      expect(service.getTokenCount()).toBe(1);
      
      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      await service.cleanupExpiredTokens();
      expect(service.getTokenCount()).toBe(0);
    });
  });

  describe("OTPService", () => {
    let otpService: SimpleOTPService;

    beforeEach(() => {
      otpService = new SimpleOTPService({
        expirationSeconds: 300,
        codeLength: 6,
        maxAttempts: 3,
        codeType: "numeric",
      });
    });

    test("should generate OTP for enabled users", async () => {
      const userId = "user1";
      
      await otpService.enableOTP(userId, "email");
      const otp = await otpService.generateOTP(userId, "email");
      
      expect(otp.userId).toBe(userId);
      expect(otp.type).toBe("email");
      expect(otp.code).toHaveLength(6);
      expect(otp.code).toMatch(/^\d{6}$/); // 6 digits
      expect(otp.used).toBe(false);
    });

    test("should verify correct OTP codes", async () => {
      const userId = "user1";
      
      await otpService.enableOTP(userId, "email");
      const otp = await otpService.generateOTP(userId, "email");
      
      const result = await otpService.verifyOTP(userId, otp.code, "email");
      
      expect(result.success).toBe(true);
      expect(result.token?.id).toBe(otp.id);
    });

    test("should reject incorrect OTP codes", async () => {
      const userId = "user1";
      
      await otpService.enableOTP(userId, "email");
      await otpService.generateOTP(userId, "email");
      
      const result = await otpService.verifyOTP(userId, "wrong-code", "email");
      
      expect(result.success).toBe(false);
    });

    test("should track OTP enabled status", async () => {
      const userId = "user1";
      
      expect(await otpService.isOTPEnabled(userId, "email")).toBe(false);
      
      await otpService.enableOTP(userId, "email");
      expect(await otpService.isOTPEnabled(userId, "email")).toBe(true);
      
      await otpService.disableOTP(userId, "email");
      expect(await otpService.isOTPEnabled(userId, "email")).toBe(false);
    });

    test("should support multiple OTP types", async () => {
      const userId = "user1";
      
      await otpService.enableOTP(userId, "email");
      await otpService.enableOTP(userId, "sms");
      
      const emailOTP = await otpService.generateOTP(userId, "email");
      const smsOTP = await otpService.generateOTP(userId, "sms");
      
      expect(emailOTP.type).toBe("email");
      expect(smsOTP.type).toBe("sms");
      expect(emailOTP.code).not.toBe(smsOTP.code);
    });

    test("should clean up expired tokens", async () => {
      const service = new SimpleOTPService({
        expirationSeconds: 0.1, // Very short expiration
      });
      
      const userId = "user1";
      await service.enableOTP(userId, "email");
      await service.generateOTP(userId, "email");
      
      expect(await service.getActiveTokenCount(userId, "email")).toBe(1);
      
      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      await service.cleanupExpiredTokens();
      expect(await service.getActiveTokenCount(userId, "email")).toBe(0);
    });
  });

  describe("MemoryUserStore with Password Tracking", () => {
    let userStore: MemoryUserStore;

    beforeEach(async () => {
      userStore = new MemoryUserStore();
      await userStore.clear();
    });

    test("should track password change dates", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
      };

      const user = await userStore.createUser(userData);
      expect(user.lastPasswordChangedAt).toBeTruthy();

      const originalChangeDate = user.lastPasswordChangedAt;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedUser = await userStore.updatePassword(user.id, "new-hashed-password");
      expect(updatedUser.lastPasswordChangedAt).toBeTruthy();
      expect(updatedUser.lastPasswordChangedAt!.getTime()).toBeGreaterThan(originalChangeDate!.getTime());
    });

    test("should not update password change date on regular updates", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
      };

      const user = await userStore.createUser(userData);
      const originalChangeDate = user.lastPasswordChangedAt;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedUser = await userStore.updateUser(user.id, { roles: ["admin"] });
      expect(updatedUser.lastPasswordChangedAt?.getTime()).toBe(originalChangeDate?.getTime());
    });
  });

  describe("Task Coverage", () => {
    // Test password reset tasks
    test("should complete password reset flow", async () => {
      const userStore = new MemoryUserStore();
      const passwordResetService = new SimplePasswordResetService();
      
      // Create a user first
      const user = await userStore.createUser({
        email: "reset@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
      });

      // Initiate reset
      const resetRequest = await passwordResetService.generateResetToken(
        "reset@example.com"
      );
      expect(resetRequest.token).toBeTruthy();

      // Verify token without completing
      const isValid = await passwordResetService.verifyResetToken(resetRequest.token);
      expect(isValid.email).toBe("reset@example.com");

      // Complete reset
      await passwordResetService.markTokenAsUsed(resetRequest.token);

      // Token should be invalid after use
      try {
        await passwordResetService.verifyResetToken(resetRequest.token);
        fail("Should have thrown an error for used token");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPasswordResetTokenError);
      }
    });

    test("should handle invalid password reset tokens", async () => {
      const passwordResetService = new SimplePasswordResetService();
      
      try {
        await passwordResetService.verifyResetToken("invalid-token");
        fail("Should have thrown an error for invalid token");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPasswordResetTokenError);
      }
    });

    test("should handle expired password reset tokens", async () => {
      const passwordResetService = new SimplePasswordResetService({
        tokenExpirationSeconds: -1, // Expired immediately
      });
      
      const resetRequest = await passwordResetService.generateResetToken(
        "test@example.com"
      );

      // Token should be expired
      try {
        await passwordResetService.verifyResetToken(resetRequest.token);
        fail("Should have thrown an error for expired token");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPasswordResetTokenError);
      }
    });

    test("should manage OTP lifecycle", async () => {
      const otpService = new SimpleOTPService();
      const userId = "user123";

      // Enable OTP
      await otpService.enableOTP(userId, "email");
      const enabledTypes = await otpService.getEnabledTypes(userId);
      expect(enabledTypes).toContain("email");

      // Generate OTP
      const otp = await otpService.generateOTP(userId, "email");
      expect(otp.code).toBeTruthy();
      expect(otp.expiresAt).toBeTruthy();

      // Verify OTP
      const verification = await otpService.verifyOTP(userId, otp.code, "email");
      expect(verification.success).toBe(true);

      // OTP should be invalid after use
      const secondVerification = await otpService.verifyOTP(userId, otp.code, "email");
      expect(secondVerification.success).toBe(false);

      // Disable OTP
      await otpService.disableOTP(userId, "email");
      const enabledTypesAfter = await otpService.getEnabledTypes(userId);
      expect(enabledTypesAfter).not.toContain("email");
    });

    test("should handle invalid OTP verification", async () => {
      const otpService = new SimpleOTPService();
      const userId = "user123";

      await otpService.enableOTP(userId, "email");
      
      // Try invalid code
      const invalidResult = await otpService.verifyOTP(userId, "invalid", "email");
      expect(invalidResult.success).toBe(false);

      // Try disabled type
      const disabledResult = await otpService.verifyOTP(userId, "123456", "sms");
      expect(disabledResult.success).toBe(false);
    });

    test("should handle OTP attempt limits", async () => {
      const otpService = new SimpleOTPService({
        maxAttempts: 1, // Only 1 attempt allowed
      });
      const userId = "user123";

      await otpService.enableOTP(userId, "email");
      const otp = await otpService.generateOTP(userId, "email");

      // First failed attempt
      const attempt1 = await otpService.verifyOTP(userId, "wrong1", "email");
      expect(attempt1.success).toBe(false);

      // Second attempt should fail due to exceeding max attempts
      const attempt2 = await otpService.verifyOTP(userId, "wrong2", "email");
      expect(attempt2.success).toBe(false);
    });

    test("should handle expired OTP codes", async () => {
      const otpService = new SimpleOTPService({
        expirationSeconds: -1, // Expired immediately
      });
      const userId = "user123";

      await otpService.enableOTP(userId, "email");
      const otp = await otpService.generateOTP(userId, "email");

      // OTP should be expired
      const result = await otpService.verifyOTP(userId, otp.code, "email");
      expect(result.success).toBe(false);
    });
  });
});