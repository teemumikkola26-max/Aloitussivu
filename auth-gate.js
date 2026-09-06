/* =============================================================================
   AUTH-GATE.JS
   Yhteinen kirjautumislogiikka kaikille lomakkeille (Supabase Auth,
   sähköposti + salasana). Yksi tiedosto, jota jokainen HTML-sivu lataa —
   kun lisäät uuden lomakkeen, lisää siihen samat kaksi riviä <head>iin,
   ei muuta koodia tarvita.

   KÄYTTÖÖNOTTO:
   1. Täytä SUPABASE_URL ja SUPABASE_PUBLISHABLE_KEY alla.
   2. Lisää jokaisen lomakesivun <head>-osioon, tässä järjestyksessä:

        <style>html{visibility:hidden}</style>
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4"></script>
        <script src="auth-gate.js" defer></script>

   3. Luo käyttäjätunnukset Supabasen dashboardista:
      Authentication -> Users -> Add user (rastita Auto Confirm User).
   ============================================================================= */
(function(){
  "use strict";

  // ---- TÄYTÄ NÄMÄ OMAN SUPABASE-PROJEKTISI TIEDOILLA ----
  const SUPABASE_URL = "https://xuaoqdpmhhpxjcweaauz.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YW9xZHBtaGhweGpjd2VhYXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1ODg3NzksImV4cCI6MjEwNDE2NDc3OX0.vU_vlkS6WpLQoTaVt5gZTsbsSSJZg-GVnpcCiJxRivw";
  // --------------------------------------------------------

  // Näyttää virheen suoraan ruudulla (punainen palkki ylhäällä) — ei tarvetta
  // selaimen konsoliin, toimii myös puhelimella.
  function showFatalError(message){
    document.documentElement.style.visibility = "visible";
    if (document.body) document.body.style.overflow = "";
    const existing = document.getElementById("authFatalError");
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.id = "authFatalError";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:999999;" +
      "background:#a13030;color:#fff;padding:12px 16px;font-size:.85rem;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:pre-wrap;";
    banner.textContent = "Kirjautumisen virhe: " + message;
    (document.body || document.documentElement).appendChild(banner);
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function"){
    showFatalError("Supabase-js-kirjasto ei latautunut. Tarkista, että CDN-script-rivi on ennen auth-gate.js-riviä <head>issä, ja että laitteella on internetyhteys.");
    return;
  }

  let supabaseClient;
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  } catch (err){
    showFatalError("Supabase-clientin luonti epäonnistui: " + (err && err.message ? err.message : err));
    return;
  }
  window.__supabaseClient = supabaseClient; // muiden sivujen käyttöön tarvittaessa

  function ensureReady(fn){
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once:true });
  }

  function buildOverlay(){
    let overlay = document.getElementById("authOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "authOverlay";
    overlay.style.cssText =
      "visibility:visible;position:fixed;inset:0;z-index:99999;" +
      "background:#233043;color:#f2efe6;display:flex;align-items:center;" +
      "justify-content:center;padding:20px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
    document.body.appendChild(overlay);
    renderLoginView(overlay);
    return overlay;
  }

  const cardOpen =
    '<div style="width:100%;max-width:320px;background:#fff;color:#1c2430;' +
    'border-radius:12px;padding:24px 22px;box-shadow:0 8px 30px rgba(0,0,0,.35);">';
  const titleHtml = (text) =>
    '<div style="font-family:Georgia,\'Iowan Old Style\',\'Times New Roman\',serif;font-size:1.15rem;' +
    'font-weight:700;margin-bottom:4px;color:#233043;">' + text + '</div>';
  const subHtml = (text) =>
    '<div style="font-size:.8rem;color:#4a5568;margin-bottom:16px;">' + text + '</div>';
  const labelHtml = (text) =>
    '<label style="display:block;font-size:.76rem;font-weight:600;color:#4a5568;margin-bottom:3px;">' + text + '</label>';
  const inputStyle =
    'width:100%;border:1px solid #b9b2a0;border-radius:7px;padding:9px 10px;' +
    'font-size:.95rem;margin-bottom:12px;box-sizing:border-box;';
  const errorHtml =
    '<div id="authError" style="display:none;color:#a13030;font-size:.8rem;margin-bottom:10px;"></div>';
  const primaryBtnStyle =
    'width:100%;border:none;border-radius:8px;padding:11px 10px;font-size:.9rem;' +
    'font-weight:600;background:#233043;color:#fff;cursor:pointer;';
  const linkBtnStyle =
    'display:block;width:100%;text-align:center;background:none;border:none;' +
    'color:#4a5568;font-size:.78rem;margin-top:12px;cursor:pointer;text-decoration:underline;';

  function renderLoginView(overlay){
    overlay.innerHTML =
      cardOpen +
        '<form id="authForm">' +
          titleHtml("Kirjaudu sisään") +
          subHtml("Lomake on vain rekisteröityneiden käyttäjien käytössä.") +
          labelHtml("Sähköposti") +
          '<input id="authEmail" type="email" autocomplete="username" required style="' + inputStyle + '">' +
          labelHtml("Salasana") +
          '<input id="authPassword" type="password" autocomplete="current-password" required style="' + inputStyle + 'margin-bottom:14px;">' +
          errorHtml +
          '<button type="submit" id="authSubmit" style="' + primaryBtnStyle + '">Kirjaudu</button>' +
          '<button type="button" id="authForgotLink" style="' + linkBtnStyle + '">Unohditko salasanan?</button>' +
        '</form>' +
      '</div>';

    const form = overlay.querySelector("#authForm");
    const errorBox = overlay.querySelector("#authError");
    const submitBtn = overlay.querySelector("#authSubmit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      submitBtn.disabled = true;
      submitBtn.textContent = "Kirjaudutaan…";
      const email = overlay.querySelector("#authEmail").value.trim();
      const password = overlay.querySelector("#authPassword").value;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error){
        errorBox.textContent = "Kirjautuminen epäonnistui: " + (error.message || "tuntematon virhe") + " (koodi: " + (error.status || "-") + ")";
        errorBox.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Kirjaudu";
        return;
      }
      // Onnistunut kirjautuminen laukaisee onAuthStateChange-kuuntelijan,
      // joka poistaa overlayn ja paljastaa sisällön.
    });

    overlay.querySelector("#authForgotLink").addEventListener("click", () => {
      renderForgotView(overlay);
    });
  }

  function renderForgotView(overlay){
    overlay.innerHTML =
      cardOpen +
        '<form id="forgotForm">' +
          titleHtml("Palauta salasana") +
          subHtml("Syötä sähköpostiosoitteesi. Lähetämme siihen linkin, jolla voit asettaa uuden salasanan.") +
          labelHtml("Sähköposti") +
          '<input id="forgotEmail" type="email" autocomplete="username" required style="' + inputStyle + 'margin-bottom:14px;">' +
          errorHtml +
          '<button type="submit" id="forgotSubmit" style="' + primaryBtnStyle + '">Lähetä palautuslinkki</button>' +
          '<button type="button" id="forgotBackLink" style="' + linkBtnStyle + '">Takaisin kirjautumiseen</button>' +
        '</form>' +
      '</div>';

    const form = overlay.querySelector("#forgotForm");
    const errorBox = overlay.querySelector("#authError");
    const submitBtn = overlay.querySelector("#forgotSubmit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      submitBtn.disabled = true;
      submitBtn.textContent = "Lähetetään…";
      const email = overlay.querySelector("#forgotEmail").value.trim();
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href.split("#")[0]
      });
      if (error){
        errorBox.textContent = "Lähetys epäonnistui: " + (error.message || "tuntematon virhe");
        errorBox.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Lähetä palautuslinkki";
        return;
      }
      renderForgotSentView(overlay, email);
    });

    overlay.querySelector("#forgotBackLink").addEventListener("click", () => {
      renderLoginView(overlay);
    });
  }

  function renderForgotSentView(overlay, email){
    overlay.innerHTML =
      cardOpen +
        titleHtml("Tarkista sähköpostisi") +
        subHtml("Lähetimme osoitteeseen " + escapeHtmlLite(email) + " linkin, jolla voit asettaa uuden salasanan. Linkki voi kestää pari minuuttia saapua — muista tarkistaa myös roskaposti.") +
        '<button type="button" id="backToLoginFromSent" style="' + primaryBtnStyle + '">Takaisin kirjautumiseen</button>' +
      '</div>';
    overlay.querySelector("#backToLoginFromSent").addEventListener("click", () => {
      renderLoginView(overlay);
    });
  }

  function renderSetNewPasswordView(overlay){
    overlay.innerHTML =
      cardOpen +
        '<form id="newPasswordForm">' +
          titleHtml("Aseta uusi salasana") +
          subHtml("Syötä uusi salasana tilillesi.") +
          labelHtml("Uusi salasana") +
          '<input id="newPassword1" type="password" autocomplete="new-password" required minlength="6" style="' + inputStyle + '">' +
          labelHtml("Vahvista uusi salasana") +
          '<input id="newPassword2" type="password" autocomplete="new-password" required minlength="6" style="' + inputStyle + 'margin-bottom:14px;">' +
          errorHtml +
          '<button type="submit" id="newPasswordSubmit" style="' + primaryBtnStyle + '">Tallenna uusi salasana</button>' +
        '</form>' +
      '</div>';

    const form = overlay.querySelector("#newPasswordForm");
    const errorBox = overlay.querySelector("#authError");
    const submitBtn = overlay.querySelector("#newPasswordSubmit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      const p1 = overlay.querySelector("#newPassword1").value;
      const p2 = overlay.querySelector("#newPassword2").value;
      if (p1 !== p2){
        errorBox.textContent = "Salasanat eivät täsmää.";
        errorBox.style.display = "block";
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Tallennetaan…";
      const { error } = await supabaseClient.auth.updateUser({ password: p1 });
      if (error){
        errorBox.textContent = "Tallennus epäonnistui: " + (error.message || "tuntematon virhe");
        errorBox.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Tallenna uusi salasana";
        return;
      }
      revealContent();
    });
  }

  function escapeHtmlLite(s){
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function showRecoveryForm(){
    document.documentElement.style.visibility = "hidden";
    document.body.style.overflow = "hidden";
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.remove();
    const overlay = buildOverlay();
    renderSetNewPasswordView(overlay);
  }

  function addLogoutButton(){
    if (document.getElementById("logoutBtn")) return;
    const btn = document.createElement("button");
    btn.id = "logoutBtn";
    btn.textContent = "Kirjaudu ulos";
    btn.style.cssText =
      "position:fixed;bottom:10px;right:10px;z-index:9998;" +
      "background:rgba(35,48,67,.85);color:#fff;border:none;" +
      "border-radius:99px;padding:8px 14px;font-size:.75rem;cursor:pointer;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
    btn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
    });
    document.body.appendChild(btn);
  }

  function revealContent(){
    document.documentElement.style.visibility = "visible";
    document.body.style.overflow = "";
    const overlay = document.getElementById("authOverlay");
    if (overlay) overlay.remove();
    addLogoutButton();
  }

  function lockContent(){
    document.documentElement.style.visibility = "hidden";
    document.body.style.overflow = "hidden";
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.remove();
    buildOverlay();
  }

  ensureReady(() => {
    try {
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY"){
          showRecoveryForm();
        } else if (session){
          revealContent();
        } else {
          lockContent();
        }
      });

      supabaseClient.auth.getSession().then(({ data, error }) => {
        if (error){
          showFatalError("Istunnon haku epäonnistui: " + error.message);
          return;
        }
        // Jos linkki oli palautuslinkki, yllä oleva onAuthStateChange ehtii
        // jo näyttää PASSWORD_RECOVERY-näkymän — ei siis paljasteta sisältöä
        // suoraan tässä, jos overlay on jo asetuslomake-tilassa.
        if (data.session && !document.getElementById("newPasswordForm")){
          revealContent();
        } else if (!data.session){
          lockContent();
        }
      }).catch((err) => {
        showFatalError("Istunnon haku epäonnistui: " + (err && err.message ? err.message : err));
      });
    } catch (err){
      showFatalError("Odottamaton virhe: " + (err && err.message ? err.message : err));
    }
  });
})();
