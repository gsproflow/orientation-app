// Alumni GSJC Rabat : étape 1
// Inscription, profil + photo obligatoires, validation par l'administration.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PRIVACY_CONTACT, SCHOOL_EMAIL_DOMAIN } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */
const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Toute donnée saisie par un utilisateur passe par esc() avant d'être affichée.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPE_LABEL = { alumni: 'Ancien élève', student: 'Lycéen', staff: 'Personnel' };
const STUDY_FIELDS = {
  law: 'Droit & sciences politiques', health: 'Médecine, pharmacie & santé', engineering: 'Sciences & ingénierie',
  it: 'Informatique & numérique', business: 'Commerce, gestion & économie', humanities: 'Lettres, langues & sciences humaines',
  arts: 'Arts, design & architecture', comms: 'Communication & journalisme', education: 'Éducation & enseignement', other: 'Autre domaine',
};
const studyLabel = (k) => STUDY_FIELDS[k] || 'Non renseigné';

// Règle des adresses e-mail : même logique que la base de données (qui fait foi).
const SCHOOL = SCHOOL_EMAIL_DOMAIN.toLowerCase();
const STUDENT_RE = new RegExp('^[a-z]+(-[a-z]+)*\\.[a-z]+(-[a-z]+)*[0-9]{0,3}@' + SCHOOL.replace(/\./g, '\\.') + '$');
const EX_STUDENT = `a.boulami@${SCHOOL}`;
function emailError(type, raw) {
  const em = (raw || '').trim().toLowerCase();
  const school = em.endsWith('@' + SCHOOL);
  if (type === 'student') {
    if (STUDENT_RE.test(em)) return '';
    return school
      ? `Cette adresse ne respecte pas le format prenom.nom@${SCHOOL} (exemple : ${EX_STUDENT}).`
      : `Les lycéens s’inscrivent uniquement avec leur adresse scolaire : prenom.nom@${SCHOOL} (exemple : ${EX_STUDENT}).`;
  }
  if (type === 'staff') return school && /^[^@\s]+@/.test(em) ? '' : `Le personnel s’inscrit avec son adresse professionnelle @${SCHOOL}.`;
  return school ? `Les adresses @${SCHOOL} sont réservées aux lycéens et au personnel. Les anciens élèves utilisent une adresse personnelle.` : '';
}
const TYPE_RULE = {
  student: `Lycéens : inscription uniquement avec votre adresse scolaire prenom.nom@${SCHOOL} (exemple : ${EX_STUDENT}). Les adresses personnelles ne sont pas acceptées.`,
  staff: `Personnel : utilisez votre adresse professionnelle @${SCHOOL}.`,
  alumni: `Anciens élèves : utilisez une adresse personnelle (les adresses @${SCHOOL} ne sont pas acceptées).`,
};
const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateTime = (d) =>
  new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (p) => ((p.first_name || p.email || '?').charAt(0) + (p.last_name || '').charAt(0)).toUpperCase();

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), kind === 'err' ? 7000 : 3500);
}

