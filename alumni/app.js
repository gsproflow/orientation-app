// Alumni GSJC Rabat : étape 1
// Inscription, profil + photo obligatoires, validation par l'administration.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PRIVACY_CONTACT, STUDENT_EMAIL_DOMAIN } from './config.js';

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
    [/Failed to fetch|NetworkError|Load failed/i, 'Connexion impossible. Vérifiez votre connexion internet.'],
    [/row-level security|permission denied/i, 'Action non autorisée.'],
    [/mime type|not supported/i, 'Format de fichier non accepté (JPEG, PNG ou WebP).'],
    [/exceeded the maximum|too large|payload/i, 'Fichier trop volumineux.'],
  ];
  for (const [re, fr] of map) if (re.test(m)) return fr;
  // Messages métier déjà en français renvoyés par la base (schema.sql).
  if (/^(Profil incomplet|Modification non autorisée|Changement de statut|Le type de compte)/.test(m)) return m;
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
  const approved = profile?.status === 'approved';
  const isAdmin = approved && profile.role === 'admin';
  const h = location.hash || '#/';
  const act = (r) => (h === r ? 'active' : '');
  const nav = session
    ? `<nav class="nav" aria-label="Navigation principale">
        ${approved ? `<a href="#/" class="${act('#/')}">Accueil</a><a href="#/annuaire" class="${act('#/annuaire')}">Annuaire</a>` : ''}
        ${isAdmin ? `<a href="#/admin" class="${act('#/admin')}">Administration <span id="navBadge" class="badge" hidden></span></a>` : ''}
        ${approved ? `<a href="#/profil" class="${act('#/profil')}">Mon profil</a>` : ''}
        <button class="linkbtn" data-action="privacy">Vie privée</button>
        <button class="linkbtn" data-action="logout">Déconnexion</button>
      </nav>`
    : `<nav class="nav"><button class="linkbtn" data-action="privacy">Vie privée</button></nav>`;
  app.innerHTML = `
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/"><img src="icons/monogram.png" alt=""><span>Alumni <b>GSJC</b> Rabat</span></a>
      ${nav}
    </div></header>
    <main class="main ${wide ? 'wide' : ''}" id="main">${inner}</main>
    <footer class="foot">© Groupe Scolaire Jacques Chirac · Rabat ·
      <button class="linkbtn" data-action="privacy">Protection des données</button></footer>`;
  window.scrollTo(0, 0);
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
    if (uid !== currentUid) { currentUid = uid; profile = null; setTimeout(render, 0); }
  });

  window.addEventListener('hashchange', () => { if (profile && session && !recovering) route(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfPending(); });
  setInterval(refreshIfPending, 25000);

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
  if (h === '#/profil') return viewForm();
  if (s === 'draft') return viewForm();
  if (s === 'pending') return viewPending();
  if (s === 'rejected') return viewRejected();
  if (h === '#/annuaire') return viewDirectory();
  if (h === '#/admin' && profile.role === 'admin') return viewAdmin();
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
        <div class="field"><label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
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
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
      busy(btn, false);
      if (error) err(errMsg(error));
    });
  } else {
    const hint = () => {
      const t = $('input[name=member_type]:checked').value;
      $('#typeHint').textContent =
        t === 'student' ? 'Lycéens : utilisez votre adresse e-mail de l’école.'
        : t === 'alumni' ? 'Anciens élèves : utilisez l’adresse e-mail où vous recevez l’invitation.'
        : 'Personnel du groupe scolaire.';
    };
    $$('input[name=member_type]').forEach((r) => r.addEventListener('change', hint));
    hint();

    $('#signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      err('');
      const f = new FormData(e.target);
      const email = f.get('email').trim().toLowerCase();
      const type = f.get('member_type');
      if (!/^\S+@\S+\.\S+$/.test(email)) return err('Adresse e-mail invalide.');
      if (type === 'student' && STUDENT_EMAIL_DOMAIN && !email.endsWith('@' + STUDENT_EMAIL_DOMAIN)) {
        return err(`Les lycéens doivent utiliser leur adresse e-mail de l’école (@${STUDENT_EMAIL_DOMAIN}).`);
      }
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
const COUNTRIES = ['Maroc', 'France', 'Canada', 'Espagne', 'Royaume-Uni', 'États-Unis', 'Allemagne', 'Belgique', 'Suisse',
  'Pays-Bas', 'Italie', 'Irlande', 'Portugal', 'Émirats arabes unis', 'Qatar', 'Arabie saoudite', 'Sénégal', 'Côte d’Ivoire',
  'Tunisie', 'Algérie', 'Chine', 'Japon', 'Corée du Sud', 'Australie', 'Turquie', 'Luxembourg', 'Suède', 'Norvège', 'Danemark',
  'Pologne', 'Roumanie', 'Brésil', 'Mexique', 'Inde', 'Singapour', 'Hong Kong'];

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
          ${['alumni', 'student', 'staff'].map((t) => `<label class="choice"><input type="radio" name="member_type" value="${t}" ${p.member_type === t ? 'checked' : ''} ${lockType && p.member_type !== t ? 'disabled' : ''}><span>${TYPE_LABEL[t]}</span></label>`).join('')}
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
            <input id="country" name="country" type="text" maxlength="80" list="countries" value="${v('country')}"><p class="err" data-err="country"></p>
            <datalist id="countries">${COUNTRIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="field" data-field="city"><label for="city">Ville <span class="req">*</span></label><input id="city" name="city" type="text" maxlength="80" value="${v('city')}"><p class="err" data-err="city"></p></div>
          <div class="field" data-field="school"><label for="school">Université / école <span class="req">*</span></label><input id="school" name="school" type="text" maxlength="150" value="${v('school')}"><p class="err" data-err="school"></p></div>
        </div>
        <div class="field" data-field="program"><label for="program">Formation suivie <span class="req">*</span></label><input id="program" name="program" type="text" maxlength="150" placeholder="Ex. : Licence d’économie, Classe préparatoire MPSI…" value="${v('program')}"><p class="err" data-err="program"></p></div>
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
          ${sw('contact_message', 'Par message dans l’application', false)}
          ${sw('contact_chat', 'Par chat', false)}
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
    contact_email: fd.has('contact_email'),
    contact_message: fd.has('contact_message'),
    contact_chat: fd.has('contact_chat'),
    show_photo: fd.has('show_photo'),
    show_location: fd.has('show_location'),
    show_study: fd.has('show_study'),
    show_social: fd.has('show_social'),
    show_email: fd.has('contact_email'), // l'adresse n'est partagée que si le contact par e-mail est accepté
  };
  if (t === 'alumni') {
    out.graduation_year = parseInt(g('graduation_year'), 10) || null;
    out.country = g('country') || null;
    out.city = g('city') || null;
    out.school = g('school') || null;
    out.program = g('program') || null;
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
    ['graduation_year', 'country', 'city', 'school', 'program'].forEach((k) => need(k));
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
    <section class="card hero accent">
      <div id="homeAvatar">${avatarHtml(profile, null, 'lg')}</div>
      <div>
        <span class="pill ok">Compte validé</span>
        <h1>Bienvenue ${esc(profile.first_name || '')} !</h1>
        <p class="muted">${esc(TYPE_LABEL[profile.member_type])}${profile.graduation_year ? ' · Promotion ' + esc(profile.graduation_year) : ''}${profile.class_level ? ' · ' + esc(profile.class_level) : ''}</p>
      </div>
    </section>
    <section class="card">
      <h2>Votre profil est validé</h2>
      <p>Merci d’avoir rejoint la communauté du GSJC. Parcourez l’annuaire pour trouver un ancien élève par pays, ville, école ou formation. Arrivent bientôt :</p>
      <ul class="soon" style="margin-top:10px">
        <li>La carte du monde des alumni</li>
        <li>La messagerie et le chat entre membres</li>
        <li>Les événements, les actualités et les offres de stage</li>
      </ul>
    </section>
    <div class="row">
      <a class="btn" href="#/annuaire">Ouvrir l’annuaire</a>
      <a class="btn ghost" href="#/profil">Modifier mon profil</a>
      ${isAdmin ? '<a class="btn ghost" href="#/admin">Ouvrir l’administration</a>' : ''}
    </div>`);
  photoUrl(profile.photo_path).then((u) => { if (u) $('#homeAvatar') && ($('#homeAvatar').innerHTML = avatarHtml(profile, u, 'lg')); });
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
  renderDirectory();
}

async function renderDirectory() {
  const tok = ++dirTok;
  const list = $('#dirList');
  if (!list) return;
  const q = fold($('#dirQ').value.trim());
  const country = $('#dirCountry').value;
  const year = $('#dirYear').value;
  const rows = dirRows.filter((r) =>
    (!country || r.country === country) &&
    (!year || String(r.graduation_year) === year) &&
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
  const tags = [r.contact_email && '✉ E-mail', r.contact_message && '💬 Message', r.contact_chat && '⚡ Chat']
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

function openMember(id) {
  const r = dirRows.find((x) => x.id === id);
  if (!r) return;
  const url = urlCache.get(r.photo_path)?.url || null;
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  const kv = [];
  if (r.program || r.school) kv.push(['Études', [r.program, r.school].filter(Boolean).map(esc).join(' — ')]);
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
  if (r.contact_message) contact.push('<button class="btn ghost sm" disabled>💬 Message dans l’app (bientôt)</button>');
  if (r.contact_chat) contact.push('<button class="btn ghost sm" disabled>⚡ Chat (bientôt)</button>');

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
/* Administration : validation des inscriptions                        */
/* ------------------------------------------------------------------ */
const TABS = [['pending', 'En attente'], ['approved', 'Validés'], ['rejected', 'Refusés']];

async function countOf(filters) {
  let q = sb.from('profiles').select('id', { count: 'exact', head: true });
  for (const [k, val] of Object.entries(filters)) q = q.eq(k, val);
  const { count } = await q;
  return count ?? 0;
}

async function refreshBadge() {
  const n = await countOf({ status: 'pending' });
  const b = $('#navBadge');
  if (b) { b.textContent = n; b.hidden = n === 0; }
  return n;
}

async function viewAdmin() {
  currentView = 'admin';
  shell(`
    <div class="page-head"><h1>Validation des inscriptions</h1>
      <button class="btn ghost sm" data-action="refreshAdmin">Actualiser</button></div>
    <div class="stats" id="stats"></div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, l]) => `<button role="tab" data-action="adminTab" data-tab="${k}" aria-selected="${k === adminTab}">${l}</button>`).join('')}
    </div>
    <div class="field"><input type="search" id="adminSearch" placeholder="Rechercher un nom, une école, un e-mail…" aria-label="Rechercher"></div>
    <div id="adminList" class="cards"><p class="muted">Chargement…</p></div>`, { wide: true });
  $('#adminSearch').addEventListener('input', renderAdminList);
  loadStats();
  loadAdminList();
}

async function loadStats() {
  const [pending, alumni, students, rejected] = await Promise.all([
    countOf({ status: 'pending' }),
    countOf({ status: 'approved', member_type: 'alumni' }),
    countOf({ status: 'approved', member_type: 'student' }),
    countOf({ status: 'rejected' }),
  ]);
  const box = $('#stats');
  if (!box) return;
  box.innerHTML = [['En attente', pending], ['Alumni validés', alumni], ['Lycéens validés', students], ['Refusés', rejected]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  const b = $('#navBadge'); if (b) { b.textContent = pending; b.hidden = pending === 0; }
}

async function loadAdminList() {
  const list = $('#adminList');
  if (!list) return;
  list.innerHTML = '<p class="muted">Chargement…</p>';
  const { data, error } = await sb.from('profiles').select('*').eq('status', adminTab)
    .order('updated_at', { ascending: adminTab !== 'pending' }).limit(300);
  if (error) { list.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  adminRows = new Map((data || []).map((r) => [r.id, r]));
  await photoUrls((data || []).map((r) => r.photo_path));
  renderAdminList();
}

function renderAdminList() {
  const list = $('#adminList');
  if (!list) return;
  const q = ($('#adminSearch')?.value || '').trim().toLowerCase();
  const rows = [...adminRows.values()].filter((r) =>
    !q || [r.first_name, r.last_name, r.email, r.school, r.program, r.city, r.country].some((x) => (x || '').toLowerCase().includes(q)));
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${adminTab === 'pending' ? 'Aucune demande en attente 🎉' : 'Aucun résultat.'}</div>`;
    return;
  }
  list.innerHTML = rows.map(adminCard).join('');
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
  const actions = r.status === 'pending' ? accept + refuse + msg : r.status === 'approved' ? refuse + msg : accept + msg;

  return `<article class="req-card">
    <div class="req-top">${avatarHtml(r, url)}<div><h3>${esc(name)}</h3><div class="sub">${esc(r.email)}</div></div></div>
    <dl class="kv">${kv.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>
    <div class="req-actions">${actions}</div>
  </article>`;
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
  logout: async () => { await sb.auth.signOut(); profile = null; location.hash = '#/'; },
  authTab: (el) => (el.dataset.mode === 'signup' ? viewAuth('signup') : viewAuth('login')),
  forgot: () => viewForgot(),
  pickPhoto: () => $('#photoInput').click(),
  refreshAdmin: () => { loadStats(); loadAdminList(); },
  adminTab: (el) => { adminTab = el.dataset.tab; $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b === el)); loadAdminList(); },
  closeModal: () => closeModal(),
  viewMember: (el) => openMember(el.dataset.id),
  dirMore: () => { dirShown += DIR_PAGE; renderDirectory(); },

  accept: async (el) => {
    const id = el.dataset.id;
    el.disabled = true;
    if (await setStatus(id, 'approved')) {
      toast(`${nameOf(adminRows.get(id))} a été accepté(e).`);
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
