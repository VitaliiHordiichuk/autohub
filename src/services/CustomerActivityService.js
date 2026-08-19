export async function logCustomerActivity(
  db,
  {
    customerId,
    type,
    description,
    actorUserId = null,
    metadata = {},
    ipHash = null,
  }
) {
  if (!customerId) return null;

  const result = await db.query(
    `
      INSERT INTO customer_history (
        customer_id,
        type,
        description,
        actor_user_id,
        metadata,
        ip_hash
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING id;
    `,
    [
      customerId,
      type,
      description,
      actorUserId,
      JSON.stringify(metadata || {}),
      ipHash,
    ]
  );

  return Number(result.rows[0].id);
}
