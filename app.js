/* WestCap ARM Tracker — single-page app on Supabase.
   Every query runs as the signed-in user; row-level security only returns data to approved admins. */
(() => {
  const { supabaseUrl, supabaseKey } = window.ARM_CONFIG;
  const sb = window.supabase.createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const PAGE = 50;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- helpers ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
  const money = (v) => (v == null ? "—" : "$" + Math.round(Number(v)).toLocaleString("en-US"));
  const moneyShort = (v) => {
    const n = Number(v || 0);
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  };
  const date = (v) => (v ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const dateTime = (v) => (v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const phone = (v) => { const d = String(v || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v || "—"); };
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 3200); };
  const kpi = (label, value, sub = "") => `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${value}</div>${sub ? `<div class="kpi-s">${esc(sub)}</div>` : ""}</div>`;
  const row = (l, r) => `<div class="row"><span>${l}</span><span class="r">${r}</span></div>`;
  const fail = (el, error) => { console.error(error); el.innerHTML = `<div class="empty">Couldn't load this. ${esc(error?.message || "")}</div>`; };

  async function fetchAll(build, max = 20000) {
    const out = [];
    for (let from = 0; from < max; from += 1000) {
      const { data, error } = await build().range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  function pager(el, page, total, onGo) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    el.innerHTML = `<span>Page ${page + 1} of ${pages}</span>
      <button class="btn-outline small" ${page === 0 ? "disabled" : ""} data-p="${page - 1}">Previous</button>
      <button class="btn-outline small" ${page + 1 >= pages ? "disabled" : ""} data-p="${page + 1}">Next</button>`;
    $$("button[data-p]", el).forEach((b) => b.addEventListener("click", () => onGo(Number(b.dataset.p))));
  }

  // ---------- roster cache (LO names) ----------
  let roster = null;
  async function getRoster() {
    if (roster) return roster;
    const rows = await fetchAll(() => sb.from("arm_loan_officers").select("nmls_id,full_name,office_city,office_state,active").order("full_name"));
    roster = new Map(rows.map((r) => [r.nmls_id, r]));
    $("#lo-options").innerHTML = rows.filter((r) => r.active).map((r) => `<option value="${esc(r.full_name)} (${esc(r.nmls_id)})"></option>`).join("");
    return roster;
  }
  const loName = (nmls) => roster?.get(nmls)?.full_name || `NMLS ${nmls}`;
  const parseId = (v) => (String(v || "").match(/\(([^)]+)\)\s*$/) || [])[1] || (/^\d+$/.test(String(v).trim()) ? String(v).trim() : null);

  // ---------- auth ----------
  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    ["#login", "#denied", "#app"].forEach((s) => $(s).classList.add("hidden"));
    if (!session) { $("#login").classList.remove("hidden"); return; }
    const email = session.user.email;
    const { data: ok, error } = await sb.rpc("is_arm_admin");
    if (error || !ok) { $("#denied-email").textContent = email; $("#denied").classList.remove("hidden"); return; }
    $("#user-email").textContent = email;
    $("#app").classList.remove("hidden");
    getRoster().catch(console.error);
    show(location.hash.replace("#", "") || "overview");
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const msg = $("#login-msg");
    msg.textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    msg.textContent = error ? `Couldn't send the link: ${error.message}` : "Check your inbox for a sign-in link from Supabase.";
  });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-action='signout']")) { await sb.auth.signOut(); location.hash = ""; route(); }
  });
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") route(); });

  // ---------- navigation ----------
  const loaders = {};
  function show(view) {
    if (!loaders[view]) view = "overview";
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $$(".view").forEach((v) => v.classList.add("hidden"));
    $(`#view-${view}`).classList.remove("hidden");
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    loaders[view]();
  }
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

  // ---------- overview ----------
  loaders.overview = async () => {
    const { data: o, error } = await sb.rpc("arm_overview");
    if (error) return fail($("#kpi-current"), error);
    const dirPct = o.dir_total ? Math.round((o.dir_done / o.dir_total) * 100) : 0;
    $("#status-pills").innerHTML = `
      <span class="pill ok"><span class="dot"></span>Listings refresh live · 6:45 am and pm ET</span>
      <span class="pill warn"><span class="dot"></span>Notifications off · nothing sends</span>
      <span class="pill info"><span class="dot"></span>Model Match data as of ${date(o.snapshot)}</span>
      ${dirPct < 100 ? `<span class="pill info"><span class="dot"></span>Realtor directory ${dirPct}% built</span>` : ""}`;
    $("#kpi-current").innerHTML =
      kpi("Active LO roster", num(o.los), `${num(o.los_wcl_email)} WestCap emails · ${num(o.los_cell)} cells`) +
      kpi("Past borrowers listed now", num(o.listed_current), `${moneyShort(o.list_value_current)} in list price`) +
      kpi("Likely to list", num(o.likely_current), "Model Match score 90+") +
      kpi("Alerts queued", num(o.alerts_pending), `${num(o.alerts_baseline)} backlog held back`);
    $("#kpi-former").innerHTML =
      kpi("Former LOs", num(o.former_los), "Pending compliance guidance") +
      kpi("Listed now", num(o.listed_former)) +
      kpi("Likely to list", num(o.likely_former));
    $("#kpi-dir").innerHTML =
      kpi("Realtors", num(o.realtors), `${num(o.realtors_email)} with email`) +
      kpi("LO–realtor relationships", num(o.relationships), `${num(o.dir_done)} of ${num(o.dir_total)} pulls done`) +
      kpi("Active ARMs", num(o.arms)) +
      kpi("ARM-credited volume", moneyShort(o.arm_volume), `${num(o.arm_loans)} funded loans`);

    const states = o.by_state || [];
    const max = Math.max(1, ...states.map((s) => s.n));
    $("#by-state").innerHTML = states.length ? states.map((s) => `<div class="bar-row"><span class="muted">${esc(s.st)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round((s.n / max) * 100)}%"></div></div><span class="num">${num(s.n)}</span></div>`).join("") : `<div class="empty">No listings yet.</div>`;

    try {
      const r = await getRoster();
      const { data, error: e2 } = await sb.from("arm_signals_by_lo").select("*").order("listed_now", { ascending: false }).order("likely_to_list", { ascending: false }).limit(60);
      if (e2) throw e2;
      const top = data.filter((d) => r.get(d.originator_nmls)?.active).slice(0, 8);
      $("#top-los").innerHTML = top.map((d) => row(esc(loName(d.originator_nmls)), `${num(d.listed_now)} listed · ${num(d.likely_to_list)} likely`)).join("") || `<div class="empty">No data yet.</div>`;
    } catch (err) { fail($("#top-los"), err); }
  };

  // ---------- listings ----------
  let lScope = "current", lPage = 0;
  $$("#listing-scope button").forEach((b) => b.addEventListener("click", () => {
    lScope = b.dataset.scope; lPage = 0;
    $$("#listing-scope button").forEach((x) => x.classList.toggle("active", x === b));
    $("#former-note").classList.toggle("hidden", lScope !== "former");
    loaders.listings();
  }));
  $("#f-apply").addEventListener("click", () => { lPage = 0; loaders.listings(); });
  $("#f-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { lPage = 0; loaders.listings(); } });

  loaders.listings = async () => {
    const table = $("#listings-table");
    table.innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
    const type = $("#f-type").value, st = $("#f-state").value.trim().toUpperCase(), q = $("#f-search").value.trim();
    const view = lScope === "current" ? "arm_signals_current_los" : "arm_signals_former_los";
    let query = sb.from(view).select("*", { count: "exact" });
    if (type) query = query.eq("signal_type", type);
    if (st) query = query.ilike("address", `%, ${st}, %`);
    if (q) query = query.or(`originator_name.ilike.%${q.replace(/[,()]/g, " ")}%,address.ilike.%${q.replace(/[,()]/g, " ")}%`);
    query = type === "likely_to_list" ? query.order("sale_propensity", { ascending: false }) : query.order("listed_date", { ascending: false, nullsFirst: false });
    const { data, count, error } = await query.range(lPage * PAGE, lPage * PAGE + PAGE - 1);
    if (error) return fail(table, error);
    $("#listings-meta").textContent = `${num(count)} ${lScope === "former" ? "former-LO " : ""}past borrowers`;
    if (!data.length) { table.innerHTML = `<tr><td class="empty">Nothing matches these filters.</td></tr>`; $("#listings-pager").innerHTML = ""; return; }
    table.innerHTML = `<thead><tr><th>Signal</th><th>Address</th><th>Loan officer</th><th class="num">List price</th><th>Listed</th><th class="num">Score</th><th>Loan</th><th class="num">Loan amount</th><th>Lender</th></tr></thead><tbody>` +
      data.map((r) => `<tr>
        <td><span class="badge ${r.signal_type === "listed" ? "listed" : "likely"}">${r.signal_type === "listed" ? "Listed" : "Likely to list"}</span></td>
        <td>${esc(r.address)}</td>
        <td>${esc(r.lo_full_name || r.originator_name)}<div class="muted">NMLS ${esc(r.originator_nmls)}</div></td>
        <td class="num">${r.list_price ? money(r.list_price) : "—"}</td>
        <td>${date(r.listed_date)}</td>
        <td class="num">${r.sale_propensity != null ? num(r.sale_propensity) : "—"}</td>
        <td>${date(r.loan_date)}</td>
        <td class="num">${money(r.loan_amount)}</td>
        <td class="muted">${esc(r.lender || "—")}</td></tr>`).join("") + `</tbody>`;
    pager($("#listings-pager"), lPage, count, (p) => { lPage = p; loaders.listings(); });
  };

  // ---------- realtors ----------
  let rPage = 0;
  $("#r-apply").addEventListener("click", () => { rPage = 0; loaders.realtors(); });
  $("#r-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { rPage = 0; loaders.realtors(); } });
  function realtorQuery(withCount) {
    const q = $("#r-search").value.trim().replace(/[,()]/g, " "), sort = $("#r-sort").value;
    let query = sb.from("arm_realtor_directory").select("*", withCount ? { count: "exact" } : undefined);
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,office_name.ilike.%${q}%`);
    if ($("#r-email").checked) query = query.not("email", "is", null);
    return query.order(sort, { ascending: sort === "full_name", nullsFirst: false });
  }
  loaders.realtors = async () => {
    const table = $("#realtors-table");
    table.innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
    const { data, count, error } = await realtorQuery(true).range(rPage * PAGE, rPage * PAGE + PAGE - 1);
    if (error) return fail(table, error);
    $("#realtors-meta").textContent = `${num(count)} realtors · click a row to see which LOs they work with`;
    if (!data.length) { table.innerHTML = `<tr><td class="empty">No realtors match.</td></tr>`; $("#realtors-pager").innerHTML = ""; return; }
    table.innerHTML = `<thead><tr><th>Realtor</th><th>Brokerage</th><th>Email</th><th>Phone</th><th class="num">WestCap LOs</th><th class="num">Buyer-side loans</th><th class="num">Listing-side loans</th><th class="num">Volume (24 mo)</th></tr></thead><tbody>` +
      data.map((r) => `<tr class="clickable" data-id="${esc(r.mmi_agent_id)}">
        <td>${esc(r.full_name)}</td><td class="muted">${esc(r.office_name || "—")}</td>
        <td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : "—"}</td>
        <td>${phone(r.phone)}</td><td class="num">${num(r.westcap_los_worked_with)}</td>
        <td class="num">${num(r.buyer_side_loans_24m || 0)}</td><td class="num">${num(r.listing_side_loans_24m || 0)}</td>
        <td class="num">${money(r.total_volume_24m)}</td></tr>`).join("") + `</tbody>`;
    $$("tr.clickable", table).forEach((tr) => tr.addEventListener("click", () => realtorDetail(tr.dataset.id)));
    pager($("#realtors-pager"), rPage, count, (p) => { rPage = p; loaders.realtors(); });
  };
  async function realtorDetail(id) {
    const box = $("#realtor-detail");
    box.classList.remove("hidden");
    box.innerHTML = "Loading…";
    await getRoster();
    const [{ data: r }, { data: rels, error }] = await Promise.all([
      sb.from("arm_realtors").select("*").eq("mmi_agent_id", id).single(),
      sb.from("arm_lo_realtor_relationships").select("*").eq("mmi_agent_id", id).order("volume", { ascending: false }),
    ]);
    if (error) return fail(box, error);
    box.innerHTML = `<h3>${esc(r?.full_name)} <span class="muted" style="font-weight:400">· ${esc(r?.office_name || "")}</span></h3>
      <div class="list">${row("Email", r?.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : "—")}${row("Phone", phone(r?.phone))}</div>
      <h3 style="margin-top:14px">WestCap LOs they've closed with (last 24 months)</h3>
      <div class="table-wrap"><table><thead><tr><th>Loan officer</th><th>Side</th><th class="num">Loans</th><th class="num">Volume</th></tr></thead><tbody>
      ${rels.map((x) => `<tr><td>${esc(loName(x.originator_nmls))}<div class="muted">NMLS ${esc(x.originator_nmls)}</div></td><td>${x.side === "buyer" ? "Buyer's agent" : "Listing agent"}</td><td class="num">${num(x.units)}</td><td class="num">${money(x.volume)}</td></tr>`).join("")}
      </tbody></table></div>`;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("#r-export").addEventListener("click", async () => {
    toast("Building the export…");
    try {
      const rows = await fetchAll(() => realtorQuery(false), 50000);
      const cols = ["full_name", "office_name", "email", "phone", "westcap_los_worked_with", "buyer_side_loans_24m", "listing_side_loans_24m", "total_volume_24m"];
      const head = ["Realtor", "Brokerage", "Email", "Phone", "WestCap LOs", "Buyer-side loans", "Listing-side loans", "Volume 24mo"];
      const csv = [head.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `westcap-realtors-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      toast(`Exported ${num(rows.length)} realtors`);
    } catch (err) { toast(`Export failed: ${err.message}`); }
  });

  // ---------- loan officers ----------
  let loPage = 0, signalMap = null;
  $("#lo-apply").addEventListener("click", () => { loPage = 0; loaders.los(); });
  $("#lo-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { loPage = 0; loaders.los(); } });
  async function getSignalMap() {
    if (signalMap) return signalMap;
    const rows = await fetchAll(() => sb.from("arm_signals_by_lo").select("*"));
    signalMap = new Map(rows.map((r) => [r.originator_nmls, r]));
    return signalMap;
  }
  loaders.los = async () => {
    const table = $("#los-table");
    table.innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
    try {
      const sm = await getSignalMap();
      const q = $("#lo-search").value.trim().replace(/[,()]/g, " "), f = $("#lo-filter").value;
      let query = sb.from("arm_loan_officers").select("*", { count: "exact" }).eq("active", true);
      if (q) query = /^\d+$/.test(q) ? query.eq("nmls_id", q) : query.ilike("full_name", `%${q}%`);
      if (f === "email") query = query.not("email", "is", null);
      if (f === "cell") query = query.not("mobile_phone", "is", null);
      if (f === "signals") {
        const ids = [...sm.values()].filter((s) => (s.listed_now || 0) + (s.likely_to_list || 0) > 0).map((s) => s.originator_nmls);
        query = query.in("nmls_id", ids.length ? ids : ["none"]);
      }
      const { data, count, error } = await query.order("units_12m", { ascending: false, nullsFirst: false }).range(loPage * PAGE, loPage * PAGE + PAGE - 1);
      if (error) throw error;
      $("#los-meta").textContent = `${num(count)} loan officers`;
      if (!data.length) { table.innerHTML = `<tr><td class="empty">No LOs match.</td></tr>`; $("#los-pager").innerHTML = ""; return; }
      table.innerHTML = `<thead><tr><th>Loan officer</th><th>Office</th><th>At WestCap since</th><th class="num">Loans (12 mo)</th><th>WestCap email</th><th>Cell</th><th class="num">Listed</th><th class="num">Likely</th><th>Alerts</th></tr></thead><tbody>` +
        data.map((r) => { const s = sm.get(r.nmls_id) || {}; return `<tr>
          <td>${esc(r.full_name)}<div class="muted">NMLS ${esc(r.nmls_id)}</div></td>
          <td class="muted">${esc([r.office_city, r.office_state].filter(Boolean).join(", ") || "—")}${r.branch_name ? `<div>${esc(r.branch_name)}</div>` : ""}</td>
          <td>${date(r.start_date)}</td><td class="num">${num(r.units_12m || 0)}</td>
          <td>${r.email ? esc(r.email) : `<span class="muted">—</span>`}</td><td>${r.mobile_phone ? phone(r.mobile_phone) : `<span class="muted">—</span>`}</td>
          <td class="num">${num(s.listed_now || 0)}</td><td class="num">${num(s.likely_to_list || 0)}</td>
          <td><label class="toggle"><input type="checkbox" data-nmls="${esc(r.nmls_id)}" data-field="notify_email" ${r.notify_email ? "checked" : ""}/>Email</label>
              <label class="toggle"><input type="checkbox" data-nmls="${esc(r.nmls_id)}" data-field="notify_sms" ${r.notify_sms ? "checked" : ""}/>Text</label></td></tr>`; }).join("") + `</tbody>`;
      $$("input[data-field]", table).forEach((cb) => cb.addEventListener("change", async () => {
        const { error: e } = await sb.from("arm_loan_officers").update({ [cb.dataset.field]: cb.checked }).eq("nmls_id", cb.dataset.nmls);
        if (e) { cb.checked = !cb.checked; toast(`Couldn't save: ${e.message}`); } else toast("Alert setting saved");
      }));
      pager($("#los-pager"), loPage, count, (p) => { loPage = p; loaders.los(); });
    } catch (err) { fail(table, err); }
  };

  // ---------- ARMs ----------
  async function loadArmSelects() {
    const { data } = await sb.from("arm_arms").select("id,full_name,active").order("full_name");
    const opts = `<option value="">Choose an ARM</option>` + (data || []).filter((a) => a.active).map((a) => `<option value="${a.id}">${esc(a.full_name)}</option>`).join("");
    $$(".arm-select").forEach((s) => (s.innerHTML = opts));
  }
  loaders.arms = async () => {
    await getRoster();
    loadArmSelects();
    const [{ data: vol, error: e1 }, { data: deps, error: e2 }, { data: loans, error: e3 }] = await Promise.all([
      sb.from("arm_captured_volume").select("*").order("captured_volume", { ascending: false }),
      sb.from("arm_deployments").select("*, arm_arms(full_name)").order("start_date", { ascending: false }),
      sb.from("arm_attributed_loans").select("*, arm_arms(full_name), arm_realtors(full_name)").order("funded_date", { ascending: false, nullsFirst: false }).limit(200),
    ]);
    if (e1) return fail($("#arm-volume-table"), e1);
    const tot = (vol || []).reduce((a, v) => ({ loans: a.loans + Number(v.funded_loans), vol: a.vol + Number(v.captured_volume), comp: a.comp + Number(v.arm_variable_comp) }), { loans: 0, vol: 0, comp: 0 });
    $("#arm-kpis").innerHTML = kpi("ARMs", num((vol || []).length)) + kpi("Credited loans", num(tot.loans)) + kpi("Captured volume", moneyShort(tot.vol)) + kpi("ARM variable comp", money(tot.comp));
    $("#arm-volume-table").innerHTML = (vol || []).length
      ? `<thead><tr><th>ARM</th><th class="num">Funded loans</th><th class="num">Captured volume</th><th class="num">Existing relationships</th><th class="num">New relationships</th><th class="num">Variable comp</th></tr></thead><tbody>` +
        vol.map((v) => `<tr><td>${esc(v.arm_name)}</td><td class="num">${num(v.funded_loans)}</td><td class="num">${money(v.captured_volume)}</td><td class="num">${money(v.volume_existing_relationships)}</td><td class="num">${money(v.volume_new_relationships)}</td><td class="num">${money(v.arm_variable_comp)}</td></tr>`).join("") + `</tbody>`
      : `<tr><td class="empty">No ARMs yet. Add one below once the pilot hire is made.</td></tr>`;
    $("#deploy-table").innerHTML = e2 ? `<tr><td class="empty">${esc(e2.message)}</td></tr>` : (deps || []).length
      ? `<thead><tr><th>ARM</th><th>Loan officer</th><th>Start</th><th>End</th></tr></thead><tbody>` + deps.map((d) => `<tr><td>${esc(d.arm_arms?.full_name)}</td><td>${esc(loName(d.originator_nmls))}</td><td>${date(d.start_date)}</td><td>${date(d.end_date)}</td></tr>`).join("") + `</tbody>`
      : `<tr><td class="empty">No deployments yet.</td></tr>`;
    $("#loans-table").innerHTML = e3 ? `<tr><td class="empty">${esc(e3.message)}</td></tr>` : (loans || []).length
      ? `<thead><tr><th>Funded</th><th>ARM</th><th>Loan officer</th><th>Realtor</th><th>Loan #</th><th class="num">Amount</th><th>How credited</th><th>Relationship</th></tr></thead><tbody>` +
        loans.map((l) => `<tr><td>${date(l.funded_date)}</td><td>${esc(l.arm_arms?.full_name || "—")}</td><td>${esc(loName(l.originator_nmls))}</td><td>${esc(l.arm_realtors?.full_name || "—")}</td><td>${esc(l.loan_number || "—")}</td><td class="num">${money(l.loan_amount)}</td><td>${esc({ manual: "Manual", los_tag: "LOS tag", co_branded_link: "Co-branded link", mmi_match: "Model Match" }[l.attribution_method])}</td><td>${esc(l.relationship_origin || "—")}</td></tr>`).join("") + `</tbody>`
      : `<tr><td class="empty">No credited loans yet.</td></tr>`;
  };

  // Realtor autocomplete for the credit form.
  let rTimer;
  $("input[name='realtor_lookup']").addEventListener("input", (e) => {
    clearTimeout(rTimer);
    const q = e.target.value.trim();
    if (q.length < 2 || /\(mma_/.test(q)) return;
    rTimer = setTimeout(async () => {
      const { data } = await sb.from("arm_realtors").select("mmi_agent_id,full_name,office_name").ilike("full_name", `%${q.replace(/[,()]/g, " ")}%`).limit(20);
      $("#realtor-options").innerHTML = (data || []).map((r) => `<option value="${esc(r.full_name)}${r.office_name ? " · " + esc(r.office_name) : ""} (${esc(r.mmi_agent_id)})"></option>`).join("");
    }, 250);
  });

  const formData = (f) => Object.fromEntries([...new FormData(f).entries()].map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  const setMsg = (f, m) => ($(".form-msg", f).textContent = m);

  $("#form-arm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f);
    if (!d.full_name) return setMsg(f, "Enter the ARM's name.");
    const { error } = await sb.from("arm_arms").insert({ full_name: d.full_name, email: d.email || null, phone: d.phone || null, start_date: d.start_date || null, comp_bps: d.comp_bps ? Number(d.comp_bps) : 10 });
    if (error) return setMsg(f, `Couldn't save: ${error.message}`);
    f.reset(); setMsg(f, ""); toast("ARM added"); loaders.arms();
  });
  $("#form-deploy").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f), nmls = parseId(d.lo_lookup);
    if (!d.arm_id) return setMsg(f, "Choose an ARM.");
    if (!nmls || !roster?.has(nmls)) return setMsg(f, "Pick an LO from the list.");
    const { error } = await sb.from("arm_deployments").insert({ arm_id: d.arm_id, originator_nmls: nmls, start_date: d.start_date || undefined });
    if (error) return setMsg(f, `Couldn't save: ${error.message}`);
    f.reset(); setMsg(f, ""); toast("ARM deployed"); loaders.arms();
  });
  $("#form-loan").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f), nmls = parseId(d.lo_lookup);
    const realtor = d.realtor_lookup ? parseId(d.realtor_lookup) : null;
    if (!d.arm_id) return setMsg(f, "Choose an ARM.");
    if (!nmls || !roster?.has(nmls)) return setMsg(f, "Pick an LO from the list.");
    if (d.realtor_lookup && !realtor) return setMsg(f, "Pick the realtor from the suggestions, or leave it blank.");
    if (!(Number(d.loan_amount) > 0)) return setMsg(f, "Enter the loan amount.");
    const { data: arm } = await sb.from("arm_arms").select("comp_bps").eq("id", d.arm_id).single();
    const { error } = await sb.from("arm_attributed_loans").insert({
      arm_id: d.arm_id, originator_nmls: nmls, mmi_agent_id: realtor, loan_number: d.loan_number || null,
      property_address: d.property_address || null, loan_amount: Number(d.loan_amount), funded_date: d.funded_date || null,
      attribution_method: d.attribution_method, relationship_origin: d.relationship_origin || null, comp_bps: arm?.comp_bps ?? 10,
    });
    if (error) return setMsg(f, `Couldn't save: ${error.message}`);
    f.reset(); setMsg(f, ""); toast("Loan credited"); loaders.arms();
  });

  // ---------- status ----------
  loaders.status = async () => {
    const [{ data: st }, { data: runs }, { data: admins }, ...counts] = await Promise.all([
      sb.from("arm_sync_state").select("*"),
      sb.from("arm_sync_log").select("*").order("id", { ascending: false }).limit(25),
      sb.from("arm_admins").select("*").order("added_at"),
      ...["done", "pending", "error"].map((s) => sb.from("arm_realtor_queue").select("*", { count: "exact", head: true }).eq("status", s)),
    ]);
    const label = { listed: "Listed now", likely_to_list: "Likely to list", realtors: "Realtor directory" };
    $("#sync-state").innerHTML = (st || []).map((s) => row(label[s.signal_type], `Model Match batch ${date(s.mmi_computed_at)} · checked ${dateTime(s.last_checked_at)}`)).join("") +
      row("Schedule", "Checks twice daily, 6:45 am and pm ET") + row("Notifications", "Off · nothing sends");
    const [done, pending, errored] = counts.map((c) => c.count || 0);
    const total = done + pending + errored;
    $("#dir-state").innerHTML = row("Pulls done", `${num(done)} of ${num(total)} (${total ? Math.round((done / total) * 100) : 0}%)`) + row("Waiting", num(pending)) + row("Errors", num(errored)) + row("Credit floor", "Pauses below 6,000 Model Match credits");
    $("#runs-table").innerHTML = `<thead><tr><th>Started</th><th>Feed</th><th>Result</th><th class="num">Rows</th><th>Note</th></tr></thead><tbody>` +
      (runs || []).map((r) => `<tr><td>${dateTime(r.started_at)}</td><td>${esc(label[r.signal_type] || r.signal_type)}</td><td>${r.error ? (String(r.error).startsWith("paused") ? "Paused" : "Error") : !r.finished_at ? "Running" : r.changed === false ? "No new data" : r.partial ? "Continuing" : "Updated"}</td><td class="num">${num(r.rows_upserted || 0)}</td><td class="muted">${esc(r.error || "")}</td></tr>`).join("") + `</tbody>`;
    $("#admins").innerHTML = (admins || []).map((a) => row(esc(a.email), `added ${date(a.added_at)}`)).join("") + `<p class="muted" style="margin:10px 0 0;font-size:12px">To add someone, ask Claude or add their email to the arm_admins table in Supabase.</p>`;
  };

  route();
})();
