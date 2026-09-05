/**
 * Matching artisan (spec §6.3).
 *
 * Quand aucun artisan ne convient, on calcule POURQUOI. Cette information vaut
 * de l'or : elle dit ou recruter (spec §6.3, §7.3).
 */
import type { AvisPivot, Metier } from './types.ts';
import { dansCapacite } from './score.ts';

export type Artisan = {
  id: string;
  nom: string;
  societe: string | null;
  telephone: string | null;
  email: string | null;
  metiers: Metier[];
  departements: string[];
  chantier_min: number | null;
  chantier_max: number | null;
  decennale: boolean;
  decennale_expire_le: string | null;
  attestations_ok: boolean;
  deja_repondu_ao: boolean;
  appetence_public: number | null;
  actif: boolean;
};

export type Match = {
  artisan: Artisan | null;
  /** Renseigne uniquement quand aucun artisan ne convient. */
  raison: string | null;
};

/** Les filtres successifs, du plus large au plus restrictif. */
const ETAPES = [
  { nom: 'actif', message: () => 'aucun artisan actif dans le reseau' },
  { nom: 'metier', message: (a: AvisPivot, m: Metier) => `aucun artisan sur le metier « ${m} »` },
  { nom: 'departement', message: (a: AvisPivot, m: Metier) => `aucun ${m} intervenant en ${a.departement ?? 'departement inconnu'}` },
  { nom: 'decennale', message: (a: AvisPivot, m: Metier) => `aucun ${m} avec une decennale valide en ${a.departement}` },
  { nom: 'attestations', message: (a: AvisPivot, m: Metier) => `aucun ${m} avec des attestations a jour en ${a.departement}` },
  { nom: 'capacite', message: (a: AvisPivot, m: Metier) => `montant hors capacite des ${m} disponibles en ${a.departement}` },
] as const;

export function trouverArtisan(avis: AvisPivot, metier: Metier, artisans: Artisan[]): Match {
  const limite = avis.date_limite ? new Date(avis.date_limite) : null;

  const filtres: Array<(a: Artisan) => boolean> = [
    (a) => a.actif,
    (a) => a.metiers.includes(metier),
    (a) => avis.departement !== null && a.departements.includes(avis.departement),
    // La decennale doit couvrir la date de remise des offres, pas seulement aujourd'hui.
    (a) => a.decennale && (a.decennale_expire_le === null || limite === null || new Date(a.decennale_expire_le) > limite),
    (a) => a.attestations_ok,
    (a) => avis.montant_estime === null || dansCapacite(a, avis.montant_estime),
  ];

  let restants = artisans;
  for (const [i, filtre] of filtres.entries()) {
    const suivant = restants.filter(filtre);
    if (suivant.length === 0) {
      return { artisan: null, raison: ETAPES[i]!.message(avis, metier) };
    }
    restants = suivant;
  }

  // Tri : appetence, puis experience des marches publics, puis capacite.
  restants.sort(
    (x, y) =>
      (y.appetence_public ?? 0) - (x.appetence_public ?? 0) ||
      Number(y.deja_repondu_ao) - Number(x.deja_repondu_ao) ||
      (y.chantier_max ?? 0) - (x.chantier_max ?? 0),
  );

  return { artisan: restants[0]!, raison: null };
}
