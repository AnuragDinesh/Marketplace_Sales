# Deploy runbook — Ten x You Marketplace Sales

Static `index.html` (vanilla JS) + serverless functions in `api/` + Vercel Blob storage.
No build step. `sample-data/` is git- and vercel-ignored, so the live site starts empty and
is filled by real uploads (Myntra/Flipkart SOR) + the live ERP pull (Dropship).

## 1. GitHub
Create an **empty** repo (no README, no .gitignore, no license) at https://github.com/new,
e.g. `tenxyou-marketplace-sales` (Private). Copy its URL. Claude pushes the code to it.

## 2. Import into Vercel
1. https://vercel.com → **Add New… → Project → Import** the GitHub repo.
2. Framework preset: **Other** (it's static + serverless). Leave build/output empty.
3. **Deploy**. (It will work but be empty and Dropship/stock inactive until step 3–4.)

## 3. Vercel Blob (so team uploads persist for everyone)
Project → **Storage → Create Database → Blob** → connect to this project.
This adds `BLOB_READ_WRITE_TOKEN` automatically. Redeploy if prompted.

## 4. Environment variables (Project → Settings → Environment Variables)
For **live Myntra + Flipkart Dropship** (same values as the 10XU Stockroom):

| Name             | Value                          |
|------------------|--------------------------------|
| `ERP_URL`        | https://erp.tenxyou.com        |
| `ERP_API_KEY`    | (your ERP API key)             |
| `ERP_API_SECRET` | (your ERP API secret)          |

Apply to Production (and Preview). **Redeploy** after adding them.
Without these, Dropship simply shows "no data yet"; SOR (uploads) is unaffected.

## 5. Password-protect viewing — already built in
The dashboard has its own **login screen**. Viewing password: **`98(75)`** (works on any Vercel
plan, no Pro needed). It's enforced **server-side** too — `/api/data` and `/api/dropship` return
401 without it — so the data is protected, not just the UI.
- To **change** the viewing password: tell Claude (it updates the login + the two API checks).
  Optionally you can also set env `DASHBOARD_PASSWORD` to override the server check.
- (Optional, Pro only) You can *also* turn on Vercel Deployment Protection for a second layer.

## 6. Verify (after deploy + env + redeploy)
- Open the site → log in with **`98(75)`**.
- **Dropship check**: visit `https://<your-site>/api/dropship?channel=myntra&debug=1&pw=98(75)`
  and `...&channel=flipkart&debug=1&pw=98(75)` — confirm `detectedChannelField`, `channelValue`,
  `orderCount`, and `grandTotal` look right (Myntra ≈ your daily ₹1.5L).
- Upload the **SP / mapping sheet** (💰) once, then the Myntra & Flipkart **sales files**.
- Publish (the shared **update** password: `areyousure?`) so the team sees the data.

## Notes
- Two separate passwords: **viewing** = `98(75)` (login screen), **update/publish** =
  `areyousure?` (`PW_HASH` in `index.html` + `api/data.js`, shared across Ten x You dashboards).
- Data model: one Blob JSON per `marketplace-channel`. Uploading current-month sales never
  touches past months or the SP sheet.
