/* WestCap ARM Tracker — single-page app on Supabase.
   Every query runs as the signed-in user. Row-level security returns everything to admins and, to an ARM, only the LOs they're deployed to. */
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
    const dl = $("#lo-options");
    if (dl) dl.innerHTML = rows.filter((r) => r.active).map((r) => `<option value="${esc(r.full_name)} (${esc(r.nmls_id)})"></option>`).join("");
    return roster;
  }
  const loName = (nmls) => roster?.get(nmls)?.full_name || `NMLS ${nmls}`;
  const parseId = (v) => (String(v || "").match(/\(([^)]+)\)\s*$/) || [])[1] || (/^\d+$/.test(String(v).trim()) ? String(v).trim() : null);

  // ---------- auth ----------
  // me: { role: "admin" | "arm", name, first, email, arm_id?, los? }
  let me = null;
  const isAdmin = () => me?.role === "admin";
  const firstName = (name, email) => {
    const n = String(name || "").trim().split(/\s+/)[0];
    if (n) return n;
    const local = String(email || "").split("@")[0].replace(/[^a-z]/gi, " ").trim().split(/\s+/)[0] || "there";
    return local.charAt(0).toUpperCase() + local.slice(1);
  };
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    ["#login", "#denied", "#app"].forEach((s) => $(s).classList.add("hidden"));
    if (!session) { $("#login").classList.remove("hidden"); return; }
    const email = session.user.email;
    const { data: who, error } = await sb.rpc("arm_whoami");
    if (error || !who?.role) { $("#denied-email").textContent = email; $("#denied").classList.remove("hidden"); return; }
    me = { ...who, first: firstName(who.name, email) };
    document.body.classList.toggle("role-arm", me.role === "arm");
    document.body.classList.toggle("role-admin", me.role === "admin");
    $("#user-email").textContent = `Hello, ${me.first}`;
    $("#user-email").title = email;
    $("#tab-arms").textContent = me.role === "arm" ? "My stats" : "ARMs";
    if (me.role === "arm") { lScope = "current"; }
    $("#app").classList.remove("hidden");
    if (!session.user.user_metadata?.has_password) showPasswordCard(false);
    getRoster().catch(console.error);
    show(location.hash.replace("#", "") || "overview");
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim(), password = $("#login-password").value;
    const msg = $("#login-msg");
    if (!password) { msg.textContent = "Enter your password, or use the email link below if you haven't set one yet."; return; }
    msg.textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    msg.textContent = error ? "That email and password don't match. If you haven't set a password yet, use the email link below." : "";
  });
  $("#login-link").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    const msg = $("#login-msg");
    if (!email) { msg.textContent = "Enter your WestCap email first."; return; }
    msg.textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    msg.textContent = error ? `Couldn't send the link: ${error.message}` : "Check your inbox for a sign-in link. Once you're in, you'll be asked to set a password.";
  });

  // Set or change password.
  function showPasswordCard(changing) {
    $("#pw-title").textContent = changing ? "Change your password" : "Set a password";
    $("#pw-sub").textContent = changing ? "Choose a new password for signing in." : "Set a password so you can sign in without an email link next time.";
    $("#pw-msg").textContent = "";
    $("#pw-card").classList.remove("hidden");
  }
  $("#pw-later").addEventListener("click", () => $("#pw-card").classList.add("hidden"));
  $("#pw-card").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("#pw-new").value, p2 = $("#pw-confirm").value, msg = $("#pw-msg");
    if (p1.length < 10) { msg.textContent = "Use at least 10 characters."; return; }
    if (p1 !== p2) { msg.textContent = "The two passwords don't match."; return; }
    msg.textContent = "Saving…";
    const { error } = await sb.auth.updateUser({ password: p1, data: { has_password: true } });
    if (error) { msg.textContent = `Couldn't save: ${error.message}`; return; }
    $("#pw-new").value = ""; $("#pw-confirm").value = "";
    $("#pw-card").classList.add("hidden");
    toast("Password saved. Use it to sign in next time.");
  });

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-action='signout']")) { await sb.auth.signOut(); location.hash = ""; route(); }
    if (e.target.closest("[data-action='password']")) showPasswordCard(true);
  });
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") route(); });

  // ---------- navigation ----------
  const loaders = {};
  function show(view) {
    if (!loaders[view] || (view === "status" && !isAdmin())) view = "overview";
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $$(".view").forEach((v) => v.classList.add("hidden"));
    $(`#view-${view}`).classList.remove("hidden");
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    loaders[view]();
  }
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

  // ---------- overview ----------
  loaders.overview = async () => {
    $("#hello").textContent = `${greeting()}, ${me.first}.`;
    $("#hello-sub").textContent = isAdmin() ? "Here's where every LO, realtor and ARM stands." : "Here's how your LOs and realtor relationships are doing.";
    if (!isAdmin()) return armOverview();
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

  // ---------- borrower names + LO/realtor loans (Model Match, on demand) ----------
  const borrower = (r) => r.borrower_name ? esc(r.borrower_name) : `<span class="muted">${r.borrower_checked_at ? "Not on record" : "Not loaded yet"}</span>`;
  const ROLE = { buyer: "Buyer's agent", listing: "Listing agent", "co-listing": "Co-listing agent" };
  const TXN = { purchase: "Purchase", refinance: "Refinance", equity: "Equity", construction: "Construction", reo: "REO" };
  const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : "—");
  function loansTable(loans, { showLo = false, pulled = true } = {}) {
    if (!loans.length) return `<div class="empty">${pulled ? "Model Match has no individual loans on file for this pair." : "Not loaded from Model Match yet."}</div>`;
    const sorted = [...loans].sort((a, b) => String(b.mortgage_date || "").localeCompare(String(a.mortgage_date || "")));
    return `<table class="listings-mini loans-mini"><thead><tr>${showLo ? "<th>Loan officer</th>" : ""}<th>Borrower</th><th>Property</th><th>Realtor's side</th><th>Closed</th><th class="num">Loan amount</th><th class="num">Sale price</th><th>Type</th></tr></thead><tbody>
      ${sorted.map((l) => `<tr>${showLo ? `<td>${esc(loName(l.originator_nmls))}</td>` : ""}<td>${l.borrower_name ? esc(l.borrower_name) : `<span class="muted">Not on record</span>`}</td>
        <td>${esc(l.address || "—")}<div class="muted">${esc([l.city, l.state].filter(Boolean).join(", "))}</div></td>
        <td>${esc(ROLE[l.agent_role] || "—")}</td><td>${date(l.mortgage_date)}</td><td class="num">${money(l.mortgage_amount)}</td>
        <td class="num">${l.sale_price ? money(l.sale_price) : "—"}</td><td class="muted">${esc([TXN[l.transaction_type] || cap(l.transaction_type), l.loan_type ? (l.loan_type.length <= 4 ? l.loan_type.toUpperCase() : cap(l.loan_type)) : ""].filter(Boolean).join(" · "))}</td></tr>`).join("")}
      </tbody></table>`;
  }
  // Ask the server to pull any missing loans for these LO + realtor pairs. Returns a short status note.
  async function pullPairLoans(nmlsList, agentIds, scope = "allTime") {
    for (let round = 0; round < 6; round++) {
      const { data, error } = await sb.functions.invoke("arm-details", { body: { action: "pair_loans", nmls: nmlsList, agent_ids: agentIds, scope } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data.paused) return `Some loans aren't loaded yet: ${data.paused}.`;
      if (data.complete) return data.failed ? `${num(data.failed)} couldn't be loaded from Model Match.` : "";
    }
    return "Partially loaded. Open it again to load the rest.";
  }
  // Fill borrower names for one LO's listed / likely homes. Returns a short status note.
  async function pullBorrowerNames(nmls) {
    const { data, error } = await sb.functions.invoke("arm-details", { body: { action: "borrower_names", nmls, limit: 1000 } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data.paused) return `Borrower names load once Model Match credits are back above the floor (${data.paused}).`;
    return "";
  }

  // ARM home: their own numbers and their LOs.
  async function armOverview() {
    try {
      await getRoster();
      const [{ data: cv }, sm] = await Promise.all([sb.from("arm_captured_volume").select("*"), getSignalMap()]);
      const v = (cv || [])[0] || {};
      const los = (me.los || []).map(String);
      const sig = los.map((n) => sm.get(n) || { originator_nmls: n, listed_now: 0, likely_to_list: 0 });
      const listed = sumN(sig, (s) => s.listed_now), likely = sumN(sig, (s) => s.likely_to_list);
      $("#arm-home-kpis").innerHTML =
        kpi("Captured volume", moneyShort(v.captured_volume || 0), `${num(v.funded_loans || 0)} funded loans credited to you`) +
        kpi("Your variable comp", money(v.arm_variable_comp || 0), "From credited loans") +
        kpi("LOs you support", num(los.length)) +
        kpi("Past borrowers listed now", num(listed), `${num(likely)} more likely to list`);
      $("#arm-home-los").innerHTML = los.length
        ? sig.sort((a, b) => (b.listed_now + b.likely_to_list) - (a.listed_now + a.likely_to_list))
            .map((s) => row(`<a href="#los" class="lo-jump" data-nmls="${esc(s.originator_nmls)}">${esc(loName(s.originator_nmls))}</a>`, `${num(s.listed_now)} listed · ${num(s.likely_to_list)} likely`)).join("")
        : `<div class="empty">You haven't been assigned any LOs or states yet. Your admin will add them.</div>`;
      $$(".lo-jump", $("#arm-home-los")).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("#lo-search").value = a.dataset.nmls; show("los"); }));
    } catch (err) { fail($("#arm-home-kpis"), err); }
  }

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
    if (q) query = query.or(`originator_name.ilike.%${q.replace(/[,()]/g, " ")}%,address.ilike.%${q.replace(/[,()]/g, " ")}%,borrower_name.ilike.%${q.replace(/[,()]/g, " ")}%`);
    query = type === "likely_to_list" ? query.order("sale_propensity", { ascending: false }) : query.order("listed_date", { ascending: false, nullsFirst: false });
    const { data, count, error } = await query.range(lPage * PAGE, lPage * PAGE + PAGE - 1);
    if (error) return fail(table, error);
    $("#listings-meta").textContent = `${num(count)} ${lScope === "former" ? "former-LO " : ""}past borrowers`;
    if (!data.length) { table.innerHTML = `<tr><td class="empty">Nothing matches these filters.</td></tr>`; $("#listings-pager").innerHTML = ""; return; }
    table.innerHTML = `<thead><tr><th>Signal</th><th>Borrower</th><th>Address</th><th>Loan officer</th><th class="num">List price</th><th>Listed</th><th class="num">Score</th><th>Loan</th><th class="num">Loan amount</th><th>Lender</th></tr></thead><tbody>` +
      data.map((r) => `<tr>
        <td><span class="badge ${r.signal_type === "listed" ? "listed" : "likely"}">${r.signal_type === "listed" ? "Listed" : "Likely to list"}</span></td>
        <td>${borrower(r)}</td>
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
  ["#r-focus", "#r-state", "#r-sort"].forEach((id) => $(id).addEventListener("change", () => { rPage = 0; loaders.realtors(); }));
  $("#r-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { rPage = 0; loaders.realtors(); } });
  function realtorQuery(withCount) {
    const q = $("#r-search").value.trim().replace(/[,()]/g, " "), sort = $("#r-sort").value;
    let query = sb.from("arm_realtor_directory").select("*", withCount ? { count: "exact" } : undefined);
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,office_name.ilike.%${q}%`);
    if ($("#r-email").checked) query = query.not("email", "is", null);
    if ($("#r-focus").checked) query = query.eq("focus", true);
    const st = $("#r-state").value;
    if (st && $("#r-focus").checked) query = query.ilike("focus_states", `%${st}%`);
    // Focus view sorts by 14-month deals with WestCap unless a name sort is chosen.
    const col = $("#r-focus").checked && sort !== "full_name" ? (sort === "westcap_los_worked_with" ? "los_14m_focus" : sort === "total_volume_24m" ? "volume_14m_focus" : "deals_14m_focus")
      : sort === "deals" ? "total_volume_24m" : sort;
    return query.order(col, { ascending: col === "full_name", nullsFirst: false });
  }
  loaders.realtors = async () => {
    const table = $("#realtors-table");
    table.innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
    const { data, count, error } = await realtorQuery(true).range(rPage * PAGE, rPage * PAGE + PAGE - 1);
    if (error) return fail(table, error);
    const focus = $("#r-focus").checked;
    $("#realtors-meta").textContent = `${num(count)} ${focus ? "focus realtors (2+ deals with WestCap LOs in the last 14 months, CA · AZ · TN · MI · WA)" : "realtors"} · click a realtor to see the LOs they work with and every transaction together`;
    if (!data.length) { table.innerHTML = `<tr><td class="empty">No realtors match.</td></tr>`; $("#realtors-pager").innerHTML = ""; return; }
    table.innerHTML = (focus
      ? `<thead><tr><th></th><th>Realtor</th><th>Brokerage</th><th>Email</th><th>Phone</th><th>State</th><th class="num">WestCap LOs (14 mo)</th><th class="num">Deals with WestCap (14 mo)</th><th class="num">Volume with WestCap (14 mo)</th></tr></thead><tbody>`
      : `<thead><tr><th></th><th>Realtor</th><th>Brokerage</th><th>Email</th><th>Phone</th><th class="num">WestCap LOs</th><th class="num">Buyer-side loans</th><th class="num">Listing-side loans</th><th class="num">Volume with WestCap</th></tr></thead><tbody>`) +
      data.map((r) => `<tr class="clickable lo-row rl-row" data-id="${esc(r.mmi_agent_id)}">
        <td class="chev" aria-label="Show details"><span>›</span></td>
        <td>${esc(r.full_name)}</td><td class="muted">${esc(r.office_name || "—")}</td>
        <td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : "—"}</td>
        <td>${phone(r.phone)}</td>${focus
          ? `<td class="muted">${esc(r.focus_states || "—")}</td><td class="num">${num(r.los_14m_focus || 0)}</td><td class="num strong">${num(r.deals_14m_focus || 0)}</td><td class="num">${money(r.volume_14m_focus)}</td>`
          : `<td class="num">${num(r.westcap_los_worked_with)}</td><td class="num">${num(r.buyer_side_loans_24m || 0)}</td><td class="num">${num(r.listing_side_loans_24m || 0)}</td><td class="num">${money(r.total_volume_24m)}</td>`}</tr>`).join("") + `</tbody>`;
    $$("tr.rl-row", table).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggleRealtorDetail(tr); }));
    pager($("#realtors-pager"), rPage, count, (p) => { rPage = p; loaders.realtors(); });
  };
  // Realtor dropdown: the WestCap LOs they've closed with, Model Match style; click an LO for the transactions.
  function toggleRealtorDetail(tr) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("lo-detail")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    const d = document.createElement("tr");
    d.className = "lo-detail";
    d.innerHTML = `<td colspan="${tr.children.length}"><div class="lo-panel rl-panel" data-agent="${esc(tr.dataset.id)}">
      <div class="lo-panel-head">
        <div class="rl-head"><div class="muted">Loading…</div></div>
        <div class="lo-panel-actions">
          <div class="seg lo-period"><button data-v="14m" class="active">Last 14 months</button><button data-v="all">All time</button></div>
          <div class="seg lo-side"><button data-v="buyer">Buyer side</button><button data-v="listing">Listing side</button><button data-v="both" class="active">Both</button></div>
        </div>
      </div>
      <div class="rl-los"><div class="empty">Loading…</div></div></div></td>`;
    tr.after(d);
    const panel = $(".rl-panel", d);
    $$(".seg", panel).forEach((g) => $$("button", g).forEach((b) => b.addEventListener("click", () => {
      $$("button", g).forEach((x) => x.classList.toggle("active", x === b));
      renderRealtorDetail(panel);
    })));
    renderRealtorDetail(panel);
  }

  async function renderRealtorDetail(panel) {
    const id = panel.dataset.agent, box = $(".rl-los", panel);
    const period = $(".lo-period .active", panel).dataset.v, side = $(".lo-side .active", panel).dataset.v;
    try {
      await getRoster();
      const rows = await fetchAll(() => sb.from("arm_lo_realtor_detail").select("*").eq("mmi_agent_id", id));
      const r0 = rows[0] || (await sb.from("arm_realtors").select("*").eq("mmi_agent_id", id).maybeSingle()).data || {};
      $(".rl-head", panel).innerHTML = `<strong>${esc(r0.full_name || "")}</strong> <span class="muted">· ${esc(r0.office_name || "Brokerage not on file")}</span>
        <div class="muted">${r0.email ? `<a href="mailto:${esc(r0.email)}">${esc(r0.email)}</a>` : "No email"} · ${phone(r0.phone)}${r0.volume_14m != null ? ` · Own last 14 months: ${moneyShort(r0.volume_14m)}, ${num(r0.units_14m || 0)} deals` : ""}${r0.listings_refreshed_at ? ` · ${num(r0.active_listings_count || 0)} active listings` : ""}</div>`;
      // One row per WestCap LO; the realtor-side figures (financed volume) are the same on every row.
      const los = rows.map((r) => ({ nmls: r.originator_nmls, m: mergeRealtors([r])[0] }))
        .map((x) => ({ ...x, s: relStats(x.m, period, side) })).filter((x) => x.s.units > 0)
        .sort((a, b) => b.s.volume - a.s.volume || b.s.units - a.s.units);
      const label = `${period === "14m" ? "last 14 months" : "all time"}, ${side === "both" ? "both sides" : side === "buyer" ? "buyer side" : "listing side"}`;
      if (!los.length) { box.innerHTML = `<div class="empty">No WestCap LO transactions on file for ${esc(label)}.</div>`; return; }
      box.innerHTML = `<div class="rel-sum muted">${num(los.length)} WestCap ${los.length === 1 ? "LO" : "LOs"} · ${num(sumN(los, (x) => x.s.units))} loans · ${money(sumN(los, (x) => x.s.volume))} · ${esc(label)}</div>
        <div class="table-wrap"><table class="rel-table"><thead><tr><th>Loan officer</th><th class="num">Volume</th><th class="num">Units</th><th class="num">Avg loan size</th><th class="num" title="This LO's share of the realtor's financed volume on this side, for the selected period">Wallet share</th><th></th></tr></thead><tbody>
        ${los.map((x, i) => `<tr class="clickable rel-row" data-i="${i}">
          <td><div class="rel-name"><span class="avatar">${esc(initials(loName(x.nmls)))}</span><div>${esc(loName(x.nmls))}<div class="muted">NMLS ${esc(x.nmls)}${roster?.get(x.nmls) && !roster.get(x.nmls).active ? " · former LO" : ""}</div></div></div></td>
          <td class="num strong">${moneyShort(x.s.volume)}</td><td class="num">${num(x.s.units)}</td><td class="num">${x.s.avg ? moneyShort(x.s.avg) : "—"}</td>
          <td class="num">${x.s.share != null ? `<span class="pill-share">${pct(x.s.share)}</span>` : `<span class="muted" title="${x.s.shareKnown ? "No financed volume on record for this realtor" : "Loads from Model Match when an LO they work with is refreshed"}">${x.s.shareKnown ? "—" : "Loading…"}</span>`}</td>
          <td class="chev-r">›</td></tr>`).join("")}
        </tbody></table></div>`;
      $$("tr.rel-row", box).forEach((tr) => tr.addEventListener("click", () => { const x = los[Number(tr.dataset.i)]; openRelationship(x.nmls, { ...x.m, s: x.s }, period, side); }));
    } catch (err) { fail(box, err); }
  }
  $("#r-export").addEventListener("click", async () => {
    toast("Building the export…");
    try {
      const rows = await fetchAll(() => realtorQuery(false), 50000);
      const focus = $("#r-focus").checked;
      const cols = focus ? ["full_name", "office_name", "email", "phone", "focus_states", "los_14m_focus", "deals_14m_focus", "volume_14m_focus"]
        : ["full_name", "office_name", "email", "phone", "westcap_los_worked_with", "buyer_side_loans_24m", "listing_side_loans_24m", "total_volume_24m"];
      const head = focus ? ["Realtor", "Brokerage", "Email", "Phone", "State", "WestCap LOs (14 mo)", "Deals with WestCap (14 mo)", "Volume with WestCap (14 mo)"]
        : ["Realtor", "Brokerage", "Email", "Phone", "WestCap LOs", "Buyer-side loans", "Listing-side loans", "Volume with WestCap"];
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
      table.innerHTML = `<thead><tr><th></th><th>Loan officer</th><th>Office</th><th>At WestCap since</th><th class="num">Loans (12 mo)</th><th>WestCap email</th><th>Cell</th><th class="num">Listed</th><th class="num">Likely</th>${isAdmin() ? "<th>Alerts</th>" : ""}</tr></thead><tbody>` +
        data.map((r) => { const s = sm.get(r.nmls_id) || {}; return `<tr class="clickable lo-row" data-nmls="${esc(r.nmls_id)}" data-name="${esc(r.full_name)}">
          <td class="chev" aria-label="Show details"><span>›</span></td>
          <td>${esc(r.full_name)}<div class="muted">NMLS ${esc(r.nmls_id)}</div></td>
          <td class="muted">${esc([r.office_city, r.office_state].filter(Boolean).join(", ") || "—")}${r.branch_name ? `<div>${esc(r.branch_name)}</div>` : ""}</td>
          <td>${date(r.start_date)}</td><td class="num">${num(r.units_12m || 0)}</td>
          <td>${r.email ? esc(r.email) : `<span class="muted">—</span>`}</td><td class="nowrap">${r.mobile_phone ? phone(r.mobile_phone) : `<span class="muted">—</span>`}</td>
          <td class="num">${num(s.listed_now || 0)}</td><td class="num">${num(s.likely_to_list || 0)}</td>
          ${isAdmin() ? `<td><label class="toggle"><input type="checkbox" data-nmls="${esc(r.nmls_id)}" data-field="notify_email" ${r.notify_email ? "checked" : ""}/>Email</label>
              <label class="toggle"><input type="checkbox" data-nmls="${esc(r.nmls_id)}" data-field="notify_sms" ${r.notify_sms ? "checked" : ""}/>Text</label></td>` : ""}</tr>`; }).join("") + `</tbody>`;
      $$("input[data-field]", table).forEach((cb) => cb.addEventListener("change", async () => {
        const { error: e } = await sb.from("arm_loan_officers").update({ [cb.dataset.field]: cb.checked }).eq("nmls_id", cb.dataset.nmls);
        if (e) { cb.checked = !cb.checked; toast(`Couldn't save: ${e.message}`); } else toast("Alert setting saved");
      }));
      $$("label.toggle", table).forEach((l) => l.addEventListener("click", (e) => e.stopPropagation()));
      $$("tr.lo-row", table).forEach((tr) => tr.addEventListener("click", () => toggleLoDetail(tr)));
      pager($("#los-pager"), loPage, count, (p) => { loPage = p; loaders.los(); });
    } catch (err) { fail(table, err); }
  };

  // ---------- LO detail: realtors, their 14-month volume, their active listings ----------
  const LISTINGS_PREVIEW = 5;
  function toggleLoDetail(tr) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("lo-detail")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    const cols = tr.children.length;
    const d = document.createElement("tr");
    d.className = "lo-detail";
    d.innerHTML = `<td colspan="${cols}"><div class="lo-panel" data-nmls="${esc(tr.dataset.nmls)}">
      <details class="lo-sec" open>
        <summary><span class="badge listed">Listed now</span> Past borrowers with their home on the market <span class="sec-count lo-listed-count"></span></summary>
        <div class="lo-listed"><div class="empty">Loading…</div></div>
      </details>
      <details class="lo-sec" open>
        <summary><span class="badge likely">Likely to list</span> Past borrowers Model Match scores as likely to sell <span class="sec-count lo-likely-count"></span></summary>
        <div class="lo-likely"><div class="empty">Loading…</div></div>
      </details>
      <details class="lo-sec" open>
      <summary><span class="badge">Realtors</span> Realtors this LO has closed with <span class="sec-count lo-realtor-count"></span></summary>
      <div class="lo-panel-head">
        <div><strong>Realtors working with ${esc(tr.dataset.name)}</strong><div class="muted lo-status">Loading…</div></div>
        <div class="lo-panel-actions">
          <div class="seg lo-period"><button data-v="14m" class="active">Last 14 months</button><button data-v="all">All time</button></div>
          <div class="seg lo-side"><button data-v="buyer" class="active">Buyer side</button><button data-v="listing">Listing side</button><button data-v="both">Both</button></div>
          <button class="btn-outline small lo-refresh">Refresh from Model Match</button>
        </div>
      </div>
      <div class="lo-realtors"></div>
      </details></div></td>`;
    tr.after(d);
    const panel = $(".lo-panel", d);
    $$(".seg", panel).forEach((g) => $$("button", g).forEach((b) => b.addEventListener("click", () => {
      $$("button", g).forEach((x) => x.classList.toggle("active", x === b));
      renderLoDetail(panel);
    })));
    $(".lo-refresh", panel).addEventListener("click", () => syncLoDetail(panel, true));
    renderLoSignals(panel);
    renderLoDetail(panel).then(() => syncLoDetail(panel, false));
  }

  // The LO's past borrowers, split into Listed now and Likely to list.
  async function renderLoSignals(panel, fetchNames = true) {
    const nmls = panel.dataset.nmls;
    const listedBox = $(".lo-listed", panel), likelyBox = $(".lo-likely", panel);
    try {
      const rows = await fetchAll(() => sb.from("arm_borrower_signals").select("*").eq("originator_nmls", nmls).eq("is_active", true));
      const listed = rows.filter((r) => r.signal_type === "listed").sort((a, b) => String(b.listed_date || "").localeCompare(String(a.listed_date || "")));
      const likely = rows.filter((r) => r.signal_type === "likely_to_list").sort((a, b) => Number(b.sale_propensity || 0) - Number(a.sale_propensity || 0));
      $(".lo-listed-count", panel).textContent = num(listed.length);
      $(".lo-likely-count", panel).textContent = num(likely.length);
      listedBox.innerHTML = listed.length
        ? `<table class="listings-mini"><thead><tr><th>Borrower</th><th>Address</th><th class="num">List price</th><th>Listed</th><th>Original loan</th><th class="num">Loan amount</th><th>Lender</th></tr></thead><tbody>
          ${listed.map((r) => `<tr><td>${borrower(r)}</td><td>${esc(r.address)}</td><td class="num">${money(r.list_price)}</td><td>${date(r.listed_date)}</td><td>${date(r.loan_date)}</td><td class="num">${money(r.loan_amount)}</td><td class="muted">${esc(r.lender || "—")}</td></tr>`).join("")}
          </tbody></table>`
        : `<div class="empty">None of this LO's past borrowers are listed right now.</div>`;
      likelyBox.innerHTML = likely.length
        ? `<table class="listings-mini"><thead><tr><th>Borrower</th><th>Address</th><th class="num">Score</th><th>Original loan</th><th class="num">Loan amount</th><th>Lender</th></tr></thead><tbody>
          ${likely.map((r) => `<tr><td>${borrower(r)}</td><td>${esc(r.address)}</td><td class="num">${num(r.sale_propensity)}</td><td>${date(r.loan_date)}</td><td class="num">${money(r.loan_amount)}</td><td class="muted">${esc(r.lender || "—")}</td></tr>`).join("")}
          </tbody></table>`
        : `<div class="empty">No past borrowers scored as likely to list right now.</div>`;
      // Borrower names come from Model Match the first time an LO is opened, then stay saved.
      if (fetchNames && rows.some((r) => !r.borrower_checked_at)) {
        const note = await pullBorrowerNames(nmls).catch((e) => `Couldn't load borrower names: ${e.message}`);
        if (note) { listedBox.insertAdjacentHTML("afterbegin", `<div class="note small">${esc(note)}</div>`); return; }
        return renderLoSignals(panel, false);
      }
    } catch (err) { fail(listedBox, err); likelyBox.innerHTML = ""; }
  }

  // ---------- Model Match-style relationship table ----------
  // Same-name realtor profiles under one LO are merged (Model Match sometimes splits one agent in two).
  const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z]/g, "");
  const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const pct = (v) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
  const sumN = (arr, f) => arr.reduce((t, x) => t + Number(f(x) || 0), 0);

  function mergeRealtors(rows) {
    const groups = new Map();
    rows.forEach((r) => {
      const k = nameKey(r.full_name) || r.mmi_agent_id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    return [...groups.values()].map((g) => {
      const best = [...g].sort((a, b) => Number(!!b.email) - Number(!!a.email) || Number(b.volume_14m || 0) - Number(a.volume_14m || 0))[0];
      return {
        ids: g.map((r) => r.mmi_agent_id), profiles: g.length,
        full_name: best.full_name, office_name: best.office_name || g.find((r) => r.office_name)?.office_name,
        email: best.email || g.find((r) => r.email)?.email, phone: best.phone || g.find((r) => r.phone)?.phone,
        all: { buyer: { u: sumN(g, (r) => r.lo_buyer_units), v: sumN(g, (r) => r.lo_buyer_volume) }, listing: { u: sumN(g, (r) => r.lo_listing_units), v: sumN(g, (r) => r.lo_listing_volume) } },
        m14: { buyer: { u: sumN(g, (r) => r.lo14_buyer_units), v: sumN(g, (r) => r.lo14_buyer_volume) }, listing: { u: sumN(g, (r) => r.lo14_listing_units), v: sumN(g, (r) => r.lo14_listing_volume) } },
        realtor14: { buyer: sumN(g, (r) => r.buyer_volume_14m), listing: sumN(g, (r) => r.seller_volume_14m), both: sumN(g, (r) => r.volume_14m), units: sumN(g, (r) => r.units_14m) },
        // The realtor's financed (mortgaged) volume by side: the wallet-share denominator, as in Model Match.
        fin: {
          "14m": { known: g.some((r) => r.fin_buyer_volume_14m != null), buyer: sumN(g, (r) => r.fin_buyer_volume_14m), listing: sumN(g, (r) => r.fin_listing_volume_14m) },
          all: { known: g.some((r) => r.alltime_refreshed_at), buyer: sumN(g, (r) => r.fin_buyer_volume_all), listing: sumN(g, (r) => r.fin_listing_volume_all) },
        },
        hasStats: g.some((r) => r.stats_refreshed_at), listingsLoaded: g.every((r) => r.listings_refreshed_at),
        active: sumN(g, (r) => r.active_listings_count),
      };
    });
  }
  function relStats(m, period, side) {
    const src = period === "14m" ? m.m14 : m.all;
    const u = side === "both" ? src.buyer.u + src.listing.u : src[side].u;
    const v = side === "both" ? src.buyer.v + src.listing.v : src[side].v;
    const f = m.fin[period];
    const denom = side === "both" ? f.buyer + f.listing : f[side];
    const share = f.known && denom > 0 ? Math.min(v / denom, 1) : null;
    return { units: u, volume: v, avg: u ? v / u : null, share, shareKnown: f.known };
  }

  async function renderLoDetail(panel) {
    const nmls = panel.dataset.nmls, box = $(".lo-realtors", panel);
    const period = $(".lo-period .active", panel).dataset.v, side = $(".lo-side .active", panel).dataset.v;
    try {
      const rows = await fetchAll(() => sb.from("arm_lo_realtor_detail").select("*").eq("originator_nmls", nmls));
      const merged = mergeRealtors(rows).map((m) => ({ ...m, s: relStats(m, period, side) })).filter((m) => m.s.units > 0);
      merged.sort((a, b) => b.s.volume - a.s.volume || b.s.units - a.s.units);
      panel._realtors = merged;
      panel.dataset.count = merged.length;
      $(".lo-realtor-count", panel).textContent = num(merged.length);
      const totU = sumN(merged, (m) => m.s.units), totV = sumN(merged, (m) => m.s.volume);
      const label = `${period === "14m" ? "last 14 months" : "all time"}, ${side === "both" ? "both sides" : side === "buyer" ? "buyer side" : "listing side"}`;
      if (!merged.length) { box.innerHTML = `<div class="empty">No realtors on file for ${esc(label)}${period === "14m" && !rows.some((r) => r.lo14_buyer_units != null || r.lo14_listing_units != null) ? " yet. The 14-month numbers load from Model Match the first time an LO is opened" : ""}.</div>`; return; }
      box.innerHTML = `<div class="rel-sum muted">${num(merged.length)} realtors · ${num(totU)} loans · ${money(totV)} · ${esc(label)}</div>
        <div class="table-wrap"><table class="rel-table"><thead><tr><th>Name</th><th class="num">Volume</th><th class="num">Units</th><th class="num">Avg loan size</th><th class="num" title="This LO's share of the realtor's financed volume on this side, for the selected period (the same measure Model Match uses)">Wallet share</th><th class="num">Active listings</th><th></th></tr></thead><tbody>
        ${merged.map((m, i) => `<tr class="clickable rel-row" data-i="${i}">
          <td><div class="rel-name"><span class="avatar">${esc(initials(m.full_name))}</span><div>${esc(m.full_name)}${m.profiles > 1 ? ` <span class="muted small" title="Model Match lists this realtor under ${m.profiles} profiles; they are combined here">· ${m.profiles} profiles merged</span>` : ""}<div class="muted">${esc(m.office_name || "Brokerage not on file")}</div></div></div></td>
          <td class="num strong">${moneyShort(m.s.volume)}</td><td class="num">${num(m.s.units)}</td><td class="num">${m.s.avg ? moneyShort(m.s.avg) : "—"}</td>
          <td class="num">${m.s.share != null ? `<span class="pill-share">${pct(m.s.share)}</span>` : `<span class="muted" title="${m.s.shareKnown ? "No financed volume on record for this realtor" : "Loads from Model Match when this LO is refreshed"}">${m.s.shareKnown ? "—" : "Loading…"}</span>`}</td>
          <td class="num">${m.listingsLoaded ? num(m.active) : `<span class="muted">…</span>`}</td>
          <td class="chev-r">›</td></tr>`).join("")}
        </tbody></table></div>`;
      $$("tr.rel-row", box).forEach((tr) => tr.addEventListener("click", () => openRelationship(nmls, merged[Number(tr.dataset.i)], period, side)));
    } catch (err) { fail(box, err); }
  }

  // ---------- Relationship drawer: stats + every transaction between the LO and the realtor ----------
  function drawer() {
    let d = $("#rel-drawer");
    if (!d) {
      document.body.insertAdjacentHTML("beforeend", `<div id="rel-drawer" class="drawer hidden" role="dialog" aria-modal="true"><div class="drawer-back"></div><aside class="drawer-panel"><button class="drawer-x" aria-label="Close">×</button><div class="drawer-body"></div></aside></div>`);
      d = $("#rel-drawer");
      const close = () => d.classList.add("hidden");
      $(".drawer-back", d).addEventListener("click", close);
      $(".drawer-x", d).addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    }
    return d;
  }
  async function openRelationship(nmls, m, period, side) {
    const d = drawer(), body = $(".drawer-body", d);
    const loNm = loName(nmls);
    d.classList.remove("hidden");
    const draw = (loans, note, pulled) => {
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 14);
      const roleOk = (r) => side === "both" || (side === "buyer" ? r === "buyer" : r === "listing" || r === "co-listing");
      // One row per loan (a loan can match two merged profiles), newest first.
      const seen = new Set();
      const tx = (loans || []).filter((l) => roleOk(l.agent_role) && (period === "all" || (l.mortgage_date && new Date(l.mortgage_date) >= cutoff)))
        .filter((l) => { const k = `${String(l.address || "").toLowerCase()}|${l.mortgage_date}|${l.mortgage_amount}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => String(b.mortgage_date || "").localeCompare(String(a.mortgage_date || "")));
      body.innerHTML = `
        <p class="eyebrow-dark">Relationship</p>
        <h2 class="drawer-title"><button class="name-link open-profile" title="See every LO this realtor works with">${esc(m.full_name)}</button></h2>
        <div class="muted">${esc(m.office_name || "Brokerage not on file")}</div>
        <button class="profile-link open-profile">See every LO ${esc(String(m.full_name || "").split(" ")[0])} works with, and their loan types →</button>
        <div class="drawer-sub">Transactions with ${esc(loNm)}</div>
        <div class="chips"><span class="chip">${period === "14m" ? "Last 14 months" : "All time"}</span><span class="chip">${side === "both" ? "Both sides" : side === "buyer" ? "Buyer side" : "Listing side"}</span>${m.profiles > 1 ? `<span class="chip">${m.profiles} Model Match profiles merged</span>` : ""}</div>
        <div class="drawer-stats">
          <div><span class="stat-l">Volume</span><span class="stat-v">${moneyShort(m.s.volume)}</span></div>
          <div><span class="stat-l">Units</span><span class="stat-v">${num(m.s.units)}</span></div>
          <div><span class="stat-l">Avg loan</span><span class="stat-v">${m.s.avg ? moneyShort(m.s.avg) : "—"}</span></div>
          <div><span class="stat-l">Wallet share</span><span class="stat-v">${pct(m.s.share)}</span></div>
        </div>
        <div class="drawer-contact">${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : `<span class="muted">No email on file</span>`} · ${phone(m.phone)}
          ${m.hasStats ? `<div class="muted">Realtor's own last 14 months: ${moneyShort(m.realtor14.both)} · ${num(m.realtor14.units)} deals · ${num(m.active)} active listings</div>` : ""}</div>
        ${note ? `<div class="note small">${esc(note)}</div>` : ""}
        <table class="tx-table"><thead><tr><th>Transaction date</th><th>Property</th><th>Loan type</th><th class="num">Loan amount</th></tr></thead><tbody>
        ${loans == null ? `<tr><td colspan="4" class="empty">Loading transactions…</td></tr>`
          : tx.length ? tx.map((l) => `<tr>
            <td class="muted nowrap">${date(l.mortgage_date)}</td>
            <td><strong>${esc(l.address || "—")}</strong><div class="muted">${esc([l.city, l.state].filter(Boolean).join(", "))}${l.zip ? " " + esc(l.zip) : ""}</div>
              ${l.borrower_name ? `<div class="muted">Borrower: ${esc(l.borrower_name)}</div>` : ""}
              ${l.sold_agent_name ? `<div class="muted">Buyer: ${esc(l.sold_agent_name)}</div>` : ""}${l.list_agent_name ? `<div class="muted">Listing: ${esc(l.list_agent_name)}</div>` : ""}
              ${!l.sold_agent_name && !l.list_agent_name ? `<div class="muted">${esc(ROLE[l.agent_role] || "")}</div>` : ""}</td>
            <td>${l.loan_type ? `<span class="tchip">${esc(l.loan_type.length <= 4 ? l.loan_type.toUpperCase() : cap(l.loan_type))}</span>` : ""}${l.transaction_type ? `<span class="tchip">${esc(TXN[l.transaction_type] || cap(l.transaction_type))}</span>` : ""}</td>
            <td class="num strong">${moneyShort(l.mortgage_amount)}</td></tr>`).join("")
          : `<tr><td colspan="4" class="empty">${pulled ? "No individual transactions on file for this window." : "Not loaded from Model Match yet."}</td></tr>`}
        </tbody></table>
        <div class="drawer-listings"></div>`;
      $$(".open-profile", body).forEach((b) => b.addEventListener("click", () => openAgentProfile(m, { back: () => openRelationship(nmls, m, period, side), backLabel: `Back to transactions with ${loNm}` })));
    };
    draw(null, "", false);
    const read = async () => {
      const [{ data: loans, error }, { data: pulls }] = await Promise.all([
        sb.from("arm_lo_realtor_loans").select("*").eq("originator_nmls", nmls).in("mmi_agent_id", m.ids),
        sb.from("arm_lo_realtor_loan_pulls").select("mmi_agent_id,scope").eq("originator_nmls", nmls).in("mmi_agent_id", m.ids),
      ]);
      if (error) throw error;
      // All time needs an all-time pull; Last 14 months is covered by any pull.
      const ok = (pulls || []).filter((p) => period === "14m" || p.scope === "allTime");
      return { loans, pulledAll: ok.length >= m.ids.length };
    };
    try {
      let { loans, pulledAll } = await read();
      let note = "";
      if (!pulledAll) {
        draw(loans, "Pulling these transactions from Model Match…", false);
        note = await pullPairLoans([nmls], m.ids, period === "14m" ? "14m" : "allTime");
        ({ loans, pulledAll } = await read());
      }
      draw(loans, note, pulledAll);
      // The realtor's active listings, under the transactions.
      const { data: ls } = await sb.from("arm_realtor_listings").select("*").in("mmi_agent_id", m.ids).order("list_date", { ascending: false });
      if (ls?.length) $(".drawer-listings", body).innerHTML = `<h3>Active listings (${num(ls.length)})</h3><table class="tx-table"><tbody>
        ${ls.map((l) => `<tr><td class="muted nowrap">${date(l.list_date)}</td><td><strong>${esc(l.address)}</strong><div class="muted">${esc([l.city, l.state].filter(Boolean).join(", "))}</div></td><td class="num strong">${moneyShort(l.list_price)}</td></tr>`).join("")}</tbody></table>`;
    } catch (err) { draw([], `Couldn't load transactions: ${err.message}`, false); }
  }

  // ---------- Realtor profile: every LO the realtor works with, and the loan types ----------
  const NONQM = /angel oak|deephaven|acra lending|verus|nqm funding|citadel servicing|a ?& ?d mortgage|a and d mortgage|newfi|sprout mortgage|change lending|athas capital|visio|kiavi|lima one|defy mortgage|champions funding|hometown equity|oaktree funding|logan finance|arc home|vista point|ahl funding|non-?qm|nonqm|carrington mortgage|quontic|admortgage/i;
  const LT = {
    conv: "Conventional", fha: "FHA", va: "VA", usda: "USDA", nonqm: "Non-QM", other: "Other", cash: "Cash or not recorded",
  };
  const LT_ORDER = ["conv", "fha", "va", "usda", "nonqm", "other", "cash"];
  function loanKind(d) {
    if (!d.financed) return "cash";
    if (NONQM.test(String(d.lender_name || "")) || NONQM.test(String(d.company_name || ""))) return "nonqm";
    const t = String(d.loan_type || "").toLowerCase();
    return t === "conventional" ? "conv" : t === "fha" ? "fha" : t === "va" ? "va" : t === "usda" ? "usda" : "other";
  }
  const isWestCap = (d) => (d.originator_nmls && roster?.has(String(d.originator_nmls))) || /west capital lending|westcap/i.test(String(d.company_name || "") + " " + String(d.lender_name || ""));
  const ltChips = (counts) => LT_ORDER.filter((k) => counts[k]).map((k) => `<span class="tchip lt lt-${k}">${esc(k === "cash" ? "Cash" : LT[k])} ${counts[k]}</span>`).join("");

  async function openAgentProfile(m, opts = {}) {
    const d = drawer(), body = $(".drawer-body", d);
    d.classList.remove("hidden");
    $(".drawer-panel", d).scrollTop = 0;
    const st = { period: opts.period || "14m", side: "both", open: new Set() };
    let deals = null, note = "";
    const draw = () => {
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 14);
      const seen = new Set();
      const rows = (deals || []).filter((x) => (st.period === "all" || (x.sale_date && new Date(x.sale_date) >= cutoff)) && (st.side === "both" || x.side === st.side))
        .filter((x) => { const k = `${String(x.address || "").toLowerCase()}|${x.sale_date}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => String(b.sale_date || "").localeCompare(String(a.sale_date || "")));
      const fin = rows.filter((x) => x.financed);
      const wcl = fin.filter(isWestCap);
      const mix = {}; rows.forEach((x) => { const k = loanKind(x); mix[k] = (mix[k] || 0) + 1; });
      // Group financed deals by loan officer.
      const groups = new Map();
      fin.forEach((x) => {
        const key = x.originator_nmls || `c:${x.company_name || x.lender_name || "Unknown"}`;
        if (!groups.has(key)) groups.set(key, { key, name: x.originator_name, nmls: x.originator_nmls, company: x.company_name || x.lender_name, deals: [], vol: 0, mix: {}, wcl: false });
        const g = groups.get(key);
        g.deals.push(x); g.vol += Number(x.loan_amount || 0);
        const k = loanKind(x); g.mix[k] = (g.mix[k] || 0) + 1;
        if (isWestCap(x)) g.wcl = true;
      });
      const los = [...groups.values()].sort((a, b) => b.deals.length - a.deals.length || b.vol - a.vol);
      const total = rows.length || 1;
      const seg = (cls, items, cur) => `<div class="seg ${cls}">${items.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? "active" : ""}">${l}</button>`).join("")}</div>`;
      body.innerHTML = `
        ${opts.back ? `<button class="drawer-back-link">← ${esc(opts.backLabel || "Back")}</button>` : ""}
        <p class="eyebrow-dark">Realtor profile</p>
        <h2 class="drawer-title">${esc(m.full_name)}</h2>
        <div class="muted">${esc(m.office_name || "Brokerage not on file")}</div>
        <div class="drawer-contact">${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : `<span class="muted">No email on file</span>`} · ${phone(m.phone)}</div>
        <div class="ap-controls">${seg("ap-period", [["14m", "Last 14 months"], ["all", "All time"]], st.period)}${seg("ap-side", [["buyer", "Buyer side"], ["listing", "Listing side"], ["both", "Both"]], st.side)}</div>
        ${deals == null ? `<div class="empty" style="padding:24px 0">Loading every deal ${esc(String(m.full_name || "").split(" ")[0])} closed…</div>` : `
        <div class="drawer-stats">
          <div><span class="stat-l">Closed deals</span><span class="stat-v">${num(rows.length)}</span></div>
          <div><span class="stat-l">Financed</span><span class="stat-v">${num(fin.length)}</span></div>
          <div><span class="stat-l">Loan officers</span><span class="stat-v">${num(los.length)}</span></div>
          <div><span class="stat-l">With WestCap</span><span class="stat-v">${num(wcl.length)}<small style="font-size:13px;color:var(--slate);font-weight:600"> of ${num(fin.length)}</small></span></div>
        </div>
        ${rows.length ? `<div class="mix"><div class="mix-bar">${LT_ORDER.filter((k) => mix[k]).map((k) => `<i class="lt-${k}" style="width:${(mix[k] / total) * 100}%" title="${LT[k]} ${mix[k]}"></i>`).join("")}</div>
          <div class="mix-legend">${LT_ORDER.filter((k) => mix[k]).map((k) => `<span><i class="lt-${k}"></i>${esc(LT[k])} <b>${mix[k]}</b></span>`).join("")}</div></div>` : ""}
        <h3 class="ap-h">Loan officers on ${esc(String(m.full_name || "").split(" ")[0])}'s deals</h3>
        <div class="muted small">Click a loan officer to see the deals.</div>
        <table class="ap-table"><thead><tr><th>Loan officer</th><th class="num">Deals</th><th class="num">Volume</th><th>Loan types</th><th class="num">Last deal</th></tr></thead><tbody>
        ${los.length ? los.map((g, i) => `<tr class="ap-row${g.wcl ? " wcl" : ""}" data-k="${esc(g.key)}"><td><strong>${esc(g.name || "Loan officer not recorded")}</strong>${g.wcl ? `<span class="wcl-pill">WestCap</span>` : ""}<div class="muted">${esc(g.company || "")}${g.nmls ? ` · NMLS ${esc(g.nmls)}` : ""}</div></td>
            <td class="num strong">${num(g.deals.length)}</td><td class="num">${moneyShort(g.vol)}</td><td>${ltChips(g.mix)}</td><td class="num muted">${date(g.deals[0].sale_date)}</td></tr>
            ${st.open.has(g.key) ? `<tr class="ap-deals"><td colspan="5">${g.deals.map((x) => `<div class="d"><span class="muted">${date(x.sale_date)}</span><span><strong>${esc(x.address || "—")}</strong>, ${esc([x.city, x.state].filter(Boolean).join(", "))} <span class="muted">· ${x.side === "buyer" ? "Buyer side" : "Listing side"}</span><br>${ltChips({ [loanKind(x)]: 1 }).replace(/ 1</, "<")} <span class="muted">${esc(x.lender_name || "")}</span></span><span class="strong">${moneyShort(x.loan_amount)}</span></div>`).join("")}</td></tr>` : ""}`).join("")
          : `<tr><td colspan="5" class="empty">No financed deals on file for this window.</td></tr>`}
        </tbody></table>
        <p class="ap-note">${num(mix.cash || 0)} of ${num(rows.length)} deals have no purchase loan on file: cash buyers, or loans not recorded yet (recent closings take 1 to 3 months to show up). Non-QM isn't labeled in public records, so it's flagged by lender name.${note ? " " + esc(note) : ""}</p>`}`;
      if (opts.back) $(".drawer-back-link", body).addEventListener("click", opts.back);
      $$(".ap-period button", body).forEach((b) => b.addEventListener("click", async () => { st.period = b.dataset.v; st.open.clear(); draw(); if (st.period === "all") await load("allTime"); }));
      $$(".ap-side button", body).forEach((b) => b.addEventListener("click", () => { st.side = b.dataset.v; draw(); }));
      $$("tr.ap-row", body).forEach((tr) => tr.addEventListener("click", () => { const k = tr.dataset.k; st.open.has(k) ? st.open.delete(k) : st.open.add(k); draw(); }));
    };
    const read = async () => {
      const { data, error } = await sb.from("arm_agent_deals").select("*").in("mmi_agent_id", m.ids || [m.mmi_agent_id]);
      if (error) throw error;
      return data || [];
    };
    const load = async (scope) => {
      try {
        const { data, error } = await sb.functions.invoke("arm-details", { body: { action: "agent_deals", agent_ids: m.ids || [m.mmi_agent_id], scope } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        note = data.paused ? `Not refreshed: ${data.paused}.` : data.capped ? `Showing the newest ${num(data.rows)} of ${num(data.total)} deals.` : "";
        deals = await read();
      } catch (err) { note = `Couldn't reach Model Match: ${err.message}`; deals = deals || []; }
      draw();
    };
    draw();
    try { deals = await read(); if (deals.length) draw(); } catch (_) { /* fall through to load */ }
    await load(st.period === "all" ? "allTime" : "14m");
  }

  async function syncLoDetail(panel, force) {
    const status = $(".lo-status", panel), btn = $(".lo-refresh", panel);
    btn.disabled = true;
    try {
      for (let round = 0; round < 12; round++) {
        status.textContent = round === 0 ? "Checking Model Match for updates…" : "Still pulling realtor data from Model Match…";
        const { data, error } = await sb.functions.invoke("arm-lo-realtors", { body: { nmls: panel.dataset.nmls, refresh: force && round === 0 } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        await renderLoDetail(panel);
        const n = num(data.realtors ?? panel.dataset.count ?? 0);
        if (data.paused) { status.textContent = `${n} realtors · update paused: ${data.paused}.`; return; }
        if (data.complete) { status.textContent = `${n} realtors · up to date · Model Match balance ${num(data.balance)} credits`; return; }
        if (!data.refreshed && !data.remaining) { status.textContent = `${n} realtors`; return; }
      }
      status.textContent = "Partially loaded. Click Refresh to continue.";
    } catch (err) {
      status.textContent = `Couldn't reach Model Match: ${err.message}`;
    } finally { btn.disabled = false; }
  }

  // ---------- ARMs ----------
  async function loadArmSelects() {
    const { data } = await sb.from("arm_arms").select("id,full_name,active").order("full_name");
    const opts = `<option value="">Choose an ARM</option>` + (data || []).filter((a) => a.active).map((a) => `<option value="${a.id}">${esc(a.full_name)}</option>`).join("");
    $$(".arm-select").forEach((s) => (s.innerHTML = opts));
  }
  loaders.arms = async () => {
    await getRoster();
    if (isAdmin()) { loadArmSelects(); if (!$("#deploy-states").children.length) drawStatePicks(); }
    const head = (id, adminText, armText) => { const h = $(id).closest(".card")?.querySelector("h3"); if (h) h.textContent = isAdmin() ? adminText : armText; };
    head("#arm-volume-table", "Captured volume by ARM", "Your captured volume");
    head("#deploy-table", "Assignments", "Your LOs and states");
    head("#loans-table", "Credited loans", "Loans credited to you");
    const [{ data: vol, error: e1 }, { data: deps, error: e2 }, { data: sts }, { data: loans, error: e3 }] = await Promise.all([
      sb.from("arm_captured_volume").select("*").order("captured_volume", { ascending: false }),
      sb.from("arm_deployments").select("*, arm_arms(full_name)").order("start_date", { ascending: false }),
      sb.from("arm_state_assignments").select("*, arm_arms(full_name)").order("start_date", { ascending: false }),
      sb.from("arm_attributed_loans").select("*, arm_arms(full_name), arm_realtors(full_name)").order("funded_date", { ascending: false, nullsFirst: false }).limit(200),
    ]);
    if (e1) return fail($("#arm-volume-table"), e1);
    const tot = (vol || []).reduce((a, v) => ({ loans: a.loans + Number(v.funded_loans), vol: a.vol + Number(v.captured_volume), comp: a.comp + Number(v.arm_variable_comp) }), { loans: 0, vol: 0, comp: 0 });
    $("#arm-kpis").innerHTML = (isAdmin() ? kpi("ARMs", num((vol || []).length)) : kpi("LOs you support", num((me.los || []).length))) +
      kpi("Credited loans", num(tot.loans)) + kpi("Captured volume", moneyShort(tot.vol)) + kpi(isAdmin() ? "ARM variable comp" : "Your variable comp", money(tot.comp));
    $("#arm-volume-table").innerHTML = (vol || []).length
      ? `<thead><tr><th>ARM</th><th class="num">Funded loans</th><th class="num">Captured volume</th><th class="num">Existing relationships</th><th class="num">New relationships</th><th class="num">Variable comp</th></tr></thead><tbody>` +
        vol.map((v) => `<tr><td>${esc(v.arm_name)}</td><td class="num">${num(v.funded_loans)}</td><td class="num">${money(v.captured_volume)}</td><td class="num">${money(v.volume_existing_relationships)}</td><td class="num">${money(v.volume_new_relationships)}</td><td class="num">${money(v.arm_variable_comp)}</td></tr>`).join("") + `</tbody>`
      : `<tr><td class="empty">${isAdmin() ? "No ARMs yet. Add one below once the pilot hire is made." : "No credited loans yet."}</td></tr>`;
    renderAssignments(deps, sts, e2);
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
    if (!d.email) return setMsg(f, "Enter the ARM's WestCap email. It's how they sign in.");
    const { error } = await sb.from("arm_arms").insert({ full_name: d.full_name, email: d.email || null, phone: d.phone || null, start_date: d.start_date || null, comp_bps: d.comp_bps ? Number(d.comp_bps) : 10 });
    if (error) return setMsg(f, `Couldn't save: ${error.message}`);
    f.reset(); setMsg(f, ""); toast(`ARM added. ${d.full_name.split(" ")[0]} can sign in with ${d.email} and will see only the LOs and states you assign them.`); loaders.arms();
  });
  function renderAssignments(deps, sts, err) {
    const t = $("#deploy-table");
    if (err) return (t.innerHTML = `<tr><td class="empty">${esc(err.message)}</td></tr>`);
    const today = new Date().toISOString().slice(0, 10);
    const live = (r) => !r.end_date || r.end_date >= today;
    const loCount = (st) => roster ? [...roster.values()].filter((l) => l.active && String(l.office_state || "").toUpperCase() === st).length : null;
    const rows = [
      ...(sts || []).map((r) => ({ ...r, kind: "state", label: `${esc(r.state)} <span class="muted">· all ${num(loCount(r.state))} active LOs based there</span>` })),
      ...(deps || []).map((r) => ({ ...r, kind: "lo", label: esc(loName(r.originator_nmls)) })),
    ].sort((a, b) => (live(b) - live(a)) || String(a.arm_arms?.full_name).localeCompare(String(b.arm_arms?.full_name)) || (a.kind === "state" ? -1 : 1));
    if (!rows.length) return (t.innerHTML = `<tr><td class="empty">No assignments yet.</td></tr>`);
    t.innerHTML = `<thead><tr><th>ARM</th><th>Type</th><th>Covers</th><th>Start</th><th>End</th>${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>` +
      rows.map((r) => `<tr class="${live(r) ? "" : "ended"}"><td>${esc(r.arm_arms?.full_name)}</td><td>${r.kind === "state" ? "State" : "LO"}</td><td>${r.label}</td><td>${date(r.start_date)}</td><td>${date(r.end_date)}</td>${isAdmin() ? `<td>${live(r) ? `<button class="btn-ghost btn-sm end-assign" data-kind="${r.kind}" data-id="${r.id}">End</button>` : ""}</td>` : ""}</tr>`).join("") + `</tbody>`;
    $$(".end-assign", t).forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const table = b.dataset.kind === "state" ? "arm_state_assignments" : "arm_deployments";
      const { error } = await sb.from(table).update({ end_date: new Date().toISOString().slice(0, 10) }).eq("id", b.dataset.id);
      if (error) { b.disabled = false; return toast(`Couldn't end it: ${error.message}`); }
      toast("Assignment ended"); loaders.arms();
    }));
  }

  // Multi-pick LOs and states for an ARM.
  const pickedLos = new Set();
  const deployForm = $("#form-deploy");
  function drawLoChips() {
    $("#deploy-lo-chips").innerHTML = [...pickedLos].map((n) => `<span class="chip">${esc(loName(n))}<button type="button" data-n="${esc(n)}" aria-label="Remove">×</button></span>`).join("");
    $$("#deploy-lo-chips button").forEach((b) => b.addEventListener("click", () => { pickedLos.delete(b.dataset.n); drawLoChips(); }));
  }
  function addLoFromInput() {
    const inp = $("input[name='lo_lookup']", deployForm), n = parseId(inp.value);
    if (n && roster?.has(n)) { pickedLos.add(n); inp.value = ""; drawLoChips(); setMsg(deployForm, ""); return true; }
    return false;
  }
  $("input[name='lo_lookup']", deployForm).addEventListener("change", addLoFromInput);
  $("input[name='lo_lookup']", deployForm).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!addLoFromInput()) setMsg(deployForm, "Pick an LO from the list."); } });
  async function drawStatePicks() {
    await getRoster();
    const counts = {};
    roster.forEach((l) => { const st = String(l.office_state || "").toUpperCase(); if (l.active && st) counts[st] = (counts[st] || 0) + 1; });
    $("#deploy-states").innerHTML = `<div class="sp-label">States</div>` + Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([st, c]) => `<label class="sp"><input type="checkbox" name="states" value="${st}"><span>${st}</span><small>${num(c)}</small></label>`).join("");
  }
  deployForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f);
    if (d.lo_lookup) addLoFromInput();
    const states = $$("input[name='states']:checked", f).map((c) => c.value);
    if (!d.arm_id) return setMsg(f, "Choose an ARM.");
    if (!pickedLos.size && !states.length) return setMsg(f, "Add at least one LO or check a state.");
    const start = d.start_date || undefined;
    const [{ data: openDeps }, { data: openSts }] = await Promise.all([
      sb.from("arm_deployments").select("originator_nmls").eq("arm_id", d.arm_id).is("end_date", null),
      sb.from("arm_state_assignments").select("state").eq("arm_id", d.arm_id).is("end_date", null),
    ]);
    const haveLo = new Set((openDeps || []).map((r) => r.originator_nmls)), haveSt = new Set((openSts || []).map((r) => r.state));
    const newLos = [...pickedLos].filter((n) => !haveLo.has(n)), newSts = states.filter((s) => !haveSt.has(s));
    const errs = [];
    if (newLos.length) { const { error } = await sb.from("arm_deployments").insert(newLos.map((n) => ({ arm_id: d.arm_id, originator_nmls: n, start_date: start }))); if (error) errs.push(error.message); }
    if (newSts.length) { const { error } = await sb.from("arm_state_assignments").insert(newSts.map((s) => ({ arm_id: d.arm_id, state: s, start_date: start }))); if (error) errs.push(error.message); }
    if (errs.length) return setMsg(f, `Couldn't save: ${errs.join("; ")}`);
    const skipped = pickedLos.size - newLos.length + states.length - newSts.length;
    const parts = [newLos.length && `${newLos.length} LO${newLos.length > 1 ? "s" : ""}`, newSts.length && `${newSts.length} state${newSts.length > 1 ? "s" : ""}`].filter(Boolean);
    f.reset(); pickedLos.clear(); drawLoChips(); setMsg(f, "");
    toast(parts.length ? `Assigned ${parts.join(" and ")}${skipped ? ` (${skipped} already assigned)` : ""}` : "Those are already assigned to this ARM");
    loaders.arms();
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
    const [{ data: st }, { data: runs }, { data: admins }, { data: arms }, ...counts] = await Promise.all([
      sb.from("arm_sync_state").select("*"),
      sb.from("arm_sync_log").select("*").order("id", { ascending: false }).limit(25),
      sb.from("arm_admins").select("*").order("added_at"),
      sb.from("arm_arms").select("full_name,email,active").order("full_name"),
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
    $("#admins").innerHTML = (admins || []).map((a) => row(`${esc(a.full_name || a.email)}<div class="muted">${esc(a.email)}</div>`, "Admin · sees everything")).join("") +
      (arms || []).filter((a) => a.email).map((a) => row(`${esc(a.full_name)}<div class="muted">${esc(a.email)}</div>`, a.active ? "ARM · sees only their assigned LOs and states" : "ARM · inactive, no access")).join("") +
      `<p class="muted" style="margin:10px 0 0;font-size:12px">ARMs get a login when you add them on the ARMs tab with their WestCap email. They sign in with a one-time email link the first time, then set a password. To add another admin, ask Claude.</p>`;
  };

  // Shared with cobrand.js (the Co-brand tab).
  window.ARMApp = { sb, loaders, getRoster, loName, parseId, esc, num, money, moneyShort, date, phone, toast, isAdmin, fetchAll, me: () => me };
  (window.ARMExtensions || []).forEach((f) => f(window.ARMApp));

  route();
})();
