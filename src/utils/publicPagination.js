export function parsePublicPage(value) {
  if (value === undefined) return 1;
  if ((typeof value !== "string" && typeof value !== "number")
    || !/^[1-9]\d*$/.test(String(value))) {
    return null;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}
