-- PREREQUIS N°1 (spec §8, phase 0) : sans artisans, le scoring plafonne et le
-- matching ne rend rien. Dupliquer ce fichier en seed_artisans.sql (ignore par
-- git) et le remplir avec le reseau reel.
--
-- Champs qui pilotent reellement le scoring :
--   metiers      : couverture | maconnerie | bardage | vrd | paysage | piscine
--   departements : '75','77','78','91','92','93','94','95'
--   chantier_min / chantier_max : la fourchette que l'artisan sait absorber
--   decennale + decennale_expire_le : doit couvrir la date de remise des offres
--   attestations_ok : URSSAF + fiscale a jour — sans ca, candidature irrecevable
--   appetence_public : 0 a 5, subjectif, sert a departager les candidats

insert into artisans
  (nom, societe, telephone, email, metiers, departements,
   chantier_min, chantier_max, decennale, decennale_expire_le,
   attestations_ok, deja_repondu_ao, appetence_public, notes)
values
  ('Nom Prenom', 'Couverture Exemple SARL', '06 00 00 00 00', 'contact@exemple.fr',
   '{couverture,bardage}', '{93,94,75}',
   25000, 350000, true, '2028-06-30',
   true, false, 4, 'Exemple a remplacer.');
