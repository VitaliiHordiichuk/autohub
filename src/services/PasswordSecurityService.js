import crypto from "node:crypto";

import bcrypt from "bcryptjs";

const PASSWORD_SALT_ROUNDS = 12;

function createError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function validatePassword(value) {
  const password = String(value || "");

  if (password.length < 8) {
    throw createError(
      "Пароль повинен містити щонайменше 8 символів",
      400,
      "PASSWORD_TOO_SHORT"
    );
  }

  if (password.length > 200) {
    throw createError("Пароль надто довгий", 400, "PASSWORD_TOO_LONG");
  }

  return password;
}

export function hashPassword(password) {
  return bcrypt.hash(validatePassword(password), PASSWORD_SALT_ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(String(password || ""), passwordHash);
}

export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let value = "";

  for (const byte of bytes) {
    value += alphabet[byte % alphabet.length];
  }

  return `MAKA-${value}`;
}

export function generateResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSecret(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}
export function hashPrivateValue(value) {
  const pepper =
    process.env.SECURITY_HASH_SECRET ||
    process.env.AUTH_JWT_SECRET ||
    "autohub-local-security-pepper";

  return crypto
    .createHmac("sha256", pepper)
    .update(String(value || ""), "utf8")
    .digest("hex");
}
