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

The protected staff mode can also show the website's public TXT price when no
stock is found; incoming/VIP prices are never inferred for a TXT-only item.

Deployment requires only the five changed bot service modules and the bridge
URL correction, followed by restarting the existing MAKAtron polling process.
Do not start another polling worker, migrate data, restart the HTTP API, or
change the EMAIL/Data Retention/inquiry workers. Back up those five modules and
the private bot environment on the VPS with restricted permissions first;
rollback restores them and restarts only the same MAKAtron process.

Checks: TelegramSpecialOrder, TelegramCatalogService, TelegramCatalogFormatter,
TelegramReleaseParity, MakatronSharedSiteSearchClient, TelegramOrderService,
TelegramShoppingCart, MakatronWebsiteStaffFormatter, the private bridge
controller and WebsiteArticleSearchService. Run with an empty dotenv path and
unreachable test DB; tests use fixtures, not Telegram messages or production writes.
