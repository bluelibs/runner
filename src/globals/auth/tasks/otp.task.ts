import { defineTask } from "../../../define";
import {
  IOTPGenerationRequest,
  IOTPVerificationRequest,
  IOTPService,
  IUserStore,
  OTPType,
  UserNotFoundError,
  InvalidOTPError,
} from "../types";
import { otpServiceResource } from "../resources/otpService.resource";
import { userStoreResource } from "../resources/userStore.resource";

/**
 * Task to generate an OTP for a user
 */
export const generateOTPTask = defineTask({
  id: "globals.auth.tasks.generateOTP",
  dependencies: {
    otpService: otpServiceResource,
    userStore: userStoreResource,
  },
  async run(
    request: IOTPGenerationRequest,
    { otpService, userStore }: {
      otpService: IOTPService;
      userStore: IUserStore;
    }
  ) {
    // Verify user exists
    const user = await userStore.findById(request.userId);
    if (!user) {
      throw new UserNotFoundError(request.userId);
    }

    // Check if OTP is enabled for this user and type
    const isEnabled = await otpService.isOTPEnabled(request.userId, request.type);
    if (!isEnabled) {
      throw new Error(`OTP not enabled for user ${request.userId} and type ${request.type}`);
    }

    // Generate OTP
    const otp = await otpService.generateOTP(request.userId, request.type, request.metadata);

    return {
      success: true,
      otpId: otp.id,
      code: otp.code, // In production, this would be sent via email/SMS instead of returned
      expiresAt: otp.expiresAt,
      type: otp.type,
      metadata: otp.metadata,
    };
  },
  meta: {
    title: "Generate OTP",
    description: "Generates a one-time password for a user",
    tags: ["auth", "otp", "two-factor"],
  },
});

/**
 * Task to verify an OTP code
 */
export const verifyOTPTask = defineTask({
  id: "globals.auth.tasks.verifyOTP",
  dependencies: {
    otpService: otpServiceResource,
    userStore: userStoreResource,
  },
  async run(
    request: IOTPVerificationRequest,
    { otpService, userStore }: {
      otpService: IOTPService;
      userStore: IUserStore;
    }
  ) {
    // Verify user exists
    const user = await userStore.findById(request.userId);
    if (!user) {
      throw new UserNotFoundError(request.userId);
    }

    // Verify OTP
    const result = await otpService.verifyOTP(request.userId, request.code, request.type);

    if (!result.success) {
      throw new InvalidOTPError();
    }

    return {
      success: true,
      token: result.token,
      remaining: result.remaining,
      message: "OTP verified successfully",
    };
  },
  meta: {
    title: "Verify OTP",
    description: "Verifies a one-time password code",
    tags: ["auth", "otp", "verify", "two-factor"],
  },
});

/**
 * Task to enable OTP for a user
 */
export const enableOTPTask = defineTask({
  id: "globals.auth.tasks.enableOTP",
  dependencies: {
    otpService: otpServiceResource,
    userStore: userStoreResource,
  },
  async run(
    { userId, type, metadata }: { userId: string; type: OTPType; metadata?: Record<string, any> },
    { otpService, userStore }: {
      otpService: IOTPService;
      userStore: IUserStore;
    }
  ) {
    // Verify user exists
    const user = await userStore.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Enable OTP
    await otpService.enableOTP(userId, type, metadata);

    return {
      success: true,
      userId,
      type,
      message: `OTP enabled for type ${type}`,
    };
  },
  meta: {
    title: "Enable OTP",
    description: "Enables one-time password authentication for a user",
    tags: ["auth", "otp", "enable", "two-factor"],
  },
});

/**
 * Task to disable OTP for a user
 */
export const disableOTPTask = defineTask({
  id: "globals.auth.tasks.disableOTP",
  dependencies: {
    otpService: otpServiceResource,
    userStore: userStoreResource,
  },
  async run(
    { userId, type }: { userId: string; type: OTPType },
    { otpService, userStore }: {
      otpService: IOTPService;
      userStore: IUserStore;
    }
  ) {
    // Verify user exists
    const user = await userStore.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Disable OTP
    await otpService.disableOTP(userId, type);

    return {
      success: true,
      userId,
      type,
      message: `OTP disabled for type ${type}`,
    };
  },
  meta: {
    title: "Disable OTP",
    description: "Disables one-time password authentication for a user",
    tags: ["auth", "otp", "disable", "two-factor"],
  },
});

/**
 * Task to check OTP status for a user
 */
export const getOTPStatusTask = defineTask({
  id: "globals.auth.tasks.getOTPStatus",
  dependencies: {
    otpService: otpServiceResource,
    userStore: userStoreResource,
  },
  async run(
    { userId }: { userId: string },
    { otpService, userStore }: {
      otpService: IOTPService;
      userStore: IUserStore;
    }
  ) {
    // Verify user exists
    const user = await userStore.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Check enabled types
    const enabledTypes: OTPType[] = [];
    const otpTypes: OTPType[] = ["email", "sms", "totp", "backup"];

    for (const type of otpTypes) {
      if (await otpService.isOTPEnabled(userId, type)) {
        enabledTypes.push(type);
      }
    }

    return {
      userId,
      enabledTypes,
      hasOTPEnabled: enabledTypes.length > 0,
    };
  },
  meta: {
    title: "Get OTP Status",
    description: "Gets the OTP status and enabled types for a user",
    tags: ["auth", "otp", "status", "two-factor"],
  },
});