function errMsg(err) {
  const m = (err && (err.message || err.error_description)) || String(err);
  const map = [
    [/Invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
    [/Email not confirmed/i, 'Votre adresse e-mail n’est pas encore confirmée. Ouvrez le message de confirmation reçu par e-mail.'],
    [/already registered|already been registered/i, 'Un compte existe déjà avec cette adresse e-mail.'],
    [/rate limit|too many|security purposes/i, 'Trop de tentatives. Réessayez dans quelques minutes.'],
    [/at least \d+ characters/i, 'Le mot de passe doit contenir au moins 8 caractères.'],
    [/different from the old password/i, 'Le nouveau mot de passe doit être différent de l’ancien.'],
    [/Database error saving new user|non conforme/i, `Inscription refusée : l’adresse e-mail ne respecte pas la règle de votre type de compte (lycéens : prenom.nom@${SCHOOL_EMAIL_DOMAIN} ; personnel : @${SCHOOL_EMAIL_DOMAIN} ; anciens élèves : adresse personnelle).`],
    [/Failed to fetch|NetworkError|Load failed/i, 'Connexion impossible. Vérifiez votre connexion internet.'],
    [/row-level security|permission denied/i, 'Action non autorisée.'],
    [/mime type|not supported/i, 'Format de fichier non accepté (JPEG, PNG ou WebP).'],
    [/exceeded the maximum|too large|payload/i, 'Fichier trop volumineux.'],
  ];
  for (const [re, fr] of map) if (re.test(m)) return fr;
  // Messages métier déjà en français renvoyés par la base (schema.sql).
  if (/^(Profil incomplet|Modification non autorisée|Changement de statut|Le type de compte|Trop de messages|Cette personne|Limite atteinte|Destinataire|Vous ne pouvez pas|Accès réservé|Conversation introuvable|Ce type de compte|Ce message ne peut plus|Message introuvable|Le statut de propriétaire|Un lycéen ne peut pas|Seul le propriétaire|Le propriétaire ne peut|Un propriétaire ne|Réservé au propriétaire|Compte introuvable|Ce compte ne peut)/.test(m)) return m;
  return 'Une erreur est survenue. Réessayez, ou contactez l’administration si cela continue. (' + m + ')';
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

// Liens externes : on ne fabrique que des URL https sûres.
const instagramUrl = (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`;
const safeLinkedin = (u) => (/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(u || '') ? u : null);

function normInstagram(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '');
  s = s.split(/[/?#]/)[0];
  return s;
}
function normLinkedin(raw) {
  let s = (raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/^http:\/\//i, 'https://');
}

/* Photos privées : on demande à Supabase un lien temporaire. */
const urlCache = new Map();
async function photoUrl(path) {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('avatars').createSignedUrl(path, 3600);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3300 * 1000 });
  return data.signedUrl;
}
async function photoUrls(paths) {
  const need = paths.filter((p) => p && !(urlCache.get(p)?.exp > Date.now()));
  if (need.length) {
    const { data } = await sb.storage.from('avatars').createSignedUrls(need, 3600);
    (data || []).forEach((d) => {
      if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3300 * 1000 });
    });
  }
  return Object.fromEntries(paths.filter(Boolean).map((p) => [p, urlCache.get(p)?.url || null]));
}
const avatarHtml = (p, url, cls = '') =>
  url ? `<img class="avatar ${cls}" src="${esc(url)}" alt="">` : `<div class="avatar ${cls}" aria-hidden="true">${esc(initials(p))}</div>`;

/* Fenêtre modale */
function openModal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
  document.body.classList.add('noscroll');
  const box = $('.modal-box', m);
  (box.querySelector('textarea, input, button') || box).focus?.();
  return box;
}
function closeModal() {
  $$('.modal').forEach((m) => m.remove());
  document.body.classList.remove('noscroll');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */
let session = null;
let profile = null;
let recovering = false;
let currentUid = null;
let currentView = null;
let pendingPhoto = null; // { blob, url }
let adminTab = 'pending';
let adminRows = new Map();

async function loadProfile() {
  const uid = session.user.id;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  profile = data;
  return data;
}

/* ------------------------------------------------------------------ */
/* Squelette de page                                                   */
/* ------------------------------------------------------------------ */
function shell(inner, { wide = false } = {}) {
  destroyMap();
  const approved = profile?.status === 'approved';
  const isAdmin = approved && profile.role === 'admin';
  const h = location.hash || '#/';
  const act = (r) => (h === r || (r !== '#/' && h.startsWith(r + '/')) ? 'active' : '');
  const badge = (cls, id) => `<span ${id ? `id="${id}" ` : ''}class="badge ${cls}" hidden></span>`;
  const nav = session
    ? `<nav class="nav" aria-label="Menu">
        ${approved ? `<a class="dlink ${act('#/')}" href="#/">Accueil</a>
          <a class="dlink ${act('#/annuaire')}" href="#/annuaire">Annuaire</a>
          <a class="dlink ${act('#/carte')}" href="#/carte">Carte</a>
          <a class="dlink ${act('#/actus')}" href="#/actus">Actualités ${badge('js-content-badge')}</a>
          <a class="dlink ${act('#/agenda')}" href="#/agenda">Agenda</a>
          <a class="dlink ${act('#/offres')}" href="#/offres">Offres</a>
          <a class="dlink ${act('#/messages')}" href="#/messages">Messages ${badge('js-msg-badge', 'navMsgBadge')}</a>` : ''}
        ${isAdmin ? `<a class="dlink ${act('#/admin')}" href="#/admin">Administration ${badge('js-admin-badge', 'navBadge')}</a>
          <a class="mlink ${act('#/admin')}" href="#/admin">⚙ Admin ${badge('js-admin-badge')}</a>` : ''}
        ${approved ? `<a class="dlink ${act('#/profil')}" href="#/profil">Mon profil</a>` : ''}
        <button class="linkbtn ${approved ? 'dlink' : ''}" data-action="privacy">Vie privée</button>
        <button class="linkbtn" data-action="logout">Déconnexion</button>
      </nav>`
    : `<nav class="nav"><button class="linkbtn" data-action="privacy">Vie privée</button></nav>`;
  const tab = (href, icon, label, extra = '', on = null) =>
    `<a class="tab ${on === null ? act(href) : (on ? 'active' : '')}" href="${href}"><span class="ti" aria-hidden="true">${icon}</span><span>${label}</span>${extra}</a>`;
  const tabbar = approved
    ? `<nav class="tabbar" aria-label="Navigation principale">
        ${tab('#/', '🏠', 'Accueil')}${tab('#/annuaire', '👥', 'Annuaire')}${tab('#/carte', '🗺️', 'Carte')}
        ${tab('#/actus', '📰', 'Actus', badge('js-content-badge'), h === '#/actus' || h === '#/agenda' || h === '#/offres')}
        ${tab('#/messages', '💬', 'Messages', badge('js-msg-badge'))}${tab('#/profil', '👤', 'Profil')}
      </nav>` : '';
  document.body.classList.toggle('has-tabbar', approved);
  app.innerHTML = `
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/"><img src="icons/monogram.png" alt=""><span>Alumni <b>GSJC</b> Rabat</span></a>
      ${nav}
    </div></header>
    <main class="main ${wide ? 'wide' : ''}" id="main">${inner}</main>
    <footer class="foot">© Groupe Scolaire Jacques Chirac · Rabat ·
      <button class="linkbtn" data-action="privacy">Protection des données</button></footer>
    ${tabbar}`;
  window.scrollTo(0, 0);
  setUnread(unread);
  setAdminBadge(adminBadgeN);
  setContentBadge(contentNew);
}

/* ------------------------------------------------------------------ */
/* Démarrage et routage                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  currentUid = session?.user.id ?? null;

  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; setTimeout(render, 0); return; }
    const uid = s?.user.id ?? null;
    // Supabase renvoie SIGNED_IN à chaque retour sur l'onglet : on ne
    // redessine que si la personne connectée a vraiment changé.
    if (uid !== currentUid) { currentUid = uid; profile = null; stopLive(); setTimeout(render, 0); }
  });

  window.addEventListener('hashchange', () => { if (profile && session && !recovering) route(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfPending(); });
  setInterval(() => { refreshIfPending(); pollLive(); }, 25000);

  await render();
}

async function render() {
  try {
    if (recovering) return viewNewPassword();
    if (!session) return viewAuth('login');
    app.innerHTML = '<p class="boot">Chargement…</p>';
    await loadProfile();
    if (!profile) return viewProblem('Votre profil est introuvable. Déconnectez-vous puis réessayez, ou contactez l’administration.');
    route();
  } catch (err) {
    const missing = err && (err.code === 'PGRST205' || err.code === '42P01' || /schema cache|does not exist/i.test(err.message || ''));
    viewProblem(missing
      ? 'La base de données n’est pas encore initialisée. L’administrateur doit exécuter le script schema.sql dans Supabase.'
      : errMsg(err));
  }
}

function route() {
  const h = location.hash || '#/';
  currentView = null;
  const s = profile.status;
  if (s === 'approved') startLive(); else stopLive();
  if (h === '#/profil') return viewForm();
  if (s === 'draft') return viewForm();
  if (s === 'pending') return viewPending();
  if (s === 'rejected') return viewRejected();
  if (h.startsWith('#/messages')) return viewMessages(h.split('/')[2]);
  if (h === '#/annuaire') return viewDirectory();
  if (h === '#/carte') return viewMap();
  if (h === '#/actus') return viewFeed('news');
  if (h === '#/agenda') return viewFeed('events');
  if (h === '#/offres') return viewOffers();
  if (h === '#/admin' && profile.role === 'admin') return viewAdmin();
  if (h === '#/stats' && profile.role === 'admin') return viewStats();
  return viewHome();
}

async function refreshIfPending() {
  if (currentView !== 'pending' || !session || document.hidden) return;
  try {
    const before = profile.status;
    await loadProfile();
    if (profile && profile.status !== before) route();
  } catch { /* silencieux */ }
}

function go(hash) {
  history.replaceState(null, '', hash);
  route();
}

function viewProblem(msg) {
  shell(`<section class="card state"><div class="icon no">!</div><h1>Oups</h1><p>${esc(msg)}</p>
    ${session ? '<p><button class="btn ghost" data-action="logout">Se déconnecter</button></p>' : ''}</section>`);
}

/* ------------------------------------------------------------------ */
/* Connexion / création de compte                                      */
/* ------------------------------------------------------------------ */
function viewAuth(mode = 'login', prefillType = 'alumni') {
  const isLogin = mode === 'login';
  shell(`
    <section class="card auth">
      <img class="logo-full" src="../assets/logo-gsjc-aefe.png" alt="Groupe Scolaire Jacques Chirac, établissement partenaire de l’AEFE">
      <h1>Espace Alumni</h1>
      <p class="lead">Retrouvez les anciens élèves du GSJC, échangez avec eux et construisez votre réseau.</p>
      <div class="seg" role="tablist">
        <button role="tab" data-action="authTab" data-mode="login" aria-selected="${isLogin}">Connexion</button>
        <button role="tab" data-action="authTab" data-mode="signup" aria-selected="${!isLogin}">Créer un compte</button>
      </div>
      ${isLogin ? `
      <form id="loginForm" novalidate>
        <div class="field"><label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <p class="err" id="authErr" role="alert"></p>
        <button class="btn block" type="submit">Se connecter</button>
        <p style="margin-top:12px;text-align:center"><button type="button" class="linkbtn" data-action="forgot">Mot de passe oublié ?</button></p>
      </form>` : `
      <form id="signupForm" novalidate>
        <div class="field"><span class="lbl-t">Vous êtes</span>
          <div class="choices">
            ${['alumni', 'student', 'staff'].map((t) => `<label class="choice"><input type="radio" name="member_type" value="${t}" ${t === prefillType ? 'checked' : ''}><span>${TYPE_LABEL[t]}</span></label>`).join('')}
          </div>
          <p class="hint" id="typeHint"></p>
        </div>
        <div class="field"><label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required>
          <p class="hint" id="emailHint" aria-live="polite"></p></div>
        <div class="field"><label for="password">Mot de passe <span class="hint">(8 caractères minimum)</span></label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="password2">Confirmez le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" required></div>
        <div class="info-banner small">À l’étape suivante, vous compléterez votre profil. Votre inscription sera ensuite <b>vérifiée par l’administration</b> du groupe scolaire avant d’être activée.</div>
        <p class="err" id="authErr" role="alert"></p>
        <button class="btn block" type="submit">Créer mon compte</button>
      </form>`}
    </section>`);

  const err = (m) => { $('#authErr').textContent = m || ''; };

  if (isLogin) {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      err('');
      const f = new FormData(e.target);
      const btn = $('button[type=submit]', e.target);
      busy(btn, true, 'Connexion…');
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim().toLowerCase(), password: f.get('password') });
      busy(btn, false);
      if (error) err(errMsg(error));
    });
  } else {
    const hint = () => {
      const t = $('input[name=member_type]:checked').value;
      $('#typeHint').textContent = TYPE_RULE[t];
      const v = $('#email').value.trim();
      const eh = $('#emailHint');
      if (!v) { eh.textContent = ''; eh.className = 'hint'; return; }
      const e = emailError(t, v);
      eh.textContent = e ? '⚠ ' + e : '✓ Adresse conforme';
      eh.className = 'hint ' + (e ? 'bad' : 'good');
    };
    $$('input[name=member_type]').forEach((r) => r.addEventListener('change', hint));
    $('#email').addEventListener('input', hint);
    hint();

    $('#signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      err('');
      const f = new FormData(e.target);
      const email = f.get('email').trim().toLowerCase();
      const type = f.get('member_type');
      if (!/^\S+@\S+\.\S+$/.test(email)) return err('Adresse e-mail invalide.');
      const rule = emailError(type, email);
      if (rule) return err(rule);
      if (f.get('password').length < 8) return err('Le mot de passe doit contenir au moins 8 caractères.');
      if (f.get('password') !== f.get('password2')) return err('Les deux mots de passe ne sont pas identiques.');
      const btn = $('button[type=submit]', e.target);
      busy(btn, true, 'Création…');
      const { data, error } = await sb.auth.signUp({
        email,
        password: f.get('password'),
        options: {
          data: { member_type: type },
          emailRedirectTo: location.origin + location.pathname,
        },
      });
      busy(btn, false);
      if (error) return err(errMsg(error));
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        return err('Un compte existe déjà avec cette adresse e-mail. Utilisez « Connexion » ou « Mot de passe oublié ».');
      }
      if (!data.session) viewCheckEmail(email); // confirmation par e-mail requise
      // sinon, onAuthStateChange déclenche l'affichage du formulaire de profil
    });
  }
}

function viewCheckEmail(email) {
  shell(`<section class="card state">
    <div class="icon wait">✉</div>
    <h1>Vérifiez votre boîte e-mail</h1>
    <p>Nous avons envoyé un message de confirmation à <b>${esc(email)}</b>.</p>
    <p class="muted">Cliquez sur le lien qu’il contient, puis revenez vous connecter. Pensez à regarder dans vos courriers indésirables.</p>
    <p><button class="btn ghost" data-action="authTab" data-mode="login">Aller à la connexion</button></p>
  </section>`);
}

function viewForgot() {
  shell(`<section class="card auth">
    <h1>Mot de passe oublié</h1>
    <p class="lead">Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
    <form id="forgotForm" novalidate>
      <div class="field"><label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <p class="err" id="authErr" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Envoyer le lien</button>
      <button class="btn ghost" type="button" data-action="authTab" data-mode="login">Retour</button></div>
    </form></section>`);
  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email').trim();
    if (!email) return;
    const btn = $('button[type=submit]', e.target);
    busy(btn, true, 'Envoi…');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    busy(btn, false);
    if (error) return ($('#authErr').textContent = errMsg(error));
    toast('Si un compte existe pour cette adresse, un e-mail vient d’être envoyé.');
    viewAuth('login');
  });
}

function viewNewPassword() {
  shell(`<section class="card auth">
    <h1>Nouveau mot de passe</h1>
    <form id="pwForm" novalidate>
      <div class="field"><label for="p1">Nouveau mot de passe</label><input id="p1" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="p2">Confirmez</label><input id="p2" type="password" autocomplete="new-password" required></div>
      <p class="err" id="authErr" role="alert"></p>
      <button class="btn block" type="submit">Enregistrer</button>
    </form></section>`);
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#p1').value, b = $('#p2').value;
    if (a.length < 8) return ($('#authErr').textContent = 'Au moins 8 caractères.');
    if (a !== b) return ($('#authErr').textContent = 'Les deux mots de passe ne sont pas identiques.');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return ($('#authErr').textContent = errMsg(error));
    recovering = false;
    toast('Mot de passe modifié.');
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Formulaire de profil                                                */
/* ------------------------------------------------------------------ */
function viewForm() {
  currentView = 'form';
  pendingPhoto = null;
  const p = profile;
  const isNew = p.status === 'draft' || p.status === 'rejected';
  const v = (k) => esc(p[k] ?? '');
  const lockType = p.status === 'approved';
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear + 1; y >= 1995; y--) years.push(y);
  const sw = (name, label, def) =>
    `<label class="switch"><input type="checkbox" name="${name}" ${p[name] ?? def ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;

  shell(`
    <form id="profileForm" novalidate>
      <section class="card accent">
        <h1>${isNew ? 'Complétez votre profil' : 'Mon profil'}</h1>
        <p class="muted" style="margin-top:4px">${isNew
          ? 'Tous les champs marqués <span class="req">*</span> sont obligatoires pour envoyer votre demande d’inscription.'
          : 'Modifiez vos informations et vos choix de visibilité.'}</p>
        ${p.status === 'rejected' ? `<div class="warn-banner" style="margin-top:12px"><b>Votre précédente demande n’a pas été acceptée.</b>${p.review_note ? '<br>Motif : ' + esc(p.review_note) : ''}<br>Corrigez votre profil puis renvoyez-le.</div>` : ''}
        <div class="form-banner" id="formErr" role="alert" hidden></div>
      </section>

      <section class="card">
        <h2 class="section-title">Vous êtes <span class="req">*</span></h2>
        <div class="choices">
          ${['alumni', 'student', 'staff'].map((t) => `<label class="choice"><input type="radio" name="member_type" value="${t}" ${p.member_type === t ? 'checked' : ''} ${(lockType || emailError(t, p.email)) && p.member_type !== t ? 'disabled' : ''}><span>${TYPE_LABEL[t]}</span></label>`).join('')}
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">Votre photo <span class="req">*</span></h2>
        <div class="photo-pick field" data-field="photo">
          <div id="photoPreview">${avatarHtml(p, null, 'lg')}</div>
          <div>
            <input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp,image/*" hidden>
            <button type="button" class="btn ghost" data-action="pickPhoto">Choisir une photo</button>
            <p class="hint">Une photo de votre visage, claire. Elle sera recadrée en carré.</p>
            <p class="err" data-err="photo"></p>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">Identité</h2>
        <div class="grid2">
          <div class="field" data-field="first_name"><label for="first_name">Prénom <span class="req">*</span></label><input id="first_name" name="first_name" type="text" maxlength="80" autocomplete="given-name" value="${v('first_name')}"><p class="err" data-err="first_name"></p></div>
          <div class="field" data-field="last_name"><label for="last_name">Nom <span class="req">*</span></label><input id="last_name" name="last_name" type="text" maxlength="80" autocomplete="family-name" value="${v('last_name')}"><p class="err" data-err="last_name"></p></div>
        </div>
        <div class="field"><label>Adresse e-mail</label><input type="text" value="${esc(p.email)}" disabled></div>
      </section>

      <!-- Anciens élèves -->
      <section class="card" data-for="alumni">
        <h2 class="section-title">Vos études</h2>
        <div class="grid2">
          <div class="field" data-field="graduation_year"><label for="graduation_year">Année du bac / diplôme <span class="req">*</span></label>
            <select id="graduation_year" name="graduation_year"><option value="">Choisir…</option>${years.map((y) => `<option value="${y}" ${p.graduation_year === y ? 'selected' : ''}>${y}</option>`).join('')}</select><p class="err" data-err="graduation_year"></p></div>
          <div class="field" data-field="country"><label for="country">Pays d’études <span class="req">*</span></label>
            <select id="country" name="country"><option value="">Choisir…</option></select><p class="err" data-err="country"></p></div>
          <div class="field" data-field="city"><label for="city">Ville <span class="req">*</span></label>
            <input id="city" name="city" type="text" maxlength="80" list="cityList" autocomplete="off" value="${v('city')}">
            <datalist id="cityList"></datalist>
            <p class="hint" id="cityHint"></p><p class="err" data-err="city"></p></div>
          <div class="field" data-field="school"><label for="school">Université / école <span class="req">*</span></label><input id="school" name="school" type="text" maxlength="150" value="${v('school')}"><p class="err" data-err="school"></p></div>
        </div>
        <div class="field" data-field="program"><label for="program">Formation suivie <span class="req">*</span></label><input id="program" name="program" type="text" maxlength="150" placeholder="Ex. : Licence d’économie, Classe préparatoire MPSI…" value="${v('program')}"><p class="err" data-err="program"></p></div>
        <div class="field" data-field="study_field"><label for="study_field">Domaine d’études <span class="req">*</span></label>
          <select id="study_field" name="study_field"><option value="">Choisir…</option>${Object.entries(STUDY_FIELDS).map(([k, l]) => `<option value="${k}" ${p.study_field === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <p class="hint">Sert aux statistiques sur le devenir des élèves du GSJC.</p><p class="err" data-err="study_field"></p></div>
        <h3 style="margin:8px 0">Réseaux sociaux <span class="req">*</span> <span class="hint small" style="font-weight:400">(au moins un)</span></h3>
        <div class="grid2">
          <div class="field" data-field="linkedin"><label for="linkedin">LinkedIn</label><input id="linkedin" name="linkedin" type="text" inputmode="url" placeholder="linkedin.com/in/votre-nom" value="${v('linkedin')}"><p class="err" data-err="linkedin"></p></div>
          <div class="field" data-field="instagram"><label for="instagram">Instagram</label><input id="instagram" name="instagram" type="text" placeholder="@votre.identifiant" value="${p.instagram ? '@' + v('instagram') : ''}"><p class="err" data-err="instagram"></p></div>
        </div>
        <p class="err" data-err="social"></p>
      </section>

      <!-- Lycéens -->
      <section class="card" data-for="student">
        <h2 class="section-title">Votre parcours</h2>
        <div class="field" data-field="class_level"><label for="class_level">Classe <span class="req">*</span></label>
          <select id="class_level" name="class_level"><option value="">Choisir…</option>${['Seconde', 'Première', 'Terminale'].map((c) => `<option ${p.class_level === c ? 'selected' : ''}>${c}</option>`).join('')}</select><p class="err" data-err="class_level"></p></div>
        <div class="field" data-field="target_program"><label for="target_program">Vos projets d’études / d’orientation <span class="req">*</span></label>
          <input id="target_program" name="target_program" type="text" maxlength="150" placeholder="Ex. : médecine, école d’ingénieurs, droit…" value="${v('target_program')}"><p class="err" data-err="target_program"></p></div>
      </section>

      <!-- Personnel -->
      <section class="card" data-for="staff">
        <h2 class="section-title">Votre fonction</h2>
        <div class="field" data-field="job_title"><label for="job_title">Fonction <span class="req">*</span></label>
          <input id="job_title" name="job_title" type="text" maxlength="120" placeholder="Ex. : Professeur de mathématiques" value="${v('job_title')}"><p class="err" data-err="job_title"></p></div>
      </section>

      <section class="card">
        <h2 class="section-title">Comment peut-on vous contacter ?</h2>
        <p class="hint" style="margin-bottom:6px">Vous choisissez les moyens de contact que vous acceptez. Vous pourrez les modifier à tout moment.</p>
        <div class="switches">
          ${sw('contact_email', 'Par e-mail (mon adresse sera visible par les membres)', false)}
          <label class="switch"><input type="checkbox" name="contact_message" ${p.contact_message || p.contact_chat ? 'checked' : ''}><span class="track"></span><span>Par message / chat dans l’application</span></label>
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">Ce que les autres membres peuvent voir</h2>
        <p class="hint" style="margin-bottom:6px">Seuls les membres validés par l’établissement et l’administration du GSJC y ont accès. Votre nom et prénom restent toujours visibles.</p>
        <div class="switches">
          ${sw('show_photo', 'Ma photo', true)}
          ${sw('show_location', 'Mon pays et ma ville', true)}
          ${sw('show_study', 'Mon établissement et ma formation', true)}
          ${sw('show_social', 'Mes réseaux sociaux', true)}
        </div>
      </section>

      <section class="card">
        <div class="field" data-field="consent" style="margin:0">
          ${p.consent_at
            ? `<p class="small">✔ Consentement donné le ${fmtDate(p.consent_at)}. <button type="button" class="linkbtn" data-action="privacy">Relire la politique de confidentialité</button></p>`
            : `<label class="check"><input type="checkbox" name="consent"><span>J’ai lu la <button type="button" class="linkbtn" data-action="privacy">politique de protection des données</button> et j’accepte que mes informations soient partagées <b>uniquement</b> avec les membres validés et l’administration du GSJC. <span class="req">*</span></span></label>
               <p class="err" data-err="consent"></p>`}
        </div>
      </section>

      <div class="row" style="margin-bottom:16px">
        <button class="btn block" type="submit" id="saveBtn">${isNew ? 'Envoyer ma demande d’inscription' : 'Enregistrer'}</button>
        ${isNew ? '' : '<a class="btn ghost block" href="#/">Annuler</a>'}
      </div>

      <section class="danger-zone">
        <h3>Supprimer mon compte</h3>
        <p class="small muted" style="margin:4px 0 10px">Vos informations, votre photo et vos messages seront définitivement effacés.</p>
        <button type="button" class="btn danger-ghost sm" data-action="deleteAccount">Supprimer mon compte</button>
      </section>
    </form>`);

  const form = $('#profileForm');
  const applyType = () => {
    const t = $('input[name=member_type]:checked', form).value;
    $$('[data-for]', form).forEach((el) => (el.hidden = el.dataset.for !== t));
  };
  $$('input[name=member_type]', form).forEach((r) => r.addEventListener('change', applyType));
  applyType();

  initGeoFields(form, p);

  // Aperçu de la photo actuelle
  photoUrl(p.photo_path).then((u) => { if (u && !pendingPhoto) $('#photoPreview').innerHTML = avatarHtml(p, u, 'lg'); });

  $('#photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const blob = await squareJpeg(file, 640);
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
      pendingPhoto = { blob, url: URL.createObjectURL(blob) };
      $('#photoPreview').innerHTML = `<img class="avatar lg" src="${pendingPhoto.url}" alt="Aperçu de votre photo">`;
      $('[data-err=photo]').textContent = '';
    } catch {
      toast('Cette image n’a pas pu être lue. Essayez un fichier JPEG ou PNG.', 'err');
    }
    e.target.value = '';
  });

  form.addEventListener('submit', submitProfile);
}

// Recadre au carré (centre) et réduit l'image : moins de stockage, chargement rapide.
async function squareJpeg(file, size) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(side, size);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('image');
  return blob;
}

function readForm(form) {
  const fd = new FormData(form);
  const g = (k) => (fd.get(k) || '').toString().trim();
  const t = g('member_type') || profile.member_type;
  const out = {
    member_type: t,
    first_name: g('first_name'),
    last_name: g('last_name'),
    graduation_year: null, country: null, city: null, school: null, program: null,
    instagram: null, linkedin: null, class_level: null, target_program: null, job_title: null,
    country_code: null, lat: null, lng: null, study_field: null,
    contact_email: fd.has('contact_email'),
    contact_message: fd.has('contact_message'),
    contact_chat: fd.has('contact_message'), // message et chat forment un seul système
    show_photo: fd.has('show_photo'),
    show_location: fd.has('show_location'),
    show_study: fd.has('show_study'),
    show_social: fd.has('show_social'),
    show_email: fd.has('contact_email'), // l'adresse n'est partagée que si le contact par e-mail est accepté
  };
  if (t === 'alumni') {
    out.graduation_year = parseInt(g('graduation_year'), 10) || null;
    out.country = g('country') || null;
    out.country_code = form.querySelector('#country')?.selectedOptions[0]?.dataset.code || null;
    out.city = g('city') || null;
    out.school = g('school') || null;
    out.program = g('program') || null;
    out.study_field = g('study_field') || null;
    out.instagram = normInstagram(g('instagram')) || null;
    out.linkedin = normLinkedin(g('linkedin')) || null;
  } else if (t === 'student') {
    out.class_level = g('class_level') || null;
    out.target_program = g('target_program') || null;
  } else {
    out.job_title = g('job_title') || null;
  }
  return { out, consent: fd.has('consent') };
}

function validateProfile(v, consent) {
  const e = [];
  const need = (k, msg = 'Ce champ est obligatoire.') => { if (!v[k]) e.push([k, msg]); };
  need('first_name'); need('last_name');
  if (!profile.photo_path && !pendingPhoto) e.push(['photo', 'Une photo est obligatoire.']);
  if (v.member_type === 'alumni') {
    ['graduation_year', 'country', 'city', 'school', 'program', 'study_field'].forEach((k) => need(k));
    if (v.country && !v.country_code) e.push(['country', 'Choisissez un pays dans la liste.']);
    if (!v.linkedin && !v.instagram) e.push(['social', 'Renseignez au moins un réseau social (LinkedIn ou Instagram).']);
    if (v.linkedin && !/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/\S+$/i.test(v.linkedin)) e.push(['linkedin', 'Lien LinkedIn invalide (ex. linkedin.com/in/votre-nom).']);
    if (v.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(v.instagram)) e.push(['instagram', 'Identifiant Instagram invalide.']);
  } else if (v.member_type === 'student') {
    need('class_level'); need('target_program');
  } else {
    need('job_title');
  }
  if (!profile.consent_at && !consent) e.push(['consent', 'Votre consentement est nécessaire pour continuer.']);
  return e;
}

async function submitProfile(ev) {
  ev.preventDefault();
  const form = ev.target;
  const { out, consent } = readForm(form);

  // Réinitialise les erreurs
  $$('[data-err]', form).forEach((n) => (n.textContent = ''));
  $$('.field.invalid', form).forEach((n) => n.classList.remove('invalid'));
  $('#formErr').hidden = true;

  const errors = validateProfile(out, consent);
  if (errors.length) {
    errors.forEach(([k, msg]) => {
      const n = $(`[data-err="${k}"]`, form);
      if (n) n.textContent = msg;
      $(`[data-field="${k}"]`, form)?.classList.add('invalid');
    });
    const banner = $('#formErr');
    banner.textContent = 'Veuillez corriger les champs signalés avant de continuer.';
    banner.hidden = false;
    const first = $(`[data-field="${errors[0][0]}"]`, form) || $(`[data-err="${errors[0][0]}"]`, form);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = $('#saveBtn');
  busy(btn, true, 'Envoi en cours…');
  if (out.member_type === 'alumni') {
    // Position sur la carte : calculée ici à partir de la liste de villes, sans service extérieur.
    const pos = await resolvePosition(out.country_code, out.city);
    if (pos) { out.city = pos.n; out.lat = pos.la; out.lng = pos.ln; }
  }
  const uid = session.user.id;
  const oldPhoto = profile.photo_path;
  let newPath = null;
  try {
    let photo_path = oldPhoto;
    if (pendingPhoto) {
      newPath = `${uid}/avatar-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('avatars').upload(newPath, pendingPhoto.blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      photo_path = newPath;
    }
    const wasNew = profile.status === 'draft' || profile.status === 'rejected';
    const payload = { ...out, photo_path, consent_at: profile.consent_at || new Date().toISOString() };
    if (wasNew) payload.status = 'pending';

    const { data, error } = await sb.from('profiles').update(payload).eq('id', uid).select().single();
    if (error) throw error;

    if (pendingPhoto && oldPhoto && oldPhoto !== newPath) await sb.storage.from('avatars').remove([oldPhoto]);
    profile = data;
    pendingPhoto = null;
    urlCache.clear();
    toast(wasNew ? 'Votre demande a bien été envoyée.' : 'Profil enregistré.');
    go('#/');
  } catch (err) {
    if (newPath) sb.storage.from('avatars').remove([newPath]).catch(() => {});
    busy(btn, false);
    toast(errMsg(err), 'err');
  }
}

/* ------------------------------------------------------------------ */
/* États du compte                                                     */
/* ------------------------------------------------------------------ */
async function mountThread(el, userId, asAdmin) {
  el.innerHTML = '<p class="muted small">Chargement des messages…</p>';
  const { data, error } = await sb.from('admin_messages').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) { el.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const bubbles = (data || []).map((m) => `
    <div class="bubble ${m.from_admin ? 'admin' : 'user'}">
      <span class="who">${m.from_admin ? 'Administration GSJC' : 'Vous'} · ${fmtDateTime(m.created_at)}</span>${esc(m.body)}
    </div>`).join('');
  el.innerHTML = `
    ${bubbles ? `<div class="thread" id="thread">${bubbles}</div>` : ''}
    <form class="composer" novalidate>
      <textarea maxlength="2000" required placeholder="${asAdmin ? 'Votre message à cette personne…' : 'Une question ? Écrivez à l’administration…'}" aria-label="Message"></textarea>
      <button class="btn ${asAdmin ? '' : 'ghost'}" type="submit">Envoyer le message</button>
    </form>`;
  const th = $('#thread', el); if (th) th.scrollTop = th.scrollHeight;
  $('form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('textarea', e.target);
    const body = ta.value.trim();
    if (!body) return;
    const btn = $('button', e.target);
    busy(btn, true, 'Envoi…');
    const { error: err } = await sb.from('admin_messages').insert({ user_id: userId, from_admin: asAdmin, body });
    if (err) { busy(btn, false); return toast(errMsg(err), 'err'); }
    mountThread(el, userId, asAdmin);
  });
}

function viewPending() {
  currentView = 'pending';
  shell(`
    <section class="card state accent">
      <div class="icon wait">⏳</div>
      <span class="pill wait">En attente de validation</span>
      <h1>Votre demande a bien été reçue</h1>
      <p>Merci ${esc(profile.first_name || '')} ! L’administration du groupe scolaire va vérifier votre inscription.</p>
      <p class="muted">L’application s’ouvrira automatiquement dès que votre compte sera validé : revenez simplement sur cette page.</p>
      <p><a class="btn ghost" href="#/profil">Modifier mes informations</a></p>
    </section>
    <section class="card">
      <h2>Messages avec l’administration</h2>
      <div id="threadBox"></div>
    </section>`);
  mountThread($('#threadBox'), profile.id, false);
}

function viewRejected() {
  currentView = 'rejected';
  shell(`
    <section class="card state">
      <div class="icon no">✕</div>
      <span class="pill no">Demande non acceptée</span>
      <h1>Votre demande n’a pas pu être validée</h1>
      ${profile.review_note ? `<p><b>Motif :</b> ${esc(profile.review_note)}</p>` : ''}
      <p class="muted">Vous pouvez corriger votre profil et renvoyer votre demande, ou écrire à l’administration.</p>
      <p><a class="btn" href="#/profil">Corriger et renvoyer ma demande</a></p>
    </section>
    <section class="card"><h2>Messages avec l’administration</h2><div id="threadBox"></div></section>`);
  mountThread($('#threadBox'), profile.id, false);
}

async function viewHome() {
  currentView = 'home';
  const isAdmin = profile.role === 'admin';
  shell(`
    ${profile.member_type === 'alumni' && !profile.study_field ? `<div class="warn-banner">🎓 <b>Un dernier détail :</b> indiquez votre <b>domaine d’études</b> pour aider l’établissement à suivre le devenir des élèves.
      <a class="btn sm" style="margin-left:6px" href="#/profil">Compléter mon profil</a></div>` : ''}
    <section class="card hero accent">
      <div id="homeAvatar">${avatarHtml(profile, null, 'lg')}</div>
      <div>
        <span class="pill ok">Compte validé</span>
        <h1>Bienvenue ${esc(profile.first_name || '')} !</h1>
        <p class="muted">${esc(TYPE_LABEL[profile.member_type])}${profile.graduation_year ? ' · Promotion ' + esc(profile.graduation_year) : ''}${profile.class_level ? ' · ' + esc(profile.class_level) : ''}</p>
      </div>
    </section>
    <div id="homeUnread"></div>
    <div id="homeFeed"></div>
    <section class="card">
      <h2>Votre profil est validé</h2>
      <p>Merci d’avoir rejoint la communauté du GSJC. Trouvez un ancien élève dans l’annuaire ou sur la carte du monde, puis écrivez-lui directement. Arrivent bientôt :</p>
      <ul class="soon" style="margin-top:10px">
        <li>Les offres de stage et d’emploi</li>
        <li>Des statistiques sur le devenir des élèves</li>
      </ul>
    </section>
    <div class="row">
      <a class="btn" href="#/annuaire">Ouvrir l’annuaire</a>
      <a class="btn" href="#/carte">Voir la carte</a>
      <a class="btn ghost" href="#/profil">Modifier mon profil</a>
      ${isAdmin ? '<a class="btn ghost" href="#/admin">Ouvrir l’administration</a>' : ''}
    </div>`);
  photoUrl(profile.photo_path).then((u) => { if (u) $('#homeAvatar') && ($('#homeAvatar').innerHTML = avatarHtml(profile, u, 'lg')); });
  loadHomeFeed();
  if (isAdmin) refreshBadge();
}

/* ------------------------------------------------------------------ */
/* Annuaire des alumni                                                 */
/* ------------------------------------------------------------------ */
let dirRows = [];
let dirShown = 24;
let dirTok = 0;
const DIR_PAGE = 24;
const fold = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function viewDirectory() {
  currentView = 'directory';
  dirShown = DIR_PAGE;
  shell(`
    <div class="page-head"><h1>Annuaire des alumni</h1></div>
    <div class="card filters">
      <div class="field"><label for="dirQ" class="sr">Rechercher</label>
        <input type="search" id="dirQ" placeholder="Rechercher un nom, une école, une formation, une ville…" autocomplete="off"></div>
      <div class="grid2">
        <div class="field"><label for="dirCountry" class="sr">Pays</label><select id="dirCountry"><option value="">Tous les pays</option></select></div>
        <div class="field"><label for="dirYear" class="sr">Promotion</label><select id="dirYear"><option value="">Toutes les promotions</option></select></div>
        <div class="field"><label for="dirField" class="sr">Domaine d’études</label><select id="dirField"><option value="">Tous les domaines</option>${Object.entries(STUDY_FIELDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      </div>
      <p class="small muted" id="dirCount" style="margin-top:-4px"></p>
    </div>
    <div id="dirList" class="cards"><p class="muted">Chargement…</p></div>
    <div id="dirMore" class="row center" style="margin-top:14px"></div>`, { wide: true });

  const { data, error } = await sb.rpc('directory_list');
  const list = $('#dirList');
  if (!list || currentView !== 'directory') return;
  if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  dirRows = data || [];

  const countries = [...new Set(dirRows.map((r) => r.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const years = [...new Set(dirRows.map((r) => r.graduation_year).filter(Boolean))].sort((a, b) => b - a);
  $('#dirCountry').insertAdjacentHTML('beforeend', countries.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(''));
  $('#dirYear').insertAdjacentHTML('beforeend', years.map((y) => `<option value="${esc(y)}">Promo ${esc(y)}</option>`).join(''));

  const again = () => { dirShown = DIR_PAGE; renderDirectory(); };
  $('#dirQ').addEventListener('input', again);
  $('#dirCountry').addEventListener('change', again);
  $('#dirYear').addEventListener('change', again);
  $('#dirField').addEventListener('change', again);
  renderDirectory();
}

async function renderDirectory() {
  const tok = ++dirTok;
  const list = $('#dirList');
  if (!list) return;
  const q = fold($('#dirQ').value.trim());
  const country = $('#dirCountry').value;
  const year = $('#dirYear').value;
  const field = $('#dirField').value;
  const rows = dirRows.filter((r) =>
    (!country || r.country === country) &&
    (!year || String(r.graduation_year) === year) &&
    (!field || r.study_field === field) &&
    (!q || fold([r.first_name, r.last_name, r.school, r.program, r.city, r.country].join(' ')).includes(q)));

  $('#dirCount').textContent = rows.length === 1 ? '1 alumni' : `${rows.length} alumni`;
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${dirRows.length
      ? 'Aucun alumni ne correspond à votre recherche. Essayez avec moins de critères.'
      : 'Les premiers profils arrivent bientôt. Revenez nous voir !'}</div>`;
    $('#dirMore').innerHTML = '';
    return;
  }
  const shown = rows.slice(0, dirShown);
  await photoUrls(shown.map((r) => r.photo_path));
  if (tok !== dirTok || currentView !== 'directory' || !$('#dirList')) return; // une recherche plus récente a pris le relais
  list.innerHTML = shown.map(memberCard).join('');
  $('#dirMore').innerHTML = rows.length > shown.length
    ? `<button class="btn ghost" data-action="dirMore">Afficher plus (${rows.length - shown.length})</button>` : '';
}

function memberCard(r) {
  const url = urlCache.get(r.photo_path)?.url || null;
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  const study = [r.program, r.school].filter(Boolean).map(esc).join(' · ');
  const place = [r.city, r.country].filter(Boolean).map(esc).join(', ');
  const tags = [r.study_field && '🎓 ' + studyLabel(r.study_field), r.contact_email && '✉ E-mail', (r.contact_message || r.contact_chat) && '💬 Message']
    .filter(Boolean).map((t) => `<span class="tag">${t}</span>`).join('');
  return `<article class="member">
    <div class="req-top">${avatarHtml(r, url, 'md')}
      <div><h3>${esc(name)}${r.id === profile.id ? ' <span class="tag me">vous</span>' : ''}</h3>
      <div class="sub">${r.graduation_year ? 'Promo ' + esc(r.graduation_year) : 'Ancien élève'}</div></div></div>
    ${study ? `<p class="m-study">${study}</p>` : ''}
    ${place ? `<p class="m-place">📍 ${place}</p>` : ''}
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <button class="btn ghost sm" data-action="viewMember" data-id="${esc(r.id)}">Voir le profil</button>
  </article>`;
}

async function openMember(id) {
  const r = dirRows.find((x) => x.id === id);
  if (!r) return;
  await photoUrl(r.photo_path);
  const url = urlCache.get(r.photo_path)?.url || null;
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  const kv = [];
  if (r.program || r.school) kv.push(['Études', [r.program, r.school].filter(Boolean).map(esc).join(' — ')]);
  if (r.study_field) kv.push(['Domaine', esc(studyLabel(r.study_field))]);
  if (r.city || r.country) kv.push(['Lieu', [r.city, r.country].filter(Boolean).map(esc).join(', ')]);
  const links = [];
  const li = safeLinkedin(r.linkedin);
  if (li) links.push(`<a href="${esc(li)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`);
  if (r.instagram) links.push(`<a href="${esc(instagramUrl(r.instagram))}" target="_blank" rel="noopener noreferrer">Instagram</a>`);
  if (links.length) kv.push(['Réseaux', links.join(' · ')]);

  const contact = [];
  if (r.contact_email && r.email) {
    contact.push(`<a class="btn sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Alumni GSJC Rabat')}">✉ Écrire par e-mail</a>`);
  }
  if ((r.contact_message || r.contact_chat) && r.id !== profile.id) {
    contact.push(`<button class="btn sm" data-action="startConv" data-id="${esc(r.id)}">💬 Envoyer un message</button>`);
  }

  openModal(`
    <div class="member-head">${avatarHtml(r, url, 'lg')}
      <div><h2 style="margin:0">${esc(name)}</h2>
      <p class="muted">Ancien élève${r.graduation_year ? ' · Promo ' + esc(r.graduation_year) : ''}</p></div></div>
    ${kv.length ? `<dl class="kv" style="margin:14px 0">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
    <h3 style="margin:14px 0 8px">Entrer en contact</h3>
    ${r.id === profile.id ? '<p class="muted small">C’est votre profil : voici ce que les autres membres voient.</p>' : ''}
    ${contact.length ? `<div class="row">${contact.join('')}</div>`
      : '<p class="muted small">Cette personne n’a pas activé de moyen de contact pour le moment.</p>'}
    <div class="row end" style="margin-top:16px"><button class="btn ghost" data-action="closeModal">Fermer</button></div>`);
}

/* ------------------------------------------------------------------ */
/* Notifications et mises à jour en direct                             */
/* ------------------------------------------------------------------ */
let unread = 0;
let live = null;      // canal temps réel
let convOpen = null;  // conversation affichée
let convSeen = new Set();

function setUnread(n) {
  unread = Number(n) || 0;
  $$('.js-msg-badge').forEach((b) => { b.textContent = unread; b.hidden = unread === 0; });
  const h = $('#homeUnread');
  if (h) {
    h.innerHTML = unread
      ? `<a class="card unread-card" href="#/messages">💬 <b>${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''}</b> · Ouvrir la messagerie →</a>` : '';
  }
  document.title = (unread ? `(${unread}) ` : '') + 'Alumni GSJC Rabat';
}

async function refreshUnread() {
  if (!session || profile?.status !== 'approved') return;
  const { data } = await sb.rpc('my_unread');
  setUnread(data);
}

function notifyUser(title, body) {
  toast(body ? `${title} · ${body}` : title);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch { /* ignoré */ }
  }
}

function startLive() {
  if (live || !session || profile?.status !== 'approved') return;
  const isAdmin = profile.role === 'admin';
  try {
    live = sb.channel('live-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onChatMessage)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, onChatMessageUpdate)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_messages' }, onAdminMessage)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, (p) => onContent('news', p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => onContent('events', p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, onOfferEvent);
    if (isAdmin) {
      live.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onProfileEvent)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, onReportEvent);
    }
    live.subscribe();
  } catch { live = null; }
  refreshUnread();
  refreshContentBadge();
  if (isAdmin) refreshBadge();
}

function stopLive() {
  if (live) { try { sb.removeChannel(live); } catch { /* ignoré */ } live = null; }
  convOpen = null;
  setUnread(0);
  setAdminBadge(0);
  setContentBadge(0);
}

// Secours si le temps réel est bloqué (réseau d'entreprise, par exemple).
async function pollLive() {
  if (!session || profile?.status !== 'approved' || document.hidden) return;
  refreshUnread();
  refreshContentBadge();
  if (profile.role === 'admin') refreshBadge();
  if (currentView === 'feed' && !$('.modal')) loadFeed();
  if (currentView === 'messages') loadConversationList();
  if (currentView === 'conversation' && convOpen) fetchNewMessages();
}

function onChatMessageUpdate({ new: row }) {
  if (!row || !row.retracted_at) return;
  if (currentView === 'conversation' && convOpen === row.conversation_id) markRetracted(row.id);
  else { refreshUnread(); if (currentView === 'messages') loadConversationList(); }
}

async function onChatMessage({ new: row }) {
  if (!row || row.sender_id === profile.id) return;
  if (currentView === 'conversation' && convOpen === row.conversation_id) {
    appendMessage(row);
    sb.rpc('mark_conversation_read', { cid: row.conversation_id }).then(refreshUnread);
    return;
  }
  await refreshUnread();
  if (currentView === 'messages') loadConversationList();
  const { data } = await sb.rpc('my_conversations');
  const c = (data || []).find((x) => x.id === row.conversation_id);
  notifyUser('Nouveau message', c ? `${c.other_first || ''} ${c.other_last || ''}`.trim() : '');
}

function onAdminMessage({ new: row }) {
  if (!row || row.sender_id === profile.id) return;
  if (profile.role === 'admin' && !row.from_admin) { notifyUser('Réponse d’un membre', ''); return; }
  if (row.from_admin && row.user_id === profile.id) {
    if (currentView === 'adminThread') { viewAdminThread(); return; }
    refreshUnread();
    if (currentView === 'messages') loadConversationList();
    notifyUser('Message de l’administration', '');
  }
}

function onProfileEvent({ eventType, new: row }) {
  if (!row || row.id === profile.id) return;
  if (eventType === 'UPDATE' && row.status === 'pending') {
    notifyUser('Nouvelle demande d’inscription', `${row.first_name || ''} ${row.last_name || ''}`.trim());
  }
  refreshBadge();
  if (currentView === 'admin') { loadStats(); loadAdminList(); }
}

function onReportEvent() {
  notifyUser('Nouveau signalement', 'à examiner');
  refreshBadge();
  if (currentView === 'admin') { loadStats(); if (adminTab === 'reports') loadReports(); }
}

/* ------------------------------------------------------------------ */
/* Messagerie entre membres                                            */
/* ------------------------------------------------------------------ */
const preview = (t) => { const x = (t || '').replace(/\s+/g, ' ').trim(); return x.length > 90 ? x.slice(0, 90) + '…' : x; };

function renderNotifBox() {
  const box = $('#notifBox');
  if (!box) return;
  if ('Notification' in window && Notification.permission === 'default') {
    box.innerHTML = `<div class="info-banner small">🔔 Recevez une alerte quand un message arrive pendant que l’application est ouverte.
      <button class="btn sm" style="margin-left:6px" data-action="enableNotif">Activer les notifications</button></div>`;
  } else box.innerHTML = '';
}

function viewMessages(sub) {
  if (sub === 'admin') return viewAdminThread();
  if (sub) return viewConversation(sub);
  currentView = 'messages';
  convOpen = null;
  shell(`
    <div class="page-head"><h1>Messages</h1></div>
    <div id="notifBox"></div>
    <div id="convList" class="convlist"><p class="muted">Chargement…</p></div>`);
  renderNotifBox();
  loadConversationList();
}

async function loadConversationList() {
  const [conv, adm] = await Promise.all([
    sb.rpc('my_conversations'),
    sb.from('admin_messages').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1),
  ]);
  const box = $('#convList');
  if (!box || currentView !== 'messages') return;
  if (conv.error) { box.innerHTML = `<p class="err">${esc(errMsg(conv.error))}</p>`; return; }
  const rows = (conv.data || []).filter((c) => !c.hidden);
  await photoUrls(rows.map((c) => c.other_photo));
  if (!$('#convList') || currentView !== 'messages') return;

  const items = [];
  const last = adm.data?.[0];
  if (last) {
    const isNew = last.from_admin && (!profile.admin_thread_read_at || new Date(last.created_at) > new Date(profile.admin_thread_read_at));
    items.push(`<a class="conv ${isNew ? 'new' : ''}" href="#/messages/admin">
      <div class="avatar" aria-hidden="true">GS</div>
      <div class="conv-body"><div class="conv-top"><b>Administration GSJC</b><span class="small muted">${fmtDateTime(last.created_at)}</span></div>
      <div class="conv-prev">${last.from_admin ? '' : 'Vous : '}${esc(preview(last.body))}</div></div>
      ${isNew ? '<span class="dot" aria-label="Nouveau message"></span>' : ''}</a>`);
  }
  for (const c of rows) {
    const name = `${c.other_first || ''} ${c.other_last || ''}`.trim() || 'Membre';
    const url = urlCache.get(c.other_photo)?.url || null;
    items.push(`<a class="conv ${c.unread > 0 ? 'new' : ''}" href="#/messages/${esc(c.id)}">
      ${avatarHtml({ first_name: c.other_first, last_name: c.other_last }, url)}
      <div class="conv-body"><div class="conv-top"><b>${esc(name)}</b><span class="small muted">${c.last_body || c.last_retracted ? fmtDateTime(c.last_at) : ''}</span></div>
      <div class="conv-prev">${c.last_retracted ? '<i>Message retiré</i>' : c.last_body ? (c.last_sender === profile.id ? 'Vous : ' : '') + esc(preview(c.last_body)) : '<i>Nouvelle conversation</i>'}</div></div>
      ${c.unread > 0 ? `<span class="badge">${c.unread}</span>` : ''}</a>`);
  }
  box.innerHTML = items.length ? items.join('')
    : `<div class="empty">Aucune conversation pour le moment.<br>Trouvez un alumni dans l’annuaire et cliquez sur « Envoyer un message ».
       <p style="margin-top:12px"><a class="btn" href="#/annuaire">Ouvrir l’annuaire</a></p></div>`;
}

async function viewConversation(id) {
  currentView = 'conversation';
  convOpen = id;
  convSeen = new Set();
  shell(`
    <div class="conv-head">
      <a class="btn ghost sm" href="#/messages">← Messages</a>
      <div id="convWho" class="conv-who"></div>
      <div class="conv-actions">
        <button class="btn danger-ghost sm" data-action="report" data-id="${esc(id)}">Signaler</button>
        <button class="btn ghost sm" data-action="clearConv" data-id="${esc(id)}" aria-label="Supprimer la conversation">🗑 Supprimer</button>
      </div>
    </div>
    <section class="card chat">
      <div id="chatThread" class="thread chat-thread" aria-live="polite"><p class="muted small">Chargement…</p></div>
      <form id="chatForm" class="composer" novalidate>
        <textarea id="chatText" maxlength="2000" rows="2" placeholder="Écrivez votre message… (Ctrl+Entrée pour envoyer)" aria-label="Message"></textarea>
        <button class="btn" type="submit">Envoyer</button>
      </form>
    </section>`);

  const [conv, msgs] = await Promise.all([
    sb.rpc('my_conversations'),
    sb.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(500),
  ]);
  if (currentView !== 'conversation' || convOpen !== id) return;
  const c = (conv.data || []).find((x) => x.id === id);
  if (!c || msgs.error) {
    $('#main').innerHTML = '<section class="card state"><h1>Conversation introuvable</h1><p><a class="btn" href="#/messages">Retour aux messages</a></p></section>';
    return;
  }
  await photoUrls([c.other_photo]);
  if (currentView !== 'conversation' || convOpen !== id) return;
  const name = `${c.other_first || ''} ${c.other_last || ''}`.trim() || 'Membre';
  $('#convWho').innerHTML = `${avatarHtml({ first_name: c.other_first, last_name: c.other_last }, urlCache.get(c.other_photo)?.url || null)}
    <div><b>${esc(name)}</b><div class="small muted">${esc(TYPE_LABEL[c.other_type] || '')}</div></div>`;
  $('#chatThread').innerHTML = '';
  (msgs.data || []).forEach(appendMessage);
  if (!(msgs.data || []).length) $('#chatThread').innerHTML = '<p class="muted small" id="chatEmpty">Écrivez votre premier message ci-dessous.</p>';
  sb.rpc('mark_conversation_read', { cid: id }).then(refreshUnread);

  const form = $('#chatForm');
  const ta = $('#chatText');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    const btn = $('button', form);
    busy(btn, true, 'Envoi…');
    const { data, error } = await sb.from('messages').insert({ conversation_id: id, body }).select().single();
    busy(btn, false);
    if (error) return toast(errMsg(error), 'err');
    ta.value = '';
    appendMessage(data);
    ta.focus();
  });
}

const RETRACT_MS = 5 * 60 * 1000; // un message peut être retiré pendant 5 minutes

function bubbleHtml(m) {
  const mine = m.sender_id === profile.id;
  const gone = !!m.retracted_at;
  const canRetract = mine && !gone && Date.now() - new Date(m.created_at).getTime() < RETRACT_MS;
  return `<div class="bubble ${mine ? 'user' : 'admin'} ${gone ? 'gone' : ''}" data-mid="${esc(m.id)}"><span class="who">${fmtDateTime(m.created_at)}</span>${
    gone ? '<i>Message retiré</i>' : esc(m.body)}${
    canRetract ? `<button class="retract" data-action="retractMsg" data-id="${esc(m.id)}">Retirer</button>` : ''}</div>`;
}

function appendMessage(m) {
  const box = $('#chatThread');
  if (!box || !m || convSeen.has(m.id)) return;
  convSeen.add(m.id);
  $('#chatEmpty')?.remove();
  box.insertAdjacentHTML('beforeend', bubbleHtml(m));
  const el = box.lastElementChild;
  if (m.sender_id === profile.id && !m.retracted_at) {
    const left = RETRACT_MS - (Date.now() - new Date(m.created_at).getTime());
    if (left > 0) setTimeout(() => el.querySelector('.retract')?.remove(), left); // le délai est écoulé : le lien disparaît
  }
  box.scrollTop = box.scrollHeight;
}

function markRetracted(id) {
  const el = $(`.bubble[data-mid="${CSS.escape(String(id))}"]`);
  if (!el || el.classList.contains('gone')) return;
  el.classList.add('gone');
  el.innerHTML = `${el.querySelector('.who')?.outerHTML || ''}<i>Message retiré</i>`;
}

function confirmRetract(id) {
  const box = openModal(`
    <h2>Retirer ce message ?</h2>
    <p>Il disparaîtra aussi chez l’autre personne, qui verra « Message retiré ». Ce n’est possible que pendant 5 minutes.</p>
    <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="retractOk">Retirer le message</button></div>`);
  $('#retractOk', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Retrait…');
    const { error } = await sb.rpc('retract_message', { mid: Number(id) });
    closeModal();
    if (error) { document.querySelector(`.bubble[data-mid="${CSS.escape(String(id))}"] .retract`)?.remove(); return toast(errMsg(error), 'err'); }
    markRetracted(id);
    toast('Message retiré.');
  });
}

function confirmClear(id) {
  const box = openModal(`
    <h2>Supprimer cette conversation ?</h2>
    <p>Elle disparaît de votre messagerie. <b>L’autre personne conserve ses messages.</b></p>
    <p class="muted small">Une conversation qui a été signalée est conservée par l’administration le temps de l’examen. La conversation n’est effacée définitivement que lorsque les deux personnes l’ont supprimée.</p>
    <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="clearOk">Supprimer la conversation</button></div>`);
  $('#clearOk', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Suppression…');
    const { error } = await sb.rpc('clear_conversation', { cid: id });
    closeModal();
    if (error) return toast(errMsg(error), 'err');
    toast('Conversation supprimée.');
    refreshUnread();
    location.hash = '#/messages';
  });
}

async function fetchNewMessages() {
  const id = convOpen;
  const { data } = await sb.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(500);
  if (convOpen !== id) return;
  const fresh = (data || []).filter((m) => !convSeen.has(m.id));
  fresh.forEach(appendMessage);
  (data || []).filter((m) => m.retracted_at).forEach((m) => markRetracted(m.id));
  if (fresh.some((m) => m.sender_id !== profile.id)) sb.rpc('mark_conversation_read', { cid: id }).then(refreshUnread);
}

function viewAdminThread() {
  currentView = 'adminThread';
  convOpen = null;
  shell(`
    <div class="conv-head"><a class="btn ghost sm" href="#/messages">← Messages</a>
      <div class="conv-who"><div class="avatar" aria-hidden="true">GS</div><div><b>Administration GSJC</b></div></div></div>
    <section class="card"><div id="threadBox"></div></section>`);
  mountThread($('#threadBox'), profile.id, false);
  sb.from('profiles').update({ admin_thread_read_at: new Date().toISOString() }).eq('id', profile.id).select().single()
    .then(({ data }) => { if (data) profile = data; refreshUnread(); });
}

/* ------------------------------------------------------------------ */
/* Administration : signalements                                       */
/* ------------------------------------------------------------------ */
async function loadReports() {
  const list = $('#adminList');
  if (!list) return;
  const { data: reps, error } = await sb.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: true });
  if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  if (!reps.length) { list.innerHTML = '<div class="empty">Aucun signalement ouvert 🎉</div>'; return; }

  const convIds = [...new Set(reps.map((r) => r.conversation_id))];
  const [convs, msgs] = await Promise.all([
    sb.from('conversations').select('*').in('id', convIds),
    sb.from('messages').select('*').in('conversation_id', convIds).order('created_at', { ascending: true }),
  ]);
  const ids = new Set(reps.map((r) => r.reporter_id));
  (convs.data || []).forEach((c) => { ids.add(c.user_a); ids.add(c.user_b); });
  const { data: people } = await sb.from('profiles').select('id, first_name, last_name, email').in('id', [...ids]);
  const who = (id) => {
    const p = (people || []).find((x) => x.id === id);
    return p ? (`${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email) : 'Membre supprimé';
  };
  if (adminTab !== 'reports' || !$('#adminList')) return;

  list.innerHTML = reps.map((r) => {
    const c = (convs.data || []).find((x) => x.id === r.conversation_id);
    const other = c ? (c.user_a === r.reporter_id ? c.user_b : c.user_a) : null;
    const thread = (msgs.data || []).filter((m) => m.conversation_id === r.conversation_id);
    return `<article class="req-card report">
      <div><span class="pill no">Signalement</span> <span class="small muted">${fmtDate(r.created_at)}</span></div>
      <p><b>${esc(who(r.reporter_id))}</b> a signalé sa conversation avec <b>${esc(other ? who(other) : '?')}</b>.</p>
      <p class="quote">${esc(r.reason)}</p>
      <details><summary>Lire la conversation (${thread.length} message${thread.length > 1 ? 's' : ''})</summary>
        <div class="thread">${thread.map((m) => `<div class="bubble ${m.sender_id === r.reporter_id ? 'user' : 'admin'}"><span class="who">${esc(who(m.sender_id))} · ${fmtDateTime(m.created_at)}</span>${esc(m.body)}</div>`).join('')}</div>
      </details>
      <div class="req-actions"><button class="btn ok sm" data-action="closeReport" data-id="${esc(r.id)}">✓ Marquer comme traité</button></div>
    </article>`;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* Villes, pays et carte du monde                                      */
/* ------------------------------------------------------------------ */
// Les villes viennent de fichiers locaux (data/cities/XX.json, base GeoNames) :
// aucune adresse n'est envoyée à un service de géolocalisation.
const geoKey = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
let countriesCache = null;
const cityCache = new Map();

async function loadCountries() {
  if (!countriesCache) {
    try { countriesCache = await (await fetch('data/countries.json')).json(); } catch { return []; }
  }
  return countriesCache;
}
async function loadCities(code) {
  if (!code) return [];
  if (!cityCache.has(code)) {
    let rows = [];
    try { const r = await fetch(`data/cities/${code}.json`); if (r.ok) rows = await r.json(); } catch { /* pas de ville pour ce pays */ }
    cityCache.set(code, rows.map(([n, la, ln]) => ({ n, la, ln, k: geoKey(n) })));
  }
  return cityCache.get(code);
}
async function resolvePosition(code, name) {
  const rows = await loadCities(code);
  const k = geoKey(name);
  return rows.find((r) => r.k === k) || null;
}
function suggestCities(rows, q, limit) {
  if (!q) return rows.slice(0, limit); // les plus peuplées d'abord
  const starts = rows.filter((r) => r.k.startsWith(q));
  const has = rows.filter((r) => !r.k.startsWith(q) && r.k.includes(q));
  return starts.concat(has).slice(0, limit);
}

async function initGeoFields(form, p) {
  const sel = $('#country', form);
  const city = $('#city', form);
  const list = $('#cityList', form);
  const hint = $('#cityHint', form);
  if (!sel || !city) return;
  const countries = await loadCountries();
  if (!$('#country')) return; // la page a changé entre-temps
  const preset = countries.find(([, n]) => geoKey(n) === geoKey(p.country || ''));
  sel.insertAdjacentHTML('beforeend', countries.map(([c, n]) =>
    `<option value="${esc(n)}" data-code="${esc(c)}" ${preset && preset[0] === c ? 'selected' : ''}>${esc(n)}</option>`).join(''));
  if (p.country && !preset) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.country)}" selected>${esc(p.country)} (à confirmer)</option>`);
  }
  const code = () => sel.selectedOptions[0]?.dataset.code || '';
  const refresh = async () => {
    const c = code();
    const rows = await loadCities(c);
    if (code() !== c || !$('#city')) return;
    const q = geoKey(city.value);
    list.innerHTML = suggestCities(rows, q, 15).map((r) => `<option value="${esc(r.n)}">`).join('');
    if (!c) hint.textContent = 'Choisissez d’abord le pays.';
    else if (!q) hint.textContent = 'Commencez à taper pour voir les villes proposées.';
    else if (rows.some((r) => r.k === q)) hint.textContent = '✓ Ville reconnue : vous apparaîtrez sur la carte.';
    else hint.textContent = '⚠ Ville non reconnue. Choisissez la ville proposée la plus proche pour apparaître sur la carte (vous resterez visible dans l’annuaire).';
  };
  sel.addEventListener('change', refresh);
  city.addEventListener('input', refresh);
  refresh();
}

let mapObj = null;
let cluster = null;
let mapPts = [];
let mapRows = [];
let mapLibs = null;
let geoTodo = [];

// Fond de carte intégré à l'application (Natural Earth, domaine public) : aucune image n'est demandée
// à un serveur extérieur. Le Maroc y figure avec son Sahara (voir tools/build-world-map.js).
let worldData = null;
async function addBaseMap(map) {
  window.L.control.attribution({ prefix: false }).addAttribution('Fond de carte : Natural Earth').addTo(map);
  try {
    if (!worldData) worldData = await (await fetch('data/world.json')).json();
  } catch { return; }
  if (mapObj !== map) return; // la page a changé pendant le chargement
  window.L.geoJSON(worldData, {
    style: { fillColor: '#f3f0e6', fillOpacity: 1, color: '#b7b09c', weight: 0.7 },
    onEachFeature: (f, layer) => {
      layer.bindTooltip(f.properties.n, { sticky: true, direction: 'top', className: 'country-tip' });
      layer.on('click', (e) => layer.openTooltip(e.latlng));
    },
  }).addTo(map).bringToBack();
}

function destroyMap() {
  if (mapObj) {
    try { mapObj.stop(); if (cluster) cluster.clearLayers(); mapObj.off(); mapObj.remove(); } catch { /* ignoré */ }
  }
  mapObj = null; cluster = null; mapPts = []; mapRows = [];
}

function loadMapLibs() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  if (!mapLibs) {
    mapLibs = new Promise((resolve, reject) => {
      ['vendor/leaflet/leaflet.css', 'vendor/markercluster/MarkerCluster.css', 'vendor/markercluster/MarkerCluster.Default.css']
        .forEach((href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); });
      const add = (src) => new Promise((ok, ko) => {
        const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => ko(new Error('script')); document.head.appendChild(sc);
      });
      add('vendor/leaflet/leaflet.js').then(() => add('vendor/markercluster/leaflet.markercluster.js'))
        .then(resolve, (e) => { mapLibs = null; reject(e); });
    });
  }
  return mapLibs;
}

async function viewMap() {
  currentView = 'map';
  shell(`
    <div class="page-head tight"><h1>Carte des alumni</h1></div>
    <p class="small muted" id="mapCount">Chargement de la carte…</p>
    <div id="mapChips" class="chips scroll"></div>
    <details class="card filters-d" ${window.innerWidth >= 720 ? 'open' : ''}>
      <summary>🔍 Filtres</summary>
      <div class="grid2" style="margin-top:10px">
        <div class="field"><label class="sr" for="mapYear">Promotion</label><select id="mapYear"><option value="">Toutes les promotions</option></select></div>
        <div class="field"><label class="sr" for="mapQ">Filtrer</label><input type="search" id="mapQ" placeholder="Nom, école, formation…" autocomplete="off"></div>
      </div>
    </details>
    <div id="map" class="map" role="application" aria-label="Carte du monde des alumni"></div>
    <p class="small muted" style="margin-top:8px">Seuls les alumni qui ont choisi d’afficher leur localisation apparaissent. Zoomez pour séparer les groupes.</p>`, { wide: true });

  try { await loadMapLibs(); } catch {
    if ($('#map')) $('#map').innerHTML = '<div class="empty">La carte n’a pas pu être chargée. Vérifiez votre connexion et réessayez.</div>';
    return;
  }
  const { data, error } = await sb.rpc('directory_list');
  if (currentView !== 'map' || !$('#map')) return;
  if (error) { $('#mapCount').textContent = errMsg(error); return; }
  dirRows = data || [];

  const years = [...new Set(dirRows.map((r) => r.graduation_year).filter(Boolean))].sort((a, b) => b - a);
  $('#mapYear').insertAdjacentHTML('beforeend', years.map((y) => `<option value="${esc(y)}">Promo ${esc(y)}</option>`).join(''));

  mapObj = window.L.map('map', { minZoom: 2, maxZoom: 7, zoomSnap: 0.5, preferCanvas: true, attributionControl: false, maxBounds: [[-58, -190], [84, 190]], maxBoundsViscosity: 1, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([28, 10], 2);
  addBaseMap(mapObj);
  cluster = window.L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, animate: false, animateAddingMarkers: false });
  mapObj.addLayer(cluster);

  $('#mapYear').addEventListener('change', () => renderMap(true));
  $('#mapQ').addEventListener('input', () => renderMap(true));
  renderMap(true);
}

function popupHtml(r) {
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  const study = [r.program, r.school].filter(Boolean).map(esc).join(' · ');
  return `<div class="pp">
    <div class="pp-head"><div class="avatar pp-av" data-p="${esc(r.id)}" aria-hidden="true">${esc(initials(r))}</div>
      <div><b>${esc(name)}</b><div class="small muted">${r.graduation_year ? 'Promo ' + esc(r.graduation_year) : 'Ancien élève'}</div></div></div>
    ${study ? `<p class="small">${study}</p>` : ''}
    <p class="small muted">📍 ${[r.city, r.country].filter(Boolean).map(esc).join(', ')}</p>
    <button class="btn sm" data-action="viewMember" data-id="${esc(r.id)}">Voir le profil</button></div>`;
}

async function hydratePopupPhoto(r) {
  const url = await photoUrl(r.photo_path);
  const el = [...document.querySelectorAll('.pp-av')].find((n) => n.dataset.p === r.id);
  if (url && el) el.outerHTML = avatarHtml(r, url, '');
}

function renderMap(fit) {
  if (!mapObj || !cluster) return;
  const q = fold($('#mapQ').value.trim());
  const year = $('#mapYear').value;
  const located = dirRows.filter((r) => r.lat != null && r.lng != null);
  mapRows = located.filter((r) =>
    (!year || String(r.graduation_year) === year) &&
    (!q || fold([r.first_name, r.last_name, r.school, r.program, r.city, r.country].join(' ')).includes(q)));

  cluster.clearLayers();
  mapPts = [];
  const pin = window.L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [24, 24] });
  mapRows.forEach((r) => {
    const m = window.L.marker([r.lat, r.lng], { icon: pin, title: `${r.first_name || ''} ${r.last_name || ''}`.trim() });
    m.bindPopup(() => popupHtml(r), { maxWidth: 260 });
    m.on('popupopen', () => hydratePopupPhoto(r));
    cluster.addLayer(m);
    mapPts.push([r.lat, r.lng]);
  });

  const hidden = dirRows.length - located.length;
  $('#mapCount').textContent = `${mapRows.length} alumni sur la carte` +
    (hidden > 0 ? ` · ${hidden} sans position (localisation masquée ou ville non reconnue)` : '');

  const byCountry = new Map();
  mapRows.forEach((r) => {
    const key = r.country_code || r.country || '?';
    const cur = byCountry.get(key) || { name: r.country || '?', n: 0 };
    cur.n++; byCountry.set(key, cur);
  });
  const chips = [...byCountry.entries()].sort((a, b) => b[1].n - a[1].n);
  $('#mapChips').innerHTML = chips.length
    ? `<button class="chip" data-action="mapAll">🌍 Tout le monde</button>` +
      chips.map(([k, v]) => `<button class="chip" data-action="mapCountry" data-c="${esc(k)}">${esc(v.name)} · ${v.n}</button>`).join('')
    : '';
  if (fit && mapPts.length) mapObj.fitBounds(mapPts, { padding: [40, 40], maxZoom: 5 });
}

function focusCountry(key) {
  const pts = mapRows.filter((r) => (r.country_code || r.country || '?') === key).map((r) => [r.lat, r.lng]);
  if (mapObj && pts.length) mapObj.fitBounds(pts, { padding: [40, 40], maxZoom: 6 });
}

async function checkPositions() {
  const box = $('#geoFix');
  if (!box) return;
  const { data } = await sb.from('profiles').select('id, country, city, country_code')
    .eq('status', 'approved').eq('member_type', 'alumni').is('lat', null);
  geoTodo = (data || []).filter((r) => r.country && r.city);
  const n = geoTodo.length;
  box.innerHTML = n
    ? `<div class="info-banner small">📍 <b>${n}</b> alumni validé${n > 1 ? 's' : ''} ${n > 1 ? 'n’ont' : 'n’a'} pas de position sur la carte.
        <button class="btn sm" style="margin-left:6px" data-action="geoBackfill">Calculer les positions</button></div>` : '';
}

/* ------------------------------------------------------------------ */
/* Actualités et agenda                                                */
/* ------------------------------------------------------------------ */
let feedKind = 'news';
let feedNews = [];
let feedEvents = [];
let contentNew = 0;
let regCache = new Map();
const contentUrlCache = new Map();
const AUDIENCE = { all: 'Tous les membres', alumni: 'Alumni uniquement', student: 'Lycéens uniquement' };

function setContentBadge(n) {
  contentNew = Number(n) || 0;
  $$('.js-content-badge').forEach((b) => { b.textContent = contentNew; b.hidden = contentNew === 0; });
}
async function refreshContentBadge() {
  if (!session || profile?.status !== 'approved') return;
  const { data } = await sb.rpc('content_unseen');
  setContentBadge(data);
}
function markContentSeen() { sb.rpc('mark_content_seen').then(() => setContentBadge(0)); }

function onContent(kind, row) {
  if (!row || row.created_by === profile.id) return;
  refreshContentBadge();
  if (currentView === 'feed' && !$('.modal')) loadFeed();
  if (currentView === 'home') loadHomeFeed();
  notifyUser(kind === 'news' ? 'Nouvelle actualité' : 'Nouvel événement', row.title);
}

async function contentUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !(contentUrlCache.get(p)?.exp > Date.now())))];
  if (need.length) {
    const { data } = await sb.storage.from('content').createSignedUrls(need, 3600);
    (data || []).forEach((d) => { if (d.signedUrl) contentUrlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3300 * 1000 }); });
  }
}
const contentUrl = (p) => contentUrlCache.get(p)?.url || null;

