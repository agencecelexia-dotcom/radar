/**
 * Enregistrement d'une decision (a_etudier / go / no_go) sur un avis.
 *
 * Seule ecriture exposee par l'interface. Aucune autre route ne modifie la base,
 * et aucune ne permet d'envoyer quoi que ce soit a un acheteur (spec §1.4, §9.3).
 */
import { NextResponse } from 'next/server';
import { client, supabaseConfigure } from '@/lib/donnees';
import { DECISIONS } from '@/lib/metiers';

const VALIDES = new Set<string>(DECISIONS.map((d) => d.cle));

export async function POST(req: Request) {
  if (!supabaseConfigure()) {
    return NextResponse.json({ erreur: 'Supabase non configuré' }, { status: 503 });
  }

  let corps: { id?: unknown; decision?: unknown };
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ erreur: 'Corps JSON invalide' }, { status: 400 });
  }

  const id = corps.id;
  const decision = corps.decision;

  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ erreur: 'Identifiant d’avis invalide' }, { status: 400 });
  }
  if (decision !== null && (typeof decision !== 'string' || !VALIDES.has(decision))) {
    return NextResponse.json({ erreur: 'Décision inconnue' }, { status: 400 });
  }

  const { error } = await client()
    .from('avis')
    .update({
      decision,
      decision_at: decision === null ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
