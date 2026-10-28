
/**
 * Creates one Supabase client for the backend.
 * Never expose the service-role/secret key in frontend code.
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check backend/.env"
  );
  process.exit(1);
}

if (!/^https?:\/\/.+/i.test(url)) {
  console.error(
    "Invalid SUPABASE_URL. It must start with https:// or http://"
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;

