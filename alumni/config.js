// Configuration publique de l'application Alumni GSJC Rabat.
// Ces valeurs sont PUBLIQUES par conception : la sécurité repose sur les
// règles (Row Level Security) définies dans schema.sql, pas sur le secret de la clé.
// Ne jamais mettre ici la clé "secret" ou "service_role".

export const SUPABASE_URL = 'https://sxcvygaephuihzauzpse.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_rkD1HiBAzwZvMTabpOmRqQ_jUTiTOH_';

// Adresse e-mail à afficher dans la page « Protection des données »
// pour exercer ses droits (à compléter avec l'adresse officielle).
export const PRIVACY_CONTACT = '';

// Optionnel : domaine des adresses e-mail des élèves, par exemple 'gsjc.ma'.
// S'il est renseigné, les lycéens doivent s'inscrire avec une adresse de ce domaine.
// (Simple aide à la saisie : la vraie vérification reste la validation par le CPE.)
export const STUDENT_EMAIL_DOMAIN = '';
