// contact-form.js — Formulaire de contact via Cloudflare Worker + Resend

var WORKER_URL = 'https://contact-worker.lolorahaingo.workers.dev';

// Clé de test Turnstile en localhost
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  var tw = document.querySelector('.cf-turnstile');
  if (tw) tw.setAttribute('data-sitekey', '0x4AAAAAACluaw9FuPjWzSJf');
}

var form = document.getElementById('contact-form');
var submitBtn = form ? form.querySelector('button[type="submit"]') : null;

if (form) {
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var rgpdCheckbox = form.querySelector('input[name="rgpd"]');
    if (!rgpdCheckbox || !rgpdCheckbox.checked) {
      alert('Veuillez accepter la politique de confidentialit\u00e9 pour envoyer votre message.');
      return;
    }

    // Récupérer le token Turnstile
    var turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
    var token = turnstileInput ? turnstileInput.value : '';
    if (!token) {
      alert('Veuillez compl\u00e9ter la v\u00e9rification anti-bot.');
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
      _gotcha: honeypot ? honeypot.value : '',
      rgpd: true,
      'cf-turnstile-response': token
    };

    submitBtn.disabled = true;
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
}

function showStatus(state, errorMessage) {
  var existing = form.parentNode.querySelector('.contact-form__status');
  if (existing) existing.remove();

  if (state === 'success') {
    form.style.display = 'none';
    var fallback = form.parentNode.querySelector('.contact-form__fallback');
    if (fallback) fallback.style.display = 'none';

    var msg = document.createElement('div');
    msg.className = 'contact-form__status contact-form__status--success';

    var pTitle = document.createElement('p');
    pTitle.className = 'contact-form__status-title';
    pTitle.textContent = 'Message envoy\u00e9 !';
    msg.appendChild(pTitle);

    var pBody = document.createElement('p');
    pBody.textContent = 'Merci pour votre message. Je vous r\u00e9pondrai dans les plus brefs d\u00e9lais.';
    msg.appendChild(pBody);

    form.parentNode.insertBefore(msg, form);
  }

  if (state === 'error') {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Envoyer';

    var msg = document.createElement('div');
    msg.className = 'contact-form__status contact-form__status--error';

    var pError = document.createElement('p');
    pError.textContent = errorMessage || 'Une erreur est survenue.';
    msg.appendChild(pError);

    var pFallback = document.createElement('p');
    pFallback.textContent = 'Vous pouvez m\'\u00e9crire directement \u00e0 ';
    var mailLink = document.createElement('a');
    mailLink.href = 'mailto:larode.c@hotmail.com';
    mailLink.textContent = 'larode.c@hotmail.com';
    pFallback.appendChild(mailLink);
    msg.appendChild(pFallback);

    form.parentNode.insertBefore(msg, form);
  }
}
