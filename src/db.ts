/**
 * Acces Supabase. Toutes les ecritures sont idempotentes (spec §9.8) :
 * rejouer un run ne cree aucun doublon, grace a unique (source, source_id).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artisan } from './match.ts';

export type LigneAvis = Record<string, unknown> & { source: string; source_id: string };

export async function lireArtisans(db: SupabaseClient): Promise<Artisan[]> {
  const { data, error } = await db.from('artisans').select('*').eq('actif', true);
  if (error) throw new Error(`Lecture des artisans : ${error.message}`);
  return (data ?? []) as Artisan[];
}

/**
 * Upsert par lots. Renvoie le nombre de lignes creees et mises a jour.
 *
 * On lit d'abord les source_id deja connus pour pouvoir distinguer creation et
 * mise a jour — l'upsert seul ne le dit pas, et le digest ne doit annoncer que
 * les avis reellement nouveaux.
 */
export async function upserterAvis(
  db: SupabaseClient,
  lignes: LigneAvis[],
): Promise<{ nouveaux: number; majs: number }> {
  if (lignes.length === 0) return { nouveaux: 0, majs: 0 };

  const ids = lignes.map((l) => l.source_id);
  const connus = new Set<string>();
  for (const paquet of parPaquets(ids, 500)) {
    const { data, error } = await db.from('avis').select('source_id').in('source_id', paquet);
    if (error) throw new Error(`Lecture des avis connus : ${error.message}`);
    for (const r of data ?? []) connus.add(r.source_id as string);
  }

  for (const paquet of parPaquets(lignes, 200)) {
    const { error } = await db
      .from('avis')
      .upsert(paquet, { onConflict: 'source,source_id', ignoreDuplicates: false });
    if (error) throw new Error(`Upsert des avis : ${error.message}`);
  }

  const nouveaux = lignes.filter((l) => !connus.has(l.source_id)).length;
  return { nouveaux, majs: lignes.length - nouveaux };
}

/**
 * Applique un rectificatif ou une annulation a l'avis initial, rattache par
 * `annonce_lie` (plan §1.5 : rattachement exact, pas de rapprochement flou).
 *
 * L'ancien `raw` est empile dans `raw_historique` : aucune donnee source n'est
 * perdue (spec §9.4).
 */
export async function appliquerMiseAJour(
  db: SupabaseClient,
  parent: string,
  maj: { etat: 'rectifie' | 'annule'; date_limite: string | null; raw: unknown },
): Promise<'applique' | 'parent_absent' | 'delai_prolonge'> {
  const { data, error } = await db
    .from('avis')
    .select('id, date_limite, raw, raw_historique')
    .eq('source_id', parent)
    .maybeSingle();
  if (error) throw new Error(`Recherche de l'avis ${parent} : ${error.message}`);
  if (!data) return 'parent_absent';

  const prolonge =
    maj.etat === 'rectifie' &&
    maj.date_limite !== null &&
    data.date_limite !== null &&
    new Date(maj.date_limite) > new Date(data.date_limite);

  const { error: err2 } = await db
    .from('avis')
    .update({
      etat: maj.etat,
      date_limite: maj.date_limite ?? data.date_limite,
      raw_historique: [...(data.raw_historique ?? []), data.raw],
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id);
  if (err2) throw new Error(`Mise a jour de l'avis ${parent} : ${err2.message}`);

  return prolonge ? 'delai_prolonge' : 'applique';
}

export async function ouvrirRun(db: SupabaseClient, job: string): Promise<string> {
  const { data, error } = await db.from('runs').insert({ source: 'BOAMP', job }).select('id').single();
  if (error) throw new Error(`Ouverture du run : ${error.message}`);
  return data.id as string;
}

export async function fermerRun(
  db: SupabaseClient,
  id: string,
  bilan: { statut: 'ok' | 'erreur' | 'partiel'; avis_recus?: number; avis_nouveaux?: number; avis_maj?: number; erreur?: string },
): Promise<void> {
  const { error } = await db
    .from('runs')
    .update({ ...bilan, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error(`Fermeture du run ${id} : ${error.message}`);
}

export function parPaquets<T>(xs: T[], taille: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += taille) out.push(xs.slice(i, i + taille));
  return out;
}
