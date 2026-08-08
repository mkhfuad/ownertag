/* Single source of truth for API request payloads. Zod schema + inferred TS
   type per endpoint — the backend validates with the schema, the frontend
   types its forms with the inferred type, so the two can never drift.
   These mirror the existing routes in src/routes.js / src/shop.js. */
import { z } from "zod";

// E.164-ish: leading + and 8–15 digits. Backend still normalises via asPhone().
const phone = z.string().trim().regex(/^\+?[0-9\s-]{6,20}$/, "invalid_phone");
const tagId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/, "invalid_tag");
const otp = z.string().regex(/^\d{6}$/, "invalid_code");

export const activateStart = z.object({ tagId, phone });
export type ActivateStart = z.infer<typeof activateStart>;

export const activateVerify = z.object({
  tagId, phone, code: otp,
  email: z.string().email().optional(),
  plate: z.string().max(16).optional(),
  vehicleType: z.enum(["car", "bike", "other"]).default("car"),
  locale: z.enum(["de", "en"]).default("de"),
  tz: z.string().max(64).optional()
});
export type ActivateVerify = z.infer<typeof activateVerify>;

export const loginStart = z.object({ phone });
export const loginVerify = z.object({ phone, code: otp });
export type LoginVerify = z.infer<typeof loginVerify>;

export const sendMessage = z.object({
  tagId,
  body: z.string().min(1).max(500),
  turnstileToken: z.string().optional()
});
export type SendMessage = z.infer<typeof sendMessage>;

export const startCall = z.object({
  tagId, phone,
  turnstileToken: z.string().optional()
});
export type StartCall = z.infer<typeof startCall>;

export const createOrder = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: phone.optional(),
  address: z.string().min(5).max(300),
  qty: z.number().int().min(1).max(20),
  payment: z.enum(["rechnung", "vorkasse"]).default("rechnung")
});
export type CreateOrder = z.infer<typeof createOrder>;

/** Uniform API error body the frontend can rely on. */
export interface ApiError { error: string; }
