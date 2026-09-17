// Shared data store for the Marketplace Sales dashboard.
//
//   GET  /api/data?mkt=myntra&ch=sor   -> latest saved dataset for that marketplace+channel
//                                          (or 204 if nothing has been uploaded yet)
//   POST /api/data?mkt=myntra&ch=sor   -> body { password, payload }; saves it for the whole team
//
// Storage = Vercel Blob. The token comes from the BLOB_READ_WRITE_TOKEN env var that Vercel adds
// automatically once you create a Blob store and connect it to this project. The update password
// is checked here on the server, so a random visitor who finds the URL cannot overwrite your data.
//
// One blob per marketplace+channel, e.g. marketplace-sales/myntra-sor.json — so Myntra SOR,
// Myntra marketplace, Amazon SOR, etc. each get their own independent store as we add them.
import { put, list } from "@vercel/blob";

// Same lightweight hash the page uses. Must match the "Update data" password.
// Currently: areyousure?   (shared with the other Ten x You dashboards)
// To change it: run strHash('newpassword') in the browser console and paste the number below,
// and update the same password prompt in index.html.
const PW_HASH = -1982839713;
function strHash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }

// Viewing password (gates reading the data). Default '98(75)'; override with env DASHBOARD_PASSWORD.
const VIEW_PW_HASH = 1684824962; // strHash('98(75)')
function viewOk(req){
  const given = String((req.headers && req.headers["x-dash-pw"]) || (req.query && req.query.pw) || "");
  const envPw = process.env.DASHBOARD_PASSWORD;
  return envPw ? given === envPw : strHash(given) === VIEW_PW_HASH;
}

const okId = (s) => /^[a-z0-9]+$/.test(s || "");

export default async function handler(req, res) {
  const mkt = (req.query.mkt || "").toString();
  const ch  = (req.query.ch  || "").toString();
  if (!okId(mkt) || !okId(ch)) return res.status(400).json({ error: "bad marketplace/channel id" });
  const path = `marketplace-sales/${mkt}-${ch}.json`;

  try {
    if (req.method === "GET") {
      if (!viewOk(req)) return res.status(401).json({ error: "viewing password required" });
      const { blobs } = await list({ prefix: path });
      const hit = blobs.find((b) => b.pathname === path) || blobs[0];
      if (!hit) return res.status(204).end();
      const r = await fetch(hit.url, { cache: "no-store" });
      const json = await r.json();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(json);
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      if (strHash(String(body.password || "")) !== PW_HASH)
        return res.status(401).json({ error: "wrong update password" });
      if (!body.payload)
        return res.status(400).json({ error: "missing payload" });
      const record = { ...body.payload, updated_at: new Date().toISOString() };
      await put(path, JSON.stringify(record), {
        access: "public", contentType: "application/json",
        addRandomSuffix: false, allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, updated_at: record.updated_at });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "server error" });
  }
}
