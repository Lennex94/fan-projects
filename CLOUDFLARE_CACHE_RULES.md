# Cloudflare Cache Rules for Together, Together fan pages

This project must avoid loading large static data on the fan QR flow. Do not rely on Cloudflare default caching for JSON. Configure explicit cache rules for the following paths:

- `/data/seat_index.json`
- `/data/seats/*`
- `/js/*`
- `/css/*`
- `/assets/*`

Recommended settings:

- Cache Level: Cache Everything
- Edge Cache TTL: 1 day (or longer for static assets)
- Browser Cache TTL: 1 day
- Origin Cache Control: Respect Existing Headers or set explicit TTLs
- Always use `Cache Everything` for `/data/seats/*` and `/data/seat_index.json`

Notes:

- `data/seatmap_mapping.json` is source-only and should not be loaded by public fan pages.
- `join-hs-together.html` now loads only `data/seat_index.json`.
- `run-hs-together-together.html` now loads only `data/seats/<section>.json` for the selected block.
- This reduces per-fan transfer and keeps the QR-to-run path much lighter.
