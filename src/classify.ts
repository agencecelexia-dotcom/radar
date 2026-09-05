/**
 * Classification metier d'un avis.
 *
 * Deux voies, dans cet ordre :
 *   1. le code CPV (fiable, present dans ~95 % des avis hors MAPA) ;
 *   2. un repli par mots-cles sur l'objet, indispensable pour les MAPA
 *      (2 % de CPV seulement) et pour les CPV generiques comme 45000000.
 *
 * `classification_source` trace la voie utilisee, pour permettre la revue
 * hebdomadaire des faux negatifs prevue en spec §6.5.
 */
import type { AvisPivot, Metier } from './types.ts';

export type Classification = {
  metier: Metier;
  source: 'cpv' | 'mots_cles' | null;
};

/**
 * Prefixes CPV -> metier, du plus specifique au plus general (spec §3).
 * L'ordre compte : le premier prefixe qui correspond gagne.
 */
const CPV_METIER: ReadonlyArray<readonly [string, Metier]> = [
  // Bardage / ravalement / ITE — avant maconnerie, car 45262650 est plus
  // specifique que le prefixe 4526.
  ['45262650', 'bardage'],
  ['45443', 'bardage'],
  ['45321', 'bardage'],
  ['45410', 'bardage'],

  // Couverture / toiture / etancheite
  ['45260', 'couverture'],
  ['45261', 'couverture'],

  // Maconnerie / gros oeuvre
  ['452625', 'maconnerie'],
  ['452623', 'maconnerie'],
  ['45262', 'maconnerie'],

  // Paysage — avant VRD, 451127 est plus specifique que 45112.
  ['451127', 'paysage'],
  ['77310', 'paysage'],
  ['77311', 'paysage'],
  ['77300', 'paysage'],
  ['773', 'paysage'],

  // VRD / terrassement
  ['451125', 'vrd'],
  ['45112', 'vrd'],
  ['4523', 'vrd'],
];

/** Repli par mots-cles sur l'objet (spec §5.2). Teste dans l'ordre. */
const MOTS_CLES: ReadonlyArray<readonly [RegExp, Metier]> = [
  [/\bpiscine|bassin\b/, 'piscine'],
  [/toiture|couvertur|charpent|zinguerie|etancheit|ardoise|tuile|zinc\b/, 'couverture'],
  [/ravalement|facade|bardage|isolation par l.?exterieur|\bite\b|enduit/, 'bardage'],
  [/espaces? verts?|elagage|tonte|plantation|paysag|abattage|arbre|jardin/, 'paysage'],
  [/voirie|terrassement|assainissement|reseaux divers|\bvrd\b|enrobe|trottoir/, 'vrd'],
  [/maconner|gros oeuvre|beton|mur de soutenement|pierre de taille/, 'maconnerie'],
];

/**
 * Minuscules, sans accents, sans ponctuation, espaces reduits.
 * Sert au repli mots-cles et au rapprochement flou en base (pg_trgm).
 */
export function normaliserObjet(t: string | null | undefined): string {
  if (!t) return '';
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function classifier(avis: AvisPivot): Classification {
  // 1. CPV — on teste le principal puis les secondaires : un avis « travaux de
  // batiment » (45000000) peut porter un CPV secondaire de couverture.
  for (const cpv of [avis.cpv_principal, ...avis.cpv_tous]) {
    const m = metierDepuisCpv(cpv);
    if (m) return { metier: m, source: 'cpv' };
  }

  // 2. Repli mots-cles sur objet + description + intitules de lots.
  const texte = normaliserObjet(
    [avis.objet, avis.description, ...avis.lots.map((l) => l.intitule)].filter(Boolean).join(' '),
  );
  for (const [re, metier] of MOTS_CLES) {
    if (re.test(texte)) return { metier, source: 'mots_cles' };
  }

  return { metier: 'autre', source: null };
}

export function metierDepuisCpv(cpv: string | null): Metier | null {
  if (!cpv) return null;
  // 45000000 et 45200000 sont trop generiques pour decider d'un metier :
  // on laisse la main aux mots-cles.
  if (/^45[02]?0{5,6}$/.test(cpv)) return null;
  for (const [prefixe, metier] of CPV_METIER) {
    if (cpv.startsWith(prefixe)) return metier;
  }
  return null;
}
