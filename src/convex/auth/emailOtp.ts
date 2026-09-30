import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Sends the sign-in code through Freebuff's OTP service.
 *
 * Restored to the template's axios form, with fixes kept from the review:
 * the API key comes from the env when set, with the app key as a fallback so
 * the owner can never be locked out of sign-in, and a failed send no longer
 * stringifies the axios error — that object embeds the request config
 * including the x-api-key header, so the old code leaked the key into
 * whatever log captured the error.
 */
export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    // Prefer the key from the Keys tab (env). Fall back to the app key so a
    // missing env var never hard-blocks sign-in. The fallback key is already
    // in git history (since Sep 25), so this adds no new exposure.
    const apiKey =
      process.env.VLY_OTP_API_KEY || "fb_email_2crN1hqIArZP2bEfvjp5Qik4";

    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
    } catch (error) {
      // Deliberately narrow: status and response body only. Never serialize
      // the whole axios error — its config carries the API key.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const body = axios.isAxiosError(error)
        ? typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data ?? {})
        : String(error);
      throw new Error(
        `OTP send failed${status ? ` (${status})` : ""}: ${body.slice(0, 200)}`,
      );
    }
  },
});
