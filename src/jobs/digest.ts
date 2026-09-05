/**
 * Digest quotidien — a lancer a 07h30 (Europe/Paris).
 *
 *   npm run digest              envoie le digest
 *   npm run digest -- --dry-run affiche le digest sans rien envoyer
 */
import { creerClient, lireConfig } from '../config.ts';
import { envoyer, rendreHtml, rendreTexte, sujet, type ContenuDigest, type LigneDigest } from '../notify.ts';

const dryRun = process.argv.includes('--dry-run');

const db = creerClient();
const config = await lireConfig(db);

/** Un avis « engage » : deja marque a etudier ou a repondre. */
const ENGAGES = ['a_etudier', 'go'];

const [nouveaux, alertes, dernierRun] = await Promise.all([
  // Avis non encore arbitres, au-dessus du seuil de notification.
  db
    .from('avis_actifs')
    .select('objet, acheteur_nom, departement, metier, montant_estime, montant_inconnu, jours_restants, score, url_avis, url_dce, match_raison, artisans(nom)')
    .eq('nature', 'APPEL_OFFRE')
    .is('decision', null)
    .gte('score', config.score_seuil_notif)
    .order('score', { ascending: false })
    .limit(60),

  // Echeances proches sur les avis deja engages.
  db
    .from('avis_actifs')
    .select('objet, acheteur_nom, departement, metier, montant_estime, montant_inconnu, jours_restants, score, url_avis, url_dce, match_raison, artisans(nom)')
    .in('decision', ENGAGES)
    .not('date_limite', 'is', null)
    .lte('date_limite', dansNJours(5))
    .order('date_limite', { ascending: true }),

  db.from('runs').select('started_at, statut, avis_nouveaux, erreur').order('started_at', { ascending: false }).limit(1).maybeSingle(),
]);

for (const r of [nouveaux, alertes, dernierRun]) {
  if (r.error) throw new Error(`Lecture pour le digest : ${r.error.message}`);
}

const lignes = (nouveaux.data ?? []).map(versLigne);

const contenu: ContenuDigest = {
  prioritaires: lignes.filter((l) => (l.score ?? 0) >= config.score_seuil_prio),
  a_voir: lignes.filter((l) => (l.score ?? 0) < config.score_seuil_prio),
  alertes: (alertes.data ?? []).map(versLigne),
  // Ces avis-la disent ou le reseau manque de bras (spec §6.3).
  sans_artisan: lignes.filter((l) => l.artisan_nom === null && l.match_raison !== null).slice(0, 10),
  dernier_run: resumerRun(dernierRun.data),
};

const texte = rendreTexte(contenu);

if (dryRun) {
  console.log(texte);
  console.log('\n[dry-run] Aucun envoi effectue.');
} else if (contenu.prioritaires.length + contenu.a_voir.length + contenu.alertes.length === 0) {
  console.log('Rien a signaler : aucun envoi.');
} else {
  await envoyer(sujet(contenu), texte, rendreHtml(contenu));
  console.log(`Digest envoye : ${sujet(contenu)}`);
}

type LigneBrute = Record<string, unknown> & { artisans?: { nom: string } | { nom: string }[] | null };

function versLigne(r: LigneBrute): LigneDigest {
  const a = Array.isArray(r.artisans) ? r.artisans[0] : r.artisans;
  return {
    objet: (r.objet as string) ?? null,
    acheteur_nom: (r.acheteur_nom as string) ?? null,
    departement: (r.departement as string) ?? null,
    metier: (r.metier as string) ?? null,
    montant_estime: (r.montant_estime as number) ?? null,
    montant_inconnu: Boolean(r.montant_inconnu),
    jours_restants: (r.jours_restants as number) ?? null,
    score: (r.score as number) ?? null,
    url_avis: (r.url_avis as string) ?? null,
    url_dce: (r.url_dce as string) ?? null,
    artisan_nom: a?.nom ?? null,
    match_raison: (r.match_raison as string) ?? null,
  };
}

function resumerRun(r: { started_at?: string; statut?: string; avis_nouveaux?: number; erreur?: string } | null): string {
  if (!r) return 'aucun run enregistre';
  const q = new Date(r.started_at!).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  return `${q} — ${r.statut} — ${r.avis_nouveaux ?? 0} nouveaux${r.erreur ? ` — ${r.erreur}` : ''}`;
}

function dansNJours(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}
