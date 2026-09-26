/* Funnel de prospección · DANO Miami
   Datos en Supabase (si config.js tiene credenciales) o en este navegador (modo local). */
(function () {
  "use strict";

  const FIELDS = ["p_base","p_descalificados","p_contactados","p_emails","p_llamadas","p_conectadas","p_abiertos","p_respondieron","p_agendadas","p_realizadas","p_meta","n_enviados","n_abiertos","n_clics","n_respuestas","n_reuniones","n_bajas"];
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const $ = (id) => document.getElementById(id);

  let store = {};      // { "2026-08": {campos...} } del cliente activo
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
  const CLIENT_NAME = (cfg.CLIENT_NAME || "AWKI USA").trim();
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
    if (/row-level security|permission denied/i.test(m)) return "Supabase rechazó la operación (permisos RLS).";
    if (/duplicate key/i.test(m)) return "Ese cliente ya existe.";
    return m;
  }

  async function start() { boot(); }

  let booted = false;
  function showError(msg) { $("errorText").textContent = msg; $("errorBox").classList.remove("hidden"); }
  async function boot() {
    $("clientBox").classList.remove("hidden");
    $("openEdit").classList.remove("hidden");
    $("clienteNombre").textContent = CLIENT_NAME;
    document.title = "Funnel · " + CLIENT_NAME;
    if (booted) return; booted = true;
    try {
      const list = await api.listClientes();
      let c = list.find((x) => x.nombre.trim().toLowerCase() === CLIENT_NAME.toLowerCase());
      if (!c) c = await api.crearCliente(CLIENT_NAME);
      clienteId = c.id;
    } catch (e) {
      clienteId = null;
      showError("No se pudo cargar el cliente " + CLIENT_NAME + ": " + errMsg(e) +
        (hasSupabase ? " Verifica que ejecutaste supabase/schema.sql y que existe el cliente en la tabla clientes." : ""));
    }
    await loadMetricas();
  }

  const currentName = () => CLIENT_NAME;

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
  let view = "mes";
  function render() {
    const k = $("month").value, all = demo || store, d = all[k];
    $("demoBanner").classList.toggle("hidden", !demo);
    if (view === "comp") {
      $("heroTitle").innerHTML = "Comparativo mensual<span>Hasta " + label(k) + "</span>";
      $("empty").classList.add("hidden"); $("report").classList.add("hidden"); $("compare").classList.remove("hidden");
      return renderCompare(all, k);
    }
    $("compare").classList.add("hidden");
    $("heroTitle").innerHTML = "Funnel de prospección<span>" + cap(label(k)) + "</span>";
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


  // ---------------- Comparativo mensual ----------------
  // tipo: "n" = volumen (cambio en %), "r" = tasa (cambio en pts), "x" = ratio (cambio en %). inv = menor es mejor
  const CMP = [
    { g: "Resultados" },
    { k: "reuTot", l: "Reuniones totales", t: "n", f: (d) => (n(d.p_agendadas) ?? null) === null && n(d.n_reuniones) === null ? null : (n(d.p_agendadas) || 0) + (n(d.n_reuniones) || 0), spark: true },
    { k: "global", l: "Contactado → reunión", t: "r", f: (d, m) => m.global, spark: true },
    { k: "metaPct", l: "Cumplimiento de meta", t: "r", f: (d, m) => m.metaPct },
    { g: "Prospección · volumen" },
    { k: "p_base", l: "Contactos en la base", t: "n", f: (d) => n(d.p_base) },
    { k: "p_descalificados", l: "Descalificados", t: "n", inv: true, f: (d) => n(d.p_descalificados) },
    { k: "p_contactados", l: "Contactados", t: "n", f: (d) => n(d.p_contactados), spark: true },
    { k: "p_emails", l: "Emails enviados", t: "n", f: (d) => n(d.p_emails) },
    { k: "p_llamadas", l: "Llamadas realizadas", t: "n", f: (d) => n(d.p_llamadas) },
    { k: "p_abiertos", l: "Emails abiertos", t: "n", f: (d) => n(d.p_abiertos) },
    { k: "p_respondieron", l: "Respondieron", t: "n", f: (d) => n(d.p_respondieron) },
    { k: "p_agendadas", l: "Reuniones agendadas", t: "n", f: (d) => n(d.p_agendadas) },
    { k: "p_realizadas", l: "Reuniones realizadas", t: "n", f: (d) => n(d.p_realizadas) },
    { g: "Prospección · tasas" },
    { k: "descalif", l: "% descalificados", t: "r", inv: true, f: (d, m) => m.descalif, spark: true },
    { k: "cobertura", l: "Cobertura base útil", t: "r", f: (d, m) => m.cobertura },
    { k: "toquesXc", l: "Toques por contacto", t: "x", f: (d, m) => m.toquesXc },
    { k: "apertura", l: "Apertura de emails", t: "r", f: (d, m) => m.apertura, spark: true },
    { k: "conexion", l: "Llamadas conectadas", t: "r", f: (d, m) => m.conexion },
    { k: "respuesta", l: "Respuesta sobre contactados", t: "r", f: (d, m) => m.respuesta, spark: true },
    { k: "resp2reu", l: "Respuesta → reunión", t: "r", f: (d, m) => m.resp2reu },
    { k: "asistencia", l: "Asistencia a reuniones", t: "r", f: (d, m) => m.asistencia },
    { g: "Nutrición" },
    { k: "n_enviados", l: "Emails enviados", t: "n", f: (d) => n(d.n_enviados) },
    { k: "n_abiertos", l: "Emails abiertos", t: "n", f: (d) => n(d.n_abiertos) },
    { k: "n_respuestas", l: "Respuestas", t: "n", f: (d) => n(d.n_respuestas) },
    { k: "n_reuniones", l: "Reuniones", t: "n", f: (d) => n(d.n_reuniones), spark: true },
    { k: "nApertura", l: "Apertura", t: "r", f: (d, m) => m.nApertura, spark: true },
    { k: "nRespuesta", l: "Respuesta sobre enviados", t: "r", f: (d, m) => m.nRespuesta },
    { k: "nResp2reu", l: "Respuesta → reunión", t: "r", f: (d, m) => m.nResp2reu },
    { k: "nBaja", l: "Bajas", t: "r", inv: true, f: (d, m) => m.nBaja }
  ];
  const CMP_METRICS = CMP.filter((x) => x.k);
  let cmpRange = 6, cmpMetric = "reuTot", cmpChart = null;

  const fmtVal = (def, v) => v === null || v === undefined ? "—" : def.t === "r" ? pct(v) : def.t === "x" ? v.toFixed(1) : fmt(v);
  function change(def, cur, prev) {
    if (cur === null || prev === null || cur === undefined || prev === undefined) return null;
    if (def.t === "r") return { v: (cur - prev) * 100, unit: " pts" };
    if (!prev) return null;
    return { v: ((cur - prev) / prev) * 100, unit: "%" };
  }
  function changeHtml(def, ch, cls) {
    if (!ch) return `<span class="${cls} flat">—</span>`;
    const flat = Math.abs(ch.v) < (def.t === "r" ? 0.05 : 0.5);
    const good = (ch.v > 0) !== !!def.inv;
    const arrow = flat ? "→" : ch.v > 0 ? "▲" : "▼";
    const dec = def.t === "r" && Math.abs(ch.v) < 1 ? 2 : 1;
    const num = ch.v.toFixed(dec);
    if (Number(num) === 0) return `<span class="${cls} flat">→ sin cambio</span>`;
    return `<span class="${cls} ${flat ? "flat" : good ? "up" : "down"}">${arrow} ${ch.v > 0 ? "+" : ""}${num}${ch.unit}</span>`;
  }
  function tone(def, ch) {
    if (!ch || Math.abs(ch.v) < (def.t === "r" ? 0.05 : 0.5)) return "";
    return ((ch.v > 0) !== !!def.inv) ? "pos" : "neg";
  }
  function sparkSvg(vals) {
    const pts = vals.map((v, i) => [i, v]).filter((p) => p[1] !== null);
    if (pts.length < 2) return "";
    const W = 96, H = 34, ys = pts.map((p) => p[1]);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1, last = vals.length - 1 || 1;
    const xy = pts.map(([i, v]) => [(i / last) * (W - 6) + 3, H - 3 - ((v - min) / span) * (H - 6)]);
    const [lx, ly] = xy[xy.length - 1];
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${xy.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="3" fill="var(--accent)"/></svg>`;
  }

  function cmpSeries(all, keys) {
    const out = {};
    keys.forEach((k) => {
      const d = all[k], m = metrics(d);
      CMP_METRICS.forEach((def) => { (out[def.k] = out[def.k] || []).push(d ? def.f(d, m) : null); });
    });
    return out;
  }

  function renderCompare(all, endKey) {
    const allKeys = Object.keys(all).filter((x) => x <= endKey).sort();
    const keys = cmpRange ? allKeys.slice(-cmpRange) : allKeys;
    const enough = keys.length >= 2;
    $("cmpEmpty").classList.toggle("hidden", enough);
    $("cmpBody").classList.toggle("hidden", !enough);
    if (!enough) return;
    // mes previo al primero del rango para calcular su cambio
    const prevOfFirst = allKeys[allKeys.indexOf(keys[0]) - 1];
    const series = cmpSeries(all, keys);
    const prevSeries = prevOfFirst ? cmpSeries(all, [prevOfFirst]) : null;
    $("cmpRangeLabel").textContent = `${cap(label(keys[0]))} – ${label(keys[keys.length - 1])} · ${keys.length} meses`;

    // Tarjetas
    $("sparks").innerHTML = CMP_METRICS.filter((d) => d.spark).map((def) => {
      const s = series[def.k], cur = s[s.length - 1], prev = s[s.length - 2];
      return `<button type="button" class="spark ${def.k === cmpMetric ? "sel" : ""}" data-k="${def.k}">
        <span class="t">${def.l}</span>
        <span class="row"><span class="v">${fmtVal(def, cur)}</span>${sparkSvg(s)}</span>
        ${changeHtml(def, change(def, cur, prev), "d")}</button>`;
    }).join("");
    $("sparks").querySelectorAll(".spark").forEach((b) => { b.onclick = () => { cmpMetric = b.dataset.k; $("metricSel").value = cmpMetric; renderCompare(all, endKey); }; });

    // Selector y gráfico
    const sel = $("metricSel");
    if (!sel.options.length) {
      let html = "", open = false;
      CMP.forEach((x) => {
        if (x.g) { html += (open ? "</optgroup>" : "") + `<optgroup label="${x.g}">`; open = true; }
        else html += `<option value="${x.k}">${x.l}</option>`;
      });
      sel.innerHTML = html + "</optgroup>";
      sel.onchange = () => { cmpMetric = sel.value; renderCompare(demo || store, $("month").value); };
    }
    sel.value = cmpMetric;
    drawCmpChart(CMP_METRICS.find((d) => d.k === cmpMetric), keys, series[cmpMetric]);

    // Tabla
    let html = `<thead><tr><th>Indicador</th>${keys.map((k) => `<th>${cap(short(k))}</th>`).join("")}</tr></thead><tbody>`;
    CMP.forEach((x) => {
      if (x.g) { html += `<tr class="grp"><td colspan="${keys.length + 1}">${x.g}</td></tr>`; return; }
      const s = series[x.k];
      html += `<tr><td>${x.l}</td>` + s.map((v, i) => {
        const prev = i > 0 ? s[i - 1] : prevSeries ? prevSeries[x.k][0] : null;
        const ch = change(x, v, prev);
        return `<td class="${tone(x, ch)}"><span class="cv">${fmtVal(x, v)}</span>${i > 0 || prevSeries ? changeHtml(x, ch, "cd") : ""}</td>`;
      }).join("") + `</tr>`;
    });
    $("cmpTable").innerHTML = html + "</tbody>";
    $("exportCsv").onclick = () => exportCsv(keys, series);
  }

  function drawCmpChart(def, keys, vals) {
    if (!window.Chart) return;
    const ink = css("--ink"), muted = css("--muted"), line = css("--line");
    const isRate = def.t === "r";
    const data = vals.map((v) => v === null ? null : isRate ? +(v * 100).toFixed(2) : +v.toFixed(def.t === "x" ? 1 : 0));
    const colors = vals.map((v, i) => {
      if (i === 0 || v === null || vals[i - 1] === null) return muted;
      const up = v > vals[i - 1]; if (v === vals[i - 1]) return muted;
      return (up !== !!def.inv) ? css("--good") : "#C8002D";
    });
    if (cmpChart) cmpChart.destroy();
    cmpChart = new Chart($("cmpChart"), {
      type: isRate ? "line" : "bar",
      data: { labels: keys.map((k) => cap(short(k))), datasets: [{
        label: def.l, data,
        backgroundColor: isRate ? "#C8002D" : colors, borderColor: "#C8002D",
        pointBackgroundColor: colors, pointBorderColor: colors, pointRadius: 6, tension: .3, borderRadius: 4, spanGaps: true
      }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: (c) => {
            const i = c.dataIndex, v = vals[i], ch = i > 0 ? change(def, v, vals[i - 1]) : null;
            return `${def.l}: ${fmtVal(def, v)}` + (ch ? ` (${ch.v > 0 ? "+" : ""}${ch.v.toFixed(1)}${ch.unit} vs mes ant.)` : "");
          } } } },
        scales: { x: { ticks: { color: muted }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: muted, callback: (v) => isRate ? v + "%" : v }, grid: { color: line } } } }
    });
  }

  function exportCsv(keys, series) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [["Indicador", ...keys].map(esc).join(",")];
    CMP_METRICS.forEach((def) => {
      rows.push([esc(def.l), ...series[def.k].map((v) => v === null ? "" : def.t === "r" ? (v * 100).toFixed(2) : def.t === "x" ? v.toFixed(2) : v)].join(","));
    });
    const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `comparativo-${CLIENT_NAME.replace(/\s+/g, "-").toLowerCase()}-${keys[0]}_${keys[keys.length - 1]}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.querySelectorAll(".seg button").forEach((b) => {
    b.onclick = () => {
      cmpRange = Number(b.dataset.range);
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    };
  });
  function setView(v) {
    view = v;
    $("tabMes").classList.toggle("active", v === "mes"); $("tabMes").setAttribute("aria-selected", v === "mes");
    $("tabComp").classList.toggle("active", v === "comp"); $("tabComp").setAttribute("aria-selected", v === "comp");
    render();
  }
  $("tabMes").onclick = () => setView("mes");
  $("tabComp").onclick = () => setView("comp");

  // ---------------- Formulario ----------------
  function openDrawer() {
    if (!clienteId) { toast("El cliente no está disponible. Revisa el aviso en pantalla."); return; }
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
    const base = [4500, 610, 1260, 3700, 880, 98, 1290, 63, 21, 17, 20, 4100, 1170, 121, 49, 12, 21];
    const f = [0.78, 0.86, 0.9, 0.95, 0.97, 1];
    const rows = f.map((x, i) => base.map((v, j) => Math.round(v * (j === 0 || j === 10 ? 0.9 + i * 0.02 : x) * (j === 6 && i === 3 ? 0.9 : 1))));
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
