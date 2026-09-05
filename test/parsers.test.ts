/**
 * Tests des parsers sur des avis BOAMP reels (test/fixtures/).
 * Ils doivent tourner hors ligne : aucune requete reseau ici.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAvis } from '../src/parsers/index.ts';
import type { AvisBrut } from '../src/sources/boamp.ts';

const DIR = join(import.meta.dirname, 'fixtures');

function fixture(nom: string): AvisBrut {
  return JSON.parse(readFileSync(join(DIR, `${nom}.json`), 'utf8'));
}

describe('eForms (DIRECTIVE-*)', () => {
  const avis = parseAvis(fixture('eforms-appel-offre'));

  it('resout le vrai acheteur, pas le prestataire de publication', () => {
    // Piege : la premiere organisation du blob est « Avenue-Web Systemes »,
    // qui publie l'avis. L'acheteur est designe par reference ORG-xxxx.
    expect(avis.acheteur_nom).toBe("Communauté d'agglomération Val Parisis");
    expect(avis.acheteur_nom).not.toMatch(/Avenue-Web/);
  });

  it('extrait le CPV principal', () => {
    expect(avis.cpv_principal).toMatch(/^\d{8}$/);
    expect(avis.cpv_tous.length).toBeGreaterThan(0);
  });

  it('situe le chantier au lieu d execution, pas chez le prestataire', () => {
    // Le prestataire est a Seyssinet-Pariset (38170) : ne doit jamais gagner.
    expect(avis.departement).toBe('95');
    expect(avis.code_postal).not.toBe('38170');
  });

  it('prend EndpointID comme lien DCE, pas l accueil de la plateforme', () => {
    expect(avis.url_dce).toContain('marches-publics.info');
    expect(avis.url_dce).not.toBe('https://www.valparisis.fr/');
  });

  it('reconstitue la date limite depuis EndDate + EndTime', () => {
    expect(avis.date_limite).toBe(new Date('2026-10-02T12:00:00+02:00').toISOString());
  });

  it('lit le montant estime', () => {
    expect(avis.montant_estime).toBe(350000);
  });
});

describe('eForms — cas limites', () => {
  it('traite le montant "0.00" comme inconnu, jamais comme 0 EUR', () => {
    // Sinon l'avis serait juge hors fourchette et elimine a tort (plan §1.7).
    const avis = parseAvis(fixture('eforms-montant-zero'));
    expect(avis.montant_estime).not.toBe(0);
    expect(avis.montant_estime === null || avis.montant_estime > 0).toBe(true);
  });

  it('extrait tous les lots d un avis alloti', () => {
    const avis = parseAvis(fixture('eforms-multi-lots'));
    expect(avis.lots.length).toBeGreaterThan(2);
    expect(avis.lots.every((l) => l.numero !== null)).toBe(true);
  });

  it('reconnait un avis d attribution', () => {
    expect(parseAvis(fixture('eforms-attribution')).nature).toBe('ATTRIBUTION');
  });
});

describe('FNSimple', () => {
  const avis = parseAvis(fixture('fnsimple-appel-offre'));

  it('lit le SIRET dans codeIdentificationNational', () => {
    // Le champ `siret` de l'API est systematiquement vide.
    expect(avis.acheteur_siret).toBe('21600158600017');
  });

  it('deduit le departement du lieu d execution, pas de la publication', () => {
    // code_departement vaut ['2','51','60','75','80'] : ce sont les
    // departements de PUBLICATION. Le chantier est a Compiegne (60).
    expect(avis.departements_publication).toContain('75');
    expect(avis.departement).toBe('60');
  });

  it('extrait CPV, objet et date limite', () => {
    expect(avis.cpv_principal).toBe('45262512');
    expect(avis.objet).toMatch(/confortement/i);
    expect(avis.date_limite).toBe(new Date('2026-10-05T14:00:00+02:00').toISOString());
  });

  it('rattache un rectificatif a son avis initial', () => {
    const rect = parseAvis(fixture('fnsimple-rectificatif'));
    expect(rect.nature).toBe('RECTIFICATIF');
    expect(rect.annonce_lie).toMatch(/^\d{2}-\d+$/);
  });
});

describe('MAPA', () => {
  const avis = parseAvis(fixture('mapa-sans-cpv'));

  it('n a pas de CPV — la classification devra passer par les mots-cles', () => {
    expect(avis.cpv_principal).toBeNull();
  });

  it('extrait objet, acheteur, date limite et lien DCE malgre l absence de CPV', () => {
    expect(avis.objet).toBeTruthy();
    expect(avis.acheteur_nom).toBe('ESSET Property Management');
    expect(avis.date_limite).toBe(new Date('2026-09-28T16:00:00+02:00').toISOString());
    expect(avis.url_dce).toContain('achatpublic.com');
  });

  it('est toujours une procedure adaptee', () => {
    expect(avis.procedure).toBe('adaptee');
  });

  it('extrait les lots', () => {
    const lots = parseAvis(fixture('mapa-avec-lots')).lots;
    expect(lots.length).toBeGreaterThanOrEqual(2);
    expect(lots[0]?.intitule).toBeTruthy();
  });
});

describe('robustesse', () => {
  it('parse toutes les fixtures sans lever', () => {
    const noms = readdirSync(DIR).filter((f) => f.endsWith('.json'));
    expect(noms.length).toBeGreaterThan(5);
    for (const n of noms) {
      const avis = parseAvis(fixture(n.replace(/\.json$/, '')));
      expect(avis.source_id, n).toBeTruthy();
      expect(avis.raw, n).toBeTruthy();
    }
  });

  it('conserve un avis dont le blob est illisible plutot que de le perdre', () => {
    const casse = { ...fixture('mapa-sans-cpv'), donnees: '{ ceci n est pas du json' };
    const avis = parseAvis(casse);
    expect(avis.source_id).toBe(casse.idweb);
    expect(avis.objet).toBe(casse.objet);
  });
});
