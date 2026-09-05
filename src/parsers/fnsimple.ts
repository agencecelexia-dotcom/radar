/**
 * Dialecte BOAMP natif — perimetres FNSimple, DSP, AUTRE.
 * ~2 855 avis/mois. Schema plus plat qu'eForms, et un CPV present dans 95 % des cas.
 */
import type { AvisBrut } from '../sources/boamp.ts';
import type { AvisPivot, Lot } from '../types.ts';
import { arr, collecter, dateBoamp, deptDepuisCp, estObjet, get, montant, normaliserCpv, premier, txt } from './util.ts';

export function parseFnSimple(brut: AvisBrut, donnees: Record<string, unknown>): AvisPivot {
  // La racine porte le nom du perimetre (FNSimple, DSP, ...).
  const racine = premierNoeud(donnees);
  const organisme = get(racine, 'organisme');

  // La rubrique de contenu varie : `initial` pour un avis neuf,
  // `rectificatif.avisInitial` pour une rectification, `attribution` pour un
  // avis d'attribution.
  const corps =
    get(racine, 'initial') ??
    get(racine, 'rectificatif.avisInitial') ??
    get(racine, 'attribution') ??
    racine;

  const nature = get(corps, 'natureMarche') ?? premier(racine, 'natureMarche');
  const communication = get(corps, 'communication');

  const cpvPrincipal = normaliserCpv(get(nature, 'codeCPV.objetPrincipal.classPrincipale'));
  const cpvTous = new Set<string>();
  if (cpvPrincipal) cpvTous.add(cpvPrincipal);
  for (const c of collecter(racine, 'classPrincipale')) {
    const n = normaliserCpv(c);
    if (n) cpvTous.add(n);
  }
  for (const c of collecter(racine, 'classSupplementaire')) {
    const n = normaliserCpv(c);
    if (n) cpvTous.add(n);
  }

  const cp = txt(get(organisme, 'cp'));
  const lieu = txt(get(nature, 'lieuExecution'));

  return {
    source: 'BOAMP',
    source_id: brut.idweb,
    perimetre: brut.perimetre,
    nature: 'AUTRE',
    type_avis: brut.type_avis,
    annonce_lie: null,

    objet: txt(get(nature, 'intitule')) ?? brut.objet,
    description: txt(get(nature, 'description')),
    acheteur_nom: txt(get(organisme, 'nomOfficiel')) ?? brut.nomacheteur,
    // Le champ `siret` de l'API est vide : le SIRET reel est ici (plan §1.7).
    acheteur_siret: siret(get(organisme, 'codeIdentificationNational')),

    contact_nom: txt(get(communication, 'nomContact')),
    contact_email: txt(get(communication, 'adresseMailContact')),
    contact_telephone: txt(get(communication, 'telephoneContact')),

    cpv_principal: cpvPrincipal,
    cpv_tous: [...cpvTous],
    famille: familleDepuisTypeMarche(brut.type_marche),
    procedure: brut.procedure_libelle,
    accord_cadre: collecter(racine, 'accordCadre').length > 0,
    lots: extraireLots(corps),

    // Le lieu d'execution est un texte libre (« Compiegne 60200 ») : on y
    // cherche un code postal, sinon on retombe sur celui de l'organisme.
    departement: deptDepuisCp(cpDansTexte(lieu)) ?? deptDepuisCp(cp),
    code_postal: cpDansTexte(lieu) ?? cp,
    commune: txt(get(organisme, 'ville')),
    nuts: null,
    departements_publication: brut.code_departement ?? [],

    montant_estime: montant(premier(racine, 'valeurTotale')) ?? montant(premier(racine, 'montant')),

    date_parution: brut.dateparution,
    date_limite: dateBoamp(get(corps, 'procedure.dateReceptionOffres')) ?? dateBoamp(brut.datelimitereponse),

    url_avis: brut.url_avis,
    url_dce: txt(get(communication, 'urlProfilAch')) ?? txt(premier(racine, 'urlProfilAcheteur')),

    raw: brut,
  };
}

function premierNoeud(donnees: Record<string, unknown>): unknown {
  for (const [k, v] of Object.entries(donnees)) {
    if (k.startsWith('@')) continue;
    if (estObjet(v)) return v;
  }
  return donnees;
}

function siret(v: unknown): string | null {
  const s = txt(v)?.replace(/\s/g, '') ?? null;
  return s && /^\d{14}$/.test(s) ? s : null;
}

/** Extrait un code postal a 5 chiffres d'un texte libre. */
function cpDansTexte(t: string | null): string | null {
  if (!t) return null;
  return t.match(/\b(\d{5})\b/)?.[1] ?? null;
}

function extraireLots(corps: unknown): Lot[] {
  const out: Lot[] = [];
  for (const bloc of collecter(corps, 'lot')) {
    for (const lot of arr(bloc)) {
      if (!estObjet(lot)) continue;
      out.push({
        numero: txt(lot['numLot']) ?? txt(lot['numero']),
        intitule: txt(lot['intitule']) ?? txt(lot['description']),
        cpv: normaliserCpv(get(lot, 'codeCPV.objetPrincipal.classPrincipale')),
        montant: montant(lot['montant']),
      });
    }
  }
  return out;
}

function familleDepuisTypeMarche(t: string[] | null): AvisPivot['famille'] {
  const v = (t ?? [])[0]?.toUpperCase();
  if (v === 'TRAVAUX') return 'travaux';
  if (v === 'SERVICES') return 'services';
  if (v === 'FOURNITURES') return 'fournitures';
  return null;
}
