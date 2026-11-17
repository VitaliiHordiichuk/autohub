# MAKAtron: stock before special order

Customer replies use the live website read model through the private loopback
search bridge. On the current VPS the production API is port 4012; the older
4007 API does not return the active TXT price list. Configure the existing
`MAKATRON_SEARCH_BRIDGE_URL=http://127.0.0.1:4012` in the isolated bot's private
environment. Keep the existing bridge secret private and unchanged.

- Eligible own-stock variants keep their existing prices and availability.
- Without stock, display the website's `specialOrder.indicativePriceUah`, marked
  **Під замовлення**, with about two weeks and manager confirmation.
- Missing or invalid TXT prices stay unavailable/not found. No guessed price.
- Guest and linked-client identity checks and pricing remain unchanged.
- TXT metadata never becomes a product offer, stock quantity or checkout item.
  The inquiry link opens the existing website form for the canonical article.
- Multi-article replies and the optional inline shopping flow support the same
  distinction; only real stock offers contribute to cart totals.

Customer replies include the TXT title when available, retaining the same
customer price. Protected ADMIN/MANAGER replies instead show the title,
**Роздріб** (source TXT price × 1.2, rounded half-up, without a discount), and
the supplier's second discount-group field. These staff-only fields are attached
only by the authorized internal bridge, never by public/client search. The
staff lookup must match the same active READY revision and canonical article.
Incoming/VIP prices are never inferred for a TXT-only item.

The initial release corrected the private bridge URL and restarted MAKAtron.
The staff-detail update also adds the private API metadata reader and retail
helper, so it restarts the isolated HTTP API and the same MAKAtron process.
Back up only the affected files first and record any newly added module for
rollback. Do not start another polling worker, migrate data, or change the
Frontend/EMAIL/Data Retention/inquiry workers. Secrets stay outside Git.

Checks: TelegramSpecialOrder, TelegramCatalogService, TelegramCatalogFormatter,
TelegramReleaseParity, MakatronSharedSiteSearchClient, TelegramOrderService,
TelegramShoppingCart, MakatronWebsiteStaffFormatter, the private bridge
controller and WebsiteArticleSearchService. Run with an empty dotenv path and
unreachable test DB; tests use fixtures, not Telegram messages or production writes.
