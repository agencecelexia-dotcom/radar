'use client';

import { useMemo, useState } from 'react';
import type { Avis, Jeu } from '@/lib/donnees';
import { DECISIONS, libelleMetier, urgence } from '@/lib/metiers';

const fmtMontant = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

export default function TableauDeBord({ jeu, ecritureActive }: { jeu: Jeu; ecritureActive: boolean }) {
  const [metier, setMetier] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [ouvertes, setOuvertes] = useState(true);
  const [motsCles, setMotsCles] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, string | null>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  const metiers = useMemo(() => compter(jeu.avis, (a) => a.metier), [jeu.avis]);
  const depts = useMemo(() => compter(jeu.avis, (a) => a.departement), [jeu.avis]);

  const vus = jeu.avis.filter(
    (a) =>
      (!metier || a.metier === metier) &&
      (!dept || a.departement === dept) &&
      (!ouvertes || (a.jours_restants !== null && a.jours_restants >= 0)) &&
      (!motsCles || a.classification === 'mots_cles'),
  );

  const ouvertesN = jeu.avis.filter((a) => a.jours_restants !== null && a.jours_restants >= 0).length;
  const prioritaires = jeu.avis.filter((a) => (a.score ?? 0) >= 70).length;
  const sansArtisan = jeu.avis.filter((a) => a.artisan === null && a.match_raison !== null).length;

  async function decider(avis: Avis, cle: string) {
    if (!avis.id || !ecritureActive) return;
    const actuel = decisions[avis.id] ?? avis.decision;
    const nouveau = actuel === cle ? null : cle;
    setEnCours(avis.id);
    setDecisions((d) => ({ ...d, [avis.id!]: nouveau }));
    try {
      const r = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: avis.id, decision: nouveau }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch {
      // On remet l'etat precedent : l'affichage ne doit jamais mentir sur la base.
      setDecisions((d) => ({ ...d, [avis.id!]: actuel ?? null }));
      alert("La décision n'a pas pu être enregistrée. Vérifiez la connexion à Supabase.");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="wrap">
      <header className="tete">
        <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 42 L32 14 L59 42" opacity=".45" />
            <path d="M13 42 L32 23 L51 42" opacity=".72" />
            <path d="M22 42 L32 32 L42 42" />
          </g>
          <circle cx="32" cy="47.5" r="4.8" fill="var(--accent)" />
        </svg>
        <div>
          <h1 className="titre">Chantiers publics Île-de-France</h1>
          <p className="sous">Appels d&apos;offres BTP détectés par RADAR dans le flux BOAMP.</p>
        </div>
        <div className="etatsrc">
          <span className={`puce ${jeu.mode}`} />
          {jeu.mode === 'live' ? (
            <>
              source <b>Supabase</b> · données live
            </>
          ) : (
            <>
              source <b>relevé embarqué</b> · {jeu.fenetre}
            </>
          )}
          <br />
          relevé le <b>{fmtDate(jeu.releve_le)}</b>
        </div>
      </header>

      {jeu.mode === 'instantane' && (
        <div className="bandeau">
          <h2>Mode relevé — Supabase n&apos;est pas encore branché</h2>
          {jeu.avertissement ? (
            <p>{jeu.avertissement}</p>
          ) : (
            <p>
              Cette page affiche un relevé réel du BOAMP, figé au {fmtDate(jeu.releve_le)}. Les liens
              fonctionnent, mais <strong>le score, l&apos;artisan suggéré et les décisions sont
              inactifs</strong> : ils se calculent contre la base et le réseau d&apos;artisans.
            </p>
          )}
          <p>Pour passer en données live :</p>
          <ol>
            <li>
              Créer le projet Supabase et appliquer <code>supabase/migrations/0001_init.sql</code>
            </li>
            <li>
              Remplir la table <code>artisans</code> — sans elle, ni score ni matching
            </li>
            <li>
              Renseigner <code>SUPABASE_URL</code> et <code>SUPABASE_SERVICE_ROLE_KEY</code> dans les
              variables d&apos;environnement Vercel
            </li>
            <li>
              Lancer <code>npm run ingest</code> pour remplir la base
            </li>
          </ol>
        </div>
      )}

      <h2 className="sec">Vue d&apos;ensemble</h2>
      <div className="tuiles">
        <Tuile n={jeu.avis.length} l="avis sur vos métiers" />
        <Tuile n={ouvertesN} l="encore dans les délais" fort />
        {/* Score et matching n'existent qu'en mode live : afficher deux zeros
            ressemblerait a une panne. On montre alors ce qui est calculable. */}
        {jeu.mode === 'live' ? (
          <>
            <Tuile n={prioritaires} l="prioritaires (score ≥ 70)" fort={prioritaires > 0} />
            <Tuile n={sansArtisan} l="sans artisan disponible" />
          </>
        ) : (
          <>
            <Tuile n={jeu.avis.filter((a) => a.accord_cadre).length} l="accords-cadres (récurrence)" />
            <Tuile n={jeu.avis.filter((a) => a.perimetre === 'MAPA').length} l="MAPA (moins de concurrence)" />
          </>
        )}
        <Tuile n={jeu.avis.filter((a) => a.classification === 'mots_cles').length} l="classés par mots-clés, à auditer" />
      </div>

      <h2 className="sec">Opportunités</h2>
      <div className="filtres">
        <div className="grp">
          <span className="lab">Métier</span>
          <Bouton actif={metier === null} onClick={() => setMetier(null)}>
            tous
          </Bouton>
          {metiers.map(([k, n]) => (
            <Bouton key={k} actif={metier === k} onClick={() => setMetier(k)}>
              {libelleMetier(k)} <span style={{ opacity: 0.55 }}>{n}</span>
            </Bouton>
          ))}
        </div>
        <div className="grp">
          <span className="lab">Dépt</span>
          <Bouton actif={dept === null} onClick={() => setDept(null)}>
            tous
          </Bouton>
          {depts
            .filter(([k]) => k !== '—')
            .map(([k]) => (
              <Bouton key={k} actif={dept === k} onClick={() => setDept(k)}>
                {k}
              </Bouton>
            ))}
        </div>
        <div className="grp">
          <Bouton actif={ouvertes} onClick={() => setOuvertes(!ouvertes)}>
            délai non expiré
          </Bouton>
          <Bouton actif={motsCles} onClick={() => setMotsCles(!motsCles)}>
            classés par mots-clés
          </Bouton>
        </div>
      </div>

      <p className="compte">
        {vus.length} avis affiché{vus.length > 1 ? 's' : ''} sur {jeu.avis.length}
      </p>

      <div className="liste">
        {vus.length === 0 && <p className="vide">Aucun avis ne correspond à ces filtres.</p>}
        {vus.map((a, i) => (
          <Ligne
            key={a.id ?? `${a.url_avis}-${i}`}
            avis={a}
            decision={a.id ? (decisions[a.id] ?? a.decision) : null}
            ecritureActive={ecritureActive}
            enCours={enCours === a.id}
            onDecider={decider}
          />
        ))}
      </div>

      <footer>
        Données du Bulletin officiel des annonces de marchés publics, réutilisées sous Licence
        Ouverte Etalab 2.0. RADAR ne dépose aucune candidature et n&apos;écrit jamais à un acheteur
        public : le dépôt reste manuel, sur le profil acheteur.
      </footer>
    </div>
  );
}

function Tuile({ n, l, fort }: { n: number; l: string; fort?: boolean }) {
  return (
    <div className={`tuile${fort ? ' fort' : ''}`}>
      <div className="n">{n.toLocaleString('fr-FR')}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function Bouton({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="f" aria-pressed={actif} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function Ligne({
  avis,
  decision,
  ecritureActive,
  enCours,
  onDecider,
}: {
  avis: Avis;
  decision: string | null;
  ecritureActive: boolean;
  enCours: boolean;
  onDecider: (a: Avis, cle: string) => void;
}) {
  const u = urgence(avis.jours_restants);
  const lieu = [avis.commune, avis.departement].filter(Boolean).join(', ');

  return (
    <article className="avis" data-u={u}>
      <div className="delai">
        {u === 'clos' ? (
          <span className="j">clos</span>
        ) : (
          <>
            <span className="j">{avis.jours_restants}</span>
            <span className="u">jours</span>
          </>
        )}
      </div>

      <div>
        <p className="objet">{avis.objet ?? '(sans objet)'}</p>
        <p className="meta">
          {avis.acheteur ?? 'acheteur non renseigné'}
          {lieu && (
            <>
              <span className="sep">·</span>
              {lieu}
            </>
          )}
        </p>
        <div className="tags">
          <span className="tag metier">{libelleMetier(avis.metier)}</span>
          {avis.classification === 'mots_cles' && <span className="tag alerte">mots-clés</span>}
          {avis.perimetre === 'MAPA' && <span className="tag">MAPA</span>}
          {avis.accord_cadre && <span className="tag">accord-cadre</span>}
          {avis.alloti && <span className="tag">{avis.nb_lots > 0 ? `${avis.nb_lots} lots` : 'alloti'}</span>}
          {avis.cpv && <span className="tag mono">CPV {avis.cpv}</span>}
        </div>
      </div>

      <div className="droite">
        {avis.score !== null && (
          <span className="score">
            {avis.score}
            <small>/100</small>
          </span>
        )}
        {avis.montant !== null ? (
          <span className="montant">{fmtMontant(avis.montant)}</span>
        ) : (
          <span className="montant np">montant non publié</span>
        )}
        {avis.artisan ? (
          <span className="artisan">{avis.artisan}</span>
        ) : (
          avis.match_raison && <span className="artisan aucun">{avis.match_raison}</span>
        )}
        <span className="liens">
          {avis.url_avis && (
            <a href={avis.url_avis} target="_blank" rel="noopener noreferrer">
              Avis
            </a>
          )}
          {avis.url_dce ? (
            <a href={avis.url_dce} target="_blank" rel="noopener noreferrer">
              DCE
            </a>
          ) : (
            <span className="absent">DCE non publié</span>
          )}
        </span>
        <span className="dec">
          {DECISIONS.map((d) => (
            <button
              key={d.cle}
              className="d"
              type="button"
              aria-pressed={decision === d.cle}
              disabled={!ecritureActive || enCours}
              title={ecritureActive ? undefined : 'Disponible une fois Supabase branché'}
              onClick={() => onDecider(avis, d.cle)}
            >
              {d.libelle}
            </button>
          ))}
        </span>
      </div>
    </article>
  );
}

function compter(avis: Avis[], cle: (a: Avis) => string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const a of avis) {
    const k = cle(a) ?? '—';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}
