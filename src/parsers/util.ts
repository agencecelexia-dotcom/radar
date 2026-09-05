/**
 * Utilitaires de navigation dans les blobs BOAMP.
 *
 * Les trois dialectes partagent deux difficultes :
 *  - eForms enveloppe les scalaires dans { "@attr": ..., "#text": "valeur" } ;
 *  - un noeud repete est un objet quand il est unique, un tableau quand il ne
 *    l'est pas (consequence de la conversion XML -> JSON).
 */

export type Noeud = Record<string, unknown>;

/** Vrai objet (ni null, ni tableau). */
export function estObjet(v: unknown): v is Noeud {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Extrait la valeur scalaire d'un noeud, en depliant le wrapper `#text`
 * d'eForms. Renvoie null pour tout ce qui n'est pas exploitable.
 */
export function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (estObjet(v)) return txt(v['#text']);
  return null;
}

/** Normalise un noeud repetable en tableau (objet seul -> tableau d'un element). */
export function arr<T = unknown>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** Suit un chemin pointe. Traverse les tableaux en prenant le premier element. */
export function get(racine: unknown, chemin: string): unknown {
  let cur: unknown = racine;
  for (const cle of chemin.split('.')) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!estObjet(cur)) return undefined;
    cur = cur[cle];
  }
  return cur;
}

/** Toutes les valeurs portees par `cle`, a n'importe quelle profondeur. */
export function collecter(racine: unknown, cle: string, max = 5000): unknown[] {
  const out: unknown[] = [];
  const pile: unknown[] = [racine];
  while (pile.length && out.length < max) {
    const n = pile.pop();
    if (Array.isArray(n)) {
      pile.push(...n);
    } else if (estObjet(n)) {
      for (const [k, v] of Object.entries(n)) {
        if (k === cle) out.push(v);
        pile.push(v);
      }
    }
  }
  return out;
}

/** Premiere valeur portee par `cle`, a n'importe quelle profondeur. */
export function premier(racine: unknown, cle: string): unknown {
  return collecter(racine, cle, 1)[0];
}

/**
 * Convertit un montant en nombre.
 *
 * `"0.00"` est le sentinelle eForms de « montant non divulgue » (plan §1.7) :
 * on renvoie null, surtout pas 0, sinon l'avis serait juge hors fourchette.
 */
export function montant(v: unknown): number | null {
  const s = txt(v);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Departement a partir d'un code postal francais (2A/2B ramenes a "20"). */
export function deptDepuisCp(cp: string | null): string | null {
  if (!cp) return null;
  const m = cp.replace(/\s/g, '').match(/^(\d{2})\d{3}$/);
  if (!m) return null;
  const d = m[1]!;
  // 97x/98x : outre-mer, le departement tient sur 3 chiffres.
  if (d === '97' || d === '98') {
    const m3 = cp.match(/^(\d{3})\d{2}$/);
    return m3 ? m3[1]! : d;
  }
  return d;
}

/** Codes NUTS3 d'Ile-de-France -> departement. */
const NUTS_IDF: Record<string, string> = {
  FR101: '75',
  FR102: '77',
  FR103: '78',
  FR104: '91',
  FR105: '92',
  FR106: '93',
  FR107: '94',
  FR108: '95',
};

export function deptDepuisNuts(nuts: string | null): string | null {
  if (!nuts) return null;
  return NUTS_IDF[nuts.toUpperCase()] ?? null;
}

/** Date ISO a partir d'une date eForms (`2026-10-02+02:00`) et d'une heure optionnelle. */
export function dateEForms(date: unknown, heure: unknown): string | null {
  const d = txt(date);
  if (!d) return null;
  const jour = d.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const fuseau = d.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? '';
  const h = txt(heure);
  const heureIso = h ? h.replace(/([+-]\d{2}:\d{2}|Z)$/, '').slice(0, 8) : '00:00:00';
  const iso = `${jour}T${heureIso}${fuseau}`;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Date ISO a partir d'une date BOAMP native (`2026-09-28T16:00:00`, heure de Paris). */
export function dateBoamp(v: unknown): string | null {
  const s = txt(v);
  if (!s) return null;
  // Les dates BOAMP natives sont sans fuseau et exprimees en heure de Paris.
  const avecFuseau = /([+-]\d{2}:\d{2}|Z)$/.test(s) ? s : `${s.slice(0, 19)}${offsetParis(s.slice(0, 10))}`;
  const t = new Date(avecFuseau);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Offset de Paris pour une date donnee (+02:00 en heure d'ete, +01:00 sinon). */
function offsetParis(jour: string): string {
  const t = new Date(`${jour}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return '+01:00';
  const local = new Date(t.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const utc = new Date(t.toLocaleString('en-US', { timeZone: 'UTC' }));
  const diffH = Math.round((local.getTime() - utc.getTime()) / 3_600_000);
  return `+${String(diffH).padStart(2, '0')}:00`;
}

/** Un CPV valide : 8 chiffres. Les codes plus courts sont completes par des zeros. */
export function normaliserCpv(v: unknown): string | null {
  const s = txt(v);
  if (!s) return null;
  const chiffres = s.replace(/\D/g, '');
  if (chiffres.length < 2 || chiffres.length > 8) return null;
  return chiffres.padEnd(8, '0');
}
