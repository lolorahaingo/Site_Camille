// contact-form.js — Formulaire de contact via Cloudflare Worker + Resend
(function () {
  'use strict';

  var WORKER_URL = 'https://contact-worker.lolorahaingo.workers.dev';

  var form = document.getElementById('contact-form');
  if (!form) return;

  var submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var nom = form.querySelector('#field-nom').value.trim();
    var email = form.querySelector('#field-email').value.trim();
    var objet = form.querySelector('#field-objet').value;
    var message = form.querySelector('#field-message').value.trim();
    var honeypot = form.querySelector('input[name="_gotcha"]');

    var data = {
      nom: nom,
      email: email,
      message: 'Objet : ' + objet + '\n\n' + message,
      _gotcha: honeypot ? honeypot.value : ''
    };

    // Loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('contact-form__btn--loading');
    submitBtn.textContent = 'Envoi en cours...';

    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(function (response) {
      return response.json().then(function (json) {
        if (response.ok && json.success) {
          showStatus('success');
        } else {
          showStatus('error', json.error || 'Une erreur est survenue.');
        }
      });
    })
    .catch(function () {
      showStatus('error', 'Impossible de contacter le serveur.');
    });
  });

  function showStatus(state, errorMessage) {
    var existing = form.parentNode.querySelector('.contact-form__status');
    if (existing) existing.remove();

    if (state === 'success') {
      form.style.display = 'none';
      var fallback = form.parentNode.querySelector('.contact-form__fallback');
      if (fallback) fallback.style.display = 'none';

      var msg = document.createElement('div');
      msg.className = 'contact-form__status contact-form__status--success';
      msg.innerHTML =
        '<p class="contact-form__status-title">Message envoy\u00e9 !</p>' +
        '<p>Merci pour votre message. Je vous r\u00e9pondrai dans les plus brefs d\u00e9lais.</p>';
      form.parentNode.insertBefore(msg, form);
    }

    if (state === 'error') {
      submitBtn.disabled = false;
      submitBtn.classList.remove('contact-form__btn--loading');
      submitBtn.textContent = 'Envoyer';

      var msg = document.createElement('div');
      msg.className = 'contact-form__status contact-form__status--error';
      msg.innerHTML =
        '<p>' + (errorMessage || 'Une erreur est survenue.') + '</p>' +
        '<p>Vous pouvez m\'\u00e9crire directement \u00e0 ' +
        '<a href="mailto:larode.c@hotmail.com">larode.c@hotmail.com</a></p>';
      form.parentNode.insertBefore(msg, form);
    }
  }
})();