const eventEnd = (e) => new Date(e.ends_at || new Date(e.starts_at).getTime() + 3 * 3600 * 1000);
const isUpcoming = (e) => eventEnd(e) >= new Date();
const fmtLong = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const withBreaks = (t) => esc(t).replace(/\n/g, '<br>');
const eventWhen = (e) => {
  const same = e.ends_at && new Date(e.ends_at).toDateString() === new Date(e.starts_at).toDateString();
  return `${fmtLong(e.starts_at)} · ${fmtHour(e.starts_at)}` +
    (e.ends_at ? (same ? ` – ${fmtHour(e.ends_at)}` : ` → ${fmtLong(e.ends_at)} ${fmtHour(e.ends_at)}`) : '');
};
const isFull = (e) => e.capacity != null && Number(e.registered) >= e.capacity;

function viewFeed(kind) {
  currentView = 'feed';
  feedKind = kind;
  const isAdmin = profile.role === 'admin';
  shell(`
    <div class="page-head tight"><h1>${kind === 'news' ? 'Actualités' : 'Agenda'}</h1>
      ${isAdmin ? '<button class="btn sm" data-action="publish">＋ Publier</button>' : ''}</div>
    ${feedSeg(kind)}
    <div id="feedList" class="feed"><p class="muted">Chargement…</p></div>`);
  loadFeed().then(markContentSeen);
}

