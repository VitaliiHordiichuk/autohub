# Homepage product rotation

`homepage_product_features.is_position_fixed` controls daily rotation. Migration
`132_homepage_feature_daily_rotation.sql` adds a boolean with `NOT NULL DEFAULT TRUE`.
Existing rows and their `sort_order` values are preserved. No product, price,
stock, banner or worker data is changed.

Admin feature GET/POST/PATCH use `isPositionFixed`. Omitted values preserve the
current mode on PATCH and default to fixed on POST for older clients. The new
admin form explicitly defaults new cards to automatic. Switching modes retains
the existing queue order; invalid boolean values are rejected.

Public selection first applies the existing active-product and date filters.
The existing `sort_order, id` order defines the queue. Fixed cards keep their
slots in that queue. Only automatic slots are filled by a daily cyclic shift,
independently within `NEW` and `PROMOTION`. At least two automatic cards in a
group are needed for visible rotation. The calendar date comes from the existing
Kyiv date function; integer day arithmetic avoids DST drift. All viewers and
languages get the same order for the same eligible cards and day; pricing
remains personalized.

There is no cron task and no daily database write for product rotation. The
existing banner selection behavior is unchanged. The frontend keeps the order
of an already open page while refreshing offer data. A new page load gets the
current day's order. `ProductRail` and its arrows, touch scrolling, reduced-motion
handling and 15-second autoplay are unchanged.

## Release

Apply migration 132, then deploy `HomepageFeatureRotation.js` and the updated
`HomepageContentService.js`, then deploy the frontend. Verify that all legacy
rows remain fixed and their order is unchanged. Do not automatically unpin
existing cards; an administrator chooses which cards participate.

The previous backend ignores the added field, so a code rollback can leave the
column and saved settings intact. Do not drop the column as part of a code
rollback. Restore the previous backend and frontend versions to disable rotation.

## Focused checks

`node --test src/services/HomepageFeatureRotation.test.js src/services/HomepageContentService.test.js`

The optional integration test uses `MAKA_ROTATION_TEST_DATABASE_URL`. It only
accepts a loopback host and a database named `maka_rotation_test` (optionally with
a test suffix), creates its own temporary schema, applies the actual migration
twice, verifies legacy rows, and executes the service's actual INSERT/UPDATE SQL.
It never uses the production connection for its queries.

`node --test src/services/HomepageFeatureRotation.integration.test.js`
