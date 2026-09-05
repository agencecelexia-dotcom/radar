/**
 * Job d'ingestion — a lancer a 06h00 et 18h00 (Europe/Paris).
 *
 *   npm run ingest                          collecte incrementale depuis last_run
 *   npm run ingest -- --since 2026-08-05    rejoue une periode
 *   npm run ingest -- --dry-run --since ... n'ecrit rien, affiche le bilan
 */
import { creerClient, lireConfig, ecrireConfig, CONFIG_DEFAUT, type Config } from '../config.ts';
import { appliquerMiseAJour, fermerRun, lireArtisans, ouvrirRun, upserterAvis } from '../db.ts';
import { traiter, versLigne, versLigneAttribution, type Bilan } from '../pipeline.ts';
import { fetchAvisBruts } from '../sources/boamp.ts';
import type { Artisan } from '../match.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const since = valeurArg('--since');

/** Recouvrement de securite : on relit 2 jours avant le dernier run reussi. */
const RECOUVREMENT_JOURS = 2;

await principal();

async function principal(): Promise<void> {
  if (dryRun) return await aSec();

  const db = creerClient();
  const config = await lireConfig(db);
  const artisans = await lireArtisans(db);
  const runId = await ouvrirRun(db, 'ingest');
  const debut = new Date();

  try {
    if (artisans.length === 0) {
      console.warn('/!\\ Aucun artisan actif : le scoring et le matching ne rendront rien.');
    }

    const depuis = since ?? dateDepart(config.last_run_boamp);
    console.log(`Collecte BOAMP depuis ${depuis} (${config.departements_cibles.join(', ')})`);

    const bruts = await fetchAvisBruts({ depuis, departements: config.departements_cibles });
    const bilan = traiter(bruts, artisans, config);
    afficherBilan(bilan, config);

    const lignes = [
      ...bilan.opportunites.map(versLigne),
      ...bilan.attributions.map(versLigneAttribution),
    ];
    const { nouveaux, majs } = await upserterAvis(db, lignes);

    // Rectificatifs et annulations : appliques a l'avis initial via annonce_lie.
    let prolongations = 0;
    for (const maj of bilan.mises_a_jour) {
      if (!maj.annonce_lie) continue;
      const r = await appliquerMiseAJour(db, maj.annonce_lie, {
        etat: maj.nature === 'ANNULATION' ? 'annule' : 'rectifie',
        date_limite: maj.date_limite,
        raw: maj.raw,
      });
      if (r === 'delai_prolonge') prolongations++;
    }
    if (prolongations > 0) console.log(`  ${prolongations} prolongation(s) de delai detectee(s).`);

    await fermerRun(db, runId, {
      statut: bilan.erreurs.length > 0 ? 'partiel' : 'ok',
      avis_recus: bilan.recus,
      avis_nouveaux: nouveaux,
      avis_maj: majs,
      ...(bilan.erreurs.length > 0 ? { erreur: `${bilan.erreurs.length} avis illisibles` } : {}),
    });

    // On ne recule le curseur qu'apres un ecrit reussi : un echec fait rejouer
    // la meme fenetre au run suivant plutot que de perdre des avis.
    await ecrireConfig(db, 'last_run_boamp', debut.toISOString().slice(0, 10));

    console.log(`\n${nouveaux} nouveaux, ${majs} mis a jour.`);
  } catch (e) {
    const message = (e as Error).message;
    await fermerRun(db, runId, { statut: 'erreur', erreur: message });
    console.error(`\nECHEC : ${message}`);
    process.exitCode = 1;
  }
}

/** Rejeu a sec : aucune ecriture, aucun secret requis hormis pour lire les artisans. */
async function aSec(): Promise<void> {
  const config = CONFIG_DEFAUT;
  let artisans: Artisan[] = [];
  try {
    artisans = await lireArtisans(creerClient());
    console.log(`${artisans.length} artisan(s) actif(s) charge(s).`);
  } catch {
    console.warn('/!\\ Base inaccessible : bilan de classification seul, sans scoring.');
  }

  const depuis = since ?? dateDepart(null);
  console.log(`[dry-run] Collecte BOAMP depuis ${depuis}\n`);
  const bruts = await fetchAvisBruts({ depuis, departements: config.departements_cibles });
  afficherBilan(traiter(bruts, artisans, config), config);
  console.log('\n[dry-run] Aucune ecriture effectuee.');
}

function afficherBilan(b: Bilan, config: Config): void {
  console.log(`Recus            : ${b.recus}`);
  console.log(`Hors zone        : ${b.hors_zone}`);
  console.log(`Attributions     : ${b.attributions.length}  (signal acheteur recurrent)`);
  console.log(`Mises a jour     : ${b.mises_a_jour.length}  (rectificatifs / annulations)`);
  console.log(`Opportunites     : ${b.opportunites.length}`);

  if (b.erreurs.length > 0) {
    console.log(`\n/!\\ ${b.erreurs.length} avis illisibles :`);
    for (const e of b.erreurs.slice(0, 5)) console.log(`    ${e.idweb} (${e.perimetre}) ${e.message}`);
  }

  const parMetier = new Map<string, number>();
  for (const o of b.opportunites) {
    if (o.metier === 'autre') continue;
    parMetier.set(o.metier, (parMetier.get(o.metier) ?? 0) + 1);
  }
  if (parMetier.size > 0) {
    console.log('\nPar metier (hors « autre ») :');
    for (const [m, n] of [...parMetier].sort((x, y) => y[1] - x[1])) {
      console.log(`  ${m.padEnd(12)} ${n}`);
    }
  }

  const parMotsCles = b.opportunites.filter((o) => o.classification_source === 'mots_cles' && o.metier !== 'autre');
  console.log(`\nClasses par mots-cles : ${parMotsCles.length} (a auditer, spec §6.5)`);

  const retenus = b.opportunites.filter((o) => o.score >= config.score_seuil_notif);
  const prioritaires = b.opportunites.filter((o) => o.score >= config.score_seuil_prio);
  console.log(`Score >= ${config.score_seuil_notif}        : ${retenus.length}`);
  console.log(`Score >= ${config.score_seuil_prio} (prio) : ${prioritaires.length}`);

  for (const o of retenus.slice(0, 10)) {
    const montant = o.pivot.montant_estime === null ? 'montant inconnu' : `${Math.round(o.pivot.montant_estime).toLocaleString('fr-FR')} EUR`;
    console.log(`  [${String(o.score).padStart(3)}] ${o.metier.padEnd(11)} ${(o.pivot.departement ?? '--')} ${montant.padEnd(18)} ${(o.pivot.objet ?? '').slice(0, 60)}`);
  }
}

function dateDepart(lastRun: string | null): string {
  if (lastRun) {
    const d = new Date(lastRun);
    d.setUTCDate(d.getUTCDate() - RECOUVREMENT_JOURS);
    return d.toISOString().slice(0, 10);
  }
  // Premier run : une semaine d'historique.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function valeurArg(nom: string): string | null {
  const i = args.indexOf(nom);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}
