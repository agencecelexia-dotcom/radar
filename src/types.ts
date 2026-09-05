/** Schema pivot : forme commune produite par tous les parsers de dialecte. */
export type Metier =
  | 'couverture'
  | 'maconnerie'
  | 'bardage'
  | 'vrd'
  | 'paysage'
  | 'piscine'
  | 'autre';

export type Nature = 'APPEL_OFFRE' | 'ATTRIBUTION' | 'RECTIFICATIF' | 'ANNULATION' | 'AUTRE';

export type Lot = {
  numero: string | null;
  intitule: string | null;
  cpv: string | null;
  montant: number | null;
};

/** Un avis normalise, avant classification et scoring. */
export type AvisPivot = {
  source: 'BOAMP';
  source_id: string;
  perimetre: string | null;
  nature: Nature;
  type_avis: string | null;
  annonce_lie: string | null;

  objet: string | null;
  description: string | null;
  acheteur_nom: string | null;
  acheteur_siret: string | null;

  /** RGPD : usage interne strict, jamais exporte, jamais destinataire (spec §1.4). */
  contact_nom: string | null;
  contact_email: string | null;
  contact_telephone: string | null;

  cpv_principal: string | null;
  cpv_tous: string[];
  famille: 'travaux' | 'services' | 'fournitures' | null;
  procedure: string | null;
  accord_cadre: boolean;
  lots: Lot[];

  departement: string | null;
  code_postal: string | null;
  commune: string | null;
  nuts: string | null;
  /** Departements de publication BOAMP — repli seulement (plan : ce n'est PAS le lieu d'execution). */
  departements_publication: string[];

  montant_estime: number | null;

  date_parution: string | null;
  date_limite: string | null;

  url_avis: string | null;
  url_dce: string | null;

  raw: unknown;
};
