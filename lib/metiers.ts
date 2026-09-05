/** Libelles d'affichage. Les cles internes sont sans accent (voir src/types.ts). */
export const LIBELLE_METIER: Record<string, string> = {
  couverture: 'Couverture',
  maconnerie: 'Maçonnerie',
  bardage: 'Bardage / ITE',
  vrd: 'VRD / terrassement',
  paysage: 'Espaces verts',
  piscine: 'Piscine',
  autre: 'Non identifié',
};

export const libelleMetier = (m: string | null): string =>
  m === null ? 'Non identifié' : (LIBELLE_METIER[m] ?? m);

export type Urgence = 'urgent' | 'bientot' | 'large' | 'clos';

/** Palier d'urgence, aligne sur les seuils de delai du scoring (spec §6.2). */
export function urgence(joursRestants: number | null): Urgence {
  if (joursRestants === null || joursRestants < 0) return 'clos';
  if (joursRestants <= 7) return 'urgent';
  if (joursRestants <= 21) return 'bientot';
  return 'large';
}

export const DECISIONS = [
  { cle: 'a_etudier', libelle: 'À étudier' },
  { cle: 'go', libelle: 'Go' },
  { cle: 'no_go', libelle: 'No-go' },
] as const;

export type Decision = (typeof DECISIONS)[number]['cle'];
