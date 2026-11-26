import { txtActivationEnabled } from "../services/SpecialOrderTxtAdminWorkflowService.js";
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
    !txtActivationEnabled()
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
