// Genera config.js en el build de Vercel a partir de variables de entorno.
const fs = require("fs");
const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_ANON_KEY || "";
if (!url || !key) console.warn("⚠ Faltan SUPABASE_URL o SUPABASE_ANON_KEY: la app correrá en modo local.");
fs.writeFileSync("config.js", `window.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key })};\n`);
console.log("config.js generado");
