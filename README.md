# Ten × You — Marketplace Sales dashboard

Marketplace analytics for Ten × You, built the same way as the other dashboards in
`Documents/tenxyou/claude`: a single-file `index.html` SPA (no framework, no build step),
plus tiny Vercel serverless functions in `api/`, with the shared dataset stored in **Vercel Blob**.

Marketplaces are **not** API-integrated — data arrives as Excel/CSV downloads that a human uploads.
The dashboard parses those files **in the browser** and publishes a shared dataset the whole team sees.

## Navigation (three tiers)
- **Marketplace** (top): `Overall` (sum of all) · `Myntra` · `Amazon` · `Flipkart`
- **Channel** (per marketplace): `Overall` (SOR + Dropship) · `SOR` · `Dropship`
- **View**: `Overview` · `Products` · `Stock & Aging`

State is a store keyed `STORE[marketplace][channel]`; the active selection is folded into one derived
`DATA` view for the render functions. "Overall" tabs aggregate across marketplaces / channels. Each
concrete marketplace+channel is its own Vercel Blob (`marketplace-sales/<mkt>-<ch>.json`); publish saves
every non-empty bucket. Uploaded files **auto-route** by content to the right marketplace/channel.

## Status
- ✅ **Myntra · SOR** (consignment — Myntra holds stock, fulfils, reports back) — fully wired.
- ⏳ **Myntra · Dropship** (self-ship / M-Direct, seller 92272) — recognised on upload; ingest next.
- ⏳ Amazon, Flipkart — nav + empty states in place; awaiting their file formats.
- ⏳ Ads split (spend attributed to products).

## Upload (per marketplace)
The Upload modal offers labelled buckets — **Past data**, **Current-month sale data**, **Stock snapshot**,
and **Price/value sheet** (Myntra SOR only). They're for convenience; the detector routes every file by its
own content regardless of which bucket it's dropped in.

## The two Myntra channels
| | **SOR** (this dashboard) | **Marketplace / M-Direct** (later) |
|---|---|---|
| Stock held by | Myntra | You (own WH) |
| Fulfilment | Myntra | You pick-pack-dispatch |
| Seller ID in files | `69139` | `92272` |
| Reports used | `Sales_Report_69139`, `Inventory_Detailed_Report_69139` | `MDirect_Orders_Report_92272` |

## SOR data sources (what the files actually contain)
**Sales feed** — `..._Sales_Report_69139_<start>_<end>.csv` (daily). One row per SKU sold:
`ord_month(date) · style_id · sku_code · article_type · business_unit · master_category · gender · qty · item_mrp`.
> ⚠️ **This feed carries units, not settled value.** So **v1 reports units only** — no ₹ on the sales side.
> Sale **value** arrives in **v2** by looking each sold unit up against a **product-value sheet the user
> maintains** (value = units × maintained unit value). A separate Myntra sales-value sheet also exists and
> can be wired in later.

**Inventory feed** — `..._Inventory_Detailed_Report_69139.csv` (snapshot). Your stock at Myntra:
`style_id · gtin · style_name · article_type · master_category · gender · warehouse_name · inward_age_bucket(A 0-30 … H 210-240) · season_code · item_status · inv_units_q1 · inv_value_q1`.
`item_status` exposes `STORED` (sellable), `TRANSIT`, `CUSTOMER_RETURNED`/`ACCEPTED_RETURNS` (returns), etc.

## How uploads merge (idempotent — handles re-downloads & restatements)
- **Sales** files merge **by date**: uploading a file replaces every existing row for the dates it covers,
  so re-downloading a corrected day never double-counts. Filename date range is authoritative.
- **Inventory** is a snapshot and **replaces** the previous one (its "as of" date comes from the filename).
- Nothing is shared until you click **Publish to team** and enter the update password.

### Current month vs past months
Sales are stored as dated rows, so the **current (latest) month is "live"** — it keeps accumulating as you
upload each day — and every **completed month is "held"** automatically (frozen as last uploaded, until you
re-upload that month). A **Month switcher** (defaults to the live month) plus a **By-month** table let you
move between them; past-month data persists in the shared blob across publishes because uploads merge by
date and never wipe history.

## Screens (v1 — units)
- **Overview** — units sold, sell-through, sellable stock, active styles, returns held; a month banner
  (live vs held); daily-units chart; splits by category / gender / article (by units); By-month table;
  day-by-day table; period-over-period unit deltas.
- **Products** — per-style: units sold, sellable stock, **days-of-cover**, **sell-through**, oldest age
  bucket, with **FAST / LOW / DEAD** flags. Sortable & searchable.
- **Stock & Aging** — aging by value (8 buckets), sellable vs transit vs returns, aging by category,
  top warehouses, and a **dead-stock watchlist** (150+ days old with no sales in range). ₹ here is real
  inventory value from the stock feed.

## Run locally
```
python -m http.server 8787
```
Open http://localhost:8787 . On localhost the dashboard auto-loads the CSVs listed in
`sample-data/manifest.json` so you see it populated with real numbers. `sample-data/` is **gitignored
and vercelignored** — it never deploys, and production starts empty until someone uploads.

## Deploy (Vercel)
1. Create a Vercel project from this folder (or `vercel` CLI).
2. Add a **Blob store** and connect it — Vercel injects `BLOB_READ_WRITE_TOKEN`.
3. Put the app behind the same auth as the other dashboards (or Vercel password protection).
4. Update password is shared with the other Ten × You dashboards (`areyousure?`). To change it,
   run `strHash('newpw')` in the browser console and paste the number into **both** `api/data.js`
   (`PW_HASH`) and `index.html` (`PW_HASH`).

Storage layout: one blob per marketplace+channel, e.g. `marketplace-sales/myntra-sor.json`.

## Roadmap / open items
1. **v2 — sale value** — look each sold unit up against the user's maintained **product-value sheet**
   (value = units × maintained unit value) to add a sale-amount layer on top of units. A separate Myntra
   sales-value sheet is also available as an alternative/cross-check.
2. **Returns over time** — currently only visible as an inventory status snapshot; a returns feed would let us trend returns by day and style.
3. **Myntra M-Direct** channel (self-ship) — separate ingest + screens.
4. **Amazon & Flipkart**, then the **ads split** (spend × product).
