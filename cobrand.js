/* Co-brand tab: on-brand social posts and flyers for an LO + realtor partner, with a compliance gate.
   Photos stay in the browser; only a log line (who made what, for which LO and realtor) is saved. */
(window.ARMExtensions = window.ARMExtensions || []).push((A) => {
  const { sb, esc, moneyShort, date, phone, toast } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const WCL_NMLS = "1566096";

  const SIZES = { square: [1080, 1080], story: [1080, 1920], letter: [1275, 1650] };
  const FORMAT_LABEL = { square: "Square post", story: "Story", letter: "Flyer (letter)" };
  const TYPES = {
    just_listed: { label: "Just listed", group: "Listing posts", formats: ["square", "story", "letter"], listing: "active" },
    open_house: { label: "Open house", group: "Listing posts", formats: ["square", "story", "letter"], listing: "active", openHouse: true },
    just_sold: { label: "Just sold", group: "Listing posts", formats: ["square", "story"], listing: "sold" },
    partner: { label: "Meet your lending partner", group: "Intro", formats: ["square", "story"] },
    buyer_flyer: { label: "Buyer flyer", group: "Buyers", formats: ["letter", "square"], area: true },
    ftb_guide: { label: "First-time buyer guide", group: "Buyers", formats: ["letter"], area: true },
    market: { label: "Market update", group: "Market", formats: ["square", "story", "letter"], area: true, market: true },
  };

  const st = {
    lo: null, realtor: null, realtors: [], listings: [], sold: [],
    type: "just_listed", format: "square", photos: {}, f: {}, captionEdited: false, inited: false,
  };
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const initials = (n) => String(n || "").trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s\-'&/])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  const form = () => $("#cb-form");
  const val = (name) => (form().elements[name]?.value ?? "").trim();

  // ---------- default words ----------
  function defaults() {
    const L = first(st.lo?.name) || "your loan officer", R = first(st.realtor?.name) || "your agent";
    const area = st.f.area || st.f.city || "";
    switch (st.type) {
      case "just_listed": return { h: "Just listed", b: `Call ${R} for a private showing. Thinking about making it yours? ${L} can get you pre-approved before you tour.` };
      case "open_house": return { h: "Open house", b: `Come see it in person. Questions about financing? ${L} is one call away.` };
      case "just_sold": return { h: "Just sold", b: `Another one closed with ${R} and ${L}. Ready for your move? Let's talk.` };
      case "partner": return { h: "Your home team", b: `${R} finds the home. ${L} handles the loan. One team from first showing to keys in hand.` };
      case "buyer_flyer": return { h: area ? `Ready to buy in ${area}?` : "Ready to buy your next home?", b: "Start with a pre-approval so your offer is ready the day the right home hits the market." };
      case "ftb_guide": return { h: "First-time buyer's guide", b: `Five steps from renting to owning${area ? ` in ${area}` : ""}, from your local team.` };
      case "market": return { h: area ? `${area} market update` : "Market update", b: "Here's what moved this month. Thinking about buying or selling? We're one call away." };
    }
    return { h: "", b: "" };
  }

  // ---------- compliance ----------
  const RULES = [
    { re: /\d+(\.\d+)?\s*%|\bapr\b|\binterest rate|\brates? (as low|from|starting)|\$\s?\d[\d,]*\s*(\/\s?mo|per month|a month|monthly)|\bpayments? (of|as low|from)|\b\d+\s*(year|yr)[\s-]*(fixed|term)|no money down|zero down|\$0 down|down payment of|\d+\s*down\b/i,
      text: "Reg Z trigger term: a rate, payment, down payment or loan term in an ad requires the full disclosures. Take it out, or send the piece to Compliance." },
    { re: /#\s?1\b|number one|best rates?|lowest rates?|guarantee|guaranteed|instant approval|approved in minutes|pre-?approved in minutes|no credit check/i,
      text: "Unsupported claim (\"#1\", \"best/lowest rate\", \"guaranteed\", \"instant approval\"). Remove it." },
    { re: /family[- ]friendly|perfect for (a )?(young|couples?|famil|singles|retirees)|ideal for (young|couples?|famil|singles|retirees)|bachelor|empty[- ]nesters?|exclusive (neighbou?rhood|community|area)|safe (neighbou?rhood|area|community)|walking distance to (church|synagogue|mosque|temple)|no (kids|children)|adults? only|christian|integrated|ethnic|english[- ]speaking|able[- ]bodied|handicap/i,
      text: "Fair Housing: words that describe who should live there (family, age, religion, ability, \"safe\" or \"exclusive\" area). Describe the home, not the buyer." },
  ];
  function checks() {
    const out = [];
    const L = st.lo, R = st.realtor;
    out.push({ lvl: L?.nmls ? "ok" : "block", text: L?.nmls ? `${L.name}, NMLS #${L.nmls} on the asset` : "Pick a loan officer" });
    out.push({ lvl: "ok", text: `West Capital Lending, Inc., NMLS #${WCL_NMLS} and Equal Housing Opportunity on the asset` });
    if (st.type !== "ftb_guide" || R) out.push({ lvl: R ? (brokerage() ? "ok" : "block") : "block", text: !R ? "Pick a realtor" : brokerage() ? `Realtor's brokerage shown (${brokerage()})` : "Add the realtor's brokerage. State ad rules require it on agent advertising." });
    const words = [val("headline"), val("body"), $("#cb-caption")?.value || "", ...Object.values(st.f)].join(" \n ");
    RULES.forEach((r) => { const m = words.match(r.re); if (m) out.push({ lvl: "block", text: `${r.text} Found: "${m[0].trim()}"` }); });
    const cost = val("cost");
    if (cost === "lo_all") out.push({ lvl: "block", text: "RESPA §8: the LO can't pay for the realtor's share of an ad or print run. Split the cost by each side's share of the space." });
    else if (cost === "realtor_all") out.push({ lvl: "block", text: "RESPA §8: the realtor can't pay for the LO's share of an ad or print run. Split the cost by each side's share of the space." });
    else if (cost === "split") out.push({ lvl: "ok", text: "Cost split by share of the space. Keep the invoices showing each side's payment." });
    else out.push({ lvl: "ok", text: "Organic post: no shared cost" });
    if (TYPES[st.type].market) {
      const hasStats = [1, 2, 3].some((i) => st.f[`s${i}v`]);
      if (hasStats && !st.f.source) out.push({ lvl: "block", text: "Market stats need a source line (for example, \"Source: ARMLS, October 2026\")." });
      if (!hasStats) out.push({ lvl: "warn", text: "Add at least one market stat." });
    }
    if (st.photos.listing && TYPES[st.type].listing) out.push({ lvl: "warn", text: "Use listing photos only with the listing agent's and photographer's permission." });
    return out;
  }
  const brokerage = () => (st.f.brokerage ?? st.realtor?.office ?? "").trim();

  // ---------- asset markup ----------
  const EHO = `<svg class="eho" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 2 15v4h4v18h28V19h4v-4L20 3zm10 30H10V17.5L20 10.6l10 6.9V33z" fill="currentColor"/><rect x="13" y="20" width="14" height="3" fill="currentColor"/><rect x="13" y="26" width="14" height="3" fill="currentColor"/></svg>`;
  function person(p, role, photo) {
    if (!p) return "";
    const pic = photo ? `<img src="${photo}" alt="">` : `<span>${esc(initials(p.name))}</span>`;
    const line = role === "lo" ? `Loan Officer · NMLS #${esc(p.nmls)}` : `REALTOR® · ${esc(brokerage())}`;
    const contact = [p.phone ? phone(p.phone) : "", p.email || ""].filter(Boolean).map(esc).join("<br>");
    return `<div class="a-person"><div class="a-pic">${pic}</div><div><div class="a-name">${esc(p.name)}</div><div class="a-role">${line}</div><div class="a-contact">${contact}</div></div></div>`;
  }
  function legal() {
    const L = st.lo, R = st.realtor;
    return `<div class="a-legal">${EHO}<span>${L ? `${esc(L.name)}, NMLS #${esc(L.nmls)} · ` : ""}West Capital Lending, Inc., NMLS #${WCL_NMLS} · nmlsconsumeraccess.org · Equal Housing Opportunity.${R ? ` ${esc(R.name)}, ${esc(brokerage())}.` : ""} Not a commitment to lend. All loans subject to credit approval. Information deemed reliable but not guaranteed.</span></div>`;
  }
  const team = (dark) => `<div class="a-team${dark ? " dark" : ""}">${person(st.lo, "lo", st.photos.lo)}${person(st.realtor, "realtor", st.photos.realtor)}</div>`;
  const logo = (dark) => `<img class="a-logo" src="assets/${dark ? "logo-h-white.png" : "logo-h-blue.png"}" alt="West Capital Lending">`;
  const heroPhoto = () => st.photos.listing ? `<img src="${st.photos.listing}" alt="">` : `<div class="a-ph"><span>Add a listing photo</span></div>`;

  function assetHTML() {
    const t = st.type, F = st.f, h = esc(val("headline")), b = esc(val("body"));
    const addr = esc(F.address || "Street address"), city = esc(F.city || "City, ST");
    const price = F.price ? esc(F.price) : "";
    let inner = "";
    if (TYPES[t].listing) {
      inner = `
        <div class="a-hero">${heroPhoto()}<div class="a-tag">${h || esc(TYPES[t].label)}</div></div>
        <div class="a-main">
          <div class="a-addr">${addr}</div>
          <div class="a-city">${city}</div>
          ${t === "open_house" ? `<div class="a-oh"><b>${esc(F.oh_date ? date(F.oh_date) : "Date")}</b><span>${esc(F.oh_time || "Time")}</span></div>` : ""}
          ${price ? `<div class="a-price">${price}</div>` : ""}
          ${b ? `<p class="a-body">${b}</p>` : ""}
        </div>
        <div class="a-foot">${team(true)}<div class="a-footrow">${logo(true)}</div>${legal()}</div>`;
    } else if (t === "partner") {
      inner = `
        <div class="a-dark">
          ${logo(true)}
          <div class="a-eyebrow">Meet your lending partner</div>
          <h1 class="a-h">${h}</h1>
          <div class="a-duo">
            <div>${bigPic(st.photos.realtor, st.realtor)}<div class="a-name">${esc(st.realtor?.name || "")}</div><div class="a-role">REALTOR® · ${esc(brokerage())}</div></div>
            <div class="a-plus">+</div>
            <div>${bigPic(st.photos.lo, st.lo)}<div class="a-name">${esc(st.lo?.name || "")}</div><div class="a-role">Loan Officer · NMLS #${esc(st.lo?.nmls || "")}</div></div>
          </div>
          <p class="a-body">${b}</p>
          <div class="a-contacts">${contactLine(st.realtor)}${contactLine(st.lo)}</div>
          ${legal()}
        </div>`;
    } else if (t === "buyer_flyer" || t === "ftb_guide") {
      const R = first(st.realtor?.name) || "your agent", L = first(st.lo?.name) || "your loan officer";
      const steps = t === "buyer_flyer"
        ? [["Get pre-approved", `${L} reviews income, assets and credit up front, so you shop with a real number.`],
           ["Know your budget", "Look at the full monthly picture: taxes, insurance and HOA, not just the price."],
           [`Tour with ${R}`, `${R} knows the neighborhoods, the inventory and how to write an offer that wins.`],
           ["Close with confidence", "One team keeping the appraisal, title and closing date on track."]]
        : [["Check your credit", "Pull your reports, fix errors and keep balances low while you shop."],
           ["Save for the costs", "Plan for the down payment, closing costs and a cushion after you move in."],
           ["Get pre-approved", `${L} matches you with the right loan program and gives you a pre-approval letter.`],
           ["Find the home", `${R} sets up showings, compares homes and negotiates your offer.`],
           ["Close and get your keys", "Inspection, appraisal, final approval and a closing date you can plan around."]];
      inner = `
        <div class="a-band">${logo(true)}<div class="a-eyebrow">${t === "ftb_guide" ? "Buyer's guide" : "For buyers"}${F.area ? ` · ${esc(F.area)}` : ""}</div><h1 class="a-h">${h}</h1>${b ? `<p class="a-body">${b}</p>` : ""}</div>
        <ol class="a-steps">${steps.map(([s, d]) => `<li><b>${esc(s)}</b><span>${esc(d)}</span></li>`).join("")}</ol>
        ${t === "ftb_guide" ? `<div class="a-programs"><b>Programs to ask about</b><span>Conventional</span><span>FHA</span><span>VA</span><span>USDA</span><span>Down payment assistance</span></div>` : ""}
        <div class="a-foot">${team(true)}${legal()}</div>`;
    } else if (t === "market") {
      const stats = [1, 2, 3].map((i) => [F[`s${i}l`], F[`s${i}v`]]).filter(([, v]) => v);
      inner = `
        <div class="a-dark">
          ${logo(true)}
          <div class="a-eyebrow">${esc(F.month || "This month")}${F.area ? ` · ${esc(F.area)}` : ""}</div>
          <h1 class="a-h">${h}</h1>
          <div class="a-stats">${stats.map(([l, v]) => `<div><b>${esc(v)}</b><span>${esc(l || "")}</span></div>`).join("") || `<div class="a-muted">Add stats in the panel</div>`}</div>
          ${b ? `<p class="a-body">${b}</p>` : ""}
          ${F.source ? `<div class="a-source">${esc(F.source)}</div>` : ""}
          ${team(true)}
          ${legal()}
        </div>`;
    }
    return `<div class="asset t-${t} f-${st.format}" style="width:${SIZES[st.format][0]}px;height:${SIZES[st.format][1]}px">${inner}</div>`;
  }
  const bigPic = (photo, p) => `<div class="a-bigpic">${photo ? `<img src="${photo}" alt="">` : `<span>${esc(initials(p?.name))}</span>`}</div>`;
  const contactLine = (p) => p ? `<div><b>${esc(first(p.name))}</b> ${esc([p.phone ? phone(p.phone) : "", p.email || ""].filter(Boolean).join(" · "))}</div>` : "";

  function caption() {
    const L = st.lo, R = st.realtor, F = st.f;
    if (!L || !R) return "";
    const where = [F.address, F.city].filter(Boolean).join(", ");
    const lines = {
      just_listed: `Just listed${where ? `: ${where}` : ""}${F.price ? ` · ${F.price}` : ""}.\n\nReach out to ${R.name} for a showing, and to ${L.name} to get pre-approved before you tour.`,
      open_house: `Open house${where ? ` at ${where}` : ""}${F.oh_date ? `, ${date(F.oh_date)}` : ""}${F.oh_time ? `, ${F.oh_time}` : ""}.\n\nCome see it with ${R.name}. Financing questions? ${L.name} has answers.`,
      just_sold: `Just sold${where ? `: ${where}` : ""}. Congratulations to the new homeowners.\n\nProud to close this one together. ${R.name} and ${L.name}.`,
      partner: `Buying a home takes a team. ${R.name} finds the right home, and ${L.name} gets the financing done.\n\nReach out to either of us to get started.`,
      buyer_flyer: `Thinking about buying${F.area ? ` in ${F.area}` : ""}? Start with a pre-approval from ${L.name}, then tour with ${R.name}.`,
      ftb_guide: `First home on the list for this year? Here are five steps from renting to owning${F.area ? ` in ${F.area}` : ""}. Save this, and message ${R.name} or ${L.name} with questions.`,
      market: `${F.area || "Local"} market update${F.month ? ` for ${F.month}` : ""}.\n\nQuestions about what it means for you? Talk to ${R.name} about the market and ${L.name} about financing.${F.source ? `\n\n${F.source}` : ""}`,
    }[st.type];
    return `${lines}\n\n${L.name} | NMLS #${L.nmls} | West Capital Lending, Inc. NMLS #${WCL_NMLS} | Equal Housing Opportunity\n${R.name} | ${brokerage()}`;
  }

  // ---------- panel ----------
  function drawTypes() {
    $("#cb-types").innerHTML = Object.entries(TYPES).map(([k, t]) => `<button type="button" data-t="${k}" class="${k === st.type ? "active" : ""}"><small>${esc(t.group)}</small>${esc(t.label)}</button>`).join("");
    $$("#cb-types button").forEach((b) => b.addEventListener("click", () => setType(b.dataset.t)));
    const fm = TYPES[st.type].formats;
    if (!fm.includes(st.format)) st.format = fm[0];
    $("#cb-format").innerHTML = fm.map((f) => `<button type="button" data-f="${f}" class="${f === st.format ? "active" : ""}">${FORMAT_LABEL[f]}</button>`).join("");
    $$("#cb-format button").forEach((b) => b.addEventListener("click", () => { st.format = b.dataset.f; drawTypes(); render(); }));
  }
  function setType(t) {
    st.type = t; st.captionEdited = false;
    if (TYPES[t].market) ["Median sale price", "Days on market", "Homes for sale"].forEach((l, i) => { if (st.f[`s${i + 1}l`] == null) st.f[`s${i + 1}l`] = l; });
    const d = defaults();
    form().elements.headline.value = d.h; form().elements.body.value = d.b;
    drawTypes(); drawFields(); render();
  }
  const input = (k, label, ph = "", type = "text") => `<label>${label}<input data-f="${k}" type="${type}" value="${esc(st.f[k] || "")}" placeholder="${esc(ph)}"></label>`;
  function drawFields() {
    const T = TYPES[st.type];
    let h = "";
    if (T.listing === "active") {
      h += `<label>Listing<select data-pick="active"><option value="">${st.listings.length ? "Pick one of their active listings" : "No active listings on file, type it below"}</option>${st.listings.map((l, i) => `<option value="${i}">${esc(title(l.address))}, ${esc(title(l.city))} · ${moneyShort(l.list_price)}</option>`).join("")}</select></label>`;
    }
    if (T.listing === "sold") {
      h += `<label>Closed together<select data-pick="sold"><option value="">${st.sold.length ? "Pick a deal this LO and realtor closed" : "None on file, type it below"}</option>${st.sold.map((l, i) => `<option value="${i}">${esc(l.address || "")}, ${esc(l.city || "")} · ${date(l.mortgage_date)}</option>`).join("")}</select></label>`;
    }
    if (T.listing) h += `<div class="cb-row">${input("address", "Address", "123 Main St")}${input("city", "City, state", "Mesa, AZ")}</div>${input("price", T.listing === "sold" ? "Price (optional)" : "List price", "$525,000")}`;
    if (T.openHouse) h += `<div class="cb-row">${input("oh_date", "Open house date", "", "date")}${input("oh_time", "Time", "1 to 4 PM")}</div>`;
    if (T.area) h += input("area", "Area", "Mesa, Gilbert, East Valley…");
    if (T.market) {
      h += input("month", "Month", "November 2026");
      h += [1, 2, 3].map((i) => `<div class="cb-row">${input(`s${i}l`, `Stat ${i} label`, ["Median sale price", "Days on market", "Homes for sale"][i - 1])}${input(`s${i}v`, "Value", ["$485K", "41", "1,920"][i - 1])}</div>`).join("");
      h += input("source", "Source (required with stats)", "Source: ARMLS, October 2026");
    }
    if (st.realtor) h += input("brokerage", "Brokerage as it should appear", "Brokerage name");
    $("#cb-fields").innerHTML = h;
    if (st.realtor && st.f.brokerage == null) $("[data-f='brokerage']").value = st.realtor.office || "";
    $$("#cb-fields [data-f]").forEach((el) => el.addEventListener("input", () => { st.f[el.dataset.f] = el.value; render(); }));
    $$("#cb-fields [data-pick]").forEach((el) => el.addEventListener("change", () => {
      const l = (el.dataset.pick === "active" ? st.listings : st.sold)[Number(el.value)];
      if (!l) return;
      st.f.address = title(l.address); st.f.city = [title(l.city), l.state].filter(Boolean).join(", ");
      st.f.price = el.dataset.pick === "active" ? (l.list_price ? "$" + Math.round(l.list_price).toLocaleString("en-US") : "") : "";
      drawFields(); render();
    }));
  }

  // ---------- preview ----------
  let renderTimer;
  function render() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const stage = $("#cb-stage");
      if (!st.lo || !st.realtor) { stage.innerHTML = `<div class="empty">Pick a loan officer and a realtor to start.</div>`; drawCheck(); return; }
      if (!st.captionEdited) $("#cb-caption").value = caption();
      const [w, hgt] = SIZES[st.format];
      const maxW = Math.min(stage.clientWidth || 560, 620), maxH = 720;
      const k = Math.min(maxW / w, maxH / hgt);
      stage.innerHTML = `<div class="cb-scale" style="width:${w * k}px;height:${hgt * k}px"><div style="transform:scale(${k});transform-origin:0 0;width:${w}px;height:${hgt}px">${assetHTML()}</div></div>`;
      drawCheck();
    }, 60);
  }
  function drawCheck() {
    const c = checks(), blocked = c.some((x) => x.lvl === "block");
    $("#cb-check").innerHTML = `<div class="cb-check-head"><h3>Compliance check</h3><span class="pill ${blocked ? "bad" : "ok"}">${blocked ? "Fix before posting" : "Clear to post"}</span></div>
      <ul class="cb-checks">${c.map((x) => `<li class="${x.lvl}">${esc(x.text)}</li>`).join("")}</ul>
      <p class="muted small" style="margin:8px 0 0">This catches the common issues. Anything paid, printed in volume or unusual still goes to Compliance first.</p>`;
    $("#cb-png").disabled = $("#cb-pdf").disabled = blocked || !st.lo || !st.realtor;
  }

  // ---------- export ----------
  async function snapshot() {
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-20000px;top:0;";
    holder.innerHTML = assetHTML();
    document.body.appendChild(holder);
    try {
      await document.fonts?.ready;
      await Promise.all($$("img", holder).map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      return await window.html2canvas(holder.firstElementChild, { scale: st.format === "letter" ? 2 : 1, backgroundColor: null, useCORS: true, logging: false });
    } finally { holder.remove(); }
  }
  const fileBase = () => [st.type.replace(/_/g, "-"), (st.realtor?.name || "").split(" ").pop(), (st.lo?.name || "").split(" ").pop()].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  async function logAsset() {
    await sb.from("arm_cobrand_assets").insert({ originator_nmls: st.lo.nmls, mmi_agent_id: st.realtor.id, realtor_name: st.realtor.name, template: st.type, format: st.format, headline: val("headline"), cost_split: val("cost") });
    loadRecent();
  }
  async function download(kind) {
    if (checks().some((x) => x.lvl === "block")) return;
    const s = $("#cb-status"); s.textContent = "Rendering…";
    try {
      const canvas = await snapshot();
      if (kind === "png") {
        const a = document.createElement("a"); a.download = `${fileBase()}.png`; a.href = canvas.toDataURL("image/png"); a.click();
      } else {
        const { jsPDF } = window.jspdf;
        const [w, h] = SIZES[st.format];
        const pdf = st.format === "letter" ? new jsPDF({ unit: "in", format: "letter" }) : new jsPDF({ unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
        const img = canvas.toDataURL("image/jpeg", 0.95);
        if (st.format === "letter") pdf.addImage(img, "JPEG", 0, 0, 8.5, 11); else pdf.addImage(img, "JPEG", 0, 0, w, h);
        pdf.save(`${fileBase()}.pdf`);
      }
      s.textContent = "";
      await logAsset();
    } catch (e) { s.textContent = `Couldn't render: ${e.message}`; }
  }

  // ---------- data ----------
  async function pickLo() {
    const nmls = A.parseId(val("lo"));
    const roster = await A.getRoster();
    if (!nmls || !roster.has(nmls)) return;
    if (st.lo?.nmls === nmls) return;
    const { data: lo } = await sb.from("arm_loan_officers").select("nmls_id,full_name,email,mobile_phone,office_phone,office_city,office_state").eq("nmls_id", nmls).maybeSingle();
    st.lo = { nmls, name: lo?.full_name || A.loName(nmls), email: lo?.email || "", phone: lo?.mobile_phone || lo?.office_phone || "" };
    st.realtor = null; st.listings = []; st.sold = []; st.f = {};
    const sel = form().elements.realtor;
    sel.disabled = true; sel.innerHTML = `<option>Loading realtors…</option>`;
    const rows = await A.fetchAll(() => sb.from("arm_lo_realtor_detail").select("mmi_agent_id,full_name,office_name,email,phone,lo_total_units,lo14_buyer_units,lo14_listing_units").eq("originator_nmls", nmls));
    // One entry per person (Model Match can hold duplicate profiles).
    const by = new Map();
    rows.forEach((r) => {
      const k = String(r.full_name || "").toLowerCase().replace(/[^a-z]/g, "");
      if (!k) return;
      const cur = by.get(k) || { id: r.mmi_agent_id, ids: [], name: title(r.full_name), office: title(r.office_name), email: r.email || "", phone: r.phone || "", deals: 0, d14: 0 };
      cur.ids.push(r.mmi_agent_id); cur.deals += Number(r.lo_total_units || 0); cur.d14 += Number(r.lo14_buyer_units || 0) + Number(r.lo14_listing_units || 0);
      if (!cur.email && r.email) cur.email = r.email; if (!cur.phone && r.phone) cur.phone = r.phone; if (!cur.office && r.office_name) cur.office = title(r.office_name);
      by.set(k, cur);
    });
    st.realtors = [...by.values()].sort((a, b) => b.d14 - a.d14 || b.deals - a.deals || a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">${st.realtors.length ? `Pick from ${first(st.lo.name)}'s ${st.realtors.length} realtors` : "No realtor relationships on file"}</option>` +
      st.realtors.map((r, i) => `<option value="${i}">${esc(r.name)}${r.office ? " · " + esc(r.office) : ""} (${r.d14 ? `${r.d14} in 14 mo` : `${r.deals} all time`})</option>`).join("");
    sel.disabled = !st.realtors.length;
    drawFields(); render();
  }
  async function pickRealtor() {
    const r = st.realtors[Number(form().elements.realtor.value)];
    st.realtor = r || null; st.f = {}; st.listings = []; st.sold = [];
    if (r) {
      const [{ data: ls }, { data: sold }] = await Promise.all([
        sb.from("arm_realtor_listings").select("address,city,state,list_price,list_date").in("mmi_agent_id", r.ids).order("list_date", { ascending: false }),
        sb.from("arm_lo_realtor_loans").select("address,city,state,mortgage_date,mortgage_amount").eq("originator_nmls", st.lo.nmls).in("mmi_agent_id", r.ids).order("mortgage_date", { ascending: false }).limit(25),
      ]);
      st.listings = ls || [];
      const seen = new Set();
      st.sold = (sold || []).filter((x) => { const k = `${x.address}|${x.mortgage_date}`; if (seen.has(k)) return false; seen.add(k); return true; });
    }
    const d = defaults();
    form().elements.headline.value = d.h; form().elements.body.value = d.b;
    st.captionEdited = false;
    drawFields(); render();
  }
  async function loadRecent() {
    const { data } = await sb.from("arm_cobrand_assets").select("*").order("created_at", { ascending: false }).limit(20);
    $("#cb-recent").innerHTML = (data || []).length
      ? `<thead><tr><th>Made</th><th>By</th><th>Loan officer</th><th>Realtor</th><th>Asset</th></tr></thead><tbody>` +
        data.map((x) => `<tr><td class="muted nowrap">${date(x.created_at)}</td><td>${esc(x.made_by || "")}</td><td>${esc(A.loName(x.originator_nmls))}</td><td>${esc(x.realtor_name || "")}</td><td>${esc(TYPES[x.template]?.label || x.template)} · ${esc(FORMAT_LABEL[x.format] || x.format)}</td></tr>`).join("") + `</tbody>`
      : `<tr><td class="empty">Nothing made yet.</td></tr>`;
  }

  function init() {
    if (st.inited) return;
    st.inited = true;
    const f = form();
    f.addEventListener("submit", (e) => e.preventDefault());
    f.elements.lo.addEventListener("change", pickLo);
    f.elements.lo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pickLo(); } });
    f.elements.realtor.addEventListener("change", pickRealtor);
    ["headline", "body"].forEach((n) => f.elements[n].addEventListener("input", render));
    f.elements.cost.addEventListener("change", render);
    $$(".cb-photo input", f).forEach((inp) => inp.addEventListener("change", () => {
      const file = inp.files?.[0]; const k = inp.dataset.photo;
      if (st.photos[k]) URL.revokeObjectURL(st.photos[k]);
      st.photos[k] = file ? URL.createObjectURL(file) : null;
      inp.closest(".cb-photo").classList.toggle("has", !!file);
      render();
    }));
    $("#cb-caption").addEventListener("input", () => { st.captionEdited = true; drawCheck(); });
    $("#cb-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#cb-caption").value); toast("Caption copied"); } catch (_) { $("#cb-caption").select(); } });
    $("#cb-png").addEventListener("click", () => download("png"));
    $("#cb-pdf").addEventListener("click", () => download("pdf"));
    window.addEventListener("resize", render);
    setType(st.type);
  }

  A.loaders.cobrand = async () => {
    init();
    const roster = await A.getRoster();
    $("#cb-lo-options").innerHTML = [...roster.values()].filter((r) => r.active).map((r) => `<option value="${esc(r.full_name)} (${esc(r.nmls_id)})"></option>`).join("");
    // An ARM with one LO starts with that LO picked.
    const mine = (A.me()?.los || []).map(String);
    if (!st.lo && mine.length === 1 && roster.has(mine[0])) { form().elements.lo.value = `${roster.get(mine[0]).full_name} (${mine[0]})`; await pickLo(); }
    render();
    loadRecent();
  };
});
