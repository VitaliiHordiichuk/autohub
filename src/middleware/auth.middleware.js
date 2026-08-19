import { AuthService } from "../services/AuthService.js";

const COOKIE_NAME = "autohub_token";

function getBearerToken(req) {
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function getToken(req) {
  return (
    req.cookies?.[COOKIE_NAME] ||
    getBearerToken(req)
  );
}

async function attachAuth(req, token) {
  req.auth = await AuthService.verifySessionToken(token);
}

function isPasswordChangeRoute(req) {
  return [
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/logout",
  ].some((path) => req.originalUrl?.split("?")[0] === path);
}

export async function optionalAuth(req, res, next) {
  const token = getToken(req);

  if (!token) {
    req.auth = null;
    return next();
  }

  try {
    await attachAuth(req, token);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Сесія недійсна або завершилася",
    });
  }
}


export async function optionalAuthSilent(
  req,
  res,
  next
) {
  const token = getToken(req);

  req.auth = null;

  if (!token) {
    return next();
  }

  try {
    await attachAuth(req, token);
  } catch {
    req.auth = null;
  }

  return next();
}

export async function requireAuth(req, res, next) {
  const token = getToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Потрібна авторизація",
    });
  }

  try {
    await attachAuth(req, token);

    if (
      req.auth.mustChangePassword &&
      !isPasswordChangeRoute(req)
    ) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        error: "Потрібно створити новий пароль",
      });
    }

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Сесія недійсна або завершилася",
    });
  }
}

export function requireRole(...allowedRoles) {
  return function roleMiddleware(
    req,
    res,
    next
  ) {
    if (
      !req.auth ||
      !allowedRoles.includes(req.auth.role)
    ) {
      return res.status(403).json({
        success: false,
        error: "Недостатньо прав",
      });
    }

    return next();
  };
}
