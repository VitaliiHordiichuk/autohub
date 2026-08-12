import { AuthService } from "../services/AuthService.js";

const COOKIE_NAME = "autohub_token";
const COOKIE_MAX_AGE =
  7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_COOKIE_SECURE === "true",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  };
}

function clearCookieOptions() {
  const options = cookieOptions();

  delete options.maxAge;

  return options;
}

function sendError(res, error) {
  const statusCode =
    Number(error.statusCode) || 500;

  if (statusCode >= 500) {
    console.error("Auth error:", error);
  }

  return res.status(statusCode).json({
    success: false,
    error:
      statusCode >= 500
        ? "Внутрішня помилка сервера"
        : error.message,
  });
}

export async function register(req, res) {
  try {
    const result =
      await AuthService.register(req.body);

    res.cookie(
      COOKIE_NAME,
      result.token,
      cookieOptions()
    );

    return res.status(201).json({
      success: true,
      user: result.user,
      customer: result.customer,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function login(req, res) {
  try {
    const result =
      await AuthService.login(req.body);

    res.cookie(
      COOKIE_NAME,
      result.token,
      cookieOptions()
    );

    return res.json({
      success: true,
      user: result.user,
      customer: result.customer,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export function logout(req, res) {
  res.clearCookie(
    COOKIE_NAME,
    clearCookieOptions()
  );

  return res.json({
    success: true,
  });
}

export async function me(req, res) {
  try {
    const result =
      await AuthService.getCurrentUser(
        req.auth.userId
      );

    return res.json({
      success: true,
      user: result.user,
      customer: result.customer,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function updateProfile(req, res) {
  try {
    const result = await AuthService.updateProfile(req.auth.userId, req.body);

    return res.json({
      success: true,
      user: result.user,
      customer: result.customer,
      phoneVerificationReset: result.phoneVerificationReset,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
