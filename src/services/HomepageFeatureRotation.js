/** Rows arrive in the existing merchandising order (sort_order, id). */
export function rotateHomepageFeatures(rows, displayDate) {
  const timestamp = Date.parse(`${displayDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(displayDate) || !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== displayDate) {
    throw new Error("Некоректна дата ротації товарів");
  }
  // The date has already been resolved in Kyiv; UTC arithmetic avoids DST hours.
  const day = Math.floor(timestamp / 86400000);
  const result = [...rows];
  const groups = new Map();
  rows.forEach((row, index) => {
    // Missing flags belong to legacy, fixed cards, never automatic cards.
    if (row.is_position_fixed !== false) return;
    const positions = groups.get(row.feature_type) || [];
    positions.push(index);
    groups.set(row.feature_type, positions);
  });
  for (const positions of groups.values()) {
    const shift = ((day % positions.length) + positions.length) % positions.length;
    positions.forEach((index, offset) => {
      result[index] = rows[positions[(offset + shift) % positions.length]];
    });
  }
  return result;
}
