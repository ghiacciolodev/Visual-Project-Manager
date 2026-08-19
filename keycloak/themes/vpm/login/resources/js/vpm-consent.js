/*
 * A tick box on the sign-in form: the privacy notice has to be acknowledged
 * before the button works.
 *
 * Added from a script rather than by overriding login.ftl, and that is the
 * whole design decision here. This theme's stated rule is that it repaints
 * markup the parent already renders and forks no templates, because a forked
 * login.ftl is a copy of Keycloak's form that has to be re-read against the
 * original on every upgrade, forever, to notice what changed in it. A dozen
 * lines that add one field cost nothing at upgrade time.
 *
 * What that buys, it buys honestly: this is a gate in the interface, not in
 * the server. Somebody who wants to post the form without it can, exactly as
 * they could with a `required` attribute on a checkbox in the template. It is
 * there so that a person is told, at the moment they are about to type into a
 * shared sandbox, what that means. It is not there to stop anybody, and
 * nothing behind it depends on it.
 *
 * The order below is deliberate. The button is only disabled after the box is
 * on the page: if anything above throws, the form is left exactly as Keycloak
 * rendered it, and the worst case is a missing notice rather than a sign-in
 * button nobody can press.
 */
(function () {
  'use strict';

  var form = document.getElementById('kc-form-login');
  var submit = document.getElementById('kc-login');
  if (!form || !submit) return;

  var wrap = document.createElement('div');
  wrap.className = 'vpm-consent';

  var box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'vpm-consent-box';
  box.className = 'vpm-consent__box';

  var label = document.createElement('label');
  label.htmlFor = box.id;
  label.className = 'vpm-consent__label';
  label.appendChild(document.createTextNode(
    'This is a shared public demonstration. The accounts are shared, the data ' +
    'is reset several times a day, and nothing private belongs in it. I have read the '
  ));

  var link = document.createElement('a');
  link.href = '/privacy/';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'privacy notice';
  label.appendChild(link);
  label.appendChild(document.createTextNode('.'));

  wrap.appendChild(box);
  wrap.appendChild(label);

  // Above the button rather than below it: a condition on pressing something
  // belongs on the way to it.
  var anchor = submit.closest('.pf-v5-c-form__group') || submit.parentNode;
  anchor.parentNode.insertBefore(wrap, anchor);

  function sync() {
    submit.disabled = !box.checked;
  }

  box.addEventListener('change', sync);
  sync();
})();
