import { chargerAvis, supabaseConfigure } from '@/lib/donnees';
import TableauDeBord from './TableauDeBord';

// Les avis changent deux fois par jour et les decisions sont ecrites en direct :
// jamais de page mise en cache.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const jeu = await chargerAvis();
  return <TableauDeBord jeu={jeu} ecritureActive={supabaseConfigure() && jeu.mode === 'live'} />;
}
