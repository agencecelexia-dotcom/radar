/**
 * Dialecte eForms / UBL — perimetres DIRECTIVE-23, -24, -25, -81.
 * ~5 550 avis/mois au niveau national, la source majoritaire.
 *
 * Ce sont exactement les avis transmis a TED : c'est pourquoi TED n'est pas
 * ingere separement en v1 (plan §1.6).
 */
import type { AvisBrut } from '../sources/boamp.ts';
import type { AvisPivot, Lot } from '../types.ts';
import {
  arr,
  collecter,
  dateEForms,
  deptDepuisCp,
  deptDepuisNuts,
  estObjet,
  get,
  montant,
  normaliserCpv,
  premier,
  txt,
} from './util.ts';

/** Une organisation eForms resolue depuis le bloc efac:Organizations. */
type Organisation = {
  id: string | null;
  nom: string | null;
  siret: string | null;
  cp: string | null;
  ville: string | null;
  nuts: string | null;
  contactNom: string | null;
  contactMail: string | null;
  contactTel: string | null;
};

export function parseEForms(brut: AvisBrut, donnees: Record<string, unknown>): AvisPivot {
  // La racine varie selon le type de notice (ContractNotice, ContractAwardNotice...).
  const eforms = (get(donnees, 'EFORMS') ?? donnees) as Record<string, unknown>;
  const racine = premierNoeud(eforms);

  const projet = get(racine, 'cac:ProcurementProject');
  const orgs = resoudreOrganisations(racine);

  // L'acheteur est designe par reference : cac:ContractingParty pointe un
  // ORG-xxxx. Prendre naivement la premiere organisation donnerait le
  // prestataire de publication (ex. « Avenue-Web Systemes »), pas l'acheteur.
  const idAcheteur = txt(get(racine, 'cac:ContractingParty.cac:Party.cac:PartyIdentification.cbc:ID'));
  const acheteur = orgs.find((o) => o.id === idAcheteur) ?? orgs[0] ?? null;

  const lieu = lieuExecution(racine);
  const lots = extraireLots(racine);

  const cpvPrincipal = normaliserCpv(
    get(projet, 'cac:MainCommodityClassification.cbc:ItemClassificationCode'),
  );
  const cpvTous = new Set<string>();
  if (cpvPrincipal) cpvTous.add(cpvPrincipal);
  for (const c of collecter(racine, 'cbc:ItemClassificationCode')) {
    const n = normaliserCpv(c);
    if (n) cpvTous.add(n);
  }

  // Le montant global n'est pas toujours au niveau projet : on retient la plus
  // grande valeur estimee trouvee, faute de mieux.
  const montants = collecter(racine, 'cbc:EstimatedOverallContractAmount')
    .map(montant)
    .filter((m): m is number => m !== null);
  const montantGlobal = montants.length ? Math.max(...montants) : null;

  const deadline = get(racine, 'cac:TenderingProcess.cac:TenderSubmissionDeadlinePeriod');
  const dateLimite =
    dateEForms(get(deadline, 'cbc:EndDate'), get(deadline, 'cbc:EndTime')) ??
    dateEForms(premier(racine, 'cbc:EndDate'), premier(racine, 'cbc:EndTime'));

  return {
    source: 'BOAMP',
    source_id: brut.idweb,
    perimetre: brut.perimetre,
    nature: 'AUTRE', // fixe par le dispatcher
    type_avis: txt(get(racine, 'cbc:NoticeTypeCode')),
    annonce_lie: null,

    objet: txt(get(projet, 'cbc:Name')) ?? brut.objet,
    description: txt(get(projet, 'cbc:Description')),
    acheteur_nom: acheteur?.nom ?? brut.nomacheteur,
    acheteur_siret: acheteur?.siret ?? null,

    contact_nom: acheteur?.contactNom ?? null,
    contact_email: acheteur?.contactMail ?? null,
    contact_telephone: acheteur?.contactTel ?? null,

    cpv_principal: cpvPrincipal,
    cpv_tous: [...cpvTous],
    famille: familleDepuisNature(txt(get(projet, 'cbc:ProcurementTypeCode'))),
    procedure: txt(get(racine, 'cac:TenderingProcess.cbc:ProcedureCode')),
    accord_cadre: collecter(racine, 'cac:FrameworkAgreement').length > 0,
    lots,

    departement: lieu.departement,
    code_postal: lieu.cp,
    commune: lieu.ville,
    nuts: lieu.nuts,
    departements_publication: brut.code_departement ?? [],

    montant_estime: montantGlobal,

    date_parution: brut.dateparution,
    date_limite: dateLimite,

    url_avis: brut.url_avis,
    // EndpointID est le lien profond vers la consultation ; BuyerProfileURI
    // n'est que l'accueil de la plateforme (plan §1.7).
    url_dce: txt(premier(racine, 'cbc:EndpointID')) ?? txt(premier(racine, 'cbc:BuyerProfileURI')),

    raw: brut,
  };
}

