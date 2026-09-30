// Vercel serverless function: starts a Lipila mobile money payment for the signed-in user.
// Env vars (Vercel -> Settings -> Environment Variables): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIPILA_API_KEY
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIPILA_API_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LIPILA_API_KEY) {
      console.error("Missing environment variables");
      return res.status(500).json({ success: false, message: "Payment configuration is missing." });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Who is paying? Taken from the login token, never from the request body.
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ success: false, message: "Please sign in again." });
    const user = u.user;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // Phone -> 260XXXXXXXXX
    let acct = String(body.phone || "").replace(/\D/g, "");
    if (acct.startsWith("0")) acct = "260" + acct.slice(1);
    if (!acct.startsWith("260")) acct = "260" + acct;
    if (acct.length !== 12) {
      return res.status(400).json({ success: false, message: "Enter a valid Zambian mobile number, e.g. 0977123456." });
    }

    // Price comes from the app_settings table, so the browser cannot change it.
    const { data: st } = await admin.from("app_settings").select("key,value").in("key", ["price", "currency_code"]);
    const cfg = Object.fromEntries((st || []).map((r) => [r.key, r.value]));
    const amount = Number(cfg.price || 50);
    const currency = cfg.currency_code || "ZMW";
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(500).json({ success: false, message: "Price is not configured." });
    }

    // Abuse limit: 5 attempts per 10 minutes.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since);
    if ((count || 0) >= 5) {
      return res.status(429).json({ success: false, message: "Too many attempts. Please wait a few minutes." });
    }

    const referenceId = "PD-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const ins = await admin.from("payments").insert({ reference: referenceId, user_id: user.id, amount });
    if (ins.error) {
      console.error(ins.error);
      return res.status(500).json({ success: false, message: "Couldn't record the payment. Run setup-lipila.sql first." });
    }

    const resp = await fetch("https://blz.lipila.io/api/v1/collections/mobile-money", {
      method: "POST",
      headers: { accept: "application/json", "Content-Type": "application/json", "x-api-key": LIPILA_API_KEY },
      body: JSON.stringify({
        referenceId,
        amount,
        narration: "PrivateDrive Premium",
        accountNumber: acct,
        currency,
        referenceData: user.email || user.id
      })
    });
    const text = await resp.text();
    console.log("Lipila create:", resp.status, text);

    if (!resp.ok) {
      await admin.from("payments").update({ status: "failed", provider_status: "rejected " + resp.status })
        .eq("reference", referenceId);
      return res.status(502).json({ success: false, message: "The payment request was rejected. Check the number and try again." });
    }
    return res.status(200).json({ success: true, referenceId });
  } catch (e) {
    console.error("CREATE PAYMENT ERROR:", e);
    return res.status(500).json({ success: false, message: "Payment function failed." });
  }
};
