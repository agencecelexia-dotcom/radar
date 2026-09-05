import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rendreHtml, rendreTexte, sujet, type ContenuDigest, type LigneDigest } from '../src/notify.ts';

const ligne = (p: Partial<LigneDigest> = {}): LigneDigest => ({
  objet: 'Réfection de la toiture du groupe scolaire',
  acheteur_nom: 'Ville de Montreuil',
  departement: '93',
  metier: 'couverture',
  montant_estime: 180_000,
  montant_inconnu: false,
  jours_restants: 24,
  score: 88,
  url_avis: 'https://www.boamp.fr/avis/1',
  url_dce: 'https://plateforme.example/dce',
  artisan_nom: 'Couverture Martin',
  match_raison: null,
  ...p,
});

const contenu = (p: Partial<ContenuDigest> = {}): ContenuDigest => ({
  prioritaires: [ligne()],
  a_voir: [ligne({ score: 58, artisan_nom: null, match_raison: 'aucun couverture intervenant en 77' })],
  alertes: [],
  sans_artisan: [],
  dernier_run: '05/09/2026 06:00 — ok — 4 nouveaux',
  ...p,
});

describe('digest', () => {
  it('annonce le volume et les prioritaires dans le sujet', () => {
    expect(sujet(contenu())).toBe('RADAR — 2 avis, dont 1 prioritaire');
  });

  it('porte tout le necessaire pour decider en 30 secondes', () => {
    const t = rendreTexte(contenu());
    for (const attendu of ['Réfection de la toiture', 'Ville de Montreuil', '93', `180${'\u202f'}000 EUR`, '24 j restants', 'Couverture Martin', 'boamp.fr']) {
      expect(t).toContain(attendu);
    }
  });

  it('dit pourquoi aucun artisan ne convient', () => {
    expect(rendreTexte(contenu())).toContain('aucun couverture intervenant en 77');
  });

  it('signale un montant ou une date non publies au lieu d afficher 0', () => {
    const t = rendreTexte(contenu({ a_voir: [], prioritaires: [ligne({ montant_estime: null, montant_inconnu: true, jours_restants: null })] }));
    expect(t).toContain('montant non publie');
    expect(t).toContain('date limite non publiee');
    expect(t).not.toContain('0 EUR');
  });

  it('indique quand le DCE n est pas publie', () => {
    expect(rendreTexte(contenu({ prioritaires: [ligne({ url_dce: null })] }))).toContain('profil acheteur');
  });

  it('echappe le HTML', () => {
    const h = rendreHtml(contenu({ prioritaires: [ligne({ objet: '<script>alert(1)</script>' })] }));
    expect(h).not.toContain('<script>alert');
    expect(h).toContain('&lt;script&gt;');
  });

  it('rappelle le statut du dernier run', () => {
    expect(rendreTexte(contenu())).toContain('05/09/2026 06:00 — ok');
  });
});

describe('garde-fou legal', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/notify.ts'), 'utf8');

  it('n expose aucun moyen de choisir le destinataire', () => {
    // Le destinataire vient exclusivement de l'environnement (spec §1.4, §9.3).
    expect(src).toContain("env('RADAR_DIGEST_TO')");
    expect(src).not.toMatch(/to:\s*\[?\s*(destinataires|params|options|avis)/);
  });

  it('ne lit jamais les coordonnees d un acheteur', () => {
    expect(src).not.toMatch(/contact_email|contact_telephone|adresseMailContact/);
  });
});
