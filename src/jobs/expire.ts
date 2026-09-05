/**
 * Job quotidien : sortir de la liste active les avis dont le delai est passe
 * (spec §5.4). A lancer une fois par jour.
 */
import { creerClient } from '../config.ts';

const db = creerClient();

const { data, error } = await db
  .from('avis')
  .update({ etat: 'expire', updated_at: new Date().toISOString() })
  .in('etat', ['en_cours', 'rectifie'])
  .not('date_limite', 'is', null)
  .lt('date_limite', new Date().toISOString())
  .select('id');

if (error) {
  console.error(`Expiration : ${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`${data?.length ?? 0} avis passes a « expire ».`);
}
