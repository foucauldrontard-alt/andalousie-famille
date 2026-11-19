// Relais Cloudflare entre l'appli « Andalousie en famille » et l'API Claude.
// La clé API Anthropic reste ici, en secret (variable ANTHROPIC_API_KEY), jamais dans le site.
// Seule l'appli publiée peut l'appeler, et seulement avec la clé d'accès du lien partagé.

const ORIGINE = "https://foucauldrontard-alt.github.io";
// Empreinte SHA-256 de la clé d'accès « k » du lien partagé (la clé elle-même n'est pas dans ce code).
const EMPREINTE_CLE = "8f94f37b56f5cfe4396e387f465bed4b5c4b0bc00af607b9346fd8f2689ae129";
const MODELE = "claude-sonnet-5-5";
const MAX_QUESTIONS_PAR_JOUR = 150;

const CONSIGNES = `Tu es l'assistant de la famille pour l'organisation du séjour « Andalousie en famille » (24 au 28 février 2027, Serranía de Ronda).
Tu réponds en français, de façon claire et chaleureuse, à n'importe quel membre de la famille qui utilise l'appli de suivi.
Tu t'appuies d'abord sur les données du séjour ci-dessous (devis, prestataires, plan d'action, participants, décisions, fil des nouvelles). Tu peux aussi utiliser tes connaissances générales sur l'Andalousie, les voyages en famille avec de jeunes enfants et l'organisation de groupes.
Règles :
- N'invente jamais un prix, une disponibilité ou une réponse d'hôtel : si l'info n'est pas dans les données, dis-le et propose quoi demander.
- Pour comparer, fais un petit tableau en Markdown, puis une recommandation argumentée en quelques phrases.
- Ramène les coûts au groupe (13 adultes, enfants et bébés) quand c'est utile, en montrant le calcul.
- Reste neutre entre les familles ; les décisions appartiennent au groupe.
- Tu ne peux ni envoyer de message, ni réserver, ni modifier les fichiers : propose plutôt un texte prêt à copier.
- Sois concis : va à l'essentiel, avec des listes courtes.

DONNÉES DU SÉJOUR (lues dans l'appli au moment de la question) :
`;

let jour = "", compteur = 0;

async function sha256(texte) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": ORIGINE,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const repondre = (texte, status) => new Response(texte, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST" || req.headers.get("Origin") !== ORIGINE) return repondre("Accès réservé à l'appli.", 403);
    if (!env.ANTHROPIC_API_KEY) return repondre("Le relais n'a pas encore sa clé Anthropic.", 503);

    let corps;
    try { corps = await req.json(); } catch (e) { return repondre("Requête illisible.", 400); }
    if (typeof corps.k !== "string" || (await sha256(corps.k)) !== EMPREINTE_CLE) return repondre("Lien d'accès invalide.", 401);

    const aujourdhui = new Date().toISOString().slice(0, 10);
    if (aujourdhui !== jour) { jour = aujourdhui; compteur = 0; }
    if (++compteur > MAX_QUESTIONS_PAR_JOUR) return repondre("Limite de questions atteinte pour aujourd'hui. Réessayez demain.", 429);

    const messages = (Array.isArray(corps.messages) ? corps.messages : [])
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return repondre("Question manquante.", 400);
    while (messages[0].role !== "user") messages.shift();

    const contexte = String(corps.contexte || "").slice(0, 60000);
    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODELE || MODELE, max_tokens: 1800, system: CONSIGNES + contexte, messages, stream: true })
    });
    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => "");
      console.log("Erreur Anthropic", reponse.status, detail.slice(0, 300));
      return repondre(reponse.status === 401 ? "La clé Anthropic du relais est refusée." : reponse.status === 429 ? "Claude est très sollicité, réessayez dans une minute." : "Claude n'a pas pu répondre (" + reponse.status + ").", 502);
    }
    return new Response(reponse.body, { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
  }
};
