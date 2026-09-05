/**
 * Notifications (spec §7).
 *
 * GARDE-FOU LEGAL (spec §1.4, §9.3) — ce module est le SEUL point d'envoi du
 * logiciel, et il n'a qu'un destinataire possible : RADAR_DIGEST_TO.
 * Il n'expose aucune fonction permettant d'ecrire a un acheteur public, et ne
 * lit jamais les colonnes contact_*. Ne pas en ajouter, meme « au cas ou ».
 */
import { Resend } from 'resend';
import { env } from './config.ts';

export type LigneDigest = {
  objet: string | null;
  acheteur_nom: string | null;
  departement: string | null;
  metier: string | null;
  montant_estime: number | null;
  montant_inconnu: boolean;
  jours_restants: number | null;
  score: number | null;
  url_avis: string | null;
  url_dce: string | null;
  artisan_nom: string | null;
  match_raison: string | null;
};

export type ContenuDigest = {
  prioritaires: LigneDigest[];
  a_voir: LigneDigest[];
  alertes: LigneDigest[];
  sans_artisan: LigneDigest[];
  dernier_run: string;
};

export function sujet(c: ContenuDigest): string {
  const n = c.prioritaires.length + c.a_voir.length;
  const p = c.prioritaires.length > 0 ? `, dont ${c.prioritaires.length} prioritaire${c.prioritaires.length > 1 ? 's' : ''}` : '';
  return `RADAR — ${n} avis${p}`;
}

export function rendreTexte(c: ContenuDigest): string {
  const l: string[] = [];
  l.push(sujet(c));
  l.push('='.repeat(sujet(c).length), '');

  if (c.prioritaires.length > 0) {
    l.push('PRIORITAIRE — a traiter aujourd hui', '');
    for (const a of c.prioritaires) l.push(...blocDetaille(a), '');
  }

  if (c.a_voir.length > 0) {
    l.push('A VOIR', '');
    for (const a of c.a_voir) {
      // Meme en version condensee, on dit si le reseau ne peut pas suivre.
      const qui = a.artisan_nom ?? `sans artisan : ${a.match_raison ?? 'raison inconnue'}`;
      l.push(`  [${a.score}] ${a.metier ?? '?'} ${a.departement ?? '--'} ${montant(a)} — ${a.objet ?? ''} — ${qui}`);
    }
    l.push('');
  }

  if (c.alertes.length > 0) {
    l.push('ALERTES — echeance sous 5 jours sur un avis engage', '');
    for (const a of c.alertes) l.push(`  ${jours(a)} — ${a.objet ?? ''} (${a.url_avis ?? ''})`);
    l.push('');
  }

  if (c.sans_artisan.length > 0) {
    l.push('SANS ARTISAN DISPONIBLE — ou recruter', '');
    for (const a of c.sans_artisan) l.push(`  ${a.match_raison} — ${a.objet ?? ''}`);
    l.push('');
  }

  l.push(`--\nDernier run : ${c.dernier_run}`);
  return l.join('\n');
}

function blocDetaille(a: LigneDigest): string[] {
  return [
    `  [${a.score}] ${a.objet ?? '(sans objet)'}`,
    `       ${a.acheteur_nom ?? 'acheteur inconnu'} — ${a.departement ?? '--'} — ${a.metier ?? '?'}`,
    `       ${montant(a)} — ${jours(a)}`,
    `       Artisan : ${a.artisan_nom ?? `AUCUN (${a.match_raison ?? 'raison inconnue'})`}`,
    `       Avis : ${a.url_avis ?? '-'}`,
    `       DCE  : ${a.url_dce ?? 'non publie — a chercher sur le profil acheteur'}`,
  ];
}

export function rendreHtml(c: ContenuDigest): string {
  const s = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

  const carte = (a: LigneDigest) => `
    <tr><td style="padding:14px 16px;border:1px solid #e2e5ea;border-radius:8px;">
      <div style="font:600 15px/1.4 system-ui,sans-serif;color:#0f1826;">
        <span style="display:inline-block;min-width:34px;padding:2px 7px;margin-right:8px;border-radius:5px;background:#0f1826;color:#fff;font-size:12px;text-align:center;">${a.score ?? '-'}</span>
        ${s(a.objet ?? '(sans objet)')}
      </div>
      <div style="font:13px/1.7 system-ui,sans-serif;color:#5a6572;margin-top:6px;">
        ${s(a.acheteur_nom ?? 'acheteur inconnu')} &middot; ${s(a.departement ?? '--')} &middot; ${s(a.metier ?? '?')}<br>
        <strong>${s(montant(a))}</strong> &middot; ${s(jours(a))}<br>
        Artisan : ${a.artisan_nom ? `<strong>${s(a.artisan_nom)}</strong>` : `<span style="color:#b4472e;">aucun — ${s(a.match_raison ?? '')}</span>`}
      </div>
      <div style="font:13px system-ui,sans-serif;margin-top:10px;">
        <a href="${s(a.url_avis ?? '#')}" style="color:#1c4f8b;margin-right:14px;">Avis</a>
        ${a.url_dce ? `<a href="${s(a.url_dce)}" style="color:#1c4f8b;">DCE</a>` : '<span style="color:#98a1ad;">DCE non publie</span>'}
      </div>
    </td></tr><tr><td style="height:10px;"></td></tr>`;

  const section = (titre: string, lignes: LigneDigest[], couleur: string) =>
    lignes.length === 0
      ? ''
      : `<tr><td style="padding:22px 0 10px;font:700 12px system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${couleur};">${titre}</td></tr>
         <tr><td><table width="100%" cellpadding="0" cellspacing="0">${lignes.map(carte).join('')}</table></td></tr>`;

  return `<div style="max-width:680px;margin:0 auto;padding:24px;background:#f7f8fa;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font:700 20px system-ui,sans-serif;color:#0f1826;padding-bottom:4px;">RADAR</td></tr>
      <tr><td style="font:14px system-ui,sans-serif;color:#5a6572;">${s(sujet(c))}</td></tr>
      ${section('Prioritaire', c.prioritaires, '#b4472e')}
      ${section('A voir', c.a_voir, '#0f1826')}
      ${section('Alertes — echeance sous 5 jours', c.alertes, '#b4472e')}
      ${section('Sans artisan disponible — ou recruter', c.sans_artisan, '#5a6572')}
      <tr><td style="padding-top:20px;border-top:1px solid #e2e5ea;font:12px system-ui,sans-serif;color:#98a1ad;">
        Dernier run : ${s(c.dernier_run)}
      </td></tr>
    </table></div>`;
}

/**
 * Envoie le digest. Destinataire unique, lu depuis l'environnement.
 * Aucun appelant ne peut choisir le destinataire — c'est volontaire.
 */
export async function envoyer(objet: string, texte: string, html: string): Promise<void> {
  const destinataire = env('RADAR_DIGEST_TO');
  const resend = new Resend(env('RESEND_API_KEY'));
  const { error } = await resend.emails.send({
    from: env('RADAR_DIGEST_FROM'),
    to: [destinataire],
    subject: objet,
    text: texte,
    html,
  });
  if (error) throw new Error(`Envoi du digest : ${error.message}`);
}

function montant(a: LigneDigest): string {
  return a.montant_estime === null ? 'montant non publie' : `${Math.round(a.montant_estime).toLocaleString('fr-FR')} EUR`;
}

function jours(a: LigneDigest): string {
  if (a.jours_restants === null) return 'date limite non publiee';
  if (a.jours_restants < 0) return 'delai depasse';
  return `${a.jours_restants} j restants`;
}
