/**
 * Scoring deterministe par regles (spec §6). Pas de LLM : les regles sont
 * explicables, debuggables et gratuites.
 *
 * Le detail du calcul est conserve dans `score_detail` pour pouvoir comprendre
 * POURQUOI un avis a le score qu'il a — indispensable au recalibrage (spec §6.4).
 */
import type { Poids } from './config.ts';
import type { Artisan } from './match.ts';
import type { AvisPivot, Metier } from './types.ts';

export type Contribution = { critere: string; points: number; motif: string };

export type ScoreDetail = {
  total: number;
  contributions: Contribution[];
  elimine: boolean;
  motif_elimination: string | null;
};

/** Departements limitrophes, pour la Region parisienne et ses voisins. */
const LIMITROPHES: Record<string, readonly string[]> = {
  '75': ['92', '93', '94'],
  '77': ['91', '93', '94', '95', '45', '89', '10', '51', '02', '60'],
  '78': ['27', '28', '91', '92', '95'],
  '91': ['28', '45', '77', '78', '92', '94'],
  '92': ['75', '78', '91', '93', '95'],
  '93': ['75', '77', '92', '94', '95'],
  '94': ['75', '77', '91', '93'],
  '95': ['27', '60', '77', '78', '92', '93'],
};

export type EntreeScore = {
  avis: AvisPivot;
  metier: Metier;
  artisans: Artisan[];
  poids: Poids;
  montantMin: number;
  montantMax: number;
  /** Injectable pour rendre les tests deterministes. */
  maintenant?: Date;
};

export function scorer(e: EntreeScore): ScoreDetail {
  const contributions: Contribution[] = [];
  const actifs = e.artisans.filter((a) => a.actif);

  // --- Metier : critere eliminatoire (spec §6.2) ---
  const surLeMetier = actifs.filter((a) => a.metiers.includes(e.metier));
  if (e.metier === 'autre' || surLeMetier.length === 0) {
    return {
      total: 0,
      contributions: [],
      elimine: true,
      motif_elimination:
        e.metier === 'autre'
          ? "metier non identifie"
          : `aucun artisan sur le metier « ${e.metier} »`,
    };
  }
  contributions.push({
    critere: 'metier',
    points: e.poids.metier,
    motif: `${surLeMetier.length} artisan(s) sur « ${e.metier} »`,
  });

  // --- Departement ---
  const dept = e.avis.departement;
  const couvrent = surLeMetier.filter((a) => dept !== null && a.departements.includes(dept));
  const limitrophes = surLeMetier.filter((a) =>
    a.departements.some((d: string) => dept !== null && (LIMITROPHES[dept] ?? []).includes(d)),
  );
  if (couvrent.length > 0) {
    contributions.push({ critere: 'departement', points: e.poids.departement_direct, motif: `${dept} couvert` });
  } else if (limitrophes.length > 0) {
    contributions.push({ critere: 'departement', points: e.poids.departement_limitrophe, motif: `${dept} limitrophe` });
  } else {
    contributions.push({ critere: 'departement', points: 0, motif: dept ? `${dept} non couvert` : 'departement inconnu' });
  }

  // --- Montant ---
  const m = e.avis.montant_estime;
  if (m === null) {
    // Cas majoritaire : ne pas penaliser un avis dont l'acheteur n'a rien publie.
    contributions.push({ critere: 'montant', points: e.poids.montant_inconnu, motif: 'montant non publie' });
  } else if (m < e.montantMin || m > e.montantMax) {
    contributions.push({ critere: 'montant', points: 0, motif: `${fmt(m)} hors fourchette` });
  } else {
    const preneurs = surLeMetier.filter((a) => dansCapacite(a, m));
    contributions.push({
      critere: 'montant',
      points: preneurs.length > 0 ? e.poids.montant_ok : 0,
      motif: preneurs.length > 0 ? `${fmt(m)} dans la capacite de ${preneurs.length} artisan(s)` : `${fmt(m)} hors capacite du reseau`,
    });
  }

  // --- Delai restant ---
  const jours = joursRestants(e.avis.date_limite, e.maintenant ?? new Date());
  contributions.push(pointsDelai(jours, e.poids));

  // --- Procedure ---
  contributions.push(pointsProcedure(e.avis.procedure, e.poids));

  // --- Accord-cadre : recurrence, donc volume ---
  if (e.avis.accord_cadre) {
    contributions.push({ critere: 'accord_cadre', points: e.poids.accord_cadre, motif: 'accord-cadre' });
  }

  const total = contributions.reduce((s, c) => s + c.points, 0);
  return { total: Math.max(0, Math.min(100, total)), contributions, elimine: false, motif_elimination: null };
}

export function joursRestants(dateLimite: string | null, maintenant: Date): number | null {
  if (!dateLimite) return null;
  const t = new Date(dateLimite).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - maintenant.getTime()) / 86_400_000);
}

function pointsDelai(jours: number | null, p: Poids): Contribution {
  // 4 % des appels d'offres n'ont pas de date limite exploitable : on reste
  // neutre plutot que de les eliminer (plan §1.4).
  if (jours === null) return { critere: 'delai', points: p.delai_7_14j, motif: 'date limite non publiee' };
  if (jours > 21) return { critere: 'delai', points: p.delai_sup_21j, motif: `${jours} j restants` };
  if (jours >= 14) return { critere: 'delai', points: p.delai_14_21j, motif: `${jours} j restants` };
  if (jours >= 7) return { critere: 'delai', points: p.delai_7_14j, motif: `${jours} j restants` };
  if (jours >= 3) return { critere: 'delai', points: p.delai_3_7j, motif: `${jours} j restants` };
  return { critere: 'delai', points: 0, motif: jours < 0 ? 'delai depasse' : `${jours} j restants` };
}

function pointsProcedure(procedure: string | null, p: Poids): Contribution {
  const t = (procedure ?? '').toLowerCase();
  if (/adapt|mapa/.test(t)) {
    return { critere: 'procedure', points: p.procedure_adaptee, motif: 'procedure adaptee' };
  }
  if (/restreint|restricted/.test(t)) {
    return { critere: 'procedure', points: p.procedure_restreinte, motif: 'procedure restreinte' };
  }
  if (/ouvert|open/.test(t)) {
    return { critere: 'procedure', points: p.procedure_ouverte, motif: 'procedure ouverte' };
  }
  return { critere: 'procedure', points: 0, motif: `procedure « ${procedure ?? 'inconnue'} »` };
}

/** L'artisan peut-il absorber ce chantier ? Les bornes non renseignees sont permissives. */
export function dansCapacite(a: Artisan, montant: number): boolean {
  if (a.chantier_min !== null && montant < a.chantier_min) return false;
  if (a.chantier_max !== null && montant > a.chantier_max) return false;
  return true;
}

function fmt(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} EUR`;
}
