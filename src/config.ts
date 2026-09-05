/**
 * Configuration : variables d'environnement pour les secrets, table `config`
 * pour tout le reste (spec §9.7 — parametrer, ne pas coder en dur).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : on s'appuie sur l'environnement (cron, CI).
}

export function env(cle: string): string {
  const v = process.env[cle];
  if (!v) throw new Error(`Variable d'environnement manquante : ${cle}`);
  return v;
}

export function creerClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

export type Poids = {
  metier: number;
  departement_direct: number;
  departement_limitrophe: number;
  montant_ok: number;
  montant_inconnu: number;
  delai_sup_21j: number;
  delai_14_21j: number;
  delai_7_14j: number;
  delai_3_7j: number;
  procedure_adaptee: number;
  procedure_ouverte: number;
  procedure_restreinte: number;
  accord_cadre: number;
};

export type Config = {
  last_run_boamp: string | null;
  departements_cibles: string[];
  montant_min: number;
  montant_max: number;
  score_seuil_notif: number;
  score_seuil_prio: number;
  score_seuil_immediat: number;
  poids: Poids;
};

export const CONFIG_DEFAUT: Config = {
  last_run_boamp: null,
  departements_cibles: ['75', '77', '78', '91', '92', '93', '94', '95'],
  montant_min: 20_000,
  montant_max: 600_000,
  score_seuil_notif: 50,
  score_seuil_prio: 70,
  score_seuil_immediat: 85,
  poids: {
    metier: 30,
    departement_direct: 20,
    departement_limitrophe: 10,
    montant_ok: 20,
    montant_inconnu: 10,
    delai_sup_21j: 15,
    delai_14_21j: 12,
    delai_7_14j: 8,
    delai_3_7j: 3,
    procedure_adaptee: 10,
    procedure_ouverte: 5,
    procedure_restreinte: 2,
    accord_cadre: 5,
  },
};

export async function lireConfig(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from('config').select('cle, valeur');
  if (error) throw new Error(`Lecture de config : ${error.message}`);

  const brut = Object.fromEntries((data ?? []).map((r) => [r.cle, r.valeur]));
  return {
    ...CONFIG_DEFAUT,
    ...brut,
    poids: { ...CONFIG_DEFAUT.poids, ...(brut['poids'] ?? {}) },
  } as Config;
}

export async function ecrireConfig(db: SupabaseClient, cle: string, valeur: unknown): Promise<void> {
  const { error } = await db.from('config').upsert({ cle, valeur }, { onConflict: 'cle' });
  if (error) throw new Error(`Ecriture de config.${cle} : ${error.message}`);
}
