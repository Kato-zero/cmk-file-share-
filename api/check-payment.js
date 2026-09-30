// Vercel serverless function: checks a payment with Lipila and, once successful, unlocks Premium.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIPILA_API_KEY
const { createClient } = require("@supabase/supabase-js");

const OK = ["successful", "success", "completed", "paid"];
const BAD = ["failed", "expired", "cancelled", "canceled", "rejected", "declined", "error"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIPILA_API_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LIPILA_API_KEY) {
      return res.status(500).json({ success: false, message: "Payment configuration is missing." });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ success: false, message: "Please sign in again." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const ref = String(body.referenceId || "").trim();
    if (!ref) return res.status(400).json({ success: false, message: "referenceId is required" });

    // Only the payment's owner can check it.
    const { data: row } = await admin.from("payments").select("*")
      .eq("reference", ref).eq("user_id", u.user.id).maybeSingle();
    if (!row) return res.status(404).json({ success: false, message: "Payment not found." });
    if (row.status !== "pending") return res.status(200).json({ success: true, status: row.status });

    const resp = await fetch(
      "https://blz.lipila.io/api/v1/collections/check-status?referenceId=" + encodeURIComponent(ref),
      { headers: { accept: "application/json", "x-api-key": LIPILA_API_KEY } }
    );
    const text = await resp.text();
    console.log("Lipila status:", resp.status, text);
    let d = {};
    try { d = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!resp.ok) return res.status(200).json({ success: true, status: "pending" });

    const raw = String((d && (d.status || (d.data && d.data.status))) || "").toLowerCase();
    if (BAD.includes(raw)) {
      await admin.from("payments").update({ status: "failed", provider_status: raw }).eq("id", row.id).eq("status", "pending");
      return res.status(200).json({ success: true, status: "failed" });
    }
    if (!OK.includes(raw)) return res.status(200).json({ success: true, status: "pending" });

    // Paid. The conditional update makes sure Premium is added only ONCE per payment.
    const { data: upd } = await admin.from("payments")
      .update({ status: "successful", provider_status: raw, paid_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", "pending").select("id");
    if (upd && upd.length) {
      const { error } = await admin.rpc("activate_premium", { p_user: row.user_id, p_days: null });
      if (error) {
        console.error("activate_premium failed:", error);
        await admin.from("payments").update({ status: "pending" }).eq("id", row.id); // allow a retry
        return res.status(500).json({ success: false, message: "Payment received but activation failed. It will retry." });
      }
    }
    return res.status(200).json({ success: true, status: "successful" });
  } catch (e) {
    console.error("CHECK PAYMENT ERROR:", e);
    return res.status(500).json({ success: false, message: "Unable to check payment status." });
  }
};
