import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DEFAUT } from '../src/config.ts';
import { dansLaZone, traiter, versLigne } from '../src/pipeline.ts';
import type { Artisan } from '../src/match.ts';
import type { AvisBrut } from '../src/sources/boamp.ts';
import type { AvisPivot } from '../src/types.ts';

const DIR = join(import.meta.dirname, 'fixtures');
const toutes = (): AvisBrut[] =>
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

const artisans: Artisan[] = [
  {
    id: 'a1', nom: 'Martin', societe: 'Couverture Martin', telephone: null, email: null,
    metiers: ['couverture', 'bardage'], departements: ['75', '92', '93', '95'],
    chantier_min: 20_000, chantier_max: 400_000, decennale: true, decennale_expire_le: '2028-01-01',
    attestations_ok: true, deja_repondu_ao: true, appetence_public: 4, actif: true,
  },
];

describe('dansLaZone', () => {
  const pivot = (p: Partial<AvisPivot>) => ({ departement: null, departements_publication: [], ...p }) as AvisPivot;
  const cibles = CONFIG_DEFAUT.departements_cibles;

  it('retient un lieu d execution dans la zone', () => {
    expect(dansLaZone(pivot({ departement: '93' }), cibles)).toBe(true);
  });

  it('ecarte un lieu d execution hors zone meme s il est publie a Paris', () => {
    // Cas reel : avis de Compiegne (60) publie aussi dans le 75.
    expect(dansLaZone(pivot({ departement: '60', departements_publication: ['60', '75'] }), cibles)).toBe(false);
  });

  it('se rabat sur la publication quand le lieu est introuvable', () => {
    expect(dansLaZone(pivot({ departements_publication: ['94'] }), cibles)).toBe(true);
    expect(dansLaZone(pivot({ departements_publication: ['33'] }), cibles)).toBe(false);
  });
});

describe('traiter', () => {
  const bilan = traiter(toutes(), artisans, CONFIG_DEFAUT, new Date('2026-09-05T08:00:00Z'));

  it('range chaque avis dans la bonne categorie', () => {
    expect(bilan.recus).toBe(toutes().length);
    expect(bilan.attributions.length).toBeGreaterThan(0);
    expect(bilan.mises_a_jour.length).toBeGreaterThan(0);
    // Les rectificatifs ne doivent jamais apparaitre comme des opportunites.
    expect(bilan.opportunites.every((o) => o.pivot.nature === 'APPEL_OFFRE')).toBe(true);
  });

  it('ne perd aucun avis en silence', () => {
    const classes =
      bilan.opportunites.length + bilan.attributions.length + bilan.mises_a_jour.length + bilan.hors_zone + bilan.erreurs.length;
    // Le solde correspond aux natures non exploitables (PRE-INFORMATION...).
    expect(classes).toBeLessThanOrEqual(bilan.recus);
    expect(bilan.erreurs).toHaveLength(0);
  });

  it('trie les opportunites par score decroissant', () => {
    const scores = bilan.opportunites.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('rattache chaque mise a jour a son avis initial', () => {
    expect(bilan.mises_a_jour.every((m) => m.annonce_lie !== null)).toBe(true);
  });
});

describe('versLigne', () => {
  const traite = traiter(toutes(), artisans, CONFIG_DEFAUT).opportunites[0]!;
  const ligne = versLigne(traite);

  it('produit une cle d upsert stable — l idempotence en depend', () => {
    expect(ligne.source).toBe('BOAMP');
    expect(ligne.source_id).toBe(traite.pivot.source_id);
    // updated_at trace la derniere observation : seul le reste doit etre stable.
    const sansHorodatage = (l: Record<string, unknown>) => ({ ...l, updated_at: null });
    expect(sansHorodatage(versLigne(traite))).toEqual(sansHorodatage(ligne));
  });

  it('marque montant_inconnu quand aucun montant n est publie', () => {
    expect(ligne.montant_inconnu).toBe(traite.pivot.montant_estime === null);
  });

  it('conserve le brut integralement', () => {
    expect(ligne.raw).toBe(traite.pivot.raw);
  });

  it('marque alloti des qu il y a plus d un lot', () => {
    const alloti = traiter(toutes(), artisans, CONFIG_DEFAUT).opportunites.map(versLigne).filter((l) => l.alloti);
    expect(alloti.every((l) => l.lot_numero === null)).toBe(true);
  });
});