async function loadFeed() {
  const kind = feedKind;
  let error = null;
  if (kind === 'news') {
    const r = await sb.from('news').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    error = r.error; feedNews = r.data || [];
    if (!error) await contentUrls(feedNews.map((n) => n.image_path));
  } else {
    const r = await sb.rpc('events_list');
    error = r.error; feedEvents = r.data || [];
    if (!error) await contentUrls(feedEvents.map((e) => e.image_path));
  }
  const box = $('#feedList');
  if (!box || currentView !== 'feed' || feedKind !== kind) return;
  if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  box.innerHTML = kind === 'news' ? renderNewsList() : renderEventList();
}

const adminBtns = (kind, id) => profile.role === 'admin'
  ? `<button class="btn ghost sm" data-action="editItem" data-kind="${kind}" data-id="${esc(id)}">Modifier</button>
     <button class="btn danger-ghost sm" data-action="deleteItem" data-kind="${kind}" data-id="${esc(id)}">Supprimer</button>` : '';
const audTag = (a) => (a !== 'all' ? `<span class="tag">${a === 'alumni' ? '🎓 Alumni' : '🎒 Lycéens'}</span>` : '');

function renderNewsList() {
  if (!feedNews.length) return '<div class="empty">Aucune actualité pour le moment.</div>';
  return feedNews.map((n) => {
    const url = contentUrl(n.image_path);
    const text = n.body.length > 220 ? n.body.slice(0, 220).trim() + '…' : n.body;
    return `<article class="post ${n.pinned ? 'pinned' : ''}">
      ${url ? `<img class="post-img" src="${esc(url)}" alt="" loading="lazy">` : ''}
      <div class="post-body">
        <div class="tags">${n.pinned ? '<span class="tag me">📌 À la une</span>' : ''}${audTag(n.audience)}</div>
        <h3>${esc(n.title)}</h3>
        <p class="small muted">${fmtDate(n.created_at)}</p>
        <p>${esc(text)}</p>
        <div class="row"><button class="btn ghost sm" data-action="openNews" data-id="${esc(n.id)}">Lire la suite</button>${adminBtns('news', n.id)}</div>
      </div></article>`;
  }).join('');
}

