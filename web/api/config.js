// Vercel serverless function: GET /api/config
// Hands the browser the PUBLIC Supabase URL + anon key from Vercel env vars,
// so no keys live in the repo. Never put the service role key here.
module.exports = (req, res) => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  res.setHeader("Cache-Control", "no-store");
  if (!url || !anonKey) {
    // The site falls back to the bundled JSON when this fails.
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }
  res.status(200).json({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey });
};
