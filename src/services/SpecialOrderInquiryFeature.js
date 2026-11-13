/** Keep write endpoints disabled until the approved public TXT search is live. */
export function specialOrderInquiriesEnabled(env = process.env) {
  return env.MAKA_TXT_INQUIRIES_ENABLED === "true" &&
    env.MAKA_TXT_PUBLIC_SEARCH_ENABLED === "true";
}
