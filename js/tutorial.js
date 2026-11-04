// Prise en main : une fenêtre à écrans (une capture du vrai widget, un titre, deux lignes), faite comme la fenêtre des nouveautés de la charte Grist Factory :
// un point par écran (une liste d'onglets à un seul arrêt de Tab ; les flèches, Début et Fin passent de l'un à l'autre), « Fermer, Précédent, Suivant »,
// puis « Précédent, Fermer » au dernier écran, où « Fermer » devient le bouton principal. Tous les écrans ont la même hauteur (css/tutorial.css).
// Elle s'ouvre d'elle-même une fois par navigateur, à la fin du démarrage (js/main.js), pour qui peut modifier le document : jamais en lecture seule, sans l'accès
// complet ni hors de Grist, jamais par-dessus une autre fenêtre, et seulement si le navigateur retient qu'elle a été vue (sinon elle reviendrait à chaque chargement :
// c'est le cas dans le cadre de GFS, qui n'a pas de stockage). Réglages > Aide > « Prise en main » la rouvre quand on veut. La fermer, de quelque façon que ce soit,
// la retient : localStorage, ab_tuto, la version de la prise en main vue. Les captures, img/tuto/<écran>-<langue>.webp, sont faites par tests/e2e/tutorial-shots.mjs.
(function (root) {
  'use strict';
  const STORAGE_KEY = 'ab_tuto';
  const VERSION = 1;   // monte quand la prise en main change assez pour être remontrée une fois à qui l'a déjà vue

  // Les écrans, dans l'ordre : la capture (image), puis les clés de leur titre, de leur texte et du texte de la capture.
  const SCREENS = [
    { image: 'graphe', name: 'tuto.graphName', text: 'tuto.graphText', alt: 'tuto.graphAlt' },
    { image: 'ajouter', name: 'tuto.addName', text: 'tuto.addText', alt: 'tuto.addAlt' },
    { image: 'relier', name: 'tuto.linkName', text: 'tuto.linkText', alt: 'tuto.linkAlt' },
    { image: 'regler', name: 'tuto.setName', text: 'tuto.setText', alt: 'tuto.setAlt' },
    { image: 'tester', name: 'tuto.testName', text: 'tuto.testText', alt: 'tuto.testAlt' },
    { image: 'activer', name: 'tuto.runName', text: 'tuto.runText', alt: 'tuto.runAlt' },
  ];

  // La version gardée est-elle plus ancienne que celle de la prise en main ? Rien de gardé, ou un texte qui n'est pas une version : oui.
  // Une version plus récente (gardée par une app plus neuve) la laisse fermée.
  function isUnseen(saved, version = VERSION) {
    return !/^\d{1,4}$/.test(String(saved)) || Number(saved) < version;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SCREENS, VERSION, STORAGE_KEY, isUnseen };
    return;
  }

  const t = (key, params) => root.I18n.t(key, params);
  const imageUrl = (screen) => `img/tuto/${screen.image}-${root.I18n.lang}.webp?v=${root.APP_VERSION}`;

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(className, text) {
    const element = make('button', className, text);
    element.type = 'button';
    return element;
  }

  // La personne a vu la prise en main : elle ne revient plus d'elle-même. Jamais une version plus ancienne que celle déjà gardée.
  function remember() {
    try {
      if (isUnseen(localStorage.getItem(STORAGE_KEY))) localStorage.setItem(STORAGE_KEY, String(VERSION));
    } catch (err) { /* navigateur qui ne retient rien : elle ne s'ouvre pas d'elle-même chez lui (openFirstTime) */ }
  }

  // Un écran : la capture, qui disparaît si elle ne vient pas (sa place reste : le titre, le texte et la hauteur de l'écran ne bougent pas), le titre et le texte.
  function drawScreen(screen) {
    const box = make('div', 'tuto-screen');
    const figure = make('figure', 'tuto-shot');
    const image = make('img');
    image.src = imageUrl(screen);
    image.alt = t(screen.alt);
    image.width = 1200;
    image.height = 400;
    image.addEventListener('error', () => { figure.classList.add('is-missing'); });
    figure.append(image);
    box.append(figure, make('h3', 'tuto-name', t(screen.name)), make('p', 'tuto-text', t(screen.text)));
    return box;
  }

  // Les éléments de la fenêtre : l'écran affiché (pane), les points (tabs, dots) et les trois boutons.
  function build() {
    const pane = make('div', 'tuto-pane');
    pane.id = 'tuto-pane';
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-live', 'polite');
    const tabs = make('div', 'tuto-dots');
    tabs.setAttribute('role', 'tablist');
    const dots = SCREENS.map((screen, i) => {
      const dot = button('tuto-dot');
      dot.id = 'tuto-tab-' + i;
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-controls', pane.id);
      dot.setAttribute('aria-label', t('tuto.dot', { n: i + 1, total: SCREENS.length, name: t(screen.name) }));
      tabs.append(dot);
      return dot;
    });
    return { pane, tabs, dots, close: button('', t('modal.close')), prev: button('', t('tuto.prev')), next: button('primary', t('tuto.next')), index: 0, lastPlaced: null };
  }

  // Affiche l'écran i : son contenu, le point choisi, les boutons dans l'ordre du dernier écran ou des autres. Le focus reste sur le bouton qui l'avait ;
  // un bouton qui disparaît (« Précédent » au premier écran, « Suivant » au dernier) le passe au bouton principal.
  function show(tuto, i) {
    tuto.index = Math.min(Math.max(i, 0), SCREENS.length - 1);
    const focused = document.activeElement;
    const last = tuto.index === SCREENS.length - 1;
    tuto.pane.replaceChildren(drawScreen(SCREENS[tuto.index]));
    tuto.pane.setAttribute('aria-labelledby', tuto.dots[tuto.index].id);
    tuto.dots.forEach((dot, n) => {
      dot.setAttribute('aria-selected', String(n === tuto.index));
      dot.tabIndex = n === tuto.index ? 0 : -1;
    });
    tuto.prev.hidden = tuto.index === 0;
    tuto.next.hidden = last;
    tuto.close.classList.toggle('primary', last);
    // L'ordre dans la page suit l'ordre à l'écran (Tab) ; remettre un bouton à sa place lui fait perdre le focus, d'où le retour du focus juste après.
    if (tuto.footer && last !== tuto.lastPlaced) {
      tuto.lastPlaced = last;
      tuto.footer.append(tuto.tabs, ...(last ? [tuto.prev, tuto.close] : [tuto.close, tuto.prev, tuto.next]));
    }
    if (tuto.footer && tuto.footer.contains(focused)) {
      const target = focused.hidden ? (last ? tuto.close : tuto.next) : focused;
      if (document.activeElement !== target) target.focus();
    }
    // L'image de l'écran suivant se charge d'avance : le passage d'un écran à l'autre ne la fait pas attendre.
    if (!last) new Image().src = imageUrl(SCREENS[tuto.index + 1]);
  }

  // Ouvre la prise en main sur son premier écran, par-dessus ce qui est ouvert (les Réglages, quand elle s'ouvre de là).
  function open() {
    const tuto = build();
    show(tuto, 0);
    const win = root.Modal.create({ title: t('tuto.title'), width: 'media', body: tuto.pane, actions: [tuto.tabs, tuto.close, tuto.prev, tuto.next], onClose: remember });
    tuto.footer = win.footer;
    tuto.lastPlaced = false;
    tuto.tabs.setAttribute('aria-labelledby', win.box.getAttribute('aria-labelledby'));
    tuto.close.addEventListener('click', () => win.close());
    tuto.prev.addEventListener('click', () => show(tuto, tuto.index - 1));
    tuto.next.addEventListener('click', () => show(tuto, tuto.index + 1));
    tuto.dots.forEach((dot, i) => dot.addEventListener('click', () => show(tuto, i)));
    tuto.tabs.addEventListener('keydown', (event) => {
      const to = { ArrowRight: tuto.index + 1, ArrowLeft: tuto.index - 1, Home: 0, End: SCREENS.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      show(tuto, to);
      tuto.dots[tuto.index].focus();
    });
    return win;
  }

  let offered = false;   // déjà ouverte d'elle-même dans cette page : une fois suffit
  // À la fin du démarrage, pour qui peut modifier le document (js/main.js le vérifie) : l'ouvre si ce navigateur ne l'a pas encore vue, et rend vrai quand elle s'ouvre.
  // Un navigateur qui ne retient rien (stockage refusé, cadre de GFS) la rouvrirait à chaque chargement : il doit d'abord pouvoir retenir, sinon elle ne s'ouvre pas.
  function openFirstTime() {
    if (offered || root.Modal.isOpen()) return false;
    let saved;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
      if (!isUnseen(saved)) return false;
      localStorage.setItem(STORAGE_KEY, saved === null ? '0' : saved);
    } catch (err) {
      return false;
    }
    offered = true;
    open();
    return true;
  }

  root.Tutorial = { open, openFirstTime, isUnseen, SCREENS, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
