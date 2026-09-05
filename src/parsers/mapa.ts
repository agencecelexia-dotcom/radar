/**
 * Dialecte MAPA — procedures adaptees.
 * ~566 avis/mois. Cas particulier majeur : seuls 2 % portent un code CPV
 * (plan §1.3), la classification passe donc presque toujours par les mots-cles.
 *
 * Ce sont aussi les avis les plus interessants : moins de concurrence, dossier
 * plus leger (bonus de score, spec §6.2).
 */
import type { AvisBrut } from '../sources/boamp.ts';
import type { AvisPivot, Lot } from '../types.ts';
import { arr, collecter, dateBoamp, deptDepuisCp, estObjet, get, montant, normaliserCpv, premier, txt } from './util.ts';

export function parseMapa(brut: AvisBrut, donnees: Record<string, unknown>): AvisPivot {
  const racine = get(donnees, 'MAPA') ?? donnees;
  const organisme = get(racine, 'organisme');
  const corps = get(racine, 'initial') ?? get(racine, 'rectificatif') ?? racine;
  const description = get(corps, 'description');

  const adresseOrg = get(organisme, 'adr');
  const lieu = get(description, 'lieuExecutionLivraison');

  // Le lieu d'execution prime sur l'adresse de l'acheteur : un bailleur
  // parisien fait realiser des travaux partout en Ile-de-France.
  const cpLieu = txt(get(lieu, 'cp'));
  const cpOrg = txt(get(adresseOrg, 'cp'));

  const cpvPrincipal = normaliserCpv(premier(racine, 'classPrincipale'));
  const cpvTous = new Set<string>();
  if (cpvPrincipal) cpvTous.add(cpvPrincipal);

  const contact = get(corps, 'adressesComplt.rensComplementaires') ?? get(corps, 'adressesComplt.document');

  return {
    source: 'BOAMP',
    source_id: brut.idweb,
    perimetre: brut.perimetre,
    nature: 'AUTRE',
    type_avis: brut.type_avis,
    annonce_lie: null,

    objet: txt(get(description, 'objet')) ?? brut.objet,
    description: txt(get(corps, 'caracteristiques.quantites')),
    acheteur_nom: txt(get(organisme, 'acheteurPublic')) ?? brut.nomacheteur,
    acheteur_siret: null,

    contact_nom: txt(get(organisme, 'correspondantPRM.nom')),
    contact_email: txt(get(contact, 'coord.mel')),
    contact_telephone: txt(get(contact, 'coord.tel')),

    cpv_principal: cpvPrincipal,
    cpv_tous: [...cpvTous],
    famille: null,
    // Par construction, tout avis MAPA est une procedure adaptee.
    procedure: 'adaptee',
    accord_cadre: collecter(racine, 'accordCadre').length > 0,
    lots: extraireLots(corps),

    departement: deptDepuisCp(cpLieu) ?? deptDepuisCp(cpOrg),
    code_postal: cpLieu ?? cpOrg,
    commune: txt(get(lieu, 'ville')) ?? txt(get(adresseOrg, 'ville')),
    nuts: null,
    departements_publication: brut.code_departement ?? [],

    montant_estime: montant(premier(racine, 'montant')),

    date_parution: brut.dateparution,
    date_limite: dateBoamp(get(corps, 'delais.receptionOffres')) ?? dateBoamp(brut.datelimitereponse),

    url_avis: brut.url_avis,
    url_dce: txt(get(organisme, 'urlProfilAcheteur')) ?? txt(get(organisme, 'coord.url')),

    raw: brut,
  };
}

function extraireLots(corps: unknown): Lot[] {
  const out: Lot[] = [];
  for (const bloc of collecter(corps, 'lot')) {
    for (const lot of arr(bloc)) {
      if (!estObjet(lot)) continue;
      out.push({
        numero: txt(lot['numLot']),
        intitule: txt(lot['description']) ?? txt(lot['intitule']),
        cpv: normaliserCpv(get(lot, 'codeCPV.objetPrincipal.classPrincipale')),
        montant: montant(lot['montant']),
      });
    }
  }
  return out;
}
