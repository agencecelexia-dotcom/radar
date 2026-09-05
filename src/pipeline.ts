/**
 * Coeur du pipeline, sans effet de bord : brut -> lignes prêtes a ecrire.
 * Isole de la base pour rester testable et rejouable a sec (--dry-run).
 */
import { classifier, normaliserObjet } from './classify.ts';
import type { Config } from './config.ts';
import type { Artisan } from './match.ts';
import { trouverArtisan } from './match.ts';
import { ErreurParsing, parseAvis } from './parsers/index.ts';
import { scorer } from './score.ts';
import type { AvisBrut } from './sources/boamp.ts';
import type { AvisPivot, Metier } from './types.ts';
import type { LigneAvis } from './db.ts';

export type AvisTraite = {
  pivot: AvisPivot;
  metier: Metier;
  classification_source: 'cpv' | 'mots_cles' | null;
  score: number;
  score_detail: unknown;
  artisan: Artisan | null;
  match_raison: string | null;
};

export type Bilan = {
  recus: number;
  hors_zone: number;
  erreurs: { idweb: string; perimetre: string | null; message: string }[];
  opportunites: AvisTraite[];
  attributions: AvisPivot[];
  mises_a_jour: AvisPivot[];
};

export function traiter(
  bruts: AvisBrut[],
  artisans: Artisan[],
  config: Config,
  maintenant = new Date(),
): Bilan {
  const bilan: Bilan = {
    recus: bruts.length,
    hors_zone: 0,
    erreurs: [],
    opportunites: [],
    attributions: [],
    mises_a_jour: [],
  };

  for (const brut of bruts) {
    let pivot: AvisPivot;
    try {
      pivot = parseAvis(brut);
    } catch (e) {
      const err = e as ErreurParsing;
      // Un avis illisible est signale, jamais avale en silence (spec §9.5, §9.10).
      bilan.erreurs.push({ idweb: err.idweb ?? brut.idweb, perimetre: err.perimetre ?? null, message: err.message });
      continue;
    }

    // Les rectificatifs et annulations ne sont pas des opportunites : ils
    // modifient un avis existant.
    if (pivot.nature === 'RECTIFICATIF' || pivot.nature === 'ANNULATION') {
      bilan.mises_a_jour.push(pivot);
      continue;
    }

    if (!dansLaZone(pivot, config.departements_cibles)) {
      bilan.hors_zone++;
      continue;
    }

    // Les attributions alimentent le signal « acheteur recurrent » (plan §1.4) :
    // elles remplacent l'ingestion DECP prevue en phase 4.
    if (pivot.nature === 'ATTRIBUTION') {
      bilan.attributions.push(pivot);
      continue;
    }
    if (pivot.nature !== 'APPEL_OFFRE') continue;

    const cls = classifier(pivot);
    const detail = scorer({
      avis: pivot,
      metier: cls.metier,
      artisans,
      poids: config.poids,
      montantMin: config.montant_min,
      montantMax: config.montant_max,
      maintenant,
    });

    // Le matching ne tourne que sur ce qui vaut la peine (spec §6.3).
    const match =
      !detail.elimine && detail.total >= config.score_seuil_notif
        ? trouverArtisan(pivot, cls.metier, artisans)
        : { artisan: null, raison: detail.motif_elimination };

    bilan.opportunites.push({
      pivot,
      metier: cls.metier,
      classification_source: cls.source,
      score: detail.total,
      score_detail: detail,
      artisan: match.artisan,
      match_raison: match.raison,
    });
  }

  bilan.opportunites.sort((a, b) => b.score - a.score);
  return bilan;
}

/**
 * L'avis concerne-t-il la zone cible ?
 *
 * `departement` vient du lieu d'execution reel. Quand il n'a pas pu etre
 * extrait, on se rabat sur les departements de PUBLICATION — bruyants (un avis
 * de Compiegne est publie aussi a Paris), donc on garde l'avis sans lui
 * attribuer de departement : il perdra les points correspondants.
 */
export function dansLaZone(pivot: AvisPivot, cibles: string[]): boolean {
  if (pivot.departement !== null) return cibles.includes(pivot.departement);
  return pivot.departements_publication.some((d) => cibles.includes(d));
}

/** Convertit un avis traite en ligne prête pour l'upsert. */
export function versLigne(t: AvisTraite): LigneAvis {
  const p = t.pivot;
  return {
    source: p.source,
    source_id: p.source_id,
    perimetre: p.perimetre,
    nature: p.nature,
    type_avis: p.type_avis,
    annonce_lie: p.annonce_lie,
    objet: p.objet,
    objet_normalise: normaliserObjet(p.objet),
    description: p.description,
    acheteur_nom: p.acheteur_nom,
    acheteur_siret: p.acheteur_siret,
    contact_nom: p.contact_nom,
    contact_email: p.contact_email,
    contact_telephone: p.contact_telephone,
    cpv_principal: p.cpv_principal,
    cpv_tous: p.cpv_tous,
    metier: t.metier,
    classification_source: t.classification_source,
    famille: p.famille,
    procedure: p.procedure,
    alloti: p.lots.length > 1,
    lot_numero: p.lots.length === 1 ? p.lots[0]!.numero : null,
    lot_intitule: p.lots.length === 1 ? p.lots[0]!.intitule : null,
    accord_cadre: p.accord_cadre,
    departement: p.departement,
    code_postal: p.code_postal,
    commune: p.commune,
    nuts: p.nuts,
    montant_estime: p.montant_estime,
    montant_inconnu: p.montant_estime === null,
    date_parution: p.date_parution,
    date_limite: p.date_limite,
    etat: 'en_cours',
    url_avis: p.url_avis,
    url_dce: p.url_dce,
    score: t.score,
    score_detail: t.score_detail,
    artisan_suggere: t.artisan?.id ?? null,
    match_raison: t.match_raison,
    raw: p.raw,
    updated_at: new Date().toISOString(),
  };
}

/** Ligne d'attribution : sert au signal « acheteur recurrent », pas au digest. */
export function versLigneAttribution(p: AvisPivot): LigneAvis {
  return {
    source: p.source,
    source_id: p.source_id,
    perimetre: p.perimetre,
    nature: p.nature,
    objet: p.objet,
    objet_normalise: normaliserObjet(p.objet),
    acheteur_nom: p.acheteur_nom,
    acheteur_siret: p.acheteur_siret,
    cpv_principal: p.cpv_principal,
    cpv_tous: p.cpv_tous,
    departement: p.departement,
    montant_estime: p.montant_estime,
    montant_inconnu: p.montant_estime === null,
    date_parution: p.date_parution,
    etat: 'attribue',
    url_avis: p.url_avis,
    raw: p.raw,
    updated_at: new Date().toISOString(),
  };
}
