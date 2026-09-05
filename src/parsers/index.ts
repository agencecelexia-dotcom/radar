/**
 * Dispatcher : choisit le parser de dialecte a partir de `perimetre`,
 * puis complete les champs communs a tous les dialectes.
 */
import { parseBlob, type AvisBrut } from '../sources/boamp.ts';
import type { AvisPivot, Nature } from '../types.ts';
import { parseEForms } from './eforms.ts';
import { parseFnSimple } from './fnsimple.ts';
import { parseMapa } from './mapa.ts';

export class ErreurParsing extends Error {
  readonly idweb: string;
  readonly perimetre: string | null;

  constructor(idweb: string, perimetre: string | null, cause: unknown) {
    super(`Parsing de ${idweb} (${perimetre ?? 'perimetre inconnu'}) : ${(cause as Error)?.message ?? cause}`);
    this.name = 'ErreurParsing';
    this.idweb = idweb;
    this.perimetre = perimetre;
  }
}

export function parseAvis(brut: AvisBrut): AvisPivot {
  const donnees = parseBlob(brut.donnees);
  const perimetre = brut.perimetre ?? '';

  try {
    const pivot = donnees
      ? choisirParser(perimetre)(brut, donnees)
      : pivotMinimal(brut);

    pivot.nature = normaliserNature(brut.nature);
    pivot.annonce_lie = (brut.annonce_lie ?? [])[0] ?? null;
    return pivot;
  } catch (cause) {
    throw new ErreurParsing(brut.idweb, brut.perimetre, cause);
  }
}

type Parser = (brut: AvisBrut, donnees: Record<string, unknown>) => AvisPivot;

function choisirParser(perimetre: string): Parser {
  if (perimetre.startsWith('DIRECTIVE')) return parseEForms;
  if (perimetre === 'MAPA') return parseMapa;
  // FNSimple, DSP, AUTRE et tout perimetre inconnu partagent le schema natif.
  return parseFnSimple;
}

/**
 * Repli quand le blob `donnees` est absent ou illisible : on garde l'avis avec
 * les seuls champs de premier niveau plutot que de le perdre (spec §9.4).
 */
function pivotMinimal(brut: AvisBrut): AvisPivot {
  return {
    source: 'BOAMP',
    source_id: brut.idweb,
    perimetre: brut.perimetre,
    nature: 'AUTRE',
    type_avis: brut.type_avis,
    annonce_lie: null,
    objet: brut.objet,
    description: null,
    acheteur_nom: brut.nomacheteur,
    acheteur_siret: null,
    contact_nom: null,
    contact_email: null,
    contact_telephone: null,
    cpv_principal: null,
    cpv_tous: [],
    famille: null,
    procedure: brut.procedure_libelle,
    accord_cadre: false,
    lots: [],
    departement: null,
    code_postal: null,
    commune: null,
    nuts: null,
    departements_publication: brut.code_departement ?? [],
    montant_estime: null,
    date_parution: brut.dateparution,
    date_limite: brut.datelimitereponse,
    url_avis: brut.url_avis,
    url_dce: null,
    raw: brut,
  };
}

/**
 * Normalise le champ `nature`. C'est LE discriminant du pipeline (plan §1.4) :
 * seuls les APPEL_OFFRE sont des opportunites, les ATTRIBUTION alimentent le
 * signal « acheteur recurrent », les RECTIFICATIF/ANNULATION mettent a jour un
 * avis existant.
 */
export function normaliserNature(v: string | null): Nature {
  switch ((v ?? '').toUpperCase()) {
    case 'APPEL_OFFRE':
      return 'APPEL_OFFRE';
    case 'ATTRIBUTION':
      return 'ATTRIBUTION';
    case 'RECTIFICATIF':
      return 'RECTIFICATIF';
    case 'ANNULATION':
      return 'ANNULATION';
    default:
      return 'AUTRE';
  }
}
