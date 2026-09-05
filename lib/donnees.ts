/**
 * Source des avis du tableau de bord.
 *
 * Deux modes, choisis automatiquement :
 *   - « live »      : Supabase est configure, on lit la vraie base ;
 *   - « instantane » : sinon, on sert le releve embarque (data/snapshot.json).
 *
 * Ce repli est deliberé : sans lui, un deploiement Vercel effectue avant la
 * creation du projet Supabase afficherait une erreur au lieu du produit.
 */
import { createClient } from '@supabase/supabase-js';
import instantane from '@/data/snapshot.json';

export type Avis = {
  id: string | null;
  objet: string | null;
  acheteur: string | null;
  metier: string | null;
  classification: string | null;
  departement: string | null;
  commune: string | null;
  montant: number | null;
  date_limite: string | null;
  jours_restants: number | null;
  procedure: string | null;
  perimetre: string | null;
  cpv: string | null;
  alloti: boolean;
  nb_lots: number;
  accord_cadre: boolean;
  url_avis: string | null;
  url_dce: string | null;
  score: number | null;
  artisan: string | null;
  match_raison: string | null;
  decision: string | null;
};

export type Jeu = {
  mode: 'live' | 'instantane';
  avis: Avis[];
  releve_le: string;
  fenetre: string;
  /** Renseigne en mode instantane, pour expliquer ce qui manque. */
  avertissement: string | null;
};

export function supabaseConfigure(): boolean {
  return Boolean(process.env.SUPABASE_URL && cleSupabase());
}

function cleSupabase(): string | undefined {
  // La cle de service permet d'ecrire les decisions ; l'anonyme suffit a lire.
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
}

export function client() {
  const url = process.env.SUPABASE_URL;
  const cle = cleSupabase();
  if (!url || !cle) throw new Error('Supabase non configuré');
  return createClient(url, cle, { auth: { persistSession: false } });
}

export async function chargerAvis(): Promise<Jeu> {
  if (!supabaseConfigure()) return depuisInstantane();

  try {
    const { data, error } = await client()
      .from('avis_actifs')
      .select(
        'id, objet, acheteur_nom, metier, classification_source, departement, commune, ' +
          'montant_estime, date_limite, jours_restants, procedure, perimetre, cpv_principal, ' +
          'alloti, accord_cadre, url_avis, url_dce, score, match_raison, decision, artisans(nom)',
      )
      .eq('nature', 'APPEL_OFFRE')
      .order('score', { ascending: false, nullsFirst: false })
      .limit(500);

    if (error) throw new Error(error.message);

    // Sans types generes du schema, supabase-js n'infere pas la relation
    // imbriquee artisans(nom) : on annonce la forme reelle des lignes.
    const lignes = (data ?? []) as unknown as LigneSupabase[];

    if (lignes.length === 0) {
      // Base joignable mais vide : l'ingestion n'a pas encore tourne.
      const j = depuisInstantane();
      j.avertissement =
        "Supabase est connecté mais la table « avis » est vide : lancez « npm run ingest ». " +
        "En attendant, voici le relevé embarqué.";
      return j;
    }

    return {
      mode: 'live',
      avis: lignes.map(versAvis),
      releve_le: new Date().toISOString(),
      fenetre: 'base complète',
      avertissement: null,
    };
  } catch (e) {
    const j = depuisInstantane();
    j.avertissement = `Supabase injoignable (${(e as Error).message}). Relevé embarqué affiché.`;
    return j;
  }
}

type LigneSupabase = Record<string, unknown> & { artisans?: { nom: string } | { nom: string }[] | null };

function versAvis(r: LigneSupabase): Avis {
  const a = Array.isArray(r.artisans) ? r.artisans[0] : r.artisans;
  return {
    id: (r.id as string) ?? null,
    objet: (r.objet as string) ?? null,
    acheteur: (r.acheteur_nom as string) ?? null,
    metier: (r.metier as string) ?? null,
    classification: (r.classification_source as string) ?? null,
    departement: (r.departement as string) ?? null,
    commune: (r.commune as string) ?? null,
    montant: (r.montant_estime as number) ?? null,
    date_limite: (r.date_limite as string) ?? null,
    jours_restants: (r.jours_restants as number) ?? null,
    procedure: (r.procedure as string) ?? null,
    perimetre: (r.perimetre as string) ?? null,
    cpv: (r.cpv_principal as string) ?? null,
    alloti: Boolean(r.alloti),
    nb_lots: 0,
    accord_cadre: Boolean(r.accord_cadre),
    url_avis: (r.url_avis as string) ?? null,
    url_dce: (r.url_dce as string) ?? null,
    score: (r.score as number) ?? null,
    artisan: a?.nom ?? null,
    match_raison: (r.match_raison as string) ?? null,
    decision: (r.decision as string) ?? null,
  };
}

type LigneInstantane = (typeof instantane)['opportunites'][number];

function depuisInstantane(): Jeu {
  const brut = instantane as unknown as {
    genere_le: string;
    fenetre_jours: number;
    opportunites: LigneInstantane[];
  };

  return {
    mode: 'instantane',
    releve_le: brut.genere_le,
    fenetre: `${brut.fenetre_jours} jours`,
    avertissement: null,
    avis: brut.opportunites.map((o) => ({
      id: null,
      objet: o.objet,
      acheteur: o.acheteur,
      metier: o.metier,
      classification: o.classification,
      departement: o.departement,
      commune: o.commune,
      montant: o.montant,
      date_limite: o.date_limite,
      jours_restants: o.jours_restants,
      procedure: o.procedure,
      perimetre: o.perimetre,
      cpv: o.cpv,
      alloti: o.alloti,
      nb_lots: o.nb_lots,
      accord_cadre: o.accord_cadre,
      url_avis: o.url_avis,
      url_dce: o.url_dce,
      // Le scoring et le matching se calculent contre la table artisans,
      // absente de l'instantane.
      score: null,
      artisan: null,
      match_raison: null,
      decision: null,
    })),
  };
}
