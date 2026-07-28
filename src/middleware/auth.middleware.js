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

function attachAuth(req, token) {
  const payload =
    AuthService.verifyToken(token);

  req.auth = {
    userId: Number(payload.sub),
    role: payload.role,
  };
}

export function optionalAuth(req, res, next) {
  const token = getToken(req);

  if (!token) {
    req.auth = null;
    return next();
  }

  try {
    attachAuth(req, token);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Сессия недействительна или истекла",
    });
  }
}


export function optionalAuthSilent(
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
    attachAuth(req, token);
  } catch {
    req.auth = null;
  }

  return next();
}

export function requireAuth(req, res, next) {
  const token = getToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Требуется авторизация",
    });
  }

  try {
    attachAuth(req, token);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Сессия недействительна или истекла",
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
        error: "Недостаточно прав",
      });
    }

    return next();
  };
}
