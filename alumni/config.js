// Configuration publique de l'application Alumni GSJC Rabat.
// Ces valeurs sont PUBLIQUES par conception : la sécurité repose sur les
// règles (Row Level Security) définies dans schema.sql, pas sur le secret de la clé.
// Ne jamais mettre ici la clé "secret" ou "service_role".

export const SUPABASE_URL = 'https://sxcvygaephuihzauzpse.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_rkD1HiBAzwZvMTabpOmRqQ_jUTiTOH_';

// Adresse e-mail à afficher dans la page « Protection des données »
// pour exercer ses droits (à compléter avec l'adresse officielle).
export const PRIVACY_CONTACT = '';

// Domaine des adresses e-mail de l'établissement (lycéens et personnel).
// Règles : lycéens = prenom.nom@<domaine> (le prénom peut se réduire à une ou deux lettres,
// ex. a.boulami@gsjc.ma) ; personnel = une adresse @<domaine> ; anciens élèves = adresse
// personnelle (les adresses @<domaine> leur sont fermées).
// La règle est APPLIQUÉE PAR LA BASE DE DONNÉES (fonction email_ok_for_type dans schema.sql) :
// si vous changez de domaine, changez-le aussi dans ce fichier SQL.
export const SCHOOL_EMAIL_DOMAIN = 'gsjc.ma';
