/** @type {import('next').NextConfig} */
export default {
  // Le tableau de bord lit Supabase a la demande : aucune page n'est
  // pre-rendue avec des donnees potentiellement perimees.
  eslint: { ignoreDuringBuilds: true },
};
