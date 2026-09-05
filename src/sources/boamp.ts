/**
 * Source BOAMP — API Opendatasoft Explore v2.1, sans authentification.
 * Licence Ouverte Etalab 2.0.
 *
 * Point cle (plan §1.8) : on NE filtre PAS le CPV cote serveur. Le CPV n'est pas
 * un champ interrogeable, il est enfoui dans le blob texte `donnees`. On recupere
 * donc tout l'Ile-de-France par date (~54 avis/jour) et on classe en local.
 */

const BASE = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp';

/**
 * Un enregistrement BOAMP tel que renvoye par l'API.
 *
 * Attention (plan §1.7) : `code_departement` et `descripteur_code` sont des
 * TABLEAUX. `descripteur_code` n'est PAS un CPV — c'est le thesaurus interne
 * BOAMP (le code "45" y signifie « Cd, DVD »).
 */
export type AvisBrut = {
  idweb: string;
  objet: string | null;
  perimetre: string | null;
  nature: string | null;
  nature_libelle: string | null;
  famille: string | null;
  famille_libelle: string | null;
  code_departement: string[] | null;
  code_departement_prestation: string[] | null;
  dateparution: string | null;
  datefindiffusion: string | null;
  datelimitereponse: string | null;
  nomacheteur: string | null;
  type_marche: string[] | null;
  type_avis: string | null;
  procedure_libelle: string | null;
  etat: string | null;
  annonce_lie: string[] | null;
  url_avis: string | null;
  /** Blob JSON serialise. Forme variable selon `perimetre`. */
  donnees: string | null;
  /** Blob JSON serialise : metadonnees d'indexation. */
  gestion: string | null;
  [k: string]: unknown;
};

export type OptionsFetch = {
  /** Date ISO (YYYY-MM-DD) a partir de laquelle recuperer. */
  depuis: string;
  departements: string[];
};

/**
 * Recupere les avis parus depuis `depuis` pour les departements cibles.
 *
 * Utilise /exports/json : contrairement a /records il n'a pas de plafond de
 * pagination (offset+limit < 10 000) et renvoie tout le resultat d'un coup.
 * Mesure sur 30 jours d'Ile-de-France : 1 634 avis en un seul appel.
 */
export async function fetchAvisBruts(opts: OptionsFetch): Promise<AvisBrut[]> {
  const depts = opts.departements.map((d) => `"${d}"`).join(',');
  const where = `dateparution >= "${opts.depuis}" AND code_departement IN (${depts})`;

  const url = `${BASE}/exports/json?${new URLSearchParams({ where })}`;

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    throw new Error(`BOAMP ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`BOAMP : reponse inattendue (${typeof data}), tableau attendu.`);
  }
  return data as AvisBrut[];
}

/** Parse un blob `donnees` / `gestion`. Renvoie null si absent ou illisible. */
export function parseBlob(blob: string | null): Record<string, unknown> | null {
  if (!blob) return null;
  try {
    const o = JSON.parse(blob);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
