(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const STORE = "andalousie_cle";

  /* ---------- clé de la feuille de données ---------- */
  const params = new URLSearchParams(location.search);
  let KEY = params.get("k");
  try { if (KEY) localStorage.setItem(STORE, KEY); else KEY = localStorage.getItem(STORE); } catch (e) { /* stockage indisponible */ }
  if (!KEY || !/^[\w-]{20,}$/.test(KEY)) { $("#gate").hidden = false; return; }
  $("#app").hidden = false;

  /* ---------- lecture Google Sheets (JSONP gviz) ---------- */
  let n = 0;
  function sheet(name) {
    return new Promise((resolve, reject) => {
      const cb = "__andalousie" + (++n) + "_" + Date.now();
      const s = document.createElement("script");
      const timer = setTimeout(() => { done(); reject(new Error("délai dépassé")); }, 20000);
      function done() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
      window[cb] = r => {
        done();
        if (!r || r.status === "error") return reject(new Error((r && r.errors && r.errors[0] && r.errors[0].detailed_message) || "erreur de lecture"));
        const t = r.table, labels = t.cols.map(c => (c.label || "").trim());
        resolve(t.rows.map(row => {
          const o = {};
          labels.forEach((l, i) => { const c = row.c[i]; o[l] = c == null ? "" : (c.f != null ? String(c.f) : (c.v == null ? "" : String(c.v))); });
          return o;
        }).filter(o => Object.values(o).some(v => String(v).trim() !== "")));
      };
      s.onerror = () => { done(); reject(new Error("réseau")); };
      s.src = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(KEY)}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=1&sheet=${encodeURIComponent(name)}&_=${Date.now()}`;
      document.head.appendChild(s);
    });
  }
  const opt = name => sheet(name).catch(() => []);

  /* ---------- utilitaires ---------- */
  function parseD(s) {
    if (!s) return null; s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    return null;
  }
  const fDay = d => d ? `${d.getDate()} ${MOIS[d.getMonth()]}` : "";
  const fTime = d => d ? `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}` : "";
  const hasTime = s => /\d{1,2}:\d{2}/.test(String(s || ""));
  function fDayLong(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const diff = Math.round((today - x) / 864e5);
    if (diff === 0) return "Aujourd'hui"; if (diff === 1) return "Hier";
    const j = JOURS[d.getDay()]; return `${j[0].toUpperCase() + j.slice(1)} ${fDay(d)}`;
  }
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const badge = (code, txt) => `<span class="badge b-${esc(code)}">${esc(txt)}</span>`;
  const isUrl = u => /^https:\/\//.test(String(u || ""));
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2200); }

  const STATUS = {
    "choisi": "valide", "reserve": "valide", "devis recu": "devis", "relance": "relance", "en attente": "attente",
    "a contacter": "a_contacter", "decline": "refus", "ecarte": "refus", "contacte": "contacte", "repere": "identifie",
    "recommande": "recommande", "a reserver": "a_lancer", "a planifier": "a_lancer", "apres le logement": "bloque", "si maroc": "reserve"
  };
  const code = t => STATUS[norm(t)] || "attente";
  const SRC = { whatsapp: ["W", "WhatsApp"], mail: ["@", "Mail"], drive: ["D", "Drive"], autre: ["•", ""] };
  const PLAN_COLS = [{ k: "À lancer", c: "#B9AC9E" }, { k: "En attente logement", c: "#D98A6A" }, { k: "En cours", c: "#D9A440" }, { k: "Validé", c: "#5E7A3A" }];

  /* ---------- chargement ---------- */
  let D = null, filters = { src: "tout", pays: "tous", cat: "toutes" };
  async function load(quiet) {
    if (!quiet) $("#loading").style.display = "";
    try {
      const [infos, fil, dec, todo, heb, pre, plan, part] = await Promise.all([
        opt("Infos"), opt("Fil"), opt("Décisions"), opt("À faire"), opt("Hébergements"), opt("Prestataires"),
        opt("Plan (fichier de Noé)"), opt("Participants (fichier de Noé)")
      ]);
      if (!infos.length && !fil.length && !heb.length) throw new Error("vide");
      const I = {}; const liens = [];
      infos.forEach(r => { const k = (r["Clé"] || "").trim(), v = (r["Valeur"] || "").trim(); if (!k) return; if (/^lien/i.test(k)) { if (isUrl(v)) liens.push({ nom: r["Explication"] || k.replace(/^lien\s*:?\s*/i, ""), url: v }); } else I[k] = v; });
      D = { I, liens, fil, dec, todo, heb, pre, plan, part };
      $("#error").innerHTML = "";
      render();
    } catch (e) {
      if (!D) $("#error").innerHTML = `<div class="err">Impossible de charger les données pour le moment. Vérifiez votre connexion puis touchez « Actualiser ».</div>`;
    } finally { $("#loading").style.display = "none"; }
  }

  /* ---------- rendu ---------- */
  function render() {
    const { I, fil, dec, todo, heb, pre, plan, part } = D;
    document.title = I.titre || "Andalousie en famille";
    $("#h-title").textContent = I.titre || "Andalousie en famille";
    $("#h-eyebrow").textContent = "Projet famille" + (I.lieu ? " · " + I.lieu : "");
    const start = parseD(I.debut), end = parseD(I.fin);
    if (start) {
      const nights = end ? Math.round((end - start) / 864e5) : null;
      $("#h-dates").textContent = `Du ${JOURS[start.getDay()]} ${start.getDate()}${end ? ` au ${JOURS[end.getDay()]} ${end.getDate()} ${MOIS_LONG[end.getMonth()]} ${end.getFullYear()}` : ""}${nights ? ` · ${nights} nuits` : ""}`;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.ceil((start - today) / 864e5);
      $("#h-days").textContent = days > 0 ? days : (days === 0 ? "J" : "🎉");
    }

    /* participants */
    const people = part.map(p => ({ foyer: p["Foyer"], prenom: p["Prénom"], cat: p["Catégorie"], age: p["Âge (fév. 2027)"] || p["Âge"] || "", ville: p["Ville de départ"], chambre: p["Chambre assignée"] || "" })).filter(p => p.prenom || p.foyer);
    const foyers = []; const byF = {};
    people.forEach(p => { if (!byF[p.foyer]) { byF[p.foyer] = { key: p.foyer, people: [] }; foyers.push(byF[p.foyer]); } byF[p.foyer].people.push(p); });
    foyers.forEach(f => {
      const adults = f.people.filter(p => norm(p.cat) === "adulte").map(p => p.prenom);
      f.nom = adults.length ? adults.join(" & ") : f.key;
      f.a = adults.length; f.e = f.people.filter(p => norm(p.cat) === "enfant").length; f.b = f.people.filter(p => norm(p.cat) === "bebe").length;
      f.depart = (f.people.find(p => p.ville) || {}).ville || "";
    });
    const tot = { a: 0, e: 0, b: 0 }; foyers.forEach(f => { tot.a += f.a; tot.e += f.e; tot.b += f.b; });
    const villes = [...new Set(people.map(p => (p.ville || "").split("/")[0].trim()).filter(Boolean))];
    $("#h-pills").innerHTML = [
      `<b>${people.length}</b> voyageurs`, `<b>${tot.a}</b> adultes`, `<b>${tot.e + tot.b}</b> enfants dont ${tot.b} bébés`, villes.length ? `Départs : ${esc(villes.join(", "))}` : ""
    ].filter(Boolean).map(x => `<span class="pill">${x}</span>`).join("");

    /* progression */
    const acts = plan.map(a => ({ ref: a["Réf"], cat: a["Catégorie"], action: a["Action / Tâche"], resp: a["Responsable"], prio: a["Priorité"], due: a["Échéance"], statut: (a["Statut"] || "").trim(), notes: a["Notes & Prochaines étapes"] })).filter(a => a.ref || a.action);
    const nAct = acts.length || 1;
    $("#h-bar").innerHTML = PLAN_COLS.slice().reverse().map(c => { const k = acts.filter(a => a.statut === c.k).length; return k ? `<i style="width:${k / nAct * 100}%;background:${c.c}" title="${esc(c.k)} : ${k}"></i>` : ""; }).join("");
    $("#h-legend").innerHTML = PLAN_COLS.slice().reverse().map(c => `<span style="--c:${c.c}">${esc(c.k)} · ${acts.filter(a => a.statut === c.k).length}</span>`).join("");

    /* décisions */
    const decs = dec.map(x => ({ q: x["Question"], ctx: x["Contexte"], par: x["Posée par"], le: x["Date"], ok: norm(x["Statut"]) === "tranchee", rep: x["Décision"] })).filter(x => x.q);
    const open = decs.filter(x => !x.ok), closed = decs.filter(x => x.ok);
    $("#dec-count").textContent = open.length ? `${open.length} question${open.length > 1 ? "s" : ""} ouverte${open.length > 1 ? "s" : ""}` : "";
    $("#decisions").innerHTML = open.map(x => `<div class="card decision"><div class="q">${esc(x.q)}</div><div class="small">${esc(x.ctx)}</div><div class="meta">${x.par ? "Posée par " + esc(x.par) : ""}${x.le ? " · " + fDay(parseD(x.le)) : ""}</div></div>`).join("")
      + closed.map(x => `<div class="card decision" style="border-left-color:var(--olive)"><div class="q">${esc(x.q)}</div><div class="small"><b>Décidé :</b> ${esc(x.rep)}</div></div>`).join("")
      || `<p class="empty">Rien à trancher pour le moment.</p>`;
    const tab = document.querySelector('[data-v="accueil"]'); tab.querySelector(".n")?.remove();
    if (open.length) tab.insertAdjacentHTML("beforeend", `<span class="n">${open.length}</span>`);

    /* à faire */
    const todos = todo.map(t => ({ q: t["Tâche"], qui: t["Qui"], av: t["Avant le"], fait: norm(t["Fait"]) === "oui" })).filter(t => t.q);
    $("#todo").innerHTML = todos.map(t => `<li class="${t.fait ? "done" : ""}"><span class="box"></span><div><div class="t">${esc(t.q)}</div><div class="who">${esc(t.qui)}${t.av ? ` · avant le ${fDay(parseD(t.av))}` : ""}</div></div></li>`).join("") || `<li class="empty">Rien en attente.</li>`;

    /* fil */
    const news = fil.map(r => ({ le: r["Date"], src: norm(r["Source"]) || "autre", qui: r["Qui"], titre: r["Quoi"], lien: r["Lien"] })).filter(r => r.titre)
      .map(r => ({ ...r, d: parseD(r.le), src: SRC[r.src] ? r.src : "autre" })).sort((a, b) => (b.d || 0) - (a.d || 0));
    const item = (x, withDay) => { const [ic, lbl] = SRC[x.src]; const when = [withDay ? fDay(x.d) : "", hasTime(x.le) ? fTime(x.d) : ""].filter(Boolean).join(", "); return `<li><span class="ico ${x.src === "mail" ? "gmail" : esc(x.src)}">${ic}</span><div class="when">${[when, lbl, esc(x.qui)].filter(Boolean).join(" · ")}</div><div class="what">${isUrl(x.lien) ? `<a href="${esc(x.lien)}" target="_blank" rel="noopener">${esc(x.titre)}</a>` : esc(x.titre)}</div></li>`; };
    $("#news-short").innerHTML = news.slice(0, 6).map(x => item(x, true)).join("") || `<li class="empty">Pas encore de nouvelles.</li>`;
    function drawNews() {
      let html = "", last = "";
      news.filter(x => filters.src === "tout" || x.src === filters.src).forEach(x => { const k = x.d ? x.d.toDateString() : ""; if (k !== last) { html += `<li class="day">${x.d ? fDayLong(x.d) : ""}</li>`; last = k; } html += item(x, false); });
      $("#news").innerHTML = html || `<li class="empty">Rien pour ce filtre.</li>`;
    }
    chips("#news-filters", [["tout", "Tout"], ["whatsapp", "WhatsApp"], ["mail", "Mails"], ["drive", "Drive"]], "src", drawNews);
    drawNews();

    /* logement */
    const L = heb.map(h => ({ nom: h["Nom"], lieu: h["Lieu"], pays: h["Pays"] || "", st: h["Statut"], c: code(h["Statut"]), cap: h["Le lieu"], prix: h["Prix"], repas: h["Repas"], notes: h["À savoir"], contact: h["Contact"], lien: h["Lien du devis"] })).filter(h => h.nom);
    const cnt = k => L.filter(x => x.c === k).length;
    const stats = [[cnt("valide") ? cnt("valide") : cnt("devis"), cnt("valide") ? "lieu choisi" : "devis reçu" + (cnt("devis") > 1 ? "s" : "")], [cnt("attente") + cnt("relance"), "en attente de réponse"], [cnt("refus"), "refusés ou écartés"], [L.length, "lieux suivis"]];
    $("#lodge-stats").innerHTML = $("#lodge-stats2").innerHTML = stats.map(([k, l]) => `<div class="stat"><b>${k}</b><span>${l}</span></div>`).join("");
    const order = { valide: 0, devis: 1, relance: 2, attente: 3, a_contacter: 4, refus: 9 };
    function drawLodges() {
      $("#lodges").innerHTML = L.filter(x => filters.pays === "tous" || x.pays === filters.pays).sort((a, b) => (order[a.c] ?? 5) - (order[b.c] ?? 5)).map(h => `<div class="card lodge ${h.c === "refus" ? "refus" : ""} ${h.c === "devis" || h.c === "valide" ? "devis" : ""}">
        <div class="top"><div>${h.pays ? `<div class="flag">${esc(h.pays)}</div>` : ""}<h3>${esc(h.nom)}</h3><div class="where">${esc(h.lieu)}</div></div>${h.st ? badge(h.c, h.st) : ""}</div>
        <dl class="kv">${kv("Le lieu", h.cap)}${kv("Prix", h.prix, true)}${kv("Repas", h.repas)}${kv("À savoir", h.notes)}${kv("Contact", h.contact, false, true)}</dl>
        ${isUrl(h.lien) ? `<a class="small" href="${esc(h.lien)}" target="_blank" rel="noopener">Voir le devis ↗</a>` : ""}</div>`).join("") || `<p class="empty">Aucun lieu.</p>`;
    }
    chips("#lodge-filters", [["tous", "Tous"], ...[...new Set(L.map(x => x.pays).filter(Boolean))].map(p => [p, p])], "pays", drawLodges);
    drawLodges();

    /* prestataires */
    const P = pre.map(p => ({ cat: p["Catégorie"] || "Autres", nom: p["Nom"], zone: p["Zone"], st: p["Statut"], c: code(p["Statut"]), offre: p["Offre"], prix: p["Prix"], notes: p["À savoir"], contact: p["Contact"] })).filter(p => p.nom);
    const intro = { "Repas": "Demi-pension de l'hôtel ou chef à domicile", "Garde d'enfants": "Pour quelques demi-journées entre adultes", "Transport": "Se réserve une fois le lieu choisi", "Sorties": "Autour de Ronda" };
    $("#presta").innerHTML = [...new Set(P.map(p => p.cat))].map(cat => `<div class="sec-h"><h2>${esc(cat)}</h2><span class="aside">${esc(intro[cat] || "")}</span></div><div class="grid g2">${P.filter(p => p.cat === cat).map(p => `<div class="card lodge ${p.c === "refus" ? "refus" : ""}">
      <div class="top"><div><h3>${esc(p.nom)}</h3><div class="where">${esc(p.zone)}</div></div>${p.st ? badge(p.c, p.st) : ""}</div>
      <dl class="kv">${kv("Offre", p.offre)}${kv("Prix", p.prix, true)}${kv("À savoir", p.notes)}${kv("Contact", p.contact, false, true)}</dl></div>`).join("")}</div>`).join("") || `<p class="empty">Aucun prestataire.</p>`;

    /* famille */
    $("#fam-aside").textContent = `${foyers.length} foyers`;
    $("#fam-stats").innerHTML = [[people.length, "personnes"], [tot.a, "adultes"], [tot.e, "enfants"], [tot.b, "bébés"]].map(([k, l]) => `<div class="stat"><b>${k}</b><span>${l}</span></div>`).join("");
    $("#foyers").innerHTML = foyers.map(f => `<div class="card foyer">
      <div><h3>${esc(f.nom)}</h3><div class="where small muted">Départ : ${esc(f.depart || "à préciser")}</div></div>
      <div class="counts"><span>${f.a} adulte${f.a > 1 ? "s" : ""}</span>${f.e ? `<span>${f.e} enfant${f.e > 1 ? "s" : ""}</span>` : ""}${f.b ? `<span>${f.b} bébé${f.b > 1 ? "s" : ""}</span>` : ""}</div>
      <div class="people">${f.people.map(p => `<span class="person ${esc(norm(p.cat) === "bebe" ? "Bébé" : norm(p.cat) === "enfant" ? "Enfant" : "")}">${esc(p.prenom && !/^[_\W]+$/.test(p.prenom) ? p.prenom : "Bébé")}<small>${esc(p.age)}</small></span>`).join("")}</div></div>`).join("") || `<p class="empty">Liste des participants indisponible.</p>`;

    /* plan */
    $("#plan-aside").textContent = `${acts.filter(a => a.statut === "Validé").length} validée(s) sur ${acts.length}`;
    function drawPlan() {
      const list = acts.filter(a => filters.cat === "toutes" || a.cat === filters.cat);
      const card = a => `<div class="act"><div class="ref">${esc(a.ref)} · ${esc(a.cat)}${a.prio ? ` · <span class="prio ${esc(a.prio)}">${esc(a.prio)}</span>` : ""}</div><div class="a">${esc(a.action)}</div>${a.notes ? `<div class="n">${esc(a.notes)}</div>` : ""}${a.resp ? `<div class="due">👤 ${esc(a.resp)}</div>` : ""}</div>`;
      $("#board").innerHTML = PLAN_COLS.map(c => { const items = list.filter(a => a.statut === c.k); return `<div class="col"><h3><span style="border-bottom:3px solid ${c.c}">${esc(c.k)}</span><em>${items.length}</em></h3>${items.map(card).join("") || `<div class="small empty">—</div>`}</div>`; }).join("");
      const other = list.filter(a => !PLAN_COLS.some(c => c.k === a.statut));
      if (other.length) $("#board").insertAdjacentHTML("beforeend", `<div class="col"><h3>Autres<em>${other.length}</em></h3>${other.map(card).join("")}</div>`);
    }
    chips("#plan-filters", [["toutes", "Toutes"], ...[...new Set(acts.map(a => a.cat).filter(Boolean))].map(c => [c, c])], "cat", drawPlan);
    drawPlan();

    /* documents */
    $("#links").innerHTML = D.liens.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.nom)}</a>`).join("") || `<p class="empty">Les liens sont dans le groupe WhatsApp.</p>`;

    /* copier le point */
    $("#copy-btn").onclick = () => {
      const lines = [`🌞 ${I.titre || "Andalousie"} · point du ${fDay(new Date())} (J-${$("#h-days").textContent})`, ""];
      if (open.length) { lines.push("❓ À décider :"); open.forEach(x => lines.push(`• ${x.q}`)); lines.push(""); }
      const td = todos.filter(t => !t.fait); if (td.length) { lines.push("✅ À faire :"); td.forEach(t => lines.push(`• ${t.q}${t.qui ? ` (${t.qui})` : ""}`)); lines.push(""); }
      lines.push(`🏡 Logement : ${cnt("devis")} devis reçu(s), ${cnt("attente") + cnt("relance")} en attente, ${cnt("refus")} refus.`);
      if (news.length) { lines.push("", "📰 Dernières nouvelles :"); news.slice(0, 4).forEach(x => lines.push(`• ${x.qui ? x.qui + " : " : ""}${x.titre}`)); }
      lines.push("", location.origin + location.pathname);
      const txt = lines.join("\n"); const ta = $("#copy-area"); ta.value = txt; ta.style.display = "block";
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copié : à coller dans WhatsApp"), () => { ta.select(); toast("Sélectionnez le texte puis copiez-le"); });
    };

    const m = parseD(I.maj);
    $("#foot").innerHTML = `Données lues en direct dans le Drive du projet${m ? ` · fil mis à jour le ${fDay(m)}${hasTime(I.maj) ? " à " + fTime(m) : ""}` : ""}. Pour corriger une info, modifiez le fichier dans le Drive : l'appli suivra.`;
  }

  function kv(label, val, bold, muted) {
    const v = String(val || "").trim(); if (!v || v === "—") return "";
    return `<dt>${label}</dt><dd${muted ? ' class="muted"' : ""}>${bold ? `<b>${esc(v)}</b>` : esc(v)}</dd>`;
  }
  function chips(sel, items, key, redraw) {
    const el = $(sel);
    if (!items.some(([k]) => k === filters[key])) filters[key] = items[0][0];
    el.innerHTML = items.map(([k, l]) => `<button type="button" class="chip ${k === filters[key] ? "on" : ""}" data-k="${esc(k)}">${esc(l)}</button>`).join("");
    el.onclick = e => { const b = e.target.closest(".chip"); if (!b) return; filters[key] = b.dataset.k; [...el.children].forEach(c => c.classList.toggle("on", c === b)); redraw(); };
  }

  /* ---------- navigation ---------- */
  function route() {
    const v = (location.hash || "#accueil").slice(1);
    const ok = document.getElementById("v-" + v) ? v : "accueil";
    document.querySelectorAll("section.view").forEach(s => s.classList.toggle("on", s.id === "v-" + ok));
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.v === ok));
  }
  window.addEventListener("hashchange", () => { route(); const nav = $("nav.tabs"); if (window.scrollY > nav.offsetTop) window.scrollTo({ top: nav.offsetTop, behavior: "smooth" }); });
  document.addEventListener("click", e => { const n = e.target.closest(".act .n"); if (n) n.classList.toggle("open"); });
  $("#refresh").onclick = () => load(true).then(() => toast("À jour"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && D) load(true); });
  setInterval(() => { if (!document.hidden) load(true); }, 5 * 60 * 1000);

  route();
  load(false);
})();
