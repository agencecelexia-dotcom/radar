/**
 * Apercu : rejoue le pipeline sur les avis reels et exporte les opportunites
 * en JSON, pour visualisation. Aucune ecriture en base, aucun secret requis.
 *
 *   node --experimental-strip-types scripts/apercu.ts <sortie.json> [jours]
 */
import { writeFileSync } from 'node:fs';
import { CONFIG_DEFAUT } from '../src/config.ts';
import { traiter } from '../src/pipeline.ts';
import { fetchAvisBruts } from '../src/sources/boamp.ts';
import { joursRestants } from '../src/score.ts';

const sortie = process.argv[2] ?? 'apercu.json';
const jours = Number(process.argv[3] ?? 30);

const depuis = new Date();
depuis.setUTCDate(depuis.getUTCDate() - jours);
const depuisIso = depuis.toISOString().slice(0, 10);

console.log(`Collecte BOAMP depuis ${depuisIso}...`);
const bruts = await fetchAvisBruts({ depuis: depuisIso, departements: CONFIG_DEFAUT.departements_cibles });

const maintenant = new Date();
const bilan = traiter(bruts, [], CONFIG_DEFAUT, maintenant);

// Sans artisans en base, le scoring ne peut rien rendre : on presente donc les
// opportunites classees par metier cible, les plus urgentes d'abord.
const opportunites = bilan.opportunites
  .filter((o) => o.metier !== 'autre')
  .map((o) => {
    const p = o.pivot;
    return {
      objet: p.objet,
      acheteur: p.acheteur_nom,
      metier: o.metier,
      classification: o.classification_source,
      departement: p.departement,
      commune: p.commune,
      montant: p.montant_estime,
      date_parution: p.date_parution,
      date_limite: p.date_limite,
      jours_restants: joursRestants(p.date_limite, maintenant),
      procedure: p.procedure,
      perimetre: p.perimetre,
      cpv: p.cpv_principal,
      alloti: p.lots.length > 1,
      nb_lots: p.lots.length,
      accord_cadre: p.accord_cadre,
      url_avis: p.url_avis,
      url_dce: p.url_dce,
    };
  })
  // Les avis encore ouverts d'abord, du plus urgent au plus lointain.
  .sort((a, b) => {
    const ouvert = (x: typeof a) => (x.jours_restants === null || x.jours_restants < 0 ? 1 : 0);
    return ouvert(a) - ouvert(b) || (a.jours_restants ?? 9999) - (b.jours_restants ?? 9999);
  });

const donnees = {
  genere_le: maintenant.toISOString(),
  fenetre_jours: jours,
  depuis: depuisIso,
  departements: CONFIG_DEFAUT.departements_cibles,
  stats: {
    recus: bilan.recus,
    hors_zone: bilan.hors_zone,
    attributions: bilan.attributions.length,
    mises_a_jour: bilan.mises_a_jour.length,
    opportunites_totales: bilan.opportunites.length,
    metiers_cibles: opportunites.length,
    erreurs: bilan.erreurs.length,
  },
  opportunites,
};

writeFileSync(sortie, JSON.stringify(donnees, null, 2));
console.log(`${opportunites.length} opportunites sur les metiers cibles -> ${sortie}`);
console.log(`  encore ouvertes : ${opportunites.filter((o) => (o.jours_restants ?? -1) >= 0).length}`);
