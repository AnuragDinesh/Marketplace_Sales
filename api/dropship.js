// Marketplace Dropship — live from ERPNext Sales Orders (Myntra + Flipkart).
//
// A marketplace's dropship orders in the ERP are the ones where the customer name is masked
// (all asterisks, e.g. "*****s") AND the order's channel field names that marketplace. We pull
// those submitted Sales Orders in a date range, split each order's total across its line
// items, and return per-(date, item_code) rows the dashboard renders exactly like SOR.
//
//   GET /api/dropship?channel=myntra|flipkart&from=YYYY-MM-DD&to=YYYY-MM-DD[&debug=1]
//   -> { updatedAt, channel, from, to, channelField, channelValue, orders, rows:[{ d, sku, qty, amt }], note }
//
// d   = YYYYMMDD, sku = ERP item_code (= the mapping sheet's "10xu SKU"),
// qty = units, amt = that line's share of the order's grand_total (tax-inclusive, so the
//        dashboard's 5/18 GST slab backs tax out the same way it does for SOR).
//
// Env vars on Vercel (same ERP as the stock/stockroom):  ERP_URL, ERP_API_KEY, ERP_API_SECRET
// If they're not set this returns an empty list (the Dropship tab just shows "no data yet").

const CACHE_MS = 15 * 60 * 1000; // 15-minute cache
let cache = {}; // keyed by `${channel}|${from}|${to}` -> { at, payload }
let channelCache = null; // { field, values:[...] } once detected

// Viewing password (same gate as /api/data). Default '98(75)'; override with env DASHBOARD_PASSWORD.
const VIEW_PW_HASH = 1684824962;
function strHash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }
function viewOk(req){
  const given = String((req.headers && req.headers["x-dash-pw"]) || (req.query && req.query.pw) || "");
  const envPw = process.env.DASHBOARD_PASSWORD;
  return envPw ? given === envPw : strHash(given) === VIEW_PW_HASH;
}

const MASK_RE = /^\*{2,}[A-Za-z0-9]?$/; // "*****", "*****s", etc. — a masked marketplace buyer
const MKT_RE = /myntra|amazon|flipkart|ajio|nykaa|meesho|tatacliq|snapdeal/i;

function isMasked(name) { return MASK_RE.test(String(name || "").trim()); }
function ymd8(s) { return String(s || "").slice(0, 10).replace(/-/g, ""); }

