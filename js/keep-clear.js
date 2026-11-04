// Tient l'app hors de la zone que la barre de GFS recouvre (consigne 003 ; guide des apps 1.2, point 9 ; contrats de GFS 5.2, point 7).
// La barre se pose par-dessus le cadre, au bord que la personne choisit, centrée sur lui. GFS donne ce bord et la zone à laisser libre, en pixels du cadre, origine en haut à gauche :
// { bord: 'gauche' | 'haut' | 'droite' | 'bas', epaisseur, zone: { x, y, largeur, hauteur } }, ou null (app seule, explorateur de GFS ouvert). La zone n'est jamais écrite ici : elle a déjà changé de taille une fois.
// Sans bande réservée : ce qui ne touche pas la zone reste où il est.
//  - la barre d'outils, barre en haut, se partage autour de la zone (html[data-gfs-bar="haut"], css/style.css, avec --gfs-zone-x et --gfs-zone-w) ;
//  - le journal, les menus et les bulles qui recouvriraient la zone s'en écartent, dans le sens qui les éloigne du bord (propriété `translate` : elle s'ajoute à `transform`, que le canevas utilise) ;
//  - une fenêtre qui recouvrirait la zone se place dans le reste du cadre : son voile prend une marge du côté de la barre et la fenêtre se réduit d'autant (--gfs-pad-*, css/modal.css).
// js/gfs.js appelle KeepClear.set(barre) avec ce que le lien du kit donne. Seule, ou si le kit manque, rien n'est appelé et rien ne bouge.
(function (root) {
  'use strict';
  const FLOATING = '.logs, .add-menu, .ss-panel, .canvas-connect-hint';
  const SIDES = { haut: 'top', bas: 'bottom', gauche: 'left', droite: 'right' };
  const TOLERANCE = 0.25;   // px : le navigateur arrondit les positions (au 64e de pixel) et offsetWidth (à l'entier) ; un recouvrement plus petit que cela n'en est pas un

  // Rectangles { x, y, largeur, hauteur }, les mots de GFS.
  function overlaps(a, b) {
    return a.x < b.x + b.largeur && b.x < a.x + a.largeur && a.y < b.y + b.hauteur && b.y < a.y + a.hauteur;
  }

  // Le déplacement { dx, dy } le plus court qui sort `rect` de la zone de `bar`, en s'éloignant du bord de la barre ; { 0, 0 } si rien ne se recouvre.
  function escape(rect, bar) {
    const { zone, bord } = bar;
    if (!overlaps(rect, zone)) return { dx: 0, dy: 0 };
    if (bord === 'haut') return { dx: 0, dy: zone.y + zone.hauteur - rect.y };
    if (bord === 'bas') return { dx: 0, dy: zone.y - (rect.y + rect.hauteur) };
    if (bord === 'gauche') return { dx: zone.x + zone.largeur - rect.x, dy: 0 };
    return { dx: zone.x - (rect.x + rect.largeur), dy: 0 };
  }

  // La marge à laisser du côté de la barre pour qu'une fenêtre ne recouvre plus la zone : la profondeur de la zone, mesurée depuis le bord du cadre (`frame` : { largeur, hauteur }).
  function inset(bar, frame) {
    const { zone, bord } = bar;
    if (bord === 'haut') return zone.y + zone.hauteur;
    if (bord === 'bas') return frame.hauteur - zone.y;
    if (bord === 'gauche') return zone.x + zone.largeur;
    return frame.largeur - zone.x;
  }

  const api = { overlaps, escape, inset };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  const html = document.documentElement;
  const toRect = (box) => ({ x: box.left, y: box.top, largeur: box.width, hauteur: box.height });
  let current = null;   // la barre de GFS telle que le lien du kit la donne, ou null
  let queued = false;

  function refresh() {
    queued = false;
    const floating = Array.from(document.querySelectorAll(FLOATING));
    const veils = Array.from(document.querySelectorAll('.modal'));
    for (const element of floating) element.style.removeProperty('translate');
    for (const veil of veils) for (const side of Object.values(SIDES)) veil.style.removeProperty('--gfs-pad-' + side);
    if (!current) return;
    const zone = { x: current.zone.x + TOLERANCE, y: current.zone.y + TOLERANCE, largeur: current.zone.largeur - 2 * TOLERANCE, hauteur: current.zone.hauteur - 2 * TOLERANCE };
    for (const element of floating) {
      if (!element.getClientRects().length) continue;
      const box = element.getBoundingClientRect();
      const scale = element.offsetWidth ? box.width / element.offsetWidth : 1;   // dans le monde du canevas, zoomé, un pixel de l'élément n'est pas un pixel du cadre
      let shiftX = 0;
      let shiftY = 0;
      // La première passe vise d'après l'échelle estimée ; la suivante reprend ce que l'arrondi a laissé.
      for (let pass = 0; pass < 3; pass += 1) {
        const { dx, dy } = escape(toRect(element.getBoundingClientRect()), { bord: current.bord, zone });
        if (!dx && !dy) break;
        shiftX += dx / scale;
        shiftY += dy / scale;
        element.style.setProperty('translate', `${shiftX}px ${shiftY}px`);
      }
    }
    const frame = { largeur: html.clientWidth, hauteur: html.clientHeight };
    for (const veil of veils) {
      const dialog = veil.querySelector('.modal-box');
      if (dialog && overlaps(toRect(dialog.getBoundingClientRect()), current.zone)) veil.style.setProperty('--gfs-pad-' + SIDES[current.bord], inset(current, frame) + 'px');
    }
  }

  function schedule() {
    if (current && !queued) {
      queued = true;
      requestAnimationFrame(refresh);
    }
  }

  // `next` : ce que le lien du kit donne (GfsLink.bar() et son abonné), ou null. Une forme inconnue vaut null : mieux n'écarter rien que n'importe quoi.
  function set(next) {
    current = next && SIDES[next.bord] && next.zone ? next : null;
    if (current) {
      html.dataset.gfsBar = current.bord;
      html.style.setProperty('--gfs-zone-x', current.zone.x + 'px');
      html.style.setProperty('--gfs-zone-w', current.zone.largeur + 'px');
    } else {
      delete html.dataset.gfsBar;
      html.style.removeProperty('--gfs-zone-x');
      html.style.removeProperty('--gfs-zone-w');
    }
    refresh();
  }

  // Le journal grandit, un menu s'ouvre, une fenêtre apparaît, le cadre change de taille : on remesure.
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', schedule);

  root.KeepClear = Object.assign({ set, refresh }, api);
})(typeof window !== 'undefined' ? window : globalThis);
