import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifier, metierDepuisCpv, normaliserObjet } from '../src/classify.ts';
import { parseAvis } from '../src/parsers/index.ts';
import type { AvisPivot } from '../src/types.ts';

const base = (p: Partial<AvisPivot> = {}): AvisPivot =>
  ({ cpv_principal: null, cpv_tous: [], objet: null, description: null, lots: [], ...p }) as AvisPivot;

describe('metierDepuisCpv', () => {
  it('classe les CPV cibles', () => {
    expect(metierDepuisCpv('45261210')).toBe('couverture'); // couverture
    expect(metierDepuisCpv('45261420')).toBe('couverture'); // etancheite
    expect(metierDepuisCpv('45262522')).toBe('maconnerie');
    expect(metierDepuisCpv('45262650')).toBe('bardage');
    expect(metierDepuisCpv('45443000')).toBe('bardage');
    expect(metierDepuisCpv('45112500')).toBe('vrd');
    expect(metierDepuisCpv('45233141')).toBe('vrd');
    expect(metierDepuisCpv('45112710')).toBe('paysage');
    expect(metierDepuisCpv('77311000')).toBe('paysage');
  });

  it('laisse la main aux mots-cles sur un CPV generique', () => {
    expect(metierDepuisCpv('45000000')).toBeNull();
    expect(metierDepuisCpv('45200000')).toBeNull();
  });

  it('donne la priorite au prefixe le plus specifique', () => {
    // 45262650 (bardage) ne doit pas etre avale par 45262 (maconnerie),
    // ni 45112700 (paysage) par 45112 (vrd).
    expect(metierDepuisCpv('45262650')).toBe('bardage');
    expect(metierDepuisCpv('45112700')).toBe('paysage');
  });
});

describe('classifier', () => {
  it('utilise le CPV en priorite', () => {
    const c = classifier(base({ cpv_principal: '45261210', objet: 'Entretien des espaces verts' }));
    expect(c).toEqual({ metier: 'couverture', source: 'cpv' });
  });

  it('retombe sur les mots-cles quand le CPV est generique', () => {
    const c = classifier(base({ cpv_principal: '45000000', objet: 'Réfection de la toiture de l’école' }));
    expect(c).toEqual({ metier: 'couverture', source: 'mots_cles' });
  });

  it('classe un MAPA sans CPV par son objet', () => {
    const c = classifier(base({ objet: 'Travaux de ravalement de façade' }));
    expect(c).toEqual({ metier: 'bardage', source: 'mots_cles' });
  });

  it('exploite un CPV secondaire quand le principal est hors sujet', () => {
    const c = classifier(base({ cpv_principal: '71631430', cpv_tous: ['71631430', '45261420'] }));
    expect(c.metier).toBe('couverture');
  });

  it('cherche aussi dans les intitules de lots', () => {
    const c = classifier(base({ objet: 'Rénovation du groupe scolaire', lots: [{ numero: '2', intitule: 'Couverture zinguerie', cpv: null, montant: null }] }));
    expect(c).toEqual({ metier: 'couverture', source: 'mots_cles' });
  });

  it('rend "autre" quand rien ne correspond', () => {
    expect(classifier(base({ objet: 'Fourniture de CD et DVD' })).metier).toBe('autre');
  });

  it('classe le MAPA reel de la fixture (couverture / facade)', () => {
    const avis = parseAvis(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/mapa-avec-lots.json'), 'utf8')));
    const c = classifier(avis);
    expect(c.source).toBe('mots_cles');
    expect(['couverture', 'bardage']).toContain(c.metier);
  });
});

describe('normaliserObjet', () => {
  it('supprime accents, ponctuation et casse', () => {
    expect(normaliserObjet("Réfection d'étanchéité — Toiture N°3")).toBe('refection d etancheite toiture n 3');
  });

  it('tolere null', () => {
    expect(normaliserObjet(null)).toBe('');
  });
});
