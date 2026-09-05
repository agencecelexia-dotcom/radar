/**
 * Capture des avis BOAMP reels dans test/fixtures/.
 *
 * On selectionne des cas representatifs de chaque dialecte ET les cas limites
 * identifies pendant la validation d'API (plan §1.7) : absence de CPV,
 * absence de date limite, montant "0.00", rectificatif avec annonce_lie.
 *
 * Ces fixtures sont commitees : les tests des parsers doivent tourner hors ligne.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAvisBruts } from '../src/sources/boamp.ts';
import type { AvisBrut } from '../src/sources/boamp.ts';

const OUT = join(import.meta.dirname, '..', 'test', 'fixtures');

/** Un cas a capturer : nom de fichier + predicat de selection. */
type Cas = { nom: string; test: (a: AvisBrut) => boolean };

const CAS: Cas[] = [
  {
    nom: 'eforms-appel-offre',
    test: (a) => a.perimetre === 'DIRECTIVE-24' && a.nature === 'APPEL_OFFRE' && !!a.datelimitereponse,
  },
  {
    nom: 'eforms-multi-lots',
    // Les lots sont un tableau : la cle n'apparait qu'une fois, on compte les
    // identifiants "LOT-000x" a l'interieur.
    test: (a) =>
      a.perimetre === 'DIRECTIVE-24' &&
      a.nature === 'APPEL_OFFRE' &&
      (a.donnees?.match(/"LOT-\d+"/g)?.length ?? 0) > 2,
  },
  {
    nom: 'eforms-montant-zero',
    test: (a) => a.perimetre === 'DIRECTIVE-24' && /EstimatedOverallContractAmount[^}]*"0\.00"/.test(a.donnees ?? ''),
  },
  {
    nom: 'eforms-attribution',
    test: (a) => a.perimetre === 'DIRECTIVE-24' && a.nature === 'ATTRIBUTION',
  },
  {
    nom: 'fnsimple-appel-offre',
    test: (a) => a.perimetre === 'FNSimple' && a.nature === 'APPEL_OFFRE',
  },
  {
    nom: 'fnsimple-rectificatif',
    test: (a) => a.perimetre === 'FNSimple' && a.nature === 'RECTIFICATIF' && !!a.annonce_lie?.length,
  },
  {
    nom: 'mapa-sans-cpv',
    test: (a) => a.perimetre === 'MAPA' && !/classPrincipale/.test(a.donnees ?? ''),
  },
  {
    nom: 'mapa-avec-lots',
    test: (a) => a.perimetre === 'MAPA' && /"lot"/.test(a.donnees ?? ''),
  },
  {
    nom: 'sans-date-limite',
    test: (a) => a.nature === 'APPEL_OFFRE' && !a.datelimitereponse,
  },
];

/** Mots-cles des metiers cibles, pour privilegier des avis realistes. */
const PERTINENT = /toiture|couvertur|charpent|etancheit|étanchéit|maconner|maçonner|ravalement|facade|façade|bardage|espaces verts|voirie|terrassement|paysag/i;

const avis = await fetchAvisBruts({ depuis: isoIlYA(45), departements: ['75', '77', '78', '91', '92', '93', '94', '95'] });
console.log(`${avis.length} avis recuperes sur 45 jours.`);

mkdirSync(OUT, { recursive: true });

for (const cas of CAS) {
  const candidats = avis.filter(cas.test);
  if (candidats.length === 0) {
    console.warn(`  /!\\  aucun avis pour le cas "${cas.nom}"`);
    continue;
  }
  // On prefere un avis d'un metier cible : la fixture sert aussi a tester la classification.
  const choisi = candidats.find((a) => PERTINENT.test(a.objet ?? '')) ?? candidats[0]!;
  writeFileSync(join(OUT, `${cas.nom}.json`), JSON.stringify(anonymiser(choisi), null, 2) + '\n');
  console.log(`  ok  ${cas.nom.padEnd(24)} <- ${choisi.idweb} (${candidats.length} candidats)`);
}

/**
 * Retire les coordonnees personnelles avant ecriture.
 *
 * Les avis exposent des noms, emails et telephones de contacts acheteurs. Ces
 * fixtures sont commitees dans un depot public : les republier contredirait la
 * regle « contact_* jamais exporte » (spec §1.4). Les parsers n'en ont pas
 * besoin — seule la structure compte.
 */
function anonymiser<T>(avis: T): T {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-zA-Z]{2,}/g;
  const TEL = /\b0\d(?:[ .-]?\d{2}){4}\b/g;
  // Conteneurs de donnees personnelles : leurs champs nominatifs sont remplaces.
  const CONTEXTES = new Set(['cac:Contact', 'coord', 'correspondantPRM', 'PersonnePhysique', 'adressesComplt']);
  const CHAMPS = new Set(['nom', 'prenom', 'civilite', 'Name', 'cbc:Name', 'mel', 'tel', 'cbc:ElectronicMail', 'cbc:Telephone', 'cbc:JobTitle']);

  const parcourir = (v: unknown, perso: boolean): unknown => {
    if (typeof v === 'string') {
      return v.replace(EMAIL, 'contact@example.invalid').replace(TEL, '01 00 00 00 00');
    }
    if (Array.isArray(v)) return v.map((x) => parcourir(x, perso));
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => {
          const ctx = perso || CONTEXTES.has(k);
          if (ctx && CHAMPS.has(k) && typeof val === 'string') {
            return [k, k === 'tel' || k === 'cbc:Telephone' ? '01 00 00 00 00' : 'CONTACT ANONYMISE'];
          }
          return [k, parcourir(val, ctx)];
        }),
      );
    }
    return v;
  };

  const copie = { ...(avis as Record<string, unknown>) };
  // Les blobs sont du JSON serialise : les rouvrir pour les nettoyer en profondeur.
  for (const champ of ['donnees', 'gestion']) {
    const blob = copie[champ];
    if (typeof blob === 'string' && blob) {
      copie[champ] = JSON.stringify(parcourir(JSON.parse(blob), false));
    }
  }
  for (const [k, v] of Object.entries(copie)) {
    if (typeof v === 'string' && k !== 'donnees' && k !== 'gestion') copie[k] = parcourir(v, false);
  }
  return copie as T;
}

function isoIlYA(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}
