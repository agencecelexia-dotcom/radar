import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAUT } from '../src/config.ts';
import { scorer, joursRestants } from '../src/score.ts';
import { trouverArtisan, type Artisan } from '../src/match.ts';
import type { AvisPivot } from '../src/types.ts';

const MAINTENANT = new Date('2026-09-05T08:00:00Z');
const poids = CONFIG_DEFAUT.poids;

const artisan = (p: Partial<Artisan> = {}): Artisan => ({
  id: 'a1',
  nom: 'Dupont',
  societe: 'Toitures Dupont',
  telephone: null,
  email: null,
  metiers: ['couverture'],
  departements: ['93'],
  chantier_min: 20_000,
  chantier_max: 300_000,
  decennale: true,
  decennale_expire_le: '2027-12-31',
  attestations_ok: true,
  deja_repondu_ao: false,
  appetence_public: 3,
  actif: true,
  ...p,
});

const avis = (p: Partial<AvisPivot> = {}): AvisPivot =>
  ({
    departement: '93',
    montant_estime: 150_000,
    date_limite: '2026-10-05T12:00:00Z',
    procedure: 'open',
    accord_cadre: false,
    ...p,
  }) as AvisPivot;

const entree = (a: AvisPivot, artisans: Artisan[]) => ({
  avis: a,
  metier: 'couverture' as const,
  artisans,
  poids,
  montantMin: CONFIG_DEFAUT.montant_min,
  montantMax: CONFIG_DEFAUT.montant_max,
  maintenant: MAINTENANT,
});

describe('scorer', () => {
  it('score un avis ideal haut', () => {
    const r = scorer(entree(avis(), [artisan()]));
    // 30 metier + 20 dept + 20 montant + 15 delai + 5 ouverte = 90
    expect(r.total).toBe(90);
    expect(r.elimine).toBe(false);
  });

  it('elimine un metier absent du reseau', () => {
    const r = scorer({ ...entree(avis(), [artisan()]), metier: 'piscine' });
    expect(r.elimine).toBe(true);
    expect(r.total).toBe(0);
    expect(r.motif_elimination).toMatch(/piscine/);
  });

  it('elimine un metier non identifie', () => {
    const r = scorer({ ...entree(avis(), [artisan()]), metier: 'autre' });
    expect(r.elimine).toBe(true);
  });

  it('ne penalise pas un montant non publie', () => {
    const r = scorer(entree(avis({ montant_estime: null }), [artisan()]));
    const m = r.contributions.find((c) => c.critere === 'montant')!;
    expect(m.points).toBe(poids.montant_inconnu);
    expect(m.motif).toMatch(/non publie/);
  });

  it('annule les points de montant hors fourchette', () => {
    const r = scorer(entree(avis({ montant_estime: 2_000_000 }), [artisan()]));
    expect(r.contributions.find((c) => c.critere === 'montant')!.points).toBe(0);
  });

  it('note un departement limitrophe a mi-chemin', () => {
    const r = scorer(entree(avis({ departement: '75' }), [artisan({ departements: ['93'] })]));
    expect(r.contributions.find((c) => c.critere === 'departement')!.points).toBe(poids.departement_limitrophe);
  });

  it('bonifie la procedure adaptee par rapport a l ouverte', () => {
    const mapa = scorer(entree(avis({ procedure: 'adaptee' }), [artisan()]));
    const ouverte = scorer(entree(avis({ procedure: 'open' }), [artisan()]));
    expect(mapa.total).toBeGreaterThan(ouverte.total);
  });

  it('degrade le score a mesure que le delai se reduit', () => {
    const loin = scorer(entree(avis({ date_limite: '2026-10-15T12:00:00Z' }), [artisan()])).total;
    const proche = scorer(entree(avis({ date_limite: '2026-09-07T12:00:00Z' }), [artisan()])).total;
    expect(loin).toBeGreaterThan(proche);
  });

  it('reste neutre sans date limite plutot que d eliminer', () => {
    const r = scorer(entree(avis({ date_limite: null }), [artisan()]));
    expect(r.elimine).toBe(false);
    expect(r.contributions.find((c) => c.critere === 'delai')!.points).toBe(poids.delai_7_14j);
  });

  it('plafonne a 100', () => {
    const r = scorer(entree(avis({ procedure: 'adaptee', accord_cadre: true }), [artisan()]));
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it('explique chaque point attribue', () => {
    const r = scorer(entree(avis(), [artisan()]));
    expect(r.contributions.reduce((s, c) => s + c.points, 0)).toBe(r.total);
    expect(r.contributions.every((c) => c.motif.length > 0)).toBe(true);
  });
});

describe('joursRestants', () => {
  it('compte les jours pleins', () => {
    expect(joursRestants('2026-09-15T08:00:00Z', MAINTENANT)).toBe(10);
  });
  it('tolere une date absente', () => {
    expect(joursRestants(null, MAINTENANT)).toBeNull();
  });
});

describe('trouverArtisan', () => {
  it('retient le meilleur candidat', () => {
    const a = artisan({ id: 'a1', appetence_public: 2 });
    const b = artisan({ id: 'b1', appetence_public: 5 });
    expect(trouverArtisan(avis(), 'couverture', [a, b]).artisan?.id).toBe('b1');
  });

  it('departage par experience des marches publics', () => {
    const a = artisan({ id: 'a1', deja_repondu_ao: false });
    const b = artisan({ id: 'b1', deja_repondu_ao: true });
    expect(trouverArtisan(avis(), 'couverture', [a, b]).artisan?.id).toBe('b1');
  });

  it('ecarte une decennale expirant avant la remise des offres', () => {
    const r = trouverArtisan(avis(), 'couverture', [artisan({ decennale_expire_le: '2026-09-20' })]);
    expect(r.artisan).toBeNull();
    expect(r.raison).toMatch(/decennale/);
  });

  it('nomme la contrainte bloquante — le signal de recrutement', () => {
    expect(trouverArtisan(avis(), 'couverture', [artisan({ departements: ['77'] })]).raison).toBe(
      'aucun couverture intervenant en 93',
    );
    expect(trouverArtisan(avis(), 'couverture', [artisan({ attestations_ok: false })]).raison).toMatch(/attestations/);
    expect(trouverArtisan(avis({ montant_estime: 500_000 }), 'couverture', [artisan()]).raison).toMatch(/capacite/);
  });

  it('accepte un montant inconnu plutot que de bloquer', () => {
    expect(trouverArtisan(avis({ montant_estime: null }), 'couverture', [artisan()]).artisan).not.toBeNull();
  });
});