function eventCard(e) {
  const d = new Date(e.starts_at);
  const full = isFull(e);
  const quick = !e.registration ? '' : e.mine
    ? `<span class="tag ok">✓ Inscrit</span>`
    : (!isUpcoming(e) ? '' : full ? '<span class="tag no">Complet</span>'
      : `<button class="btn sm" data-action="eventReg" data-id="${esc(e.id)}">S’inscrire</button>`);
  const count = e.registration ? `<span class="small muted">👥 ${e.registered} inscrit${e.registered > 1 ? 's' : ''}${e.capacity ? ` / ${e.capacity} place${e.capacity > 1 ? 's' : ''}` : ''}</span>` : '<span class="small muted">Entrée libre</span>';
  return `<article class="evt">
    <div class="date-badge" aria-hidden="true"><b>${d.getDate()}</b><span>${d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</span></div>
    <div class="evt-body">
      <div class="tags">${audTag(e.audience)}</div>
      <h3>${esc(e.title)}</h3>
      <p class="small muted">${fmtHour(e.starts_at)}${e.location ? ' · ' + esc(e.location) : ''}</p>
      <div class="evt-foot">${count}</div>
      <div class="row"><button class="btn ghost sm" data-action="openEvent" data-id="${esc(e.id)}">Détails</button>${quick}</div>
    </div></article>`;
}

function renderEventList() {
  const up = feedEvents.filter(isUpcoming).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = feedEvents.filter((e) => !isUpcoming(e)).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  return (up.length ? up.map(eventCard).join('') : '<div class="empty">Aucun événement à venir pour le moment.</div>') +
    (past.length ? `<details class="past"><summary>Événements passés (${past.length})</summary>${past.map(eventCard).join('')}</details>` : '');
}

async function openNews(id) {
  const n = feedNews.find((x) => String(x.id) === String(id));
  if (!n) return;
  await contentUrls([n.image_path]);
  const url = contentUrl(n.image_path);
  openModal(`
    ${url ? `<img class="post-img big" src="${esc(url)}" alt="">` : ''}
    <div class="tags">${n.pinned ? '<span class="tag me">📌 À la une</span>' : ''}${audTag(n.audience)}</div>
    <h2 style="margin-top:6px">${esc(n.title)}</h2>
    <p class="small muted">${fmtLong(n.created_at)}</p>
    <p style="margin-top:10px">${withBreaks(n.body)}</p>
    <div class="row end" style="margin-top:16px">${adminBtns('news', n.id)}<button class="btn" data-action="closeModal">Fermer</button></div>`);
}

async function openEvent(id) {
  const e = feedEvents.find((x) => String(x.id) === String(id));
  if (!e) return;
  await contentUrls([e.image_path]);
  const url = contentUrl(e.image_path);
  const full = isFull(e);
  const left = e.capacity ? Math.max(e.capacity - Number(e.registered), 0) : null;
  let action = '';
  if (e.registration) {
    if (e.mine) action = `<p class="ok-line">✓ Vous êtes inscrit(e).</p><button class="btn ghost" data-action="eventUnreg" data-id="${esc(e.id)}">Se désinscrire</button>`;
    else if (!isUpcoming(e)) action = '<p class="muted small">Cet événement est terminé.</p>';
    else if (full) action = '<p class="no-line">Cet événement est complet.</p>';
    else action = `<button class="btn" data-action="eventReg" data-id="${esc(e.id)}">S’inscrire</button>`;
  }
  openModal(`
    ${url ? `<img class="post-img big" src="${esc(url)}" alt="">` : ''}
    <div class="tags">${audTag(e.audience)}</div>
    <h2 style="margin-top:6px">${esc(e.title)}</h2>
    <dl class="kv" style="margin:10px 0">
      <dt>Quand</dt><dd>${esc(eventWhen(e))}</dd>
      ${e.location ? `<dt>Où</dt><dd>${esc(e.location)}</dd>` : ''}
      <dt>Inscriptions</dt><dd>${e.registration ? `${e.registered} inscrit${e.registered > 1 ? 's' : ''}${left != null ? ` · ${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}` : ''}` : 'Entrée libre, sans inscription'}</dd>
    </dl>
    ${e.description ? `<p>${withBreaks(e.description)}</p>` : ''}
    <div class="row" style="margin-top:14px">${action}
      <button class="btn ghost" data-action="addToCalendar" data-id="${esc(e.id)}">📅 Ajouter à mon agenda</button></div>
    ${profile.role === 'admin' ? `<div class="row" style="margin-top:12px">
      ${e.registration ? `<button class="btn ghost sm" data-action="eventRegistrants" data-id="${esc(e.id)}">👥 Voir les inscrits</button>` : ''}${adminBtns('events', e.id)}</div>` : ''}
    <div class="row end" style="margin-top:14px"><button class="btn" data-action="closeModal">Fermer</button></div>`);
}

async function toggleRegistration(id, join, el) {
  if (el) el.disabled = true;
  const { error } = await sb.rpc(join ? 'register_event' : 'unregister_event', { eid: id });
  if (error) { if (el) el.disabled = false; toast(errMsg(error), 'err'); await refreshEvents(); return; }
  toast(join ? 'Inscription confirmée. Ajoutez-la à votre agenda depuis les détails.' : 'Inscription annulée.');
  const open = !!$('.modal');
  await refreshEvents();
  if (open) openEvent(id);
}

async function refreshEvents() {
  const { data } = await sb.rpc('events_list');
  feedEvents = data || feedEvents;
  if (currentView === 'feed' && feedKind === 'events' && $('#feedList')) $('#feedList').innerHTML = renderEventList();
  if (currentView === 'home') loadHomeFeed();
}

async function loadHomeFeed() {
  const [ev, nw, of] = await Promise.all([
    sb.rpc('events_list'),
    sb.from('news').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(2),
    sb.rpc('offers_list'),
  ]);
  const box = $('#homeFeed');
  if (!box || currentView !== 'home') return;
  feedEvents = ev.data || [];
  feedNews = nw.data || [];
  offerRows = of.data || [];
  const offs = offerRows.filter((o) => o.status === 'published' && !offerExpired(o)).slice(0, 2);
  const up = feedEvents.filter(isUpcoming).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 2);
  if (!up.length && !feedNews.length && !offs.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="card">
    ${up.length ? `<h2>À venir</h2>${up.map((e) => {
      const d = new Date(e.starts_at);
      return `<button class="mini" data-action="openEvent" data-id="${esc(e.id)}">
        <span class="date-badge sm" aria-hidden="true"><b>${d.getDate()}</b><span>${d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</span></span>
        <span class="mini-t"><b>${esc(e.title)}</b><span class="small muted">${fmtHour(e.starts_at)}${e.location ? ' · ' + esc(e.location) : ''}${e.mine ? ' · ✓ inscrit' : ''}</span></span></button>`;
    }).join('')}<p style="margin:6px 0 14px"><a href="#/agenda">Tout l’agenda →</a></p>` : ''}
    ${feedNews.length ? `<h2>Dernières actualités</h2>${feedNews.map((n) =>
      `<button class="mini" data-action="openNews" data-id="${esc(n.id)}"><span class="mini-ic" aria-hidden="true">📰</span>
        <span class="mini-t"><b>${esc(n.title)}</b><span class="small muted">${fmtDate(n.created_at)}</span></span></button>`).join('')}
      <p style="margin:6px 0 14px"><a href="#/actus">Toutes les actualités →</a></p>` : ''}
    ${offs.length ? `<h2>Offres récentes</h2>${offs.map((o) =>
      `<button class="mini" data-action="openOffer" data-id="${esc(o.id)}"><span class="mini-ic" aria-hidden="true">💼</span>
        <span class="mini-t"><b>${esc(o.title)}</b><span class="small muted">${esc(OFFER_TYPES[o.type])} · ${esc(o.organization)}</span></span></button>`).join('')}
      <p style="margin:6px 0 0"><a href="#/offres">Toutes les offres →</a></p>` : ''}
  </section>`;
}

/* ----- Agenda personnel (.ics) et liste des inscrits (CSV) ----- */
function slug(t) { return fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'evenement'; }
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadIcs(e) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600 * 1000).toISOString();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GSJC Rabat//Alumni//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${e.id}@alumni-gsjc`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${ics(e.title)}`, e.location ? `LOCATION:${ics(e.location)}` : null, e.description ? `DESCRIPTION:${ics(e.description)}` : null,
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
  download(`${slug(e.title)}.ics`, 'text/calendar;charset=utf-8', lines.join('\r\n') + '\r\n');
}
async function fetchRegistrants(id) {
  const { data: regs, error } = await sb.from('event_registrations').select('user_id, created_at').eq('event_id', id).order('created_at', { ascending: true });
  if (error) throw error;
  if (!regs.length) return [];
  const { data: people } = await sb.from('profiles').select('id, first_name, last_name, email, member_type, graduation_year, class_level').in('id', regs.map((r) => r.user_id));
  return regs.map((r) => ({ ...(people || []).find((p) => p.id === r.user_id), at: r.created_at }));
}
async function openRegistrants(id) {
  const e = feedEvents.find((x) => String(x.id) === String(id));
  let rows = [];
  try { rows = await fetchRegistrants(id); } catch (err) { return toast(errMsg(err), 'err'); }
  regCache.set(String(id), rows);
  openModal(`
    <h2>Inscrits · ${esc(e?.title || '')}</h2>
    <p class="muted small">${rows.length} inscrit${rows.length > 1 ? 's' : ''}${e?.capacity ? ` sur ${e.capacity} places` : ''}</p>
    ${rows.length ? `<ul class="plain-list">${rows.map((r) => `<li><b>${esc(`${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email)}</b>
      <span class="small muted">${esc(TYPE_LABEL[r.member_type] || '')}${r.graduation_year ? ' · promo ' + esc(r.graduation_year) : ''}${r.class_level ? ' · ' + esc(r.class_level) : ''} · ${esc(r.email)}</span></li>`).join('')}</ul>` : '<p class="empty">Aucun inscrit pour le moment.</p>'}
    <div class="row end" style="margin-top:14px">
      ${rows.length ? `<button class="btn ghost" data-action="exportRegistrants" data-id="${esc(id)}">⬇ Exporter (Excel)</button>` : ''}
      <button class="btn" data-action="closeModal">Fermer</button></div>`);
}
function exportRegistrants(id) {
  const e = feedEvents.find((x) => String(x.id) === String(id));
  const rows = regCache.get(String(id)) || [];
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const head = ['Nom', 'Prénom', 'Type', 'Promotion / classe', 'E-mail', 'Inscrit le'];
  const lines = [head, ...rows.map((r) => [r.last_name, r.first_name, TYPE_LABEL[r.member_type] || '', r.graduation_year || r.class_level || '', r.email, new Date(r.at).toLocaleString('fr-FR')])];
  download(`inscrits-${slug(e?.title)}.csv`, 'text/csv;charset=utf-8', '\ufeff' + lines.map((l) => l.map(cell).join(';')).join('\r\n'));
}

/* ----- Publication (administration) ----- */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function resizedJpeg(file, maxW) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const k = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) throw new Error('image');
  return blob;
}

async function openPublish(kind, item) {
  const editing = !!item;
  kind = kind || 'news';
  if (editing) await contentUrls([item.image_path]);
  const curUrl = editing ? contentUrl(item.image_path) : null;
  const v = (k) => esc(item?.[k] ?? '');
  const box = openModal(`
    <h2>${editing ? 'Modifier' : 'Publier'}</h2>
    <form id="pubForm" novalidate>
      ${editing ? '' : `<div class="choices" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
        <label class="choice"><input type="radio" name="pubType" value="news" ${kind === 'news' ? 'checked' : ''}><span>📰 Actualité</span></label>
        <label class="choice"><input type="radio" name="pubType" value="events" ${kind === 'events' ? 'checked' : ''}><span>📅 Événement</span></label></div>`}
      <div class="field" data-field="title"><label for="pTitle">Titre <span class="req">*</span></label>
        <input id="pTitle" type="text" maxlength="140" value="${v('title')}"><p class="err" data-err="title"></p></div>
      <div class="field" data-field="body"><label for="pBody"><span data-for="news">Texte</span><span data-for="events">Description</span> <span class="req" data-for="news">*</span></label>
        <textarea id="pBody" rows="5" maxlength="5000">${esc(item?.body ?? item?.description ?? '')}</textarea><p class="err" data-err="body"></p></div>
      <div data-for="events">
        <div class="grid2">
          <div class="field" data-field="starts"><label for="pStart">Début <span class="req">*</span></label><input id="pStart" type="datetime-local" value="${toLocalInput(item?.starts_at)}"><p class="err" data-err="starts"></p></div>
          <div class="field" data-field="ends"><label for="pEnd">Fin <span class="hint">(facultatif)</span></label><input id="pEnd" type="datetime-local" value="${toLocalInput(item?.ends_at)}"><p class="err" data-err="ends"></p></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="pLoc">Lieu</label><input id="pLoc" type="text" maxlength="200" value="${v('location')}"></div>
          <div class="field" data-field="cap"><label for="pCap">Nombre de places <span class="hint">(vide = illimité)</span></label><input id="pCap" type="number" min="1" max="10000" value="${v('capacity')}"><p class="err" data-err="cap"></p></div>
        </div>
        <label class="switch"><input type="checkbox" id="pReg" ${item ? (item.registration ? 'checked' : '') : 'checked'}><span class="track"></span><span>Inscription en ligne</span></label>
      </div>
      <div class="field"><label for="pAud">Public concerné</label>
        <select id="pAud">${Object.entries(AUDIENCE).map(([k, l]) => `<option value="${k}" ${(item?.audience || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="switch" data-for="news"><input type="checkbox" id="pPin" ${item?.pinned ? 'checked' : ''}><span class="track"></span><span>📌 Épingler en haut</span></label>
      <div class="field"><span class="lbl-t">Image de couverture <span class="hint">(facultatif)</span></span>
        <div id="pImgPrev">${curUrl ? `<img class="post-img" src="${esc(curUrl)}" alt="">` : ''}</div>
        <input type="file" id="pImg" accept="image/jpeg,image/png,image/webp,image/*" hidden>
        <div class="row" style="margin-top:6px"><button type="button" class="btn ghost sm" id="pImgBtn">Choisir une image</button>
          ${curUrl ? '<label class="check small"><input type="checkbox" id="pImgDel"><span>Retirer l’image actuelle</span></label>' : ''}</div></div>
      <div class="row end" style="margin-top:14px"><button type="button" class="btn ghost" data-action="closeModal">Annuler</button>
        <button type="submit" class="btn" id="pSave">${editing ? 'Enregistrer' : 'Publier'}</button></div>
    </form>`);
  const form = $('#pubForm', box);
  let blob = null;
  const kindNow = () => (editing ? kind : $('input[name=pubType]:checked', form).value);
  const apply = () => { const k = kindNow(); $$('[data-for]', form).forEach((n) => (n.hidden = n.dataset.for !== k)); };
  $$('input[name=pubType]', form).forEach((r) => r.addEventListener('change', apply));
  apply();
  $('#pImgBtn', form).addEventListener('click', () => $('#pImg', form).click());
  $('#pImg', form).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { blob = await resizedJpeg(f, 1280); $('#pImgPrev', form).innerHTML = `<img class="post-img" src="${URL.createObjectURL(blob)}" alt="Aperçu">`; }
    catch { toast('Cette image n’a pas pu être lue.', 'err'); }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const k = kindNow();
    $$('[data-err]', form).forEach((n) => (n.textContent = ''));
    $$('.field.invalid', form).forEach((n) => n.classList.remove('invalid'));
    const errs = [];
    const title = $('#pTitle', form).value.trim();
    const body = $('#pBody', form).value.trim();
    if (title.length < 3) errs.push(['title', 'Indiquez un titre (3 caractères minimum).']);
    if (k === 'news' && !body) errs.push(['body', 'Le texte est obligatoire.']);
    const sv = $('#pStart', form).value, ev2 = $('#pEnd', form).value, capv = $('#pCap', form).value;
    if (k === 'events') {
      if (!sv) errs.push(['starts', 'Indiquez la date et l’heure de début.']);
      if (sv && ev2 && new Date(ev2) < new Date(sv)) errs.push(['ends', 'La fin doit être après le début.']);
      if (capv && (!(Number(capv) >= 1) || !Number.isInteger(Number(capv)))) errs.push(['cap', 'Nombre de places invalide.']);
    }
    if (errs.length) {
      errs.forEach(([f, m]) => { $(`[data-err="${f}"]`, form).textContent = m; $(`[data-field="${f}"]`, form)?.classList.add('invalid'); });
      return;
    }
    const btn = $('#pSave', form);
    busy(btn, true, 'Publication…');
    let newPath = null;
    try {
      let image_path = item?.image_path || null;
      const dropOld = (blob || $('#pImgDel', form)?.checked) ? item?.image_path : null;
      if ($('#pImgDel', form)?.checked && !blob) image_path = null;
      if (blob) {
        newPath = `${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from('content').upload(newPath, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        image_path = newPath;
      }
      const common = { title, audience: $('#pAud', form).value, image_path, updated_at: new Date().toISOString() };
      const payload = k === 'news'
        ? { ...common, body, pinned: $('#pPin', form).checked }
        : { ...common, description: body || null, location: $('#pLoc', form).value.trim() || null,
            starts_at: new Date(sv).toISOString(), ends_at: ev2 ? new Date(ev2).toISOString() : null,
            capacity: capv ? Number(capv) : null, registration: $('#pReg', form).checked };
      const table = k === 'news' ? 'news' : 'events';
      const res = editing ? await sb.from(table).update(payload).eq('id', item.id) : await sb.from(table).insert(payload);
      if (res.error) throw res.error;
      if (dropOld) sb.storage.from('content').remove([dropOld]).catch(() => {});
      closeModal();
      toast(editing ? 'Modifications enregistrées.' : (k === 'news' ? 'Actualité publiée.' : 'Événement publié.'));
      if (currentView === 'feed') { if (feedKind !== k) location.hash = k === 'news' ? '#/actus' : '#/agenda'; else loadFeed(); }
      else if (currentView === 'home') loadHomeFeed();
    } catch (err) {
      if (newPath) sb.storage.from('content').remove([newPath]).catch(() => {});
      busy(btn, false);
      toast(errMsg(err), 'err');
    }
  });
}

function confirmDelete(kind, id) {
  const it = (kind === 'news' ? feedNews : feedEvents).find((x) => String(x.id) === String(id));
  if (!it) return;
  closeModal();
  const box = openModal(`
    <h2>Supprimer « ${esc(it.title)} » ?</h2>
    <p>${kind === 'events' ? 'Les inscriptions à cet événement seront aussi supprimées. ' : ''}Cette action est définitive.</p>
    <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="delOk">Oui, supprimer</button></div>`);
  $('#delOk', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Suppression…');
    const { error } = await sb.from(kind === 'news' ? 'news' : 'events').delete().eq('id', id);
    if (error) { busy(e.target, false); return toast(errMsg(error), 'err'); }
    if (it.image_path) sb.storage.from('content').remove([it.image_path]).catch(() => {});
    closeModal(); toast('Supprimé.');
    if (currentView === 'feed') loadFeed(); else if (currentView === 'home') loadHomeFeed();
  });
}

