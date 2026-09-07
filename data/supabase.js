const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
        "\n⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.\n" +
        "   Copy .env.example to .env and fill in your Supabase project credentials.\n"
    );
}

// This client uses the SERVICE ROLE key, which bypasses all Row Level
// Security policies. It must only ever be used on the server (here), and
// every route that uses it is responsible for doing its own permission
// checks (see requireOwner in server.js) before reading/writing anything
// sensitive.
const supabaseAdmin = createClient(
    SUPABASE_URL || "https://placeholder.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY || "placeholder-key",
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

module.exports = { supabaseAdmin };