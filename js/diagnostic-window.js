// La fenêtre du diagnostic (Réglages > Diagnostic) : le texte de js/diagnostic.js, que la personne relit, copie et colle dans une demande d'aide (forum, assistance).
// Elle s'ouvre tout de suite et se remplit quand le widget a rassemblé ce qu'il sait (collect, js/main.js : des lectures dans Grist, qui peuvent prendre un moment).
// « Anonymisé » est le mode d'ouverture, toujours : « Complet » se choisit à chaque fois et n'est pas retenu. Rien n'est envoyé ni gardé : le texte est celui du champ,
// que la personne relit, sélectionne et copie.
(function (root) {
  'use strict';
  const t = (key, params) => root.I18n.t(key, params);
  // Les clés sont écrites en entier pour que les tests de textes (tests/i18n.test.js) les retrouvent.
  const MODE_LABELS = { anonymized: 'diag.anonymized', full: 'diag.full' };
  const MODE_NOTES = { anonymized: 'diag.noteAnonymized', full: 'diag.noteFull' };

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(text) {
    const element = make('button', '', text);
    element.type = 'button';
    return element;
  }

  // Copie le texte du champ : par l'API du presse-papiers ; si le cadre la refuse, par la commande du navigateur sur le texte sélectionné.
  // Rend vrai quand c'est copié ; sinon le texte reste sélectionné, pour que la personne le copie elle-même.
  async function copyFrom(area) {
    try {
      await navigator.clipboard.writeText(area.value);
      return true;
    } catch (err) {
      area.focus();
      area.select();
      try { return document.execCommand('copy'); } catch (error) { return false; }
    }
  }

  // collect : rend (une promesse de) ce que Diagnostic.build lit (js/diagnostic.js, input).
  // segmented, definition : le choix à boutons et la ligne « terme / contrôle » des Réglages (js/main.js).
  function open({ collect, segmented, definition }) {
    let input = null;
    let mode = 'anonymized';
    let closed = false;

    const area = make('textarea', 'diag-text');
    area.id = 'diagnostic-text';
    area.readOnly = true;
    area.rows = 14;
    area.wrap = 'off';
    area.spellcheck = false;
    area.setAttribute('aria-label', t('diag.label'));
    const note = make('p', 'diag-note');
    note.setAttribute('aria-live', 'polite');
    const status = make('p', 'diag-status', t('diag.preparing'));
    status.setAttribute('role', 'status');
    const copy = button(t('modal.copy'));
    copy.id = 'diagnostic-copy';
    copy.disabled = true;
    const close = button(t('modal.close'));

    function render() {
      note.textContent = t(MODE_NOTES[mode]);
      if (!input) return;
      try {
        area.value = root.Diagnostic.toText(root.Diagnostic.build(input, { mode }));
      } catch (err) {
        area.value = '';
        copy.disabled = true;
        status.textContent = t('diag.failed', { error: err.message });
      }
    }

    const choice = segmented(root.Diagnostic.MODES, mode, (value) => t(MODE_LABELS[value]), (value) => {
      mode = value;
      status.textContent = '';
      render();
    });
    const list = make('dl');
    list.append(...definition(t('diag.mode'), choice));
    const body = make('div');
    body.append(make('p', '', t('diag.intro')), list, note, area, status);

    const win = root.Modal.create({ title: t('diag.title'), width: 'large', body, actions: [close, copy], onClose: () => { closed = true; } });
    close.addEventListener('click', () => win.close());
    copy.addEventListener('click', async () => {
      status.textContent = (await copyFrom(area)) ? t('modal.copied') : t('diag.selected');
    });
    render();

    // Le texte arrive : « Copier » devient le bouton principal et prend le focus, sauf si la personne l'a déjà déplacé.
    const focused = document.activeElement;
    Promise.resolve().then(collect).then((collected) => {
      if (closed) return;
      input = collected;
      status.textContent = '';
      copy.disabled = false;
      copy.classList.add('primary');
      render();
      if (document.activeElement === focused && !copy.disabled) copy.focus();
    }, (err) => {
      if (!closed) status.textContent = t('diag.failed', { error: err && err.message ? err.message : String(err) });
    });
    return win;
  }

  root.DiagnosticWindow = { open };
})(window);