/** Premier noeud objet sous EFORMS (ContractNotice, ContractAwardNotice, ...). */
function premierNoeud(eforms: unknown): unknown {
  if (!estObjet(eforms)) return eforms;
  for (const [k, v] of Object.entries(eforms)) {
    if (k.startsWith('@')) continue;
    if (estObjet(v) || Array.isArray(v)) return v;
  }
  return eforms;
}

function resoudreOrganisations(racine: unknown): Organisation[] {
  const out: Organisation[] = [];
  for (const bloc of collecter(racine, 'efac:Organization')) {
    for (const org of arr(bloc)) {
      const c = get(org, 'efac:Company') ?? org;
      const adresse = get(c, 'cac:PostalAddress');
      out.push({
        id: txt(get(c, 'cac:PartyIdentification.cbc:ID')),
        nom: txt(get(c, 'cac:PartyName.cbc:Name')),
        siret: siret(get(c, 'cac:PartyLegalEntity.cbc:CompanyID')),
        cp: txt(get(adresse, 'cbc:PostalZone')),
        ville: txt(get(adresse, 'cbc:CityName')),
        nuts: txt(get(adresse, 'cbc:CountrySubentityCode')),
        contactNom: txt(get(c, 'cac:Contact.cbc:Name')),
        contactMail: txt(get(c, 'cac:Contact.cbc:ElectronicMail')),
        contactTel: txt(get(c, 'cac:Contact.cbc:Telephone')),
      });
    }
  }
  return out;
}

/**
 * `cbc:CompanyID` porte tantot un SIRET (14 chiffres), tantot un GUID interne
 * eForms. On ne garde que ce qui ressemble vraiment a un SIRET.
 */
function siret(v: unknown): string | null {
  const s = txt(v)?.replace(/\s/g, '') ?? null;
  return s && /^\d{14}$/.test(s) ? s : null;
}

/**
 * Lieu d'execution reel : `cac:RealizedLocation`.
 *
 * On ne se rabat jamais sur l'adresse de l'organisation : ce serait l'adresse
 * du prestataire de publication, souvent dans un tout autre departement.
 */
function lieuExecution(racine: unknown): {
  departement: string | null;
  cp: string | null;
  ville: string | null;
  nuts: string | null;
} {
  for (const loc of collecter(racine, 'cac:RealizedLocation')) {
    for (const l of arr(loc)) {
      const a = get(l, 'cac:Address');
      const cp = txt(get(a, 'cbc:PostalZone'));
      const nuts = txt(get(a, 'cbc:CountrySubentityCode'));
      const dept = deptDepuisCp(cp) ?? deptDepuisNuts(nuts);
      if (dept) return { departement: dept, cp, ville: txt(get(a, 'cbc:CityName')), nuts };
    }
  }
  return { departement: null, cp: null, ville: null, nuts: null };
}

function extraireLots(racine: unknown): Lot[] {
  const out: Lot[] = [];
  for (const bloc of collecter(racine, 'cac:ProcurementProjectLot')) {
    for (const lot of arr(bloc)) {
      const p = get(lot, 'cac:ProcurementProject');
      out.push({
        numero: txt(get(lot, 'cbc:ID')),
        intitule: txt(get(p, 'cbc:Name')),
        cpv: normaliserCpv(get(p, 'cac:MainCommodityClassification.cbc:ItemClassificationCode')),
        montant: montant(premier(p, 'cbc:EstimatedOverallContractAmount')),
      });
    }
  }
  return out;
}

function familleDepuisNature(code: string | null): AvisPivot['famille'] {
  switch (code) {
    case 'works':
      return 'travaux';
    case 'services':
      return 'services';
    case 'supplies':
      return 'fournitures';
    default:
      return null;
  }
}
