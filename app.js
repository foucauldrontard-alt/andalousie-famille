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
  const badge = (code, txt) => `<span class="badge b-${esc(code)}" title="${esc(txt)}">${esc(String(txt || "").replace(/\s*\(.*\)\s*$/, ""))}</span>`;
  const isUrl = u => /^https:\/\//.test(String(u || ""));
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2200); }

  const STATUS = {
    "choisi": "valide", "reserve": "valide", "devis recu": "devis", "relance": "relance", "en attente": "attente",
    "a contacter": "a_contacter", "decline": "refus", "ecarte": "refus", "contacte": "contacte", "repere": "identifie",
    "recommande": "recommande", "a reserver": "a_lancer", "a planifier": "a_lancer", "apres le logement": "bloque", "si maroc": "reserve"
  };
  const isPast = t => /^(annule|decline|ecarte|abandonne)/.test(norm(t));
  const code = t => isPast(t) ? "refus" : (STATUS[norm(t)] || "attente");
  const isActivite = c => /^(sorties?|activites?)$/.test(norm(c));
  const SRC = { whatsapp: ["W", "WhatsApp"], mail: ["@", "Mail"], drive: ["D", "Drive"], autre: ["•", ""] };
  const PLAN_COLS = [{ k: "À lancer", c: "#B9AC9E" }, { k: "En attente logement", c: "#D98A6A" }, { k: "En cours", c: "#D9A440" }, { k: "Validé", c: "#5E7A3A" }];

  /* ---------- chargement ---------- */
  let D = null, filters = { src: "tout", pays: "tous", cat: "toutes", statut: "En cours" };
  async function load(quiet) {
    if (!quiet) $("#loading").style.display = "";
    try {
      const [infos, fil, dec, todo, heb, pre, plan, part, pts, vols] = await Promise.all([
        opt("Infos"), opt("Fil"), opt("Décisions"), opt("À faire"), opt("Hébergements"), opt("Prestataires"),
        opt("Plan (fichier de Noé)"), opt("Participants (fichier de Noé)"), opt("Point du jour"), opt("Vols")
      ]);
      if (!infos.length && !fil.length && !heb.length) throw new Error("vide");
      const I = {}; const liens = [];
      infos.forEach(r => { const k = (r["Clé"] || "").trim(), v = (r["Valeur"] || "").trim(); if (!k) return; if (/^lien/i.test(k)) { if (isUrl(v)) liens.push({ nom: r["Explication"] || k.replace(/^lien\s*:?\s*/i, ""), url: v }); } else I[k] = v; });
      D = { I, liens, fil, dec, todo, heb, pre, plan, part, pts, vols };
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
    const actsPast = acts.filter(a => isPast(a.statut));
    acts.splice(0, acts.length, ...acts.filter(a => !isPast(a.statut)));
    const nAct = acts.length || 1;
    $("#h-bar").innerHTML = PLAN_COLS.slice().reverse().map(c => { const k = acts.filter(a => a.statut === c.k).length; return k ? `<i style="width:${k / nAct * 100}%;background:${c.c}" title="${esc(c.k)} : ${k}"></i>` : ""; }).join("");
    $("#h-legend").innerHTML = PLAN_COLS.slice().reverse().map(c => `<span style="--c:${c.c}">${esc(c.k)} · ${acts.filter(a => a.statut === c.k).length}</span>`).join("");

    /* décisions */
    const decs = dec.map(x => ({ q: x["Question"], ctx: x["Contexte"], par: x["Posée par"], le: x["Date"], ok: norm(x["Statut"]) === "tranchee", rep: x["Décision"] })).filter(x => x.q);
    const open = decs.filter(x => !x.ok), closed = decs.filter(x => x.ok);
    $("#dec-count").textContent = open.length ? `${open.length} question${open.length > 1 ? "s" : ""} ouverte${open.length > 1 ? "s" : ""}` : "";
    $("#decisions").innerHTML = open.map(x => `<div class="card decision"><div class="q">${esc(x.q)}</div><div class="small">${esc(x.ctx)}</div><div class="meta">${x.par ? "Posée par " + esc(x.par) : ""}${x.le ? " · " + fDay(parseD(x.le)) : ""}</div></div>`).join("")
      || `<p class="empty">Rien à trancher pour le moment.</p>`;
    const tab = document.querySelector('[data-v="accueil"]'); tab.querySelector(".n")?.remove();
    if (open.length) tab.insertAdjacentHTML("beforeend", `<span class="n">${open.length}</span>`);

    /* point du jour (dernier en date, affiché 36 h) */
    const pt = (D.pts || []).map(r => ({ le: r["Date"], d: parseD(r["Date"]), txt: String(r["Point"] || "").trim() })).filter(r => r.d && r.txt).sort((a, b) => b.d - a.d)[0];
    const fresh = pt && (Date.now() - pt.d.getTime()) < 36 * 36e5;
    $("#point").hidden = !fresh;
    if (fresh) {
      $("#point-date").textContent = fDayLong(pt.d);
      $("#point-txt").innerHTML = esc(pt.txt).replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
      $("#point-wa").href = "https://wa.me/?text=" + encodeURIComponent(pt.txt);
      $("#point-copy").onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(pt.txt) : Promise.reject()).then(() => toast("Copié : à coller dans WhatsApp"), () => toast("Copie impossible"));
    }

    /* à faire */
    const todos = todo.map(t => ({ q: t["Tâche"], qui: t["Qui"], av: t["Avant le"], fait: norm(t["Fait"]) === "oui" })).filter(t => t.q);
    $("#todo").innerHTML = todos.filter(t => !t.fait).map(t => `<li class="${t.fait ? "done" : ""}"><span class="box"></span><div><div class="t">${esc(t.q)}</div><div class="who">${esc(t.qui)}${t.av ? ` · avant le ${fDay(parseD(t.av))}` : ""}</div></div></li>`).join("") || `<li class="empty">Rien en attente.</li>`;

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
    const L = heb.map(h => ({ nom: h["Nom"], lieu: h["Lieu"], pays: h["Pays"] || "", st: h["Statut"], c: code(h["Statut"]), cap: h["Le lieu"], prix: h["Prix"], repas: h["Repas"], notes: h["À savoir"], contact: h["Contact"], lien: h["Lien du devis"], site: h["Site"], photo: h["Photo"], avis: h["Avis de Claude"] })).filter(h => h.nom);
    const Lpast = L.filter(h => isPast(h.st));
    L.splice(0, L.length, ...L.filter(h => !isPast(h.st)));
    const cnt = k => L.filter(x => x.c === k).length;
    const stats = [[cnt("valide") ? cnt("valide") : cnt("devis"), cnt("valide") ? "lieu choisi" : "devis reçu" + (cnt("devis") > 1 ? "s" : "")], [cnt("attente") + cnt("relance"), "en attente de réponse"], [L.length, "lieux encore en lice"], [Lpast.length, "annulés ou déclinés"]];
    $("#lodge-stats").innerHTML = $("#lodge-stats2").innerHTML = stats.map(([k, l]) => `<div class="stat"><b>${k}</b><span>${l}</span></div>`).join("");
    const order = { valide: 0, devis: 1, relance: 2, attente: 3, a_contacter: 4, refus: 9 };
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
    const photo = h => isUrl(h.photo) ? `<a class="ph" href="${esc(isUrl(h.site) ? h.site : h.photo)}" target="_blank" rel="noopener"><img src="${esc(h.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"><span>Photo : ${esc(host(isUrl(h.site) ? h.site : h.photo))}</span></a>` : "";
    const links = h => { const a = []; if (isUrl(h.site)) a.push(`<a href="${esc(h.site)}" target="_blank" rel="noopener">Voir le site ↗</a>`); if (isUrl(h.lien)) a.push(`<a href="${esc(h.lien)}" target="_blank" rel="noopener">Voir le devis ↗</a>`); return a.length ? `<div class="lk">${a.join("")}</div>` : ""; };
    function drawLodges() {
      $("#lodges").innerHTML = L.filter(x => filters.pays === "tous" || x.pays === filters.pays).sort((a, b) => (order[a.c] ?? 5) - (order[b.c] ?? 5)).map(h => `<div class="card lodge fold ${h.c === "refus" ? "refus" : ""} ${h.c === "devis" || h.c === "valide" ? "devis" : ""}">
        ${photo(h)}<div class="top"><div>${h.pays ? `<div class="flag">${esc(h.pays)}</div>` : ""}<h3>${esc(h.nom)}</h3><div class="where">${esc(h.lieu)}</div></div>${h.st ? badge(h.c, h.st) : ""}</div>
        ${h.avis ? `<div class="avis"><b>L'avis de Claude</b>${esc(h.avis)}</div>` : ""}
        <dl class="kv">${kv("Prix", h.prix, true, false, true)}${kv("Le lieu", h.cap)}${kv("Repas", h.repas)}${kv("À savoir", h.notes)}${kv("Contact", h.contact, false, true)}</dl><span class="more">Voir le détail ▾</span>
        ${links(h)}</div>`).join("") || `<p class="empty">Aucun lieu.</p>`;
    }
    const paysL = [...new Set(L.map(x => x.pays).filter(Boolean))];
    $("#lodge-filters").style.display = paysL.length > 1 ? "" : "none";
    if (paysL.length < 2) filters.pays = "tous";
    chips("#lodge-filters", [["tous", "Tous"], ...paysL.map(p => [p, p])], "pays", drawLodges);
    drawLodges();

    /* prestataires */
    const P = pre.map(p => ({ cat: p["Catégorie"] || "Autres", nom: p["Nom"], zone: p["Zone"], st: p["Statut"], c: code(p["Statut"]), offre: p["Offre"], prix: p["Prix"], notes: p["À savoir"], contact: p["Contact"] })).filter(p => p.nom);
    const Ppast = P.filter(p => isPast(p.st)), Pact = P.filter(p => !isPast(p.st) && isActivite(p.cat));
    P.splice(0, P.length, ...P.filter(p => !isPast(p.st) && !isActivite(p.cat)));
    const presCard = p => `<div class="card lodge fold ${p.c === "refus" ? "refus" : ""}">
      <div class="top"><div><h3>${esc(p.nom)}</h3><div class="where">${esc(p.zone)}</div></div>${p.st ? badge(p.c, p.st) : ""}</div>
      <dl class="kv">${kv("Offre", p.offre, false, false, true)}${kv("Prix", p.prix, true, false, true)}${kv("À savoir", p.notes)}${kv("Contact", p.contact, false, true)}</dl><span class="more">Voir le détail ▾</span></div>`;
    const intro = { "Repas": "Demi-pension de l'hôtel ou chef à domicile", "Garde d'enfants": "Pour quelques demi-journées entre adultes", "Transport": "Se réserve une fois le lieu choisi", "Sorties": "Autour de Ronda" };
    $("#presta").innerHTML = [...new Set(P.map(p => p.cat))].map(cat => `<div class="sec-h"><h2>${esc(cat)}</h2><span class="aside">${esc(intro[cat] || "")}</span></div><div class="grid g2">${P.filter(p => p.cat === cat).map(presCard).join("")}</div>`).join("") || `<p class="empty">Aucun prestataire.</p>`;

    /* vols */
    drawVols(D.vols || []);

    /* activités */
    $("#activites").innerHTML = Pact.map(presCard).join("") || `<p class="empty">Aucune activité pour le moment.</p>`;
    const actPlan = acts.filter(a => isActivite(a.cat));
    $("#act-plan").innerHTML = actPlan.length ? `<div class="sec-h"><h2>À organiser</h2><span class="aside">Actions du plan</span></div><div class="grid g2">${actPlan.map(a => `<div class="act"><div class="ref">${esc(a.ref)} · ${esc(a.statut)}${a.prio ? ` · <span class="prio ${esc(a.prio)}">${esc(a.prio)}</span>` : ""}</div><div class="a">${esc(a.action)}</div>${a.notes ? `<div class="n">${esc(a.notes)}</div>` : ""}</div>`).join("")}</div>` : "";

    /* passé / annulé */
    const pastBlock = (titre, html) => html ? `<div class="past-sec"><div class="sec-h"><h2>${titre}</h2></div>${html}</div>` : "";
    $("#passe").innerHTML = [
      pastBlock("Décisions prises", closed.length ? `<div class="grid g2">${closed.map(x => `<div class="card decision" style="border-left-color:var(--olive)"><div class="q">${esc(x.q)}</div><div class="small"><b>Décidé :</b> ${esc(x.rep)}</div>${x.le ? `<div class="meta">${fDay(parseD(x.le))}</div>` : ""}</div>`).join("")}</div>` : ""),
      pastBlock("Tâches faites", todos.some(t => t.fait) ? `<div class="card"><ul class="todo">${todos.filter(t => t.fait).map(t => `<li class="done"><span class="box"></span><div><div class="t">${esc(t.q)}</div><div class="who">${esc(t.qui)}</div></div></li>`).join("")}</ul></div>` : ""),
      pastBlock("Hébergements annulés ou déclinés", Lpast.length ? `<div class="grid g2 past">${Lpast.map(h => `<div class="card lodge fold refus"><div class="top"><div>${h.pays ? `<div class="flag">${esc(h.pays)}</div>` : ""}<h3>${esc(h.nom)}</h3><div class="where">${esc(h.lieu)}</div></div>${badge("refus", h.st)}</div><dl class="kv">${kv("À savoir", h.notes, false, false, true)}${kv("Prix", h.prix)}${kv("Contact", h.contact, false, true)}</dl><span class="more">Voir le détail ▾</span>${links(h)}</div>`).join("")}</div>` : ""),
      pastBlock("Prestataires et activités annulés", Ppast.length ? `<div class="grid g2 past">${Ppast.map(presCard).join("")}</div>` : ""),
      pastBlock("Actions annulées", actsPast.length ? `<div class="grid g2 past">${actsPast.map(a => `<div class="act"><div class="ref">${esc(a.ref)} · ${esc(a.cat)} · ${esc(a.statut)}</div><div class="a">${esc(a.action)}</div>${a.notes ? `<div class="n">${esc(a.notes)}</div>` : ""}</div>`).join("")}</div>` : "")
    ].join("") || `<p class="empty">Rien d'annulé ni de terminé pour le moment.</p>`;

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
      $("#plan-status").innerHTML = PLAN_COLS.slice().reverse().map(c => `<button type="button" class="chip ${c.k === filters.statut ? "on" : ""}" data-k="${esc(c.k)}">${esc(c.k)} · ${list.filter(a => a.statut === c.k).length}</button>`).join("");
      $("#plan-status").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; filters.statut = b.dataset.k; drawPlan(); };
      $("#board").innerHTML = PLAN_COLS.map(c => { const items = list.filter(a => a.statut === c.k); return `<div class="col ${c.k === filters.statut ? "sel" : ""}"><h3><span style="border-bottom:3px solid ${c.c}">${esc(c.k)}</span><em>${items.length}</em></h3>${items.map(card).join("") || `<div class="small empty">—</div>`}</div>`; }).join("");
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
      lines.push(`🏡 Logement : ${cnt("devis")} devis reçu(s), ${cnt("attente") + cnt("relance")} en attente, ${Lpast.length} annulé(s) ou décliné(s).`);
      if (news.length) { lines.push("", "📰 Dernières nouvelles :"); news.slice(0, 4).forEach(x => lines.push(`• ${x.qui ? x.qui + " : " : ""}${x.titre}`)); }
      lines.push("", location.origin + location.pathname);
      const txt = lines.join("\n"); const ta = $("#copy-area"); ta.value = txt; ta.style.display = "block";
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copié : à coller dans WhatsApp"), () => { ta.select(); toast("Sélectionnez le texte puis copiez-le"); });
    };

    if (isUrl(I.chat) && $("#chat").hidden) $("#chat-fab").hidden = false;

    const m = parseD(I.maj);
    $("#foot").innerHTML = `Données lues en direct dans le Drive du projet${m ? ` · fil mis à jour le ${fDay(m)}${hasTime(I.maj) ? " à " + fTime(m) : ""}` : ""}. Pour corriger une info, modifiez le fichier dans le Drive : l'appli suivra.`;
  }

  /* ---------- vols ---------- */
  const euros = s => { const m = String(s || "").replace(/\s/g, "").match(/\d+/); return m ? +m[0] : 0; };
  function leg(label, txt) {
    const t = String(txt || "").trim(); if (!t) return "";
    const [day, rest] = t.includes("·") ? t.split("·").map(x => x.trim()) : ["", t];
    const ar = (rest || "").split("→").map(x => x.trim());
    const body = ar.length === 2
      ? `<span class="f-t">${esc(ar[0])}</span><span class="f-line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg></span><span class="f-t">${esc(ar[1])}</span>`
      : `<span class="f-txt">${esc(rest)}</span>`;
    return `<div class="f-leg"><span class="f-lbl">${label}</span><span class="f-day">${esc(day)}</span>${body}</div>`;
  }
  function tagFor(r) {
    const t = String(r || "").trim(); if (!t) return "";
    const n = norm(t); const c = /moins cher/.test(n) ? "cheap" : /plus cher/.test(n) ? "dear" : "info";
    return `<span class="f-tag ${c}">${esc(t)}</span>`;
  }
  function drawVols(rows) {
    const ALL = rows.map(r => ({ dep: (r["Départ"] || "").trim(), qui: r["Voyageurs"], opt: r["Option"], co: r["Compagnie"], aller: r["Aller"], retour: r["Retour"], pp: r["Prix / pers. A/R"], tot: r["Total groupe"], rep: r["Repère"], note: r["À savoir"], le: r["Relevé le"], dates: (r["Dates"] || "").trim() })).filter(r => r.dep && r.opt);
    const scen = [...new Set(ALL.map(r => r.dates).filter(Boolean))];
    const box = $("#vols-dates");
    box.hidden = scen.length < 2;
    if (scen.length > 1) {
      const totOf = s => (ALL.find(r => norm(r.dep) === "total" && r.dates === s) || {}).tot;
      chips("#vols-dates", scen.map(s => [s, totOf(s) ? `${s} · ${totOf(s)}` : s]), "dates", () => drawVols(rows));
    }
    const cur = scen.length > 1 ? filters.dates : (scen[0] || "");
    const V = ALL.filter(r => !r.dates || !cur || r.dates === cur);
    if (!V.length) { $("#vols").innerHTML = `<p class="empty">Les options de vol arrivent bientôt.</p>`; $("#vols-aside").textContent = ""; return; }
    const special = ["total", "trajet", "a savoir"];
    const flights = V.filter(r => !special.includes(norm(r.dep)));
    const total = V.find(r => norm(r.dep) === "total");
    const trajets = V.filter(r => norm(r.dep) === "trajet");
    const tips = V.filter(r => norm(r.dep) === "a savoir");
    const le = (V.find(r => r.le) || {}).le;
    $("#vols-aside").textContent = le ? `Prix relevés le ${le}` : "";
    const max = Math.max(1, ...ALL.filter(r => !special.includes(norm(r.dep))).map(r => euros(r.tot)));
    const groups = [...new Set(flights.map(r => r.dep))];
    let html = "";
    if (total) html += `<div class="card vols-total"><div><div class="vt-lbl">${esc(total.opt)}</div><div class="vt-num">${esc(total.tot)}</div>${total.note ? `<div class="vt-note">${esc(total.note)}</div>` : ""}</div>
      <div class="vt-dest"><span>Arrivée</span><b>Málaga</b><small>${esc((cur || "Mer. 24 → dim. 28").toLowerCase())} févr.</small></div></div>`;
    groups.forEach(g => {
      const list = flights.filter(r => r.dep === g);
      const qui = (list.find(r => r.qui) || {}).qui || "";
      html += `<div class="sec-h vols-h"><h2>Depuis ${esc(g)}</h2><span class="aside">${esc(qui)}</span></div><div class="grid g2">`;
      html += list.map(r => {
        const t = euros(r.tot), cheap = /moins cher/.test(norm(r.rep));
        return `<div class="card flight${cheap ? " cheap" : ""}">
          <div class="f-top"><div><div class="f-co">${esc(r.co)}</div><h3>${esc(r.opt)}</h3></div>${tagFor(r.rep)}</div>
          <div class="f-legs">${leg("Aller", r.aller)}${leg("Retour", r.retour)}</div>
          ${r.pp || r.tot ? `<div class="f-price"><div><b>${esc(r.pp)}</b><span>par personne, aller-retour</span></div>${r.tot ? `<div class="r"><b>${esc(r.tot)}</b><span>pour ce groupe</span></div>` : ""}</div>
          ${t ? `<div class="f-bar" title="Total pour le groupe"><i style="width:${Math.max(4, t / max * 100)}%"></i></div>` : ""}` : ""}
          ${r.note ? `<div class="f-note">${esc(r.note)}</div>` : ""}</div>`;
      }).join("") + `</div>`;
    });
    if (trajets.length) html += `<div class="sec-h vols-h"><h2>De l'aéroport à l'hôtel</h2><span class="aside">Selon l'hôtel choisi</span></div><div class="grid g2">${trajets.map(r => `<div class="card trajet"><div class="tr-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6 17V9.5L8 6h8l2 3.5V17M6 12h12"/><circle cx="8" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/></svg></div><div><h3>${esc(r.opt)}</h3><div class="tr-dur">${esc(r.aller)}</div>${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ""}</div></div>`).join("")}</div>`;
    if (tips.length) html += `<div class="sec-h vols-h"><h2>Bon à savoir</h2></div><div class="card"><ul class="tips">${tips.map(r => `<li>${esc(r.opt)}</li>`).join("")}</ul></div>`;
    $("#vols").innerHTML = html;
  }

  function kv(label, val, bold, muted, keep) {
    const v = String(val || "").trim(); if (!v || v === "—") return "";
    const k = keep ? ' class="keep"' : "";
    const body = muted ? linkify(v) : (bold ? `<b>${esc(v)}</b>` : esc(v));
    return `<dt${k}>${label}</dt><dd${k}${muted ? ' style="color:var(--muted)"' : ""}>${body}</dd>`;
  }
  function linkify(v) {
    return esc(v).replace(/([\w.+-]+@[\w-]+\.[\w.-]+)|(\+\d[\d ]{7,}\d)/g, (m, mail, tel) =>
      mail ? `<a class="tap" href="mailto:${mail}">${mail}</a>` : `<a class="tap" href="tel:${tel.replace(/ /g, "")}">${tel}</a>`);
  }
  function chips(sel, items, key, redraw) {
    const el = $(sel);
    if (!items.some(([k]) => k === filters[key])) filters[key] = items[0][0];
    el.innerHTML = items.map(([k, l]) => `<button type="button" class="chip ${k === filters[key] ? "on" : ""}" data-k="${esc(k)}">${esc(l)}</button>`).join("");
    el.onclick = e => { const b = e.target.closest(".chip"); if (!b) return; filters[key] = b.dataset.k; [...el.children].forEach(c => c.classList.toggle("on", c === b)); redraw(); };
  }


  /* ---------- chat avec Claude ---------- */
  const CHAT_STORE = "andalousie_chat";
  let chatLog = [];
  try { chatLog = JSON.parse(sessionStorage.getItem(CHAT_STORE) || "[]"); } catch (e) { chatLog = []; }
  let chatBusy = false;
  const SUGG = ["Compare les hébergements reçus", "Qu'est-ce qui reste à décider en priorité ?", "Propose un programme jour par jour", "Combien ça coûte par famille ?", "Rédige un message de relance pour un hôtel"];

  function md(src) {
    const lines = esc(src).split("\n"); let html = "", list = null, para = [];
    const inline = t => t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const flushP = () => { if (para.length) { html += `<p>${inline(para.join("<br>"))}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flushP(); flushL();
        const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
        let t = `<div class="tbl"><table><thead><tr>${cells(l).map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>`;
        i += 2; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += `<tr>${cells(lines[i]).map(c => `<td>${c}</td>`).join("")}</tr>`; i++; }
        i--; html += t + "</tbody></table></div>"; continue;
      }
      let m;
      if ((m = l.match(/^\s*#{1,4}\s+(.*)/))) { flushP(); flushL(); html += `<h3>${inline(m[1])}</h3>`; continue; }
      if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== "ul") { flushL(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== "ol") { flushL(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
      if (!l.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(l);
    }
    flushP(); flushL(); return html;
  }

  function contexte() {
    if (!D) return "";
    const { I, fil, dec, todo, heb, pre, plan, part } = D;
    const row = (o, keys) => keys.map(k => o[k] ? `${k} : ${o[k]}` : "").filter(Boolean).join(" ; ");
    const out = [];
    out.push(`Aujourd'hui : ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`);
    out.push(`Séjour : ${I.titre || ""}, du ${I.debut || "?"} au ${I.fin || "?"}, ${I.lieu || ""}`);
    out.push("\n## Questions à décider\n" + dec.map(x => "- " + row(x, ["Question", "Contexte", "Posée par", "Statut", "Décision"])).join("\n"));
    out.push("\n## À faire\n" + todo.map(x => "- " + row(x, ["Tâche", "Qui", "Avant le", "Fait"])).join("\n"));
    out.push("\n## Hébergements\n" + heb.map(x => "- " + row(x, ["Nom", "Lieu", "Pays", "Statut", "Le lieu", "Prix", "Repas", "À savoir"])).join("\n"));
    out.push("\n## Prestataires\n" + pre.map(x => "- " + row(x, ["Catégorie", "Nom", "Zone", "Statut", "Offre", "Prix", "À savoir"])).join("\n"));
    out.push("\n## Vols\n" + (D.vols || []).map(x => "- " + row(x, ["Départ", "Option", "Compagnie", "Aller", "Retour", "Prix / pers. A/R", "Total groupe", "Repère", "À savoir", "Relevé le"])).join("\n"));
    out.push("\n## Plan d'action\n" + plan.map(x => "- " + row(x, ["Réf", "Catégorie", "Action / Tâche", "Responsable", "Priorité", "Statut", "Notes & Prochaines étapes"])).join("\n"));
    const foy = {}; part.forEach(p => { const f = p["Foyer"] || "?"; (foy[f] = foy[f] || []).push(`${p["Prénom"] || "?"} (${(p["Catégorie"] || "").toLowerCase()}, ${p["Âge (fév. 2027)"] || p["Âge"] || "?"})${p["Ville de départ"] ? ", départ " + p["Ville de départ"] : ""}${p["Chambre assignée"] ? ", " + p["Chambre assignée"] : ""}`); });
    out.push(`\n## Participants (${part.length})\n` + Object.entries(foy).map(([f, l]) => `- ${f} : ${l.join(" ; ")}`).join("\n"));
    const news = fil.slice().sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"]))).slice(0, 40);
    out.push("\n## Fil des nouvelles (récent d'abord)\n" + news.map(x => `- ${x["Date"]} · ${x["Source"]} · ${x["Qui"]} : ${x["Quoi"]}`).join("\n"));
    return out.join("\n");
  }

  function drawChat() {
    const log = $("#chat-log");
    log.innerHTML = (chatLog.length ? "" : `<div class="chat-intro">Posez une question sur le séjour : comparer les hôtels, estimer un budget par famille, proposer un programme, préparer un message… Claude lit les données de l'appli au moment de la question.</div>`)
      + chatLog.map((m, i) => m.role === "user" ? `<div class="msg user">${esc(m.content)}</div>` : m.role === "error" ? `<div class="msg err">${esc(m.content)}</div>` : `<div class="msg bot${m.pending ? " typing" : ""}">${md(m.content)}${!m.pending && m.content ? `<br><button type="button" class="copy-msg" data-i="${i}">Copier</button>` : ""}</div>`).join("");
    $("#chat-sugg").innerHTML = chatLog.length ? "" : SUGG.map(t => `<button type="button">${esc(t)}</button>`).join("");
    log.scrollTop = log.scrollHeight;
    $("#chat-send").disabled = chatBusy;
  }
  function saveChat() { try { sessionStorage.setItem(CHAT_STORE, JSON.stringify(chatLog.filter(m => !m.pending).slice(-30))); } catch (e) { /* rien */ } }

  async function ask(question) {
    if (chatBusy || !question.trim() || !D || !isUrl(D.I.chat)) return;
    chatBusy = true;
    chatLog = chatLog.filter(m => m.role !== "error");
    chatLog.push({ role: "user", content: question.trim() });
    const bot = { role: "assistant", content: "", pending: true }; chatLog.push(bot); drawChat();
    try {
      const messages = chatLog.filter(m => (m.role === "user" || m.role === "assistant") && !m.pending).map(m => ({ role: m.role, content: m.content }));
      const r = await fetch(D.I.chat, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: KEY, messages, contexte: contexte() }) });
      if (!r.ok) throw new Error(await r.text().catch(() => "") || "Erreur " + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", last = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut; while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
          const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
          if (!data) continue;
          try { const ev = JSON.parse(data); if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") bot.content += ev.delta.text; if (ev.type === "error") throw new Error(ev.error && ev.error.message || "erreur"); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
        if (Date.now() - last > 120) { drawChat(); last = Date.now(); }
      }
      bot.pending = false;
      if (!bot.content) throw new Error("Réponse vide.");
    } catch (e) {
      chatLog = chatLog.filter(m => m !== bot || bot.content);
      bot.pending = false;
      chatLog.push({ role: "error", content: (e && e.message && e.message.length < 200 ? e.message : "Claude n'a pas pu répondre.") + " Réessayez." });
    }
    chatBusy = false; saveChat(); drawChat();
  }

  function openChat() { $("#chat").hidden = false; $("#chat-fab").hidden = true; document.body.classList.add("chat-open"); drawChat(); if (!matchMedia("(max-width:720px)").matches) $("#chat-input").focus(); }
  function closeChat() { $("#chat").hidden = true; $("#chat-fab").hidden = false; document.body.classList.remove("chat-open"); }
  $("#chat-fab").onclick = openChat;
  $("#chat-close").onclick = closeChat;
  $("#chat-reset").onclick = () => { if (chatBusy) return; chatLog = []; saveChat(); drawChat(); };
  $("#chat-sugg").onclick = e => { const b = e.target.closest("button"); if (b) ask(b.textContent); };
  $("#chat-log").onclick = e => { const b = e.target.closest(".copy-msg"); if (!b) return; const t = chatLog[+b.dataset.i].content; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Copié"), () => toast("Copie impossible")); };
  const input = $("#chat-input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(max-width:720px)").matches) { e.preventDefault(); $("#chat-form").requestSubmit(); } });
  $("#chat-form").onsubmit = e => { e.preventDefault(); const q = input.value; if (!q.trim() || chatBusy) return; input.value = ""; input.style.height = "auto"; ask(q); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#chat").hidden) closeChat(); });

  /* ---------- navigation ---------- */
  const morePop = $("#more-pop"), moreBtn = $("#more-btn");
  morePop.innerHTML = [...document.querySelectorAll("#tabs a.more-item")].map(a => `<a href="#${a.dataset.v}" data-v="${a.dataset.v}">${a.querySelector("svg").outerHTML}<span>${a.querySelector(".l-long").innerHTML}</span></a>`).join("");
  const closeMore = () => { morePop.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); };
  moreBtn.onclick = e => { e.stopPropagation(); const open = morePop.hidden; morePop.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open)); };
  morePop.onclick = () => closeMore();
  document.addEventListener("click", e => { if (!morePop.hidden && !e.target.closest("#more-pop, #more-btn")) closeMore(); });

  function route() {
    const v = (location.hash || "#accueil").slice(1);
    const ok = document.getElementById("v-" + v) ? v : "accueil";
    document.querySelectorAll("section.view").forEach(s => s.classList.toggle("on", s.id === "v-" + ok));
    document.querySelectorAll("#tabs a, #more-pop a").forEach(a => a.classList.toggle("on", a.dataset.v === ok));
    moreBtn.classList.toggle("on", !!document.querySelector(`#tabs a.more-item[data-v="${ok}"]`));
  }
  window.addEventListener("hashchange", () => {
    route();
    const nav = $("nav.tabs");
    if (getComputedStyle(nav).position === "fixed") { const m = $("main"); if (window.scrollY > m.offsetTop - 10) window.scrollTo({ top: m.offsetTop - 10 }); }
    else if (window.scrollY > nav.offsetTop) window.scrollTo({ top: nav.offsetTop, behavior: "smooth" });
  });
  document.addEventListener("click", e => {
    const n = e.target.closest(".act .n"); if (n) n.classList.toggle("open");
    if (e.target.closest("a")) return;
    const f = e.target.closest(".fold"); if (f) f.classList.toggle("open");
  });
  $("#refresh").onclick = () => load(true).then(() => toast("À jour"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && D) load(true); });
  setInterval(() => { if (!document.hidden) load(true); }, 5 * 60 * 1000);

  route();
  load(false);
})();
