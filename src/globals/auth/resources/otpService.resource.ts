import { defineResource } from "../../../define";
import { SimpleOTPService, IOTPConfig } from "../services/SimpleOTPService";

/**
 * OTP service resource
 */
export const otpServiceResource = defineResource({
  id: "globals.auth.resources.otpService",
  async init(config: IOTPConfig = {}) {
    return new SimpleOTPService(config);
  },
  meta: {
    title: "OTP Service",
    description: "Handles One-Time Password generation and verification",
    tags: ["auth", "otp", "two-factor"],
  },
});