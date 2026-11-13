/*
 * Mercedes TXT activation is disabled by default.
 *
 * Importing a new TXT revision must never
 * automatically activate that revision.
 *
 * This middleware protects the admin activation API.
 */

export function requireMercedesTxtActivationEnabled(
  req,
  res,
  next
) {
  if (
    process.env.MAKA_TXT_ACTIVATION_ENABLED !== "true"
  ) {
    return res.status(423).json({
      success: false,
      error: "MERCEDES_TXT_ACTIVATION_LOCKED",
      message:
        "TXT revision activation requires separate approval.",
    });
  }

  return next();
}