/* ------------------------------------------------------------------ */
/* Offres de stage et d'emploi                                         */
/* ------------------------------------------------------------------ */
const OFFER_TYPES = { internship: 'Stage', apprenticeship: 'Alternance', job: 'Emploi', other: 'Autre' };
const OFFER_CHIPS = [['', 'Toutes'], ['internship', 'Stages'], ['apprenticeship', 'Alternance'], ['job', 'Emplois'], ['other', 'Autres']];
const OFFER_STATUS = { pending: ['⏳ En attente de validation', 'wait'], published: ['✓ Publiée', 'ok'], rejected: ['✕ Refusée', 'no'], closed: ['Pourvue', ''] };
let offerRows = [];
let offerType = '';
let offerMine = false;
let offerQ = '';
let offerShowExpired = false;
const offerExpired = (o) => !!o.deadline && new Date(o.deadline + 'T23:59:59') < new Date();
const offerDeadline = (o) => new Date(o.deadline + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function feedSeg(cur) {
  const l = (h, k, t) => `<a href="${h}" aria-current="${cur === k}">${t}</a>`;
  return `<div class="seg seg-links">${l('#/actus', 'news', 'Actualités')}${l('#/agenda', 'events', 'Agenda')}${l('#/offres', 'offers', 'Offres')}</div>`;
}
function adminSeg(cur) {
  const l = (h, k, t) => `<a href="${h}" aria-current="${cur === k}">${t}</a>`;
  return `<div class="seg seg-links seg-2">${l('#/admin', 'admin', 'Validation')}${l('#/stats', 'stats', 'Statistiques')}</div>`;
}

function viewOffers() {
  currentView = 'offers';
  const canPost = profile.member_type !== 'student';
  shell(`
    <div class="page-head tight"><h1>Offres</h1>${canPost ? '<button class="btn sm" data-action="newOffer">＋ Proposer</button>' : ''}</div>
    ${feedSeg('offers')}
    <div class="chips scroll" id="offerChips"></div>
    <div class="field"><label class="sr" for="offerQ">Rechercher</label>
      <input type="search" id="offerQ" placeholder="Rechercher : poste, entreprise, ville…" autocomplete="off" value="${esc(offerQ)}"></div>
    <label class="check small" style="margin-bottom:12px"><input type="checkbox" id="offerExp" ${offerShowExpired ? 'checked' : ''}><span>Afficher les offres expirées ou pourvues</span></label>
    <div id="offerList" class="feed"><p class="muted">Chargement…</p></div>`);
  $('#offerQ').addEventListener('input', (e) => { offerQ = e.target.value; renderOffers(); });
  $('#offerExp').addEventListener('change', (e) => { offerShowExpired = e.target.checked; renderOffers(); });
  loadOffers().then(markContentSeen);
}

async function loadOffers() {
  const { data, error } = await sb.rpc('offers_list');
  const box = $('#offerList');
  if (!box || currentView !== 'offers') return;
  if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  offerRows = data || [];
  renderOffers();
}

function offerCard(o) {
  const exp = offerExpired(o);
  const st = o.mine ? OFFER_STATUS[o.status] : null;
  const where = [o.location, o.remote ? 'à distance' : null].filter(Boolean).join(' · ');
  const mineActions = o.mine || profile.role === 'admin'
    ? `${o.mine && (o.status === 'published' || o.status === 'pending') ? `<button class="btn ghost sm" data-action="closeOffer" data-id="${esc(o.id)}">Marquer comme pourvue</button>` : ''}
       <button class="btn ghost sm" data-action="editOffer" data-id="${esc(o.id)}">Modifier</button>
       <button class="btn danger-ghost sm" data-action="deleteOffer" data-id="${esc(o.id)}">Supprimer</button>` : '';
  return `<article class="post offer ${exp ? 'expired' : ''}"><div class="post-body">
    <div class="tags"><span class="tag">${esc(OFFER_TYPES[o.type])}</span>${o.remote ? '<span class="tag">🌐 À distance</span>' : ''}${audTag(o.audience)}
      ${st ? `<span class="tag ${st[1]}">${st[0]}</span>` : ''}${exp ? '<span class="tag no">Expirée</span>' : ''}</div>
    <h3>${esc(o.title)}</h3>
    <p class="o-org"><b>${esc(o.organization)}</b>${where ? ' · ' + esc(where) : ''}</p>
    <p class="small muted">${o.deadline ? (exp ? 'Date limite dépassée' : 'À postuler avant le ' + esc(offerDeadline(o))) + ' · ' : ''}Proposée par ${esc(o.author_name || 'un membre')}${o.author_year && !o.author_admin ? ' (promo ' + esc(o.author_year) + ')' : ''}</p>
    ${o.mine && o.status === 'rejected' && o.review_note ? `<p class="small" style="color:var(--danger)"><b>Motif du refus :</b> ${esc(o.review_note)}</p>` : ''}
    <div class="row"><button class="btn ghost sm" data-action="openOffer" data-id="${esc(o.id)}">Voir l’offre</button>${mineActions}</div>
  </div></article>`;
}

function renderOffers() {
  const chips = $('#offerChips');
  const box = $('#offerList');
  if (!chips || !box) return;
  const canPost = profile.member_type !== 'student';
  chips.innerHTML = OFFER_CHIPS.map(([k, l]) => `<button class="chip ${!offerMine && offerType === k ? 'on' : ''}" data-action="offerType" data-t="${k}">${l}</button>`).join('') +
    (canPost ? `<button class="chip ${offerMine ? 'on' : ''}" data-action="offerMineToggle">Mes offres</button>` : '');
  const q = fold(offerQ.trim());
  let rows = offerRows.filter((o) => (offerMine ? o.mine : o.status === 'published'));
  if (!offerShowExpired && !offerMine) rows = rows.filter((o) => !offerExpired(o));
  if (offerType) rows = rows.filter((o) => o.type === offerType);
  if (q) rows = rows.filter((o) => fold([o.title, o.organization, o.location, o.description].join(' ')).includes(q));
  box.innerHTML = rows.length ? rows.map(offerCard).join('')
    : `<div class="empty">${offerMine ? 'Vous n’avez proposé aucune offre pour le moment.' : 'Aucune offre ne correspond pour le moment.'}</div>`;
}

function openOffer(id) {
  const o = offerRows.find((x) => String(x.id) === String(id));
  if (!o) return;
  const exp = offerExpired(o);
  const safe = (u) => /^https:\/\//i.test(u || '');
  const apply = [];
  if (safe(o.apply_url)) apply.push(`<a class="btn" href="${esc(o.apply_url)}" target="_blank" rel="noopener noreferrer">Postuler en ligne ↗</a>`);
  if (o.apply_email) apply.push(`<a class="btn ${safe(o.apply_url) ? 'ghost' : ''}" href="mailto:${esc(o.apply_email)}?subject=${encodeURIComponent('Candidature : ' + o.title)}">✉ Postuler par e-mail</a>`);
  const st = OFFER_STATUS[o.status];
  openModal(`
    <div class="tags"><span class="tag">${esc(OFFER_TYPES[o.type])}</span>${o.remote ? '<span class="tag">🌐 À distance</span>' : ''}${audTag(o.audience)}${exp ? '<span class="tag no">Expirée</span>' : ''}</div>
    <h2 style="margin-top:6px">${esc(o.title)}</h2>
    <p><b>${esc(o.organization)}</b></p>
    ${o.status !== 'published' && (o.mine || profile.role === 'admin') ? `<div class="warn-banner small" style="margin-top:8px">${st[0]}${o.status === 'pending' ? ' : visible par les membres après validation par l’administration.' : ''}</div>` : ''}
    <dl class="kv" style="margin:10px 0">
      ${o.location || o.remote ? `<dt>Lieu</dt><dd>${esc([o.location, o.remote ? 'à distance possible' : null].filter(Boolean).join(' · '))}</dd>` : ''}
      ${o.duration ? `<dt>Durée</dt><dd>${esc(o.duration)}</dd>` : ''}
      ${o.deadline ? `<dt>Date limite</dt><dd>${esc(offerDeadline(o))}</dd>` : ''}
      <dt>Proposée par</dt><dd>${esc(o.author_name || 'un membre')}${o.author_year && !o.author_admin ? ' (promo ' + esc(o.author_year) + ')' : ''}</dd>
    </dl>
    <p>${withBreaks(o.description)}</p>
    ${apply.length && !exp ? `<div class="row" style="margin-top:14px">${apply.join('')}</div>` : ''}
    ${exp ? '<p class="no-line" style="margin-top:12px">La date limite est dépassée.</p>' : ''}
    <p class="small muted" style="margin-top:12px">🔒 Ne communiquez jamais de coordonnées bancaires ni de copie de pièce d’identité pour candidater. En cas de doute sur une offre, parlez-en à l’administration.</p>
    <div class="row end" style="margin-top:14px">
      ${o.mine || profile.role === 'admin' ? `<button class="btn ghost sm" data-action="editOffer" data-id="${esc(o.id)}">Modifier</button><button class="btn danger-ghost sm" data-action="deleteOffer" data-id="${esc(o.id)}">Supprimer</button>` : ''}
      <button class="btn" data-action="closeModal">Fermer</button></div>`);
}

function openOfferForm(item) {
  const editing = !!item;
  const v = (k) => esc(item?.[k] ?? '');
  const isAdmin = profile.role === 'admin';
  const box = openModal(`
    <h2>${editing ? 'Modifier l’offre' : 'Proposer une offre'}</h2>
    ${isAdmin ? '' : `<p class="muted small">Votre offre sera vérifiée par l’administration avant d’être visible par les élèves et les anciens.</p>`}
    <form id="offForm" novalidate style="margin-top:10px">
      <div class="field" data-field="type"><label for="oType">Type d’offre <span class="req">*</span></label>
        <select id="oType"><option value="">Choisir…</option>${Object.entries(OFFER_TYPES).map(([k, l]) => `<option value="${k}" ${item?.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select><p class="err" data-err="type"></p></div>
      <div class="field" data-field="title"><label for="oTitle">Intitulé du poste <span class="req">*</span></label>
        <input id="oTitle" type="text" maxlength="140" value="${v('title')}" placeholder="Ex. : Stage en analyse financière"><p class="err" data-err="title"></p></div>
      <div class="field" data-field="org"><label for="oOrg">Entreprise ou organisme <span class="req">*</span></label>
        <input id="oOrg" type="text" maxlength="120" value="${v('organization')}"><p class="err" data-err="org"></p></div>
      <div class="grid2">
        <div class="field"><label for="oLoc">Lieu</label><input id="oLoc" type="text" maxlength="120" value="${v('location')}" placeholder="Ville, pays"></div>
        <div class="field"><label for="oDur">Durée</label><input id="oDur" type="text" maxlength="80" value="${v('duration')}" placeholder="Ex. : 3 mois, à partir de juin"></div>
      </div>
      <label class="switch"><input type="checkbox" id="oRemote" ${item?.remote ? 'checked' : ''}><span class="track"></span><span>🌐 Possible à distance</span></label>
      <div class="field" data-field="desc"><label for="oDesc">Description <span class="req">*</span></label>
        <textarea id="oDesc" rows="5" maxlength="5000" placeholder="Missions, profil recherché, conditions…">${v('description')}</textarea><p class="err" data-err="desc"></p></div>
      <p class="small"><b>Comment postuler ?</b> <span class="req">*</span> <span class="hint">(au moins un des deux)</span></p>
      <div class="grid2">
        <div class="field" data-field="url"><label for="oUrl">Lien de candidature</label><input id="oUrl" type="text" inputmode="url" value="${v('apply_url')}" placeholder="https://…"><p class="err" data-err="url"></p></div>
        <div class="field" data-field="mail"><label for="oMail">Adresse e-mail</label><input id="oMail" type="email" value="${v('apply_email')}" placeholder="recrutement@…"><p class="err" data-err="mail"></p></div>
      </div>
      <p class="err" data-err="apply"></p>
      <div class="grid2">
        <div class="field" data-field="deadline"><label for="oDead">Date limite <span class="hint">(facultatif)</span></label><input id="oDead" type="date" value="${v('deadline')}"><p class="err" data-err="deadline"></p></div>
        <div class="field"><label for="oAud">Public concerné</label>
          <select id="oAud">${Object.entries(AUDIENCE).map(([k, l]) => `<option value="${k}" ${(item?.audience || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="row end" style="margin-top:12px"><button type="button" class="btn ghost" data-action="closeModal">Annuler</button>
        <button type="submit" class="btn" id="oSave">${editing ? 'Enregistrer' : (isAdmin ? 'Publier' : 'Envoyer pour validation')}</button></div>
    </form>`);
  const form = $('#offForm', box);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $$('[data-err]', form).forEach((n) => (n.textContent = ''));
    $$('.field.invalid', form).forEach((n) => n.classList.remove('invalid'));
    const val = (id) => $(id, form).value.trim();
    const d = { type: val('#oType'), title: val('#oTitle'), organization: val('#oOrg'), location: val('#oLoc') || null, duration: val('#oDur') || null,
      remote: $('#oRemote', form).checked, description: val('#oDesc'), apply_url: val('#oUrl') || null, apply_email: val('#oMail') || null,
      deadline: val('#oDead') || null, audience: $('#oAud', form).value };
    if (d.apply_url && !/^https?:\/\//i.test(d.apply_url)) d.apply_url = 'https://' + d.apply_url;
    if (d.apply_url) d.apply_url = d.apply_url.replace(/^http:\/\//i, 'https://');
    const errs = [];
    if (!d.type) errs.push(['type', 'Choisissez un type d’offre.']);
    if (d.title.length < 3) errs.push(['title', 'Indiquez un intitulé (3 caractères minimum).']);
    if (d.organization.length < 2) errs.push(['org', 'Indiquez l’entreprise ou l’organisme.']);
    if (d.description.length < 10) errs.push(['desc', 'Décrivez l’offre (10 caractères minimum).']);
    if (!d.apply_url && !d.apply_email) errs.push(['apply', 'Indiquez un lien de candidature ou une adresse e-mail.']);
    if (d.apply_url && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(d.apply_url)) errs.push(['url', 'Lien invalide (il doit commencer par https://).']);
    if (d.apply_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.apply_email)) errs.push(['mail', 'Adresse e-mail invalide.']);
    if (d.deadline && !editing && new Date(d.deadline + 'T23:59:59') < new Date()) errs.push(['deadline', 'La date limite est déjà passée.']);
    if (errs.length) {
      errs.forEach(([f, m]) => { const n = $(`[data-err="${f}"]`, form); if (n) n.textContent = m; $(`[data-field="${f}"]`, form)?.classList.add('invalid'); });
      return;
    }
    const btn = $('#oSave', form);
    busy(btn, true, 'Envoi…');
    const res = editing ? await sb.from('offers').update(d).eq('id', item.id)
      : await sb.from('offers').insert(isAdmin ? { ...d, status: 'published' } : d);
    if (res.error) { busy(btn, false); return toast(errMsg(res.error), 'err'); }
    closeModal();
    toast(isAdmin ? (editing ? 'Offre modifiée.' : 'Offre publiée.')
      : (editing ? (item.status === 'pending' ? 'Offre modifiée.' : 'Modifications envoyées : l’offre sera de nouveau vérifiée.') : 'Offre envoyée. Elle sera visible après validation par l’administration.'));
    if (currentView === 'offers') { if (!isAdmin) offerMine = true; loadOffers(); }
    else if (currentView === 'admin' && adminTab === 'offers') loadOffersAdmin();
    else if (currentView === 'home') loadHomeFeed();
    else if (!isAdmin) location.hash = '#/offres';
  });
}

async function setOfferStatus(id, status, message) {
  const { error } = await sb.from('offers').update({ status, review_note: null }).eq('id', id);
  if (error) { toast(errMsg(error), 'err'); return false; }
  toast(message);
  closeModal();
  if (currentView === 'offers') loadOffers();
  if (currentView === 'admin') { loadStats(); if (adminTab === 'offers') loadOffersAdmin(); }
  return true;
}

function confirmDeleteOffer(id) {
  const o = offerRows.find((x) => String(x.id) === String(id));
  if (!o) return;
  closeModal();
  const box = openModal(`
    <h2>Supprimer « ${esc(o.title)} » ?</h2><p>Cette action est définitive.</p>
    <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="closeModal">Annuler</button><button class="btn danger" id="offDelOk">Oui, supprimer</button></div>`);
  $('#offDelOk', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Suppression…');
    const { error } = await sb.from('offers').delete().eq('id', id);
    if (error) { busy(e.target, false); return toast(errMsg(error), 'err'); }
    closeModal(); toast('Offre supprimée.');
    if (currentView === 'offers') loadOffers();
    if (currentView === 'admin') { loadStats(); if (adminTab === 'offers') loadOffersAdmin(); }
  });
}

function onOfferEvent({ eventType, new: row }) {
  if (!row) return;
  const mine = row.author_id === profile.id;
  const admin = profile.role === 'admin';
  if (admin && eventType === 'INSERT' && row.status === 'pending' && !mine) {
    notifyUser('Nouvelle offre à valider', row.title);
    refreshBadge();
    if (currentView === 'admin') { loadStats(); if (adminTab === 'offers') loadOffersAdmin(); }
    return;
  }
  if (mine && eventType === 'UPDATE' && (row.status === 'published' || row.status === 'rejected')) {
    notifyUser(row.status === 'published' ? 'Votre offre a été publiée' : 'Votre offre a été refusée', row.title);
    if (currentView === 'offers') loadOffers();
    return;
  }
  if (!mine && !admin && eventType === 'UPDATE' && row.status === 'published') {
    refreshContentBadge();
    notifyUser('Nouvelle offre', row.title);
    if (currentView === 'offers') loadOffers();
    if (currentView === 'home') loadHomeFeed();
    return;
  }
  if (admin) refreshBadge();
}

async function loadOffersAdmin() {
  const list = $('#adminList');
  if (!list) return;
  const { data, error } = await sb.rpc('offers_list');
  if (adminTab !== 'offers' || !$('#adminList')) return;
  if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  offerRows = data || [];
  const rows = offerRows.filter((o) => o.status === 'pending').reverse();
  if (!rows.length) { list.innerHTML = '<div class="empty">Aucune offre à valider 🎉</div>'; return; }
  list.innerHTML = rows.map((o) => `<article class="req-card">
    <div><span class="pill wait">À valider</span> <span class="tag">${esc(OFFER_TYPES[o.type])}</span> <span class="small muted">${fmtDate(o.created_at)}</span></div>
    <h3>${esc(o.title)}</h3>
    <p><b>${esc(o.organization)}</b>${o.location ? ' · ' + esc(o.location) : ''}</p>
    <p class="small muted">Proposée par <b>${esc(o.author_name || '?')}</b>${o.author_year ? ' (promo ' + esc(o.author_year) + ')' : ''}</p>
    <p class="small">${esc(o.description.length > 200 ? o.description.slice(0, 200) + '…' : o.description)}</p>
    <div class="req-actions">
      <button class="btn ok sm" data-action="approveOffer" data-id="${esc(o.id)}">✓ Publier</button>
      <button class="btn danger-ghost sm" data-action="rejectOffer" data-id="${esc(o.id)}">✕ Refuser</button>
      <button class="btn ghost sm" data-action="openOffer" data-id="${esc(o.id)}">👁 Voir</button></div>
  </article>`).join('');
}

/* ------------------------------------------------------------------ */
/* Statistiques (administration)                                       */
/* ------------------------------------------------------------------ */
const pct = (n, t) => (t ? Math.round((n / t) * 100) + ' %' : '–');

function barList(items, label, total) {
  if (!items || !items.length) return '<p class="muted small">Pas encore de données.</p>';
  const max = Math.max(...items.map((i) => i.n));
  return `<ul class="bars">${items.map((i) => `<li><span class="b-l">${esc(label ? label(i.k) : i.k)}</span>
    <span class="b-t"><i style="width:${Math.max(3, Math.round((i.n / max) * 100))}%"></i></span>
    <b>${i.n}${total ? ` <small>${pct(i.n, total)}</small>` : ''}</b></li>`).join('')}</ul>`;
}
function colChart(items, label) {
  if (!items || !items.length) return '<p class="muted small">Pas encore de données.</p>';
  const max = Math.max(1, ...items.map((i) => i.n));
  return `<div class="cols">${items.map((i) => `<div class="col"><b>${i.n || ''}</b><i style="height:${Math.round((i.n / max) * 100)}%"></i><span>${esc(label ? label(i.k) : i.k)}</span></div>`).join('')}</div>`;
}
const tile = (n, l) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
const monthLabel = (k) => new Date(k + '-15').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') + ' ' + k.slice(2, 4);

async function viewStats() {
  currentView = 'stats';
  const y = new Date().getFullYear();
  const opts = Array.from({ length: y + 2 - 2000 }, (_, i) => y + 1 - i).map((v) => `<option value="${v}">${v}</option>`).join('');
  shell(`
    <div class="page-head tight"><h1>Administration</h1>
      <div class="row no-print"><button class="btn ghost sm" data-action="printStats">🖨 Imprimer / PDF</button>
        <button class="btn ghost sm" data-action="exportAlumni">⬇ Exporter les alumni</button></div></div>
    ${adminSeg('stats')}
    <div class="card filters no-print"><div class="grid2">
      <div class="field"><label for="stFrom">Promotions : de</label><select id="stFrom"><option value="">Toutes</option>${opts}</select></div>
      <div class="field"><label for="stTo">à</label><select id="stTo"><option value="">Toutes</option>${opts}</select></div></div></div>
    <div id="statsBody"><p class="muted">Chargement…</p></div>`, { wide: true });
  $('#stFrom').addEventListener('change', loadStatsPage);
  $('#stTo').addEventListener('change', loadStatsPage);
  loadStatsPage();
}

async function loadStatsPage() {
  const f = $('#stFrom')?.value, t = $('#stTo')?.value;
  const { data: d, error } = await sb.rpc('admin_stats', { year_from: f ? Number(f) : null, year_to: t ? Number(t) : null });
  const box = $('#statsBody');
  if (!box || currentView !== 'stats') return;
  if (error) { box.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const m = d.members, c = d.contact, a = d.activity;
  const unknown = (d.by_field.find((x) => x.k === 'unknown') || { n: 0 }).n;
  const range = f || t ? ` · promotions ${f || '…'} à ${t || '…'}` : '';
  box.innerHTML = `
    <p class="print-only">Alumni GSJC Rabat · statistiques du ${fmtDate(new Date())}${esc(range)}</p>
    <h2 class="st-h">Membres</h2>
    <div class="stats">${tile(m.alumni, 'Alumni validés')}${tile(m.students, 'Lycéens validés')}${tile(m.staff, 'Personnel')}${tile(m.pending, 'Inscriptions en attente')}</div>
    <h2 class="st-h">Devenir des alumni <small class="muted">· ${d.alumni_total} alumni${esc(range)}</small></h2>
    <div class="stats">${tile(pct(c.message, c.total), 'acceptent les messages')}${tile(pct(c.located, c.total), 'visibles sur la carte')}${tile(pct(d.alumni_total - unknown, d.alumni_total), 'domaine renseigné')}</div>
    <div class="st-grid">
      <section class="card"><h3>Par domaine d’études</h3>${barList(d.by_field, studyLabel, d.alumni_total)}
        ${unknown ? `<p class="small muted" style="margin-top:8px">${unknown} alumni n’ont pas encore indiqué leur domaine.</p>` : ''}</section>
      <section class="card"><h3>Par pays</h3>${barList(d.by_country, null, d.alumni_total)}</section>
      <section class="card"><h3>Villes les plus représentées</h3>${barList(d.by_city)}</section>
      <section class="card"><h3>Établissements les plus fréquentés</h3>${barList(d.by_school)}</section>
      <section class="card"><h3>Formations les plus suivies</h3>${barList(d.by_program)}</section>
      <section class="card"><h3>Par promotion</h3>${colChart(d.by_year)}</section>
    </div>
    <h2 class="st-h">Vie de la communauté</h2>
    <section class="card"><h3>Inscriptions par mois (12 derniers mois)</h3>${colChart(d.signups, monthLabel)}</section>
    <div class="stats">${tile(a.messages_30d, 'messages (30 jours)')}${tile(a.conversations, 'conversations')}${tile(a.events_upcoming, 'événements à venir')}
      ${tile(a.registrations, 'inscriptions aux événements')}${tile(a.offers_published, 'offres publiées')}${tile(a.offers_pending, 'offres à valider')}
      ${tile(a.news, 'actualités')}${tile(a.reports_open, 'signalements ouverts')}</div>
    <p class="small muted">Les messages privés ne sont jamais lus : seuls des totaux sont comptés.</p>`;
}

function csvCell(v) { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; }

async function exportAlumni() {
  const cols = 'first_name,last_name,graduation_year,country,city,school,program,study_field,email,linkedin,instagram,contact_email,contact_message,contact_chat';
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('profiles').select(cols).eq('status', 'approved').eq('member_type', 'alumni')
      .order('last_name', { ascending: true }).range(from, from + 999);
    if (error) return toast(errMsg(error), 'err');
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const yes = (b) => (b ? 'oui' : 'non');
  const head = ['Nom', 'Prénom', 'Promotion', 'Pays', 'Ville', 'Établissement', 'Formation', 'Domaine', 'E-mail', 'LinkedIn', 'Instagram', 'Contact e-mail', 'Contact message'];
  const lines = [head, ...all.map((r) => [r.last_name, r.first_name, r.graduation_year, r.country, r.city, r.school, r.program, studyLabel(r.study_field), r.email, r.linkedin,
    r.instagram ? '@' + r.instagram : '', yes(r.contact_email), yes(r.contact_message || r.contact_chat)])];
  download(`alumni-gsjc-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n'));
  toast(`${all.length} alumni exportés.`);
}

/* ------------------------------------------------------------------ */
/* Administration : validation des inscriptions                        */
/* ------------------------------------------------------------------ */
const TABS_BASE = [['pending', 'En attente'], ['approved', 'Validés'], ['rejected', 'Refusés'], ['offers', 'Offres'], ['reports', 'Signalements']];
const tabsFor = () => (profile?.is_owner ? [...TABS_BASE, ['team', 'Équipe']] : TABS_BASE);

async function countOf(filters, table = 'profiles') {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [k, val] of Object.entries(filters)) q = q.eq(k, val);
  const { count } = await q;
  return count ?? 0;
}

let adminBadgeN = 0;
function setAdminBadge(n) {
  adminBadgeN = Number(n) || 0;
  $$('.js-admin-badge').forEach((b) => { b.textContent = adminBadgeN; b.hidden = adminBadgeN === 0; });
}
// Pastille « à traiter » : demandes en attente + signalements ouverts.
async function refreshBadge() {
  const [pending, reports, offers] = await Promise.all([
    countOf({ status: 'pending' }),
    countOf({ status: 'open' }, 'reports'),
    countOf({ status: 'pending' }, 'offers'),
  ]);
  setAdminBadge(pending + reports + offers);
  return pending + reports + offers;
}

async function viewAdmin() {
  currentView = 'admin';
  shell(`
    <div class="page-head"><h1>Validation des inscriptions</h1>
      <button class="btn ghost sm" data-action="refreshAdmin">Actualiser</button></div>
    ${adminSeg('admin')}
    <div class="stats" id="stats"></div>
    <div id="geoFix"></div>
    <div class="tabs" role="tablist">
      ${tabsFor().map(([k, l]) => `<button role="tab" data-action="adminTab" data-tab="${k}" aria-selected="${k === adminTab}">${l}</button>`).join('')}
    </div>
    <div class="field"><input type="search" id="adminSearch" placeholder="Rechercher un nom, une école, un e-mail…" aria-label="Rechercher"></div>
    <div id="adminList" class="cards"><p class="muted">Chargement…</p></div>`, { wide: true });
  $('#adminSearch').addEventListener('input', renderAdminList);
  loadStats();
  loadAdminList();
}

async function loadStats() {
  const [pending, alumni, students, rejected, reports, offersP] = await Promise.all([
    countOf({ status: 'pending' }),
    countOf({ status: 'approved', member_type: 'alumni' }),
    countOf({ status: 'approved', member_type: 'student' }),
    countOf({ status: 'rejected' }),
    countOf({ status: 'open' }, 'reports'),
    countOf({ status: 'pending' }, 'offers'),
  ]);
  const box = $('#stats');
  if (!box) return;
  box.innerHTML = [['En attente', pending], ['Alumni validés', alumni], ['Lycéens validés', students], ['Refusés', rejected], ['Signalements ouverts', reports], ['Offres à valider', offersP]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  setAdminBadge(pending + reports + offersP);
  checkPositions();
}

async function loadAdminList() {
  const list = $('#adminList');
  if (!list) return;
  list.innerHTML = '<p class="muted">Chargement…</p>';
  if (adminTab === 'reports') return loadReports();
  if (adminTab === 'offers') return loadOffersAdmin();
  if (adminTab === 'team') return loadTeam();
  const { data, error } = await sb.from('profiles').select('*').eq('status', adminTab)
    .order('updated_at', { ascending: adminTab !== 'pending' }).limit(300);
  if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  adminRows = new Map((data || []).map((r) => [r.id, r]));
  await photoUrls((data || []).map((r) => r.photo_path));
  renderAdminList();
}

function renderAdminList() {
  const list = $('#adminList');
  if (!list || adminTab === 'reports' || adminTab === 'offers' || adminTab === 'team') return;
  const q = ($('#adminSearch')?.value || '').trim().toLowerCase();
  const rows = [...adminRows.values()].filter((r) =>
    !q || [r.first_name, r.last_name, r.email, r.school, r.program, r.city, r.country].some((x) => (x || '').toLowerCase().includes(q)));
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${adminTab === 'pending' ? 'Aucune demande en attente 🎉' : 'Aucun résultat.'}</div>`;
    return;
  }
  list.innerHTML = rows.map(adminCard).join('');
}

// Pour un lycéen : l'adresse prenom.nom@ correspond-elle au nom indiqué ? (aide à la validation, non bloquant)
function emailNameCheck(r) {
  if (r.member_type !== 'student' || !r.first_name || !r.last_name) return null;
  const m = /^([a-z-]+)\.([a-z-]+?)[0-9]*@/.exec((r.email || '').toLowerCase());
  if (!m) return null;
  const key = (t) => fold(t).replace(/[^a-z]/g, '');
  const fn = key(r.first_name), ln = key(r.last_name);
  const ef = m[1].replace(/-/g, ''), el = m[2].replace(/-/g, '');
  return (fn.startsWith(ef) || ef.startsWith(fn)) && (ln.startsWith(el) || el.startsWith(ln));
}

function adminCard(r) {
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email;
  const url = urlCache.get(r.photo_path)?.url || null;
  const kv = [];
  kv.push(['Type', TYPE_LABEL[r.member_type] + (r.graduation_year ? ` · promo ${r.graduation_year}` : '') + (r.class_level ? ` · ${r.class_level}` : '')]);
  if (r.member_type === 'alumni') {
    kv.push(['Études', [r.program, r.school].filter(Boolean).map(esc).join(' — ')]);
    kv.push(['Lieu', [r.city, r.country].filter(Boolean).map(esc).join(', ')]);
    const links = [];
    const li = safeLinkedin(r.linkedin);
    if (li) links.push(`<a href="${esc(li)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`);
    if (r.instagram) links.push(`<a href="${esc(instagramUrl(r.instagram))}" target="_blank" rel="noopener noreferrer">Instagram</a>`);
    if (links.length) kv.push(['Réseaux', links.join(' · ')]);
  } else if (r.member_type === 'student') {
    kv.push(['Projet', esc(r.target_program || '')]);
    const chk = emailNameCheck(r);
    if (chk !== null) kv.push(['Adresse', chk ? '<span class="ok-line">✓ correspond au nom indiqué</span>' : '<span class="no-line">⚠ ne correspond pas au nom indiqué : à vérifier</span>']);
  } else {
    kv.push(['Fonction', esc(r.job_title || '')]);
  }
  const prefs = [r.contact_email && 'e-mail', r.contact_message && 'message', r.contact_chat && 'chat'].filter(Boolean).join(', ');
  kv.push(['Contact', prefs || 'aucun']);
  kv.push([r.status === 'pending' ? 'Demande' : 'Mis à jour', fmtDate(r.updated_at)]);
  if (r.status === 'rejected' && r.review_note) kv.push(['Motif', esc(r.review_note)]);

  const accept = `<button class="btn ok sm" data-action="accept" data-id="${esc(r.id)}">✓ Accepter</button>`;
  const refuse = `<button class="btn danger-ghost sm" data-action="refuse" data-id="${esc(r.id)}">${r.status === 'approved' ? 'Retirer l’accès' : '✕ Refuser'}</button>`;
  const msg = `<button class="btn ghost sm" data-action="message" data-id="${esc(r.id)}">✉ Message</button>`;
  const del = profile.is_owner && !r.is_owner && r.id !== profile.id
    ? `<button class="btn danger-ghost sm" data-action="deleteMember" data-id="${esc(r.id)}">Supprimer le compte</button>` : '';
  const protectedRow = r.is_owner || r.id === profile.id || (r.role === 'admin' && !profile.is_owner);
  const actions = protectedRow ? (r.id === profile.id ? '' : (r.is_owner ? '' : msg))
    : (r.status === 'pending' ? accept + refuse + msg : r.status === 'approved' ? refuse + msg : accept + msg) + del;
  const tag = r.is_owner ? '<span class="pill">Propriétaire</span> ' : r.role === 'admin' ? '<span class="pill">Administrateur</span> ' : '';

  return `<article class="req-card">
    <div class="req-top">${avatarHtml(r, url)}<div>${tag}<h3>${esc(name)}</h3><div class="sub">${esc(r.email)}</div></div></div>
    <dl class="kv">${kv.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>
    ${actions ? `<div class="req-actions">${actions}</div>` : ''}
  </article>`;
}

/* ---- Onglet « Équipe » : réservé au propriétaire ---- */
const LOG_LABEL = { promote_admin: 'a nommé administrateur', demote_admin: 'a retiré le rôle d’administrateur à', admin_status_change: 'a changé le statut de', delete_member: 'a supprimé le compte de' };
let teamQ = '';

async function loadTeam() {
  const list = $('#adminList');
  if (!list) return;
  const [admins, cands, log] = await Promise.all([
    sb.from('profiles').select('*').eq('role', 'admin').order('is_owner', { ascending: false }).order('last_name'),
    sb.from('profiles').select('*').eq('status', 'approved').eq('role', 'member').neq('member_type', 'student').order('last_name').limit(300),
    sb.from('admin_log').select('*').order('at', { ascending: false }).limit(30),
  ]);
  const err = admins.error || cands.error || log.error;
  if (err) { list.innerHTML = `<p class="err">${esc(errMsg(err))}</p>`; return; }
  adminRows = new Map([...(admins.data || []), ...(cands.data || [])].map((r) => [r.id, r]));
  teamData = { admins: admins.data || [], cands: cands.data || [], log: log.data || [] };
  renderTeam();
}
let teamData = { admins: [], cands: [], log: [] };

function renderTeam() {
  const list = $('#adminList');
  if (!list || adminTab !== 'team') return;
  const row = (r, btns) => `<div class="team-row"><div><b>${esc(nameOf(r))}</b> ${r.is_owner ? '<span class="pill">Propriétaire</span>' : ''}<div class="sub small muted">${esc(r.email)}${r.job_title ? ' · ' + esc(r.job_title) : ''}</div></div><div class="row">${btns}</div></div>`;
  const q = teamQ.trim().toLowerCase();
  const cands = teamData.cands.filter((r) => !q || [r.first_name, r.last_name, r.email].some((x) => (x || '').toLowerCase().includes(q))).slice(0, 8);
  list.innerHTML = `
    <section class="team-box"><h3>Administrateurs</h3>
      <p class="muted small">Les administrateurs valident les inscriptions, modèrent les offres et lisent les signalements. Eux seuls ne peuvent ni nommer ni retirer un autre administrateur : cela vous est réservé.</p>
      ${teamData.admins.map((r) => row(r, r.is_owner || r.id === profile.id ? '' :
        `<button class="btn ghost sm" data-action="demoteAdmin" data-id="${esc(r.id)}">Retirer le rôle</button><button class="btn danger-ghost sm" data-action="deleteMember" data-id="${esc(r.id)}">Supprimer le compte</button>`)).join('')}
    </section>
    <section class="team-box"><h3>Nommer un administrateur</h3>
      <p class="muted small">Parmi les membres validés (anciens élèves ou personnel). Un lycéen ne peut pas être administrateur.</p>
      <div class="field"><input type="search" id="teamSearch" value="${esc(teamQ)}" placeholder="Rechercher un nom ou un e-mail…" aria-label="Rechercher un membre"></div>
      ${cands.length ? cands.map((r) => row(r, `<button class="btn sm" data-action="promoteAdmin" data-id="${esc(r.id)}">Nommer administrateur</button>`)).join('') : '<div class="empty">Aucun membre trouvé.</div>'}
    </section>
    <section class="team-box"><h3>Journal de vos décisions</h3>
      ${teamData.log.length ? teamData.log.map((l) => `<div class="log-row small"><span class="muted">${fmtDate(l.at)}</span> — vous ${esc(LOG_LABEL[l.action] || l.action)} <b>${esc(l.target_email || '')}</b></div>`).join('') : '<div class="empty">Aucune décision enregistrée.</div>'}
    </section>`;
  const inp = $('#teamSearch');
  inp.addEventListener('input', () => { teamQ = inp.value; renderTeam(); const i = $('#teamSearch'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
}

async function setRole(id, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  if (error) { toast(errMsg(error), 'err'); return false; }
  return true;
}

function confirmDeleteMember(id) {
  const r = adminRows.get(id);
  const box = openModal(`
    <h2>Supprimer le compte de ${esc(nameOf(r))} ?</h2>
    <p>Cette action est <b>définitive</b> : le profil, la photo, les messages et les inscriptions de cette personne seront effacés. Elle sera consignée dans votre journal.</p>
    <p class="muted small">Pour simplement bloquer l’accès, utilisez plutôt « Retirer l’accès » : le compte reste récupérable.</p>
    <div class="row end"><button class="btn ghost" data-action="closeModal">Annuler</button>
    <button class="btn danger" id="delMemberOk">Supprimer définitivement</button></div>`);
  $('#delMemberOk', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Suppression…');
    try {
      const { data: files } = await sb.storage.from('avatars').list(id);
      if (files?.length) await sb.storage.from('avatars').remove(files.map((f) => `${id}/${f.name}`));
    } catch { /* la suppression du compte prime */ }
    const { error } = await sb.rpc('delete_member', { target: id });
    if (error) { busy(e.target, false); return toast(errMsg(error), 'err'); }
    closeModal(); toast('Compte supprimé.');
    adminRows.delete(id); loadStats(); loadAdminList();
  });
}

async function setStatus(id, status, note = null) {
  const { error } = await sb.from('profiles').update({ status, review_note: note }).eq('id', id);
  if (error) { toast(errMsg(error), 'err'); return false; }
  return true;
}

/* ------------------------------------------------------------------ */
/* Actions (délégation des clics)                                      */
/* ------------------------------------------------------------------ */
const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email;

const actions = {
  privacy: () => openPrivacy(),
  logout: async () => { stopLive(); await sb.auth.signOut(); profile = null; location.hash = '#/'; },
  authTab: (el) => (el.dataset.mode === 'signup' ? viewAuth('signup') : viewAuth('login')),
  forgot: () => viewForgot(),
  pickPhoto: () => $('#photoInput').click(),
  refreshAdmin: () => { loadStats(); loadAdminList(); },
  adminTab: (el) => { adminTab = el.dataset.tab; $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b === el)); loadAdminList(); },
  closeModal: () => closeModal(),
  deleteMember: (el) => confirmDeleteMember(el.dataset.id),
  promoteAdmin: async (el) => {
    const r = adminRows.get(el.dataset.id);
    el.disabled = true;
    if (await setRole(r.id, 'admin')) { toast(`${nameOf(r)} est maintenant administrateur.`); loadAdminList(); } else el.disabled = false;
  },
  demoteAdmin: (el) => {
    const r = adminRows.get(el.dataset.id);
    const box = openModal(`
      <h2>Retirer le rôle d’administrateur à ${esc(nameOf(r))} ?</h2>
      <p class="muted small">La personne reste membre mais ne pourra plus valider les inscriptions ni lire les signalements.</p>
      <div class="row end"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="demoteOk">Retirer le rôle</button></div>`);
    $('#demoteOk', box).addEventListener('click', async (e) => {
      busy(e.target, true, 'Envoi…');
      if (await setRole(r.id, 'member')) { closeModal(); toast('Rôle retiré.'); loadAdminList(); } else busy(e.target, false);
    });
  },
  retractMsg: (el) => confirmRetract(el.dataset.id),
  clearConv: (el) => confirmClear(el.dataset.id),
  newOffer: () => openOfferForm(),
  openOffer: (el) => openOffer(el.dataset.id),
  editOffer: (el) => { const o = offerRows.find((x) => String(x.id) === el.dataset.id); if (o) { closeModal(); openOfferForm(o); } },
  closeOffer: (el) => setOfferStatus(el.dataset.id, 'closed', 'Offre marquée comme pourvue.'),
  deleteOffer: (el) => confirmDeleteOffer(el.dataset.id),
  offerType: (el) => { offerType = el.dataset.t; offerMine = false; renderOffers(); },
  offerMineToggle: () => { offerMine = !offerMine; offerType = ''; renderOffers(); },
  approveOffer: async (el) => { el.disabled = true; await setOfferStatus(el.dataset.id, 'published', 'Offre publiée.'); },
  rejectOffer: (el) => {
    const id = el.dataset.id;
    const o = offerRows.find((x) => String(x.id) === id);
    const box = openModal(`
      <h2>Refuser l’offre « ${esc(o?.title || '')} »</h2>
      <p class="muted small">Le motif sera visible par son auteur, qui pourra corriger l’offre et la renvoyer.</p>
      <div class="field" style="margin-top:10px"><textarea id="offReason" maxlength="1000" placeholder="Motif (facultatif)…" aria-label="Motif"></textarea></div>
      <div class="row end"><button class="btn ghost" data-action="closeModal">Annuler</button><button class="btn danger" id="offRejectOk">Refuser l’offre</button></div>`);
    $('#offRejectOk', box).addEventListener('click', async (e) => {
      busy(e.target, true, 'Envoi…');
      const { error } = await sb.from('offers').update({ status: 'rejected', review_note: $('#offReason', box).value.trim() || null }).eq('id', id);
      if (error) { busy(e.target, false); return toast(errMsg(error), 'err'); }
      closeModal(); toast('Offre refusée.');
      loadOffersAdmin(); loadStats();
    });
  },
  printStats: () => window.print(),
  exportAlumni: () => exportAlumni(),
  publish: () => openPublish(feedKind),
  openNews: (el) => openNews(el.dataset.id),
  openEvent: (el) => openEvent(el.dataset.id),
  editItem: (el) => { const k = el.dataset.kind; const it = (k === 'news' ? feedNews : feedEvents).find((x) => String(x.id) === el.dataset.id); if (it) { closeModal(); openPublish(k, it); } },
  deleteItem: (el) => confirmDelete(el.dataset.kind, el.dataset.id),
  eventReg: (el) => toggleRegistration(el.dataset.id, true, el),
  eventUnreg: (el) => toggleRegistration(el.dataset.id, false, el),
  addToCalendar: (el) => { const e = feedEvents.find((x) => String(x.id) === el.dataset.id); if (e) downloadIcs(e); },
  eventRegistrants: (el) => openRegistrants(el.dataset.id),
  exportRegistrants: (el) => exportRegistrants(el.dataset.id),
  mapCountry: (el) => focusCountry(el.dataset.c),
  mapAll: () => { if (mapObj && mapPts.length) mapObj.fitBounds(mapPts, { padding: [40, 40], maxZoom: 5 }); },
  geoBackfill: async (el) => {
    el.disabled = true; el.textContent = 'Calcul en cours…';
    const countries = await loadCountries();
    let done = 0, missed = 0;
    for (const r of geoTodo) {
      const code = r.country_code || countries.find(([, n]) => geoKey(n) === geoKey(r.country))?.[0];
      const pos = code ? await resolvePosition(code, r.city) : null;
      if (!pos) { missed++; continue; }
      const { error } = await sb.from('profiles').update({ country_code: code, lat: pos.la, lng: pos.ln, city: pos.n }).eq('id', r.id);
      if (error) missed++; else done++;
    }
    toast(`${done} position${done > 1 ? 's' : ''} calculée${done > 1 ? 's' : ''}` + (missed ? ` · ${missed} ville${missed > 1 ? 's' : ''} non reconnue${missed > 1 ? 's' : ''} (à corriger par la personne)` : '') + '.');
    checkPositions();
  },
  enableNotif: () => { Notification.requestPermission().then(renderNotifBox); },
  startConv: async (el) => {
    el.disabled = true;
    const { data, error } = await sb.rpc('start_conversation', { target: el.dataset.id });
    if (error) { el.disabled = false; return toast(errMsg(error), 'err'); }
    closeModal();
    location.hash = '#/messages/' + data;
  },
  report: (el) => {
    const id = el.dataset.id;
    const box = openModal(`
      <h2>Signaler cette conversation</h2>
      <p class="muted small">Expliquez brièvement ce qui pose problème. L’administration pourra alors lire <b>cette conversation uniquement</b> pour intervenir. Aucune autre conversation n’est consultée.</p>
      <div class="field" style="margin-top:10px"><textarea id="repReason" maxlength="1000" placeholder="Motif du signalement…" aria-label="Motif"></textarea>
        <p class="err" id="repErr"></p></div>
      <div class="row end"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="repSend">Envoyer le signalement</button></div>`);
    $('#repSend', box).addEventListener('click', async (e) => {
      const reason = $('#repReason', box).value.trim();
      if (reason.length < 3) return ($('#repErr', box).textContent = 'Veuillez indiquer un motif.');
      busy(e.target, true, 'Envoi…');
      const { error } = await sb.from('reports').insert({ conversation_id: id, reason });
      if (error) { busy(e.target, false); return toast(errMsg(error), 'err'); }
      closeModal();
      toast('Signalement envoyé à l’administration.');
    });
  },
  closeReport: async (el) => {
    el.disabled = true;
    const { error } = await sb.from('reports').update({ status: 'closed', handled_by: profile.id, handled_at: new Date().toISOString() }).eq('id', el.dataset.id);
    if (error) { el.disabled = false; return toast(errMsg(error), 'err'); }
    toast('Signalement marqué comme traité.');
    loadStats(); loadReports();
  },
  viewMember: (el) => openMember(el.dataset.id),
  dirMore: () => { dirShown += DIR_PAGE; renderDirectory(); },

  accept: async (el) => {
    const id = el.dataset.id;
    const who = nameOf(adminRows.get(id)); // lu avant l'action : la liste se recharge ensuite toute seule
    el.disabled = true;
    if (await setStatus(id, 'approved')) {
      toast(`${who} a été accepté(e).`);
      adminRows.delete(id); renderAdminList(); loadStats();
    } else el.disabled = false;
  },

  refuse: (el) => {
    const id = el.dataset.id;
    const r = adminRows.get(id);
    const box = openModal(`
      <h2>${r.status === 'approved' ? 'Retirer l’accès de' : 'Refuser la demande de'} ${esc(nameOf(r))}</h2>
      <p class="muted small">Vous pouvez indiquer un motif. Il sera visible par la personne, qui pourra corriger son profil et renvoyer sa demande.</p>
      <div class="field" style="margin-top:10px"><textarea id="reason" maxlength="1000" placeholder="Motif (facultatif)…" aria-label="Motif"></textarea></div>
      <div class="row end"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="confirmRefuse">Confirmer</button></div>`);
    $('#confirmRefuse', box).addEventListener('click', async (e) => {
      busy(e.target, true, 'Envoi…');
      const note = $('#reason', box).value.trim() || null;
      if (await setStatus(id, 'rejected', note)) {
        closeModal(); toast('Demande refusée.');
        adminRows.delete(id); renderAdminList(); loadStats();
      } else busy(e.target, false);
    });
  },

  message: (el) => {
    const r = adminRows.get(el.dataset.id);
    const box = openModal(`
      <h2>Message à ${esc(nameOf(r))}</h2>
      <p class="muted small">Par exemple pour demander une précision. La personne verra votre message en se connectant.</p>
      <div id="threadBox"></div>
      <div class="row end" style="margin-top:10px"><button class="btn ghost sm" data-action="closeModal">Fermer</button></div>`);
    mountThread($('#threadBox', box), r.id, true);
  },

  deleteAccount: () => {
    const box = openModal(`
      <h2>Supprimer mon compte ?</h2>
      <p>Cette action est <b>définitive</b> : votre profil, votre photo et vos messages seront effacés.</p>
      <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="closeModal">Annuler</button>
      <button class="btn danger" id="confirmDelete">Oui, supprimer</button></div>`);
    $('#confirmDelete', box).addEventListener('click', async (e) => {
      busy(e.target, true, 'Suppression…');
      try {
        const uid = session.user.id;
        const { data: files } = await sb.storage.from('avatars').list(uid);
        if (files?.length) await sb.storage.from('avatars').remove(files.map((f) => `${uid}/${f.name}`));
        const { error } = await sb.rpc('delete_my_account');
        if (error) throw error;
        closeModal();
        await sb.auth.signOut().catch(() => {});
        profile = null; session = null; currentUid = null;
        toast('Votre compte a été supprimé.');
        viewAuth('login');
      } catch (err) { busy(e.target, false); toast(errMsg(err), 'err'); }
    });
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

/* ------------------------------------------------------------------ */
/* Protection des données                                              */
/* ------------------------------------------------------------------ */
// Texte proposé : à faire relire et valider par la direction de l'établissement
// (loi marocaine n° 09-08 / CNDP et RGPD).
function openPrivacy() {
  openModal(`
    <h2>Protection de vos données personnelles</h2>
    <div class="legal">
      <h3>Qui est responsable ?</h3>
      <p>Le Groupe Scolaire Jacques Chirac de Rabat (GSJC) est responsable de cette application et des données qui y sont déposées.</p>
      <h3>Pourquoi collectons-nous ces données ?</h3>
      <p>Pour permettre aux anciens élèves, aux lycéens et aux personnels du GSJC de se retrouver, d’échanger, de s’entraider pour l’orientation, de partager des offres de stage et d’emploi et de participer à des événements.</p>
      <h3>Quelles données ?</h3>
      <ul>
        <li>Identité : nom, prénom, adresse e-mail, photo ;</li>
        <li>Parcours : année du bac, classe, pays, ville, établissement et formation, projet d’orientation, fonction ;</li>
        <li>Réseaux sociaux (LinkedIn, Instagram) que vous choisissez d’indiquer ;</li>
        <li>Vos préférences de contact et les messages échangés avec l’administration.</li>
      </ul>
      <h3>Qui peut les voir ?</h3>
      <p><b>Uniquement</b> les membres de la communauté validés par l’établissement (anciens élèves, lycéens, personnels) et l’administration du GSJC (CPE, chargée d’orientation, direction). Vos données ne sont ni publiques, ni référencées sur internet, ni vendues, ni utilisées à des fins publicitaires.</p>
      <p>Vous décidez de ce qui est visible : photo, pays et ville, établissement et formation, réseaux sociaux, adresse e-mail. Vous choisissez aussi les moyens par lesquels on peut vous contacter. L’administration peut vérifier ces informations.</p>
      <p>La carte n’affiche que la <b>ville</b> (jamais une adresse) des alumni qui ont choisi d’afficher leur localisation. Le fond de carte est intégré à l’application : aucun serveur de cartes extérieur n’est contacté.</p>
      <p><b>Vos messages entre membres sont privés</b> : seuls les deux participants peuvent les lire. L’administration ne peut consulter une conversation que si l’un des participants la signale, et uniquement cette conversation, afin de protéger les élèves. Vous pouvez supprimer une conversation de votre côté (l’autre personne garde la sienne) et retirer un message dans les 5 minutes qui suivent son envoi ; une conversation signalée est conservée le temps de l’examen.</p>
      <h3>Base légale et durée</h3>
      <p>Vos données sont traitées avec votre consentement, que vous pouvez retirer à tout moment. Elles sont conservées tant que votre compte est actif. Pour les élèves mineurs, l’inscription suppose l’accord de leurs représentants légaux.</p>
      <h3>Hébergement et sécurité</h3>
      <p>Les données sont hébergées sur des serveurs situés en Europe (France), avec un accès protégé par mot de passe. Les photos sont stockées dans un espace privé.</p>
      <h3>Vos droits</h3>
      <p>Vous pouvez à tout moment accéder à vos données, les corriger, les masquer, vous opposer à leur traitement ou les faire effacer, conformément à la loi marocaine n° 09-08 et, le cas échéant, au RGPD. Vous pouvez modifier votre profil depuis « Mon profil » et supprimer définitivement votre compte depuis cette même page.</p>
      <p>${PRIVACY_CONTACT ? `Pour toute demande : <a href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a>.` : 'Pour toute demande, adressez-vous à l’administration du GSJC.'}
      Vous pouvez aussi saisir la Commission nationale de contrôle de la protection des données à caractère personnel (CNDP).</p>
    </div>
    <div class="row end" style="margin-top:14px"><button class="btn" data-action="closeModal">J’ai compris</button></div>`);
}

/* ------------------------------------------------------------------ */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
