// Copia este archivo como config.js para desarrollo local.
// En Vercel NO hace falta: config.js se genera en el build con las variables de entorno.
// La anon/publishable key es pública por diseño; la seguridad la dan las políticas RLS.
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU-ANON-O-PUBLISHABLE-KEY"
};
