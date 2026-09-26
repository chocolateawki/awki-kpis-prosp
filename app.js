/* Funnel de prospección · DANO Miami
   Datos en Supabase (si config.js tiene credenciales) o en este navegador (modo local). */
(function () {
  "use strict";

  const FIELDS = ["p_base","p_descalificados","p_contactados","p_emails","p_llamadas","p_conectadas","p_abiertos","p_respondieron","p_agendadas","p_realizadas","p_meta","n_enviados","n_abiertos","n_clics","n_respuestas","n_reuniones","n_bajas"];
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const LAST_CLIENT_KEY = "dano_funnel_cliente";
  const $ = (id) => document.getElementById(id);

  let store = {};      // { "2026-08": {campos...} } del cliente activo
  let clientes = [];   // [{id, nombre}]
  let clienteId = null;
  let demo = null;
  let chart = null;

  // ---------------- Fechas ----------------
  const ym = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  const prevKey = (k) => { const [y, m] = k.split("-").map(Number); return ym(new Date(y, m - 2, 1)); };
  const label = (k) => { const [y, m] = k.split("-").map(Number); return MESES[m - 1] + " " + y; };
  const short = (k) => { const [y, m] = k.split("-").map(Number); return MESES[m - 1].slice(0, 3) + " " + String(y).slice(2); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const now = new Date();
  $("month").value = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  // ---------------- Capa de datos ----------------
  const cfg = window.APP_CONFIG || {};
  const hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const localApi = {
    _get(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } },
    _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    async listClientes() { return this._get("dano_funnel_clientes", []); },
    async crearCliente(nombre) {
      const list = this._get("dano_funnel_clientes", []);
      const c = { id: "local-" + Date.now(), nombre };
      list.push(c); this._set("dano_funnel_clientes", list); return c;
    },
    async renombrarCliente(id, nombre) {
      const list = this._get("dano_funnel_clientes", []).map((c) => c.id === id ? { ...c, nombre } : c);
      this._set("dano_funnel_clientes", list);
    },
    async listMetricas(cid) { return this._get("dano_funnel_metricas_" + cid, {}); },
    async guardar(cid, k, data) {
      const all = this._get("dano_funnel_metricas_" + cid, {});
      all[k] = data; this._set("dano_funnel_metricas_" + cid, all);
    }
  };

  const sbApi = {
    async listClientes() {
      const { data, error } = await sb.from("clientes").select("id,nombre").order("nombre");
      if (error) throw error; return data || [];
    },
    async crearCliente(nombre) {
      const { data, error } = await sb.from("clientes").insert({ nombre }).select("id,nombre").single();
      if (error) throw error; return data;
    },
    async renombrarCliente(id, nombre) {
      const { error } = await sb.from("clientes").update({ nombre }).eq("id", id);
      if (error) throw error;
    },
    async listMetricas(cid) {
      const { data, error } = await sb.from("metricas_mensuales").select("*").eq("cliente_id", cid).order("mes");
      if (error) throw error;
      const out = {};
      (data || []).forEach((r) => { out[r.mes.slice(0, 7)] = r; });
      return out;
    },
    async guardar(cid, k, data) {
      const row = { cliente_id: cid, mes: k + "-01" };
      FIELDS.forEach((f) => { row[f] = data[f] ?? null; });
      const { error } = await sb.from("metricas_mensuales").upsert(row, { onConflict: "cliente_id,mes" });
      if (error) throw error;
    }
  };

  const api = hasSupabase ? sbApi : localApi;
  $("modeTag").textContent = hasSupabase ? "Supabase" : "Modo local";
  $("modeTag").title = hasSupabase ? "Los datos se guardan en Supabase" : "Sin config.js: los datos se guardan solo en este navegador";

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg; document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  function errMsg(e) {
    const m = (e && (e.message || e.error_description)) || "Error desconocido";
    if (/row-level security|permission denied/i.test(m)) return "Tu email no está autorizado para esta acción.";
    if (/duplicate key/i.test(m)) return "Ese cliente ya existe.";
    return m;
  }

  // ---------------- Sesión ----------------
  async function start() {
    if (!hasSupabase) return boot();
    const { data } = await sb.auth.getSession();
    if (data.session) boot(); else showLogin();
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) boot();
      if (event === "SIGNED_OUT") showLogin();
    });
  }
  function showLogin() {
    $("login").classList.remove("hidden");
    ["report", "empty", "demoBanner"].forEach((id) => $(id).classList.add("hidden"));
    $("clientBox").classList.add("hidden");
    $("openEdit").classList.add("hidden");
    $("logout").classList.add("hidden");
  }
  $("loginBtn").onclick = async () => {
    const email = $("loginEmail").value.trim();
    if (!email) { $("loginMsg").textContent = "Escribe tu email."; return; }
    $("loginBtn").disabled = true; $("loginMsg").textContent = "Enviando…";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("loginBtn").disabled = false;
    $("loginMsg").textContent = error ? "No se pudo enviar: " + error.message : "Revisa tu correo y abre el enlace de acceso.";
  };
  $("logout").onclick = async () => { await sb.auth.signOut(); };

  let booted = false;
  async function boot() {
    $("login").classList.add("hidden");
    $("clientBox").classList.remove("hidden");
    $("openEdit").classList.remove("hidden");
    $("logout").classList.toggle("hidden", !hasSupabase);
    if (booted) return; booted = true;
    try {
      clientes = await api.listClientes();
    } catch (e) { toast(errMsg(e)); clientes = []; }
    if (!clientes.length) {
      try { clientes = [await api.crearCliente("Cliente")]; } catch (e) { toast(errMsg(e)); }
    }
    const last = localStorage.getItem(LAST_CLIENT_KEY);
    clienteId = (clientes.find((c) => c.id === last) || clientes[0] || {}).id || null;
    fillClientes();
    await loadMetricas();
  }

  // ---------------- Clientes ----------------
  function fillClientes() {
    const sel = $("cliente");
    sel.innerHTML = "";
    clientes.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.nombre; sel.appendChild(o); });
    if (clienteId) sel.value = clienteId;
    document.title = "Funnel · " + (currentName() || "DANO Miami");
  }
  const currentName = () => (clientes.find((c) => c.id === clienteId) || {}).nombre || "";
  $("cliente").onchange = async (e) => {
    clienteId = e.target.value;
    try { localStorage.setItem(LAST_CLIENT_KEY, clienteId); } catch (x) {}
    demo = null; fillClientes(); await loadMetricas();
  };
  $("nuevoCliente").onclick = async () => {
    const nombre = (prompt("Nombre del cliente") || "").trim();
    if (!nombre) return;
    try {
      const c = await api.crearCliente(nombre);
      clientes.push(c); clientes.sort((a, b) => a.nombre.localeCompare(b.nombre));
      clienteId = c.id; try { localStorage.setItem(LAST_CLIENT_KEY, c.id); } catch (x) {}
      fillClientes(); await loadMetricas();
    } catch (e) { toast(errMsg(e)); }
  };
  $("renombrarCliente").onclick = async () => {
    if (!clienteId) return;
    const nombre = (prompt("Nuevo nombre del cliente", currentName()) || "").trim();
    if (!nombre || nombre === currentName()) return;
    try {
      await api.renombrarCliente(clienteId, nombre);
      clientes = clientes.map((c) => c.id === clienteId ? { ...c, nombre } : c);
      fillClientes();
    } catch (e) { toast(errMsg(e)); }
  };

  async function loadMetricas() {
    if (!clienteId) { store = {}; return render(); }
    try { store = await api.listMetricas(clienteId); }
    catch (e) { toast(errMsg(e)); store = {}; }
    render();
  }

  // ---------------- Cálculos ----------------
  const n = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? null : Number(v);
  const div = (a, b) => (n(a) === null || !n(b)) ? null : n(a) / n(b);
  const fmt = (v) => v === null ? "—" : Math.round(v).toLocaleString("es-EC");
  const pct = (v) => v === null ? "—" : v === 0 ? "0%" : (v * 100).toFixed(v < 0.01 ? 2 : v < 0.1 ? 1 : 0) + "%";
  const grade = (v, lo, hi) => v === null ? "na" : v >= hi ? "good" : v >= lo ? "warn" : "bad";

  function metrics(d) {
    if (!d) return null;
    const toques = (n(d.p_emails) || 0) + (n(d.p_llamadas) || 0);
    const baseUtil = n(d.p_base) === null ? null : n(d.p_base) - (n(d.p_descalificados) || 0);
    return {
      descalif: div(d.p_descalificados, d.p_base),
      baseUtil,
      cobertura: div(d.p_contactados, baseUtil),
      toquesXc: div(toques, d.p_contactados),
      apertura: div(d.p_abiertos, d.p_emails),
      conexion: div(d.p_conectadas, d.p_llamadas),
      respuesta: div(d.p_respondieron, d.p_contactados),
      resp2reu: div(d.p_agendadas, d.p_respondieron),
      asistencia: div(d.p_realizadas, d.p_agendadas),
      global: div(d.p_agendadas, d.p_contactados),
      metaPct: div(d.p_agendadas, d.p_meta),
      toques,
      nApertura: div(d.n_abiertos, d.n_enviados),
      nClic: div(d.n_clics, d.n_enviados),
      nRespuesta: div(d.n_respuestas, d.n_enviados),
      nResp2reu: div(d.n_reuniones, d.n_respuestas),
      nBaja: div(d.n_bajas, d.n_enviados),
      nGlobal: div(d.n_reuniones, d.n_enviados)
    };
  }

  // ---------------- Render ----------------
  function render() {
    const k = $("month").value, all = demo || store, d = all[k];
    $("heroTitle").innerHTML = "Funnel de prospección<span>" + cap(label(k)) + "</span>";
    $("demoBanner").classList.toggle("hidden", !demo);
    if (!d) { $("empty").classList.remove("hidden"); $("report").classList.add("hidden"); return; }
    $("empty").classList.add("hidden"); $("report").classList.remove("hidden");
    const pd = all[prevKey(k)], m = metrics(d), pm = metrics(pd);
    renderKpis(d, m, pm, pd);
    renderFunnelP(d, m); renderRatesP(m, pm);
    renderFunnelN(d, m); renderRatesN(m, pm);
    renderTrend(all); renderInsights(d, m, pm);
  }

  function delta(cur, prev, isPct, inv) {
    if (cur === null || prev === null || prev === undefined) return "";
    const diff = isPct ? (cur - prev) * 100 : (prev ? ((cur - prev) / prev) * 100 : null);
    if (diff === null) return "";
    const cls = Math.abs(diff) < (isPct ? 0.05 : 0.5) ? "flat" : (diff > 0) !== !!inv ? "up" : "down";
    return `<span class="delta ${cls}">${diff > 0 ? "+" : ""}${diff.toFixed(isPct && Math.abs(diff) < 1 ? 2 : 1)}${isPct ? " pts" : "%"}</span>`;
  }

  function renderKpis(d, m, pm, pd) {
    const totalReu = (n(d.p_agendadas) || 0) + (n(d.n_reuniones) || 0);
    const pTotal = pd ? (n(pd.p_agendadas) || 0) + (n(pd.n_reuniones) || 0) : null;
    const meta = n(d.p_meta);
    const items = [
      { v: fmt(totalReu), l: "Reuniones totales (prospección + nutrición)" + (meta ? ` · meta prospección ${fmt(meta)}` : ""), dl: delta(totalReu, pTotal, false) },
      { v: pct(m.global), l: "Conversión contactado → reunión", dl: delta(m.global, pm && pm.global, true) },
      { v: pct(m.respuesta), l: "Tasa de respuesta en prospección", dl: delta(m.respuesta, pm && pm.respuesta, true) },
      { v: pct(m.descalif), l: "Base descalificada", dl: delta(m.descalif, pm && pm.descalif, true, true) }
    ];
    $("kpis").innerHTML = items.map((i) => `<div class="kpi"><div class="v">${i.v}${i.dl}</div><div class="l">${i.l}</div></div>`).join("");
  }

  function drawFunnel(el, stages) {
    const max = Math.max(...stages.map((s) => n(s.value) || 0), 1);
    let html = "";
    stages.forEach((s, i) => {
      if (i > 0) {
        const c = s.conv;
        html += `<div class="step"><span></span><span class="chip ${c && c.bad ? "bad" : ""}">${c ? c.text : ""}</span><span></span></div>`;
      }
      const v = n(s.value) || 0;
      const w = Math.max(6, Math.min(100, Math.sqrt(v / max) * 100));
      let inner = "";
      if (s.split) {
        const tot = s.split.reduce((a, b) => a + (n(b.v) || 0), 0) || 1;
        inner = s.split.map((p) => `<span class="seg" style="width:${(n(p.v) || 0) / tot * 100}%;background:${p.c}" title="${p.label}: ${fmt(n(p.v))}"></span>`).join("");
      }
      const style = `width:${w}%;animation-delay:${i * 60}ms` + (s.color ? `;background:${s.color}` : "");
      html += `<div class="stage"><div class="name">${s.name}${s.sub ? `<small>${s.sub}</small>` : ""}</div>
        <div class="bar-wrap"><div class="bar ${s.activity ? "activity" : ""}" style="${style}">${inner}</div></div>
        <div class="num">${fmt(n(s.value))}</div></div>`;
    });
    el.innerHTML = html;
  }

  function renderFunnelP(d, m) {
    const hasDesc = n(d.p_descalificados) !== null;
    const stages = [{ name: "Contactos en la base", value: d.p_base }];
    if (hasDesc) stages.push({ name: "Descalificados", sub: `Base útil: ${fmt(m.baseUtil)}`, value: d.p_descalificados, color: "var(--muted)",
      conv: { text: pct(m.descalif) + " de la base", bad: m.descalif !== null && m.descalif > 0.25 } });
    stages.push(
      { name: "Contactados", value: d.p_contactados, conv: { text: pct(m.cobertura) + (hasDesc ? " de la base útil" : " de la base"), bad: m.cobertura !== null && m.cobertura < 0.3 } },
      { name: "Emails + llamadas", sub: `${fmt(n(d.p_emails))} emails · ${fmt(n(d.p_llamadas))} llamadas`, value: m.toques, activity: true,
        split: [{ v: d.p_emails, c: "var(--accent)", label: "Emails" }, { v: d.p_llamadas, c: "var(--ink)", label: "Llamadas" }],
        conv: { text: (m.toquesXc === null ? "—" : m.toquesXc.toFixed(1)) + " toques por contacto", bad: m.toquesXc !== null && m.toquesXc < 3 } },
      { name: "Emails abiertos", value: d.p_abiertos, conv: { text: pct(m.apertura) + " apertura", bad: m.apertura !== null && m.apertura < 0.25 } },
      { name: "Respondieron", value: d.p_respondieron, conv: { text: pct(m.respuesta) + " de contactados", bad: m.respuesta !== null && m.respuesta < 0.03 } },
      { name: "Reuniones agendadas", sub: n(d.p_realizadas) !== null ? `${fmt(n(d.p_realizadas))} realizadas` : "", value: d.p_agendadas, conv: { text: pct(m.resp2reu) + " de respuestas", bad: m.resp2reu !== null && m.resp2reu < 0.25 } }
    );
    drawFunnel($("funnelP"), stages);
  }
  function renderFunnelN(d, m) {
    if (["n_enviados","n_abiertos","n_respuestas","n_reuniones"].every((f) => n(d[f]) === null)) {
      $("funnelN").innerHTML = '<p style="color:var(--muted);margin:0">Sin datos de nutrición este mes. Agrégalos desde “Ingresar métricas”.</p>';
      return;
    }
    drawFunnel($("funnelN"), [
      { name: "Emails enviados", value: d.n_enviados },
      { name: "Emails abiertos", value: d.n_abiertos, conv: { text: pct(m.nApertura) + " apertura", bad: m.nApertura !== null && m.nApertura < 0.2 } },
      { name: "Respuestas", value: d.n_respuestas, conv: { text: pct(m.nRespuesta) + " de enviados", bad: m.nRespuesta !== null && m.nRespuesta < 0.01 } },
      { name: "Reuniones", value: d.n_reuniones, conv: { text: pct(m.nResp2reu) + " de respuestas", bad: m.nResp2reu !== null && m.nResp2reu < 0.2 } }
    ]);
  }

  function rateRows(rows, m, pm) {
    return `<thead><tr><th>Indicador</th><th>Mes</th><th>vs mes ant.</th></tr></thead><tbody>` +
      rows.map((r) => {
        const v = m[r.k];
        const g = r.gradeFn ? r.gradeFn(v) : grade(v, r.lo, r.hi);
        return `<tr><td><span class="dot ${g}"></span>${r.name}<span class="ref">Ref. ${r.ref}</span></td><td>${r.fmt ? r.fmt(v) : pct(v)}</td><td>${delta(v, pm ? pm[r.k] : null, r.rate !== false, r.inv) || "—"}</td></tr>`;
      }).join("") + `</tbody>`;
  }
  const lowerIsBetter = (good, warn) => (v) => v === null ? "na" : v <= good ? "good" : v <= warn ? "warn" : "bad";

  function renderRatesP(m, pm) {
    $("ratesP").innerHTML = rateRows([
      { k: "descalif", name: "Descalificados sobre la base", ref: "< 15% (menor es mejor)", inv: true, gradeFn: lowerIsBetter(0.15, 0.25) },
      { k: "cobertura", name: "Cobertura de la base útil", ref: "≥ 30% mensual", lo: .15, hi: .3 },
      { k: "toquesXc", name: "Toques por contacto", ref: "5–8 en la cadencia", lo: 3, hi: 5, rate: false, fmt: (v) => v === null ? "—" : v.toFixed(1) },
      { k: "apertura", name: "Apertura de emails", ref: "25–45%", lo: .25, hi: .4 },
      { k: "conexion", name: "Llamadas conectadas", ref: "8–15%", lo: .06, hi: .1 },
      { k: "respuesta", name: "Respuesta sobre contactados", ref: "3–8%", lo: .03, hi: .06 },
      { k: "resp2reu", name: "Respuesta → reunión", ref: "25–50%", lo: .25, hi: .4 },
      { k: "asistencia", name: "Asistencia a reuniones", ref: "75–85%", lo: .7, hi: .8 },
      { k: "global", name: "Contactado → reunión", ref: "1–3%", lo: .01, hi: .02 },
      { k: "metaPct", name: "Cumplimiento de meta", ref: "100%", lo: .8, hi: 1 }
    ], m, pm);
  }
  function renderRatesN(m, pm) {
    $("ratesN").innerHTML = rateRows([
      { k: "nApertura", name: "Apertura", ref: "20–35%", lo: .2, hi: .3 },
      { k: "nClic", name: "Clics sobre enviados", ref: "2–5%", lo: .015, hi: .03 },
      { k: "nRespuesta", name: "Respuesta sobre enviados", ref: "1–3%", lo: .01, hi: .02 },
      { k: "nResp2reu", name: "Respuesta → reunión", ref: "20–40%", lo: .2, hi: .3 },
      { k: "nBaja", name: "Bajas", ref: "< 0.5% (menor es mejor)", inv: true, gradeFn: lowerIsBetter(0.005, 0.01) },
      { k: "nGlobal", name: "Enviado → reunión", ref: "0.2–1%", lo: .002, hi: .005 }
    ], m, pm);
  }

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function renderTrend(all) {
    if (!window.Chart) return;
    const k = $("month").value;
    const keys = Object.keys(all).filter((x) => x <= k).sort().slice(-6);
    const ms = keys.map((x) => metrics(all[x]));
    const ink = css("--ink"), muted = css("--muted"), line = css("--line");
    if (chart) chart.destroy();
    chart = new Chart($("trend"), {
      data: { labels: keys.map(short), datasets: [
        { type: "bar", label: "Reuniones prospección", data: keys.map((x) => n(all[x].p_agendadas) || 0), backgroundColor: "#C8002D", stack: "r", yAxisID: "y", borderRadius: 3 },
        { type: "bar", label: "Reuniones nutrición", data: keys.map((x) => n(all[x].n_reuniones) || 0), backgroundColor: ink, stack: "r", yAxisID: "y", borderRadius: 3 },
        { type: "line", label: "Respuesta prospección %", data: ms.map((x) => x.respuesta === null ? null : +(x.respuesta * 100).toFixed(1)), borderColor: muted, backgroundColor: muted, yAxisID: "y1", tension: .3, pointRadius: 4 },
        { type: "line", label: "Contactado → reunión %", data: ms.map((x) => x.global === null ? null : +(x.global * 100).toFixed(2)), borderColor: "#C8002D", borderDash: [6, 4], backgroundColor: "#C8002D", yAxisID: "y1", tension: .3, pointRadius: 4 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: ink, font: { family: "Acumin" }, boxWidth: 12 } } },
        scales: {
          x: { stacked: true, ticks: { color: muted }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: muted, precision: 0 }, grid: { color: line }, title: { display: true, text: "Reuniones", color: muted } },
          y1: { position: "right", beginAtZero: true, ticks: { color: muted, callback: (v) => v + "%" }, grid: { display: false } }
        } }
    });
  }

  function renderInsights(d, m, pm) {
    const out = [];
    const add = (cls, html) => out.push(`<li class="${cls}">${html}</li>`);
    const checks = [
      { v: m.cobertura, lo: .3, name: "cobertura de la base útil", tip: "Estás trabajando una porción pequeña de la base. Aumenta capacidad de SDR o prioriza por fit/score para llegar a más contactos." },
      { v: m.toquesXc, lo: 5, name: "intensidad de la cadencia", tip: "Con menos de 5 toques por contacto la mayoría de respuestas no llega. Extiende la secuencia combinando email, llamada y LinkedIn.", num: true },
      { v: m.apertura, lo: .25, name: "apertura de emails", tip: "Revisa asuntos, reputación del dominio y limpieza de la lista antes de tocar el contenido." },
      { v: m.respuesta, lo: .03, name: "tasa de respuesta", tip: "El mensaje no está conectando: segmenta por buyer persona y personaliza la primera línea con un dolor concreto." },
      { v: m.resp2reu, lo: .25, name: "conversión de respuesta a reunión", tip: "Hay interés que no se cierra en agenda. Responde en menos de 1 hora y envía link de calendario con 2 horarios propuestos." },
      { v: m.asistencia, lo: .75, name: "asistencia a reuniones", tip: "Confirma 24 h antes y envía recordatorio con agenda y valor de la reunión." }
    ];
    let worst = null;
    checks.forEach((c) => { if (c.v === null) return; const gap = (c.lo - c.v) / c.lo; if (gap > 0 && (!worst || gap > worst.gap)) worst = { ...c, gap }; });
    if (worst) add("bad", `<b>Principal cuello de botella: ${worst.name}</b> (${worst.num ? worst.v.toFixed(1) : pct(worst.v)}). ${worst.tip}`);
    else add("good", `<b>Todas las etapas medidas están en rango de referencia.</b> El siguiente paso es escalar volumen manteniendo tasas.`);
    if (m.descalif !== null && m.descalif > 0.15)
      add("bad", `<b>${pct(m.descalif)} de la base está descalificada.</b> Revisa la fuente de los contactos y los criterios de ICP antes de cargar más volumen.`);
    if (m.metaPct !== null) add(m.metaPct >= 1 ? "good" : "bad", `<b>Meta de reuniones: ${pct(m.metaPct)}.</b> ${fmt(n(d.p_agendadas))} de ${fmt(n(d.p_meta))} agendadas en prospección.`);
    if (pm && m.global !== null && pm.global !== null) {
      const diff = (m.global - pm.global) * 100;
      add(diff >= 0 ? "good" : "bad", `<b>Contactado → reunión ${diff >= 0 ? "sube" : "baja"} ${Math.abs(diff).toFixed(2)} pts</b> frente al mes anterior.`);
    }
    const e = n(d.p_emails) || 0, l = n(d.p_llamadas) || 0;
    if (e + l > 0) {
      const share = l / (e + l);
      if (share < 0.2) add("", `<b>Mix de canales cargado a email (${pct(1 - share)}).</b> Las llamadas suelen duplicar la tasa de reunión; considera subirlas al 25–35% de los toques.`);
      else add("", `<b>Mix de canales:</b> ${pct(1 - share)} emails y ${pct(share)} llamadas.`);
    }
    const pR = n(d.p_agendadas) || 0, nR = n(d.n_reuniones) || 0;
    if (pR + nR > 0) add("", `<b>Origen de reuniones:</b> ${pct(pR / (pR + nR))} prospección activa y ${pct(nR / (pR + nR))} nutrición.`);
    if (m.nBaja !== null && m.nBaja > 0.005) add("bad", `<b>Bajas en nutrición por encima de 0.5% (${pct(m.nBaja)}).</b> Reduce frecuencia o segmenta mejor la audiencia de la campaña.`);
    $("insights").innerHTML = out.join("");
  }

  // ---------------- Formulario ----------------
  function openDrawer() {
    if (!clienteId) { toast("Agrega un cliente primero."); return; }
    demo = null;
    const d = store[$("month").value] || {};
    FIELDS.forEach((f) => { $(f).value = d[f] ?? ""; });
    $("drawerTitle").textContent = `${currentName()} · ${label($("month").value)}`;
    $("saveState").textContent = hasSupabase ? "Se guarda en Supabase" : "Se guarda en este navegador";
    $("drawer").classList.add("open"); $("scrim").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    setTimeout(() => $("p_base").focus(), 200);
  }
  function closeDrawer() { $("drawer").classList.remove("open"); $("scrim").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); }
  $("openEdit").onclick = openDrawer;
  $("emptyEdit").onclick = openDrawer;
  $("closeEdit").onclick = closeDrawer; $("cancelEdit").onclick = closeDrawer; $("scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  function validate(data) {
    const b = data.p_base, ds = data.p_descalificados, c = data.p_contactados;
    if (b != null && ds != null && ds > b) return "Los descalificados no pueden superar la base.";
    if (b != null && c != null && c > b - (ds || 0)) return "Los contactados superan la base útil (base − descalificados).";
    if (data.p_abiertos != null && data.p_emails != null && data.p_abiertos > data.p_emails) return "Los emails abiertos superan a los enviados.";
    if (data.n_abiertos != null && data.n_enviados != null && data.n_abiertos > data.n_enviados) return "Nutrición: abiertos superan a enviados.";
    return null;
  }
  $("saveBtn").onclick = async () => {
    const k = $("month").value, data = {};
    FIELDS.forEach((f) => { const v = $(f).value; data[f] = v === "" ? null : Math.max(0, Math.round(Number(v))); });
    const err = validate(data);
    if (err) { $("saveState").textContent = err; return; }
    $("saveBtn").disabled = true; $("saveState").textContent = "Guardando…";
    try {
      await api.guardar(clienteId, k, data);
      store[k] = { ...(store[k] || {}), ...data };
      closeDrawer(); render(); toast("Métricas guardadas");
    } catch (e) { $("saveState").textContent = errMsg(e); }
    finally { $("saveBtn").disabled = false; }
  };
  $("month").onchange = render;

  // ---------------- Ejemplo ----------------
  $("demoBtn").onclick = () => {
    const k = $("month").value, out = {};
    const rows = [
      [4200, 520, 980, 2900, 610, 64, 1015, 41, 14, 11, 15, 3800, 1060, 95, 38, 9, 14],
      [4350, 560, 1120, 3350, 720, 79, 1180, 52, 17, 13, 18, 3900, 1130, 110, 44, 11, 12],
      [4500, 610, 1260, 3700, 880, 98, 1290, 63, 21, 17, 20, 4100, 1170, 121, 49, 12, 21]
    ];
    rows.forEach((row, i) => {
      let kk = k; for (let j = 0; j < rows.length - 1 - i; j++) kk = prevKey(kk);
      const o = {}; FIELDS.forEach((f, idx) => { o[f] = row[idx]; }); out[kk] = o;
    });
    demo = out; render(); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  $("exitDemo").onclick = () => { demo = null; render(); };

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", render);
  }

  start();
})();