async function erpGet(path) {
  const erp = (process.env.ERP_URL || "").replace(/\/$/, "");
  const auth = `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`;
  const r = await fetch(erp + path, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error("ERP HTTP " + r.status + " on " + path.slice(0, 80));
  return (await r.json()).data;
}

// Find which Sales Order field holds the marketplace channel, plus the distinct values it takes.
// We look at a sample of masked-customer orders and pick the short field whose values name marketplaces.
async function detectChannel(from, to) {
  if (channelCache) return channelCache;
  const filters = encodeURIComponent(JSON.stringify([
    ["docstatus", "=", 1],
    ["transaction_date", "between", [from, to]],
    ["customer", "like", "%*%"],
  ]));
  const sample = await erpGet(`/api/resource/Sales Order?fields=["*"]&filters=${filters}&limit_page_length=60&order_by=modified desc`);
  const skip = new Set(["name", "owner", "modified_by", "customer", "customer_name", "title", "naming_series", "company", "territory", "customer_group"]);
  const tally = {}; // field -> { hits, values:Set }
  for (const o of sample || []) {
    for (const k of Object.keys(o)) {
      if (skip.has(k)) continue;
      const v = o[k];
      if (typeof v !== "string" || v.length > 40) continue;
      if (MKT_RE.test(v)) {
        tally[k] = tally[k] || { hits: 0, values: new Set() };
        tally[k].hits++; tally[k].values.add(v);
      }
    }
  }
  let best = null;
  for (const [field, t] of Object.entries(tally)) {
    if (!best || t.hits > best.hits) best = { field, hits: t.hits, values: [...t.values] };
  }
  channelCache = best; // may be null if nothing detected
  return best;
}

export default async function handler(req, res) {
  try {
    if (!viewOk(req)) return res.status(401).json({ error: "viewing password required" });
    const today = new Date().toISOString().slice(0, 10);
    const channel = (req.query.channel || "myntra").toLowerCase().replace(/[^a-z]/g, "");
    const from = (req.query.from || "2026-08-01").slice(0, 10);
    const to = (req.query.to || today).slice(0, 10);
    const debug = req.query.debug === "1";
    const key = channel + "|" + from + "|" + to;

    if (!process.env.ERP_URL || !process.env.ERP_API_KEY || !process.env.ERP_API_SECRET) {
      return res.status(200).json({ updatedAt: null, channel, from, to, orders: 0, rows: [], note: "ERP env vars not set" });
    }
    if (!debug && cache[key] && Date.now() - cache[key].at < CACHE_MS) {
      res.setHeader("x-cache", "HIT");
      return res.status(200).json(cache[key].payload);
    }

    const ch = await detectChannel(from, to);
    if (!ch) {
      return res.status(200).json({ updatedAt: new Date().toISOString(), channel, from, to, orders: 0, rows: [],
        note: "Could not auto-detect the channel field on Sales Orders. Tell me the field name and I'll wire it in.",
        ...(debug ? { debug: { channelField: null } } : {}) });
    }
    const channelValue = ch.values.find(v => new RegExp(channel, "i").test(v));
    if (!channelValue) {
      return res.status(200).json({ updatedAt: new Date().toISOString(), channel, from, to, orders: 0, rows: [],
        note: `No "${channel}" value found in channel field "${ch.field}". Seen: ${ch.values.join(", ")}`,
        ...(debug ? { debug: { channelField: ch.field, values: ch.values } } : {}) });
    }

    // 1) the dropship orders for this channel (submitted, masked customer, channel = detected value)
    const oFilters = encodeURIComponent(JSON.stringify([
      ["docstatus", "=", 1],
      ["transaction_date", "between", [from, to]],
      [ch.field, "=", channelValue],
    ]));
    const orders = (await erpGet(`/api/resource/Sales Order?fields=["name","transaction_date","customer","grand_total"]&filters=${oFilters}&limit_page_length=0`) || [])
      .filter(o => isMasked(o.customer))
      .sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date))); // newest first (graceful if truncated)
    const dateOf = {}, grand = {};
    orders.forEach(o => { dateOf[o.name] = ymd8(o.transaction_date); grand[o.name] = Number(o.grand_total) || 0; });

    // 2) line items — read via each order's document. Frappe does NOT allow listing a child
    //    table (Sales Order Item) directly over the API regardless of role, so we open each
    //    Sales Order and take its embedded .items. Concurrency pool + a time budget keep it safe.
    const names = orders.map(o => o.name);
    const lines = [];
    const started = Date.now();
    const CONC = 40, BUDGET_MS = 9000; // stay under the platform timeout; newest orders first so any cutoff hits oldest days
    let idx = 0;
    async function worker() {
      while (idx < names.length && Date.now() - started < BUDGET_MS) {
        const nm = names[idx++];
        const doc = await erpGet(`/api/resource/Sales Order/${encodeURIComponent(nm)}`).catch(() => null);
        if (doc && Array.isArray(doc.items)) {
          for (const it of doc.items) lines.push({ parent: nm, item_code: it.item_code, qty: it.qty, amount: it.amount });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, names.length) }, worker));
    const ordersRead = Math.min(idx, names.length);

    // 3) split each order's grand_total across its lines by line amount, so per-line value is
    //    tax-inclusive and the day/product totals reconcile to what customers actually paid.
    const lineSum = {};
    lines.forEach(l => { lineSum[l.parent] = (lineSum[l.parent] || 0) + (Number(l.amount) || 0); });
    const agg = {}; // `${date}|${item_code}` -> { d, sku, qty, amt }
    for (const l of lines) {
      const p = l.parent, d = dateOf[p]; if (!d) continue;
      const qty = Number(l.qty) || 0; if (!qty) continue;
      const amt = Number(l.amount) || 0;
      const share = lineSum[p] > 0 ? amt / lineSum[p] : 0;
      const gross = (grand[p] || 0) * share;   // this line's slice of the order total
      const k = d + "|" + l.item_code;
      if (!agg[k]) agg[k] = { d, sku: l.item_code, qty: 0, amt: 0 };
      agg[k].qty += qty; agg[k].amt += gross;
    }
    const rows = Object.values(agg);

    const payload = {
      updatedAt: new Date().toISOString(), channel, from, to,
      channelField: ch.field, channelValue,
      orders: orders.length, rows,
      ...(debug ? { debug: {
        detectedChannelField: ch.field, channelValue, allChannelValues: ch.values, channelHits: ch.hits,
        orderCount: orders.length, ordersRead, lineCount: lines.length,
        truncated: ordersRead < orders.length,
        grandTotal: Math.round(orders.reduce((a, o) => a + (Number(o.grand_total) || 0), 0)),
        elapsedMs: Date.now() - started,
        sampleOrders: orders.slice(0, 5),
      } } : {}),
    };
    cache[key] = { at: Date.now(), payload };
    res.setHeader("x-cache", "MISS");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e), rows: [] });
  }
}
