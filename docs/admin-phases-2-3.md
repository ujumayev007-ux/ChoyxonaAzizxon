# Admin phases 2 and 3

## Implemented modules

- Employees: unique salted PIN hashes; predefined avatar preview/replacement/removal; safe employee history. Passwords and PIN hashes are excluded from employee responses and audit metadata.
- Attendance: existing WaiterShift records, PIN and expiring QR verification, attendance switches and schedule, shift length, lateness, early departure, history and audited manual corrections. NFC and face recognition are not advertised as available without a supported device integration.
- Security: existing role authorization and role permission API, tracked signed sessions, server-side session revocation, admin PIN checks for sensitive Telegram/data operations.
- Restaurant and payments: persisted branding/contact/hours/timezone, service fee snapshots, allowed cash/card/electronic/split methods, open-shift enforcement, discount/debt/cash-difference limits and refund controls. Refunds allocate the saved order total with cumulative rounding.
- Orders: configurable automatic waiter approval, cancellation control, administrator table transfers and waiter reassignment; payment/processing locks prevent editing settled orders.
- Printing: existing department/category routes and local TCP/Windows agent, automatic-print toggle, real queued test receipts, cancellation checks, queue/error visibility. Physical printing still requires a configured restaurant computer and printer.
- Inventory: existing recipes and payment deductions, minimum thresholds, audited stocktaking/adjustments with stale-quantity protection, movement history.
- Audit: employee, permissions, session, menu/category/recipe, inventory purchase/adjustment, order approval/rejection/control, payment, settings, export/backup/archive operations.
- Telegram: encrypted bot configuration with environment-token fallback, PIN protection, multiple recipients verified through expiring codes, test delivery and history, configurable metric selection, scheduled hourly/custom-time and shift notifications, revision rollback. Unverified recipients receive no financial reports.
- Alerts: persisted configuration and automatic monitoring for low stock, delayed orders, unclosed cashier shifts, printer errors/stalls, failed payment writes and backup failures.
- Data: encrypted business snapshots, backup history and downloads, limited date-range exports, reversible completed-order archiving, preview and restore of supported settings. No production financial-record restore or database reset is performed.

## Deployment and external configuration

Run the existing non-destructive `npm run migrate:deploy` as part of deployment. Run `npm run verify` before each commit; this validates Prisma, generates its client, compiles TypeScript and runs regression tests without resetting database data.

Configure a stable `SETTINGS_ENCRYPTION_KEY`, or a stable `AUTH_SECRET` / `SESSION_SECRET` of at least 32 characters. Preserve old keys securely when rotating: existing encrypted bot settings and backups require their original key. Never commit these values.

Telegram polling uses the configured database token (or `TELEGRAM_BOT_TOKEN` fallback). Only one polling instance may own a bot. Webhook deployments must set `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET` and `CUSTOMER_WEB_APP_URL`, and register `/api/webhook` with Telegram using the matching secret header. Recipient accounts must start the bot and complete verification in Admin Settings. The scheduler requires a running server and claims each slot before delivery to avoid repeated reports. A delivery interrupted by a crash is marked failed; financial messages are not blindly retried.

The net-profit option is explicitly labeled an estimate based on current menu costs, because historical cost snapshots do not exist. Cash/card/electronic metrics include debt collections; refunds are reported separately. A shift-triggered report summarizes restaurant activity during that shift interval.

Business backups omit passwords/PINs, bot tokens and sessions. Download encrypted copies off-server; a copy in the same database is not disaster recovery. Full PostgreSQL point-in-time recovery must be enabled with the database host and rehearsed into an isolated database. See `/data-recovery.html` and `scripts/read-business-backup.cjs`. Restoring settings is implemented; bulk replay of orders/payments is intentionally not offered.

## Verification boundaries

Automated tests cover payment/change/remaining-balance regressions, service-fee and discount refunds, PIN hashing, sessions, attendance verification and schedule math, stocktake conflicts/audit, Telegram encryption/recipient filtering/schedule slots, backup exclusions/size bounds, printing/category routing, and public JavaScript syntax. Hardware printing, biometric/NFC devices, real Telegram delivery and disaster recovery require external configuration and are not claimed as physically tested.
