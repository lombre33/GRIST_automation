'use strict';
// HYG : règles de la charte et du guide Grist.Gouv vérifiées par lecture statique du code livré.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const list = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const jsFiles = list('js', '.js');
const cssFiles = list('css', '.css');
const everything = [...jsFiles, ...cssFiles, 'index.html'];
const offenders = (files, pattern) => files.filter((f) => pattern.test(read(f)));
// Le code sans ses commentaires de fin de ligne (une adresse « https:// » dans une chaîne reste) : pour chercher ce que le code fait, pas ce qu'il en dit.
const code = (file) => read(file).replace(/(^|\s)\/\/.*$/gm, '$1');

test('HYG-01 aucun appel réseau, eval ni Function dans le code du widget', () => {
  assert.deepStrictEqual(offenders(jsFiles, /\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/), []);
});

test('HYG-02 aucune police, feuille de style ni image d\'un autre site', () => {
  assert.deepStrictEqual(offenders(cssFiles, /@import|url\(\s*["']?https?:/), []);
  const external = [...read('index.html').matchAll(/<(link|img|script)[^>]+(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[2]);
  assert.deepStrictEqual(external, ['https://docs.getgrist.com/grist-plugin-api.js']);
});

test('HYG-03 la police de l\'interface commence par system-ui', () => {
  assert.match(read('css/tokens.css'), /--font-ui:\s*system-ui/);
});

test('HYG-04 pas de prompt() ni confirm() natifs, pas d\'innerHTML ni d\'attribut style', () => {
  assert.deepStrictEqual(offenders(jsFiles, /window\.(prompt|confirm)|(?<![\w.])(?<!function )(prompt|confirm)\s*\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/), []);
  assert.doesNotMatch(read('index.html'), /\sstyle="/);
  assert.deepStrictEqual(offenders(jsFiles, /setAttribute\(\s*['"]style['"]|cssText/), []);
});

test('HYG-05 pas d\'emoji ni de police d\'icônes dans l\'interface', () => {
  assert.deepStrictEqual(offenders(everything, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u), []);
  assert.deepStrictEqual(offenders(everything, /font-?awesome|material-icons/i), []);
});

test('HYG-06 la politique de sécurité n\'autorise que le widget et l\'API Grist', () => {
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  // 'unsafe-eval' est imposé par le bundle de l'API Grist (voir index.html) ; rien d'autre n'est assoupli.
  assert.match(csp, /'unsafe-eval'/, 'sans lui, l\'API Grist ne démarre pas');
  assert.doesNotMatch(csp.replace(/'unsafe-eval'/, ''), /unsafe-|connect-src/);
  assert.deepStrictEqual([...csp.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]), ['https://docs.getgrist.com/grist-plugin-api.js']);
});

test('HYG-07 aucune couleur en dur hors des jetons : css/tokens.css les porte toutes, le blanc du texte d\'un bouton plein comprise (--on-accent)', () => {
  const hardCoded = cssFiles
    .filter((f) => !f.endsWith('tokens.css'))
    .filter((f) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|blue|gray|grey|orange|yellow|purple|pink|brown)(?![\w-])/i.test(read(f).replace(/url\("data:[^"]*"\)/g, '')));
  assert.deepStrictEqual(hardCoded, []);
});

test('HYG-08 le compte personnel n\'apparaît nulle part dans l\'interface', () => {
  assert.deepStrictEqual(offenders(everything, /lombre33/i), []);
});

test('HYG-09 le widget ne garde dans le navigateur que la langue et le thème, et le temps d\'un rechargement l\'identifiant de l\'onglet qui exécute', () => {
  const keys = new Set();
  for (const f of jsFiles) for (const m of read(f).matchAll(/(?:getItem|setItem)\(\s*(?:STORAGE_KEY|'([^']+)')/g)) keys.add(m[1] || 'STORAGE_KEY');
  assert.deepStrictEqual([...keys].sort(), ['STORAGE_KEY']);
  assert.deepStrictEqual(offenders(jsFiles, /indexedDB|document\.cookie/), []);
  // localStorage : ab_lang (js/i18n.js) et ab_theme (js/theme.js), des préférences d'affichage.
  assert.deepStrictEqual(offenders(jsFiles, /localStorage/), ['js/i18n.js', 'js/theme.js']);
  assert.match(read('js/i18n.js'), /STORAGE_KEY = 'ab_lang'/);
  assert.match(read('js/theme.js'), /STORAGE_KEY = 'ab_theme'/);
  // sessionStorage : l'identifiant de l'onglet pour le verrou d'exécution (Executor.tabIdentity), sous ab_executor_<table> ; rien du document.
  assert.deepStrictEqual(jsFiles.filter((f) => /sessionStorage/.test(code(f))), ['js/main.js']);
  assert.deepStrictEqual([...code('js/main.js').matchAll(/sessionStorage/g)].length, 1);
  assert.match(read('js/main.js'), /Executor\.tabIdentity\(\(\) => sessionStorage, 'ab_executor_' \+ table, randomId\)/);
  assert.match(read('README.md'), /localStorage/, 'le README dit ce que le widget garde dans le navigateur');
  assert.match(read('README.md'), /sessionStorage/);
});

test('HYG-10 aucun z-index en dur : les couches passent par les jetons --z-* de la charte (règle 12 de GFS)', () => {
  assert.deepStrictEqual(offenders(cssFiles, /z-index:\s*(?!\s|var\(--z-[\w-]+\))/), []);
  assert.deepStrictEqual(offenders(jsFiles, /zIndex|z-index/), []);
  const tokens = read('css/tokens.css');
  const used = new Set(cssFiles.flatMap((f) => [...read(f).matchAll(/z-index:\s*var\((--z-[\w-]+)\)/g)].map((m) => m[1])));
  assert.ok(used.size >= 5, 'les couches existantes passent bien par des jetons');
  assert.deepStrictEqual([...used].filter((name) => !new RegExp(`${name}:\\s*\\d+`).test(tokens)), [], 'chaque jeton utilisé est défini');
});

test('HYG-11 un seul bleu d\'accent : pas de vert de succès dans les jetons, le rouge et l\'ambre gardent leur sens (règle 12 de GFS)', () => {
  assert.deepStrictEqual(offenders(everything, /--good|--success|--green/), []);
  assert.deepStrictEqual(offenders(cssFiles, /\bgreen\b|\blime\b/i), []);
});

test('HYG-12 le site en ligne est publié tel quel : .nojekyll et index.html à la racine (consigne 005 de GFS)', () => {
  // Sans .nojekyll, GitHub Pages passe les fichiers .md dans Jekyll, qui refuse un « {{ » non fermé : la publication échoue
  // et le site reste sur l'ancienne version sans qu'aucun test ne le voie (c'était le cas du 21/10 au 02/11, version 0.9.0 servie).
  assert.ok(fs.existsSync(path.join(root, '.nojekyll')), '.nojekyll à la racine');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'l\'entrée de l\'app dans le manifeste de GFS est index.html, à la racine');
});

test('HYG-13 les feuilles ne lisent que des jetons que css/tokens.css définit (ou que GFS pose, avec un repli), jamais ceux que le guide interdit (règle 15 de GFS)', () => {
  const defined = new Set(cssFiles.flatMap((f) => [...read(f).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
  // Posés par js/keep-clear.js sur <html> quand GFS donne sa barre : la règle qui les lit ne s'applique que dans ce cas.
  const posed = ['--gfs-zone-x', '--gfs-zone-w'];
  // Lus avec une valeur de repli, parce que GFS les pose ou non : la marge d'un voile (js/keep-clear.js), l'aplat d'ambiance, le remplissage des boutons pleins (kit/test/ambiance-exemple.json).
  const optional = ['--gfs-pad-top', '--gfs-pad-right', '--gfs-pad-bottom', '--gfs-pad-left', '--wash', '--wash-size', '--fill', '--fill-hover', '--fill-line'];
  const unknown = [];
  for (const file of cssFiles) {
    for (const m of read(file).matchAll(/var\(\s*(--[\w-]+)(\s*,)?/g)) {
      const [, name, fallback] = m;
      if (defined.has(name) || posed.includes(name)) continue;
      if (fallback && optional.includes(name)) continue;
      unknown.push(`${file} : ${name}${fallback ? ' (avec repli)' : ''}`);
    }
  }
  assert.deepStrictEqual(unknown, []);
  // Les jetons de mise en page de GFS ne sont pas ceux d'une app : fond de la page, gouttière, séparateurs, débordement.
  assert.deepStrictEqual(offenders([...cssFiles, ...jsFiles], /--(?:ex-bg|main-bg|main-overflow|gap|divider|divider-w)\b/), []);
  // Le fond de la page est --bg, sur un élément qui couvre toute la page : l'aplat d'ambiance (--wash) s'y pose sans trou.
  assert.match(read('css/style.css'), /body\s*\{[^}]*min-height:\s*100vh[^}]*background-color:\s*var\(--bg\)[^}]*background-image:\s*var\(--wash, none\)/);
});

test('HYG-14 le kit commun est un sous-module du dépôt de GFS, et js/gfs.js en cite le commit exact (consignes 003 et 006)', () => {
  const modules = read('.gitmodules');
  assert.match(modules, /path = kit\b/);
  assert.match(modules, /url = https:\/\/github\.com\/lombre33\/grist-factory-kit\.git/);
  const cited = read('js/gfs.js').match(/commit ([0-9a-f]{7,40})\b/);
  assert.ok(cited, 'js/gfs.js dit à quel commit du kit il se réfère');
  let staged;
  try { staged = execFileSync('git', ['ls-files', '--stage', 'kit'], { cwd: root, encoding: 'utf8' }).split(/\s+/); } catch (err) { return; }   // une archive sans .git : rien à comparer
  assert.strictEqual(staged[0], '160000', 'kit est un sous-module (un lien vers un commit), pas un dossier copié');
  assert.ok(staged[1].startsWith(cited[1]), `le commit cité (${cited[1]}) est celui que le dépôt référence (${staged[1].slice(0, 7)})`);
});

test('HYG-15 js/gfs.js n\'importe que les deux modules du kit dont il a besoin, par chemin relatif : aucune adresse, aucun import dynamique', () => {
  assert.deepStrictEqual([...read('js/gfs.js').matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]).sort(), ['../kit/js/ambiance-pose.js', '../kit/js/gfs-link.js']);
  assert.deepStrictEqual(offenders(jsFiles, /\bimport\s*\(/), []);
  assert.deepStrictEqual([...read('index.html').matchAll(/<script[^>]*type="module"[^>]*src="([^"?]+)(?:\?v=[\d.]+)?"/g)].map((m) => m[1]), ['js/gfs.js'], 'le seul module chargé par la page');
});

test('HYG-18 chaque script et feuille de l\'app est demandé avec la version de l\'app (?v=) : une page à jour ne charge pas d\'anciens fichiers gardés en cache', () => {
  const version = read('js/version.js').match(/APP_VERSION = '([^']+)'/)[1];
  assert.strictEqual(JSON.parse(read('package.json')).version, version, 'package.json et js/version.js disent la même version');
  const html = read('index.html');
  const local = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="((?!https:)[^"]+)"/g)].map((m) => m[1]);
  assert.ok(local.length >= 20, `fichiers de l'app demandés par la page : ${local.length}`);
  assert.deepStrictEqual(local.filter((file) => !file.endsWith('?v=' + version)), []);
  const files = local.map((file) => file.replace(/\?.*$/, ''));
  assert.deepStrictEqual(files.filter((file) => !fs.existsSync(path.join(root, file))), [], 'chaque fichier demandé existe');
  assert.deepStrictEqual(jsFiles.filter((file) => !files.includes(file)), [], 'chaque script de js/ est chargé par la page');
});

// Les modules du kit que la page charge vraiment : ceux que js/gfs.js importe, et ceux qu'ils importent à leur tour.
function kitModulesReached(entry = 'js/gfs.js', seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of read(entry).matchAll(/\bfrom\s+'(\.[^']+)'/g)) kitModulesReached(path.join(path.dirname(entry), m[1]), seen);
  return seen;
}

test('HYG-16 les modules du kit que la page charge ne font aucun appel réseau, aucun eval, aucun HTML ni attribut style : ce que SECURITY.md affirme du widget vaut aussi pour eux', {
  skip: !fs.existsSync(path.join(root, 'kit/js/gfs-link.js')) && 'le kit n\'est pas récupéré (git submodule update --init)',
}, () => {
  const reached = [...kitModulesReached()].filter((f) => f.startsWith('kit'));
  assert.ok(reached.length >= 2, `les modules du kit atteints (${reached.join(', ')})`);
  assert.deepStrictEqual(offenders(reached, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\s*\(|new\s+Function|\bimport\s*\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write|cssText|setAttribute\(\s*['"]style['"]/), [], 'un module du kit fait ce que la politique de sécurité de la page ne laisse pas faire : relire avant de passer à ce commit du kit');
  assert.deepStrictEqual(offenders(reached, /https?:\/\//), [], 'aucune adresse écrite dans les modules chargés');
});

test('HYG-17 les couleurs propres à l\'app, que l\'ambiance de GFS ne change pas, forment une liste écrite et justifiée (consigne 006)', {
  skip: !fs.existsSync(path.join(root, 'kit/js/ambiance-message.js')) && 'le kit n\'est pas récupéré (git submodule update --init)',
}, async () => {
  const { COLOR_TOKENS, SHAPE_TOKENS } = await import(pathToFileURL(path.join(root, 'kit/js/ambiance-message.js')).href);
  // Les couleurs de css/tokens.css que le kit ne pose pas : l'ambiance ne les change pas. Chacune est ici avec sa raison ; une de plus demande une ligne de plus, et de dire pourquoi.
  // Tout le reste de css/tokens.css porte le nom d'un jeton de la charte : sa valeur est celle d'origine de l'app, que l'ambiance redit. Aucune couleur n'est écrite ailleurs (HYG-07).
  // Les couleurs des types de nœuds (déclencheur, action) et des états du test à blanc (passé, action prévue) sont des jetons de la charte : elles suivent l'accent de l'ambiance, et
  // GFS tient le contraste de ces paires. Seuls le rouge de l'échec et l'ambre de l'avertissement, qui disent quelque chose quelle que soit l'ambiance, sont à l'app.
  const own = {
    '--danger': 'le rouge de l\'échec : il garde son sens dans toutes les ambiances (règle 12 : le rouge et l\'ambre sont les deux couleurs sémantiques)',
    '--danger-soft': 'le fond doux du rouge, paire de --danger-ink (contraste mesuré par CTR-*)',
    '--danger-ink': 'le texte rouge sur --bg, --surface, --surface-sunken et --danger-soft (contraste mesuré par CTR-*)',
    '--warn-ink': 'l\'ambre de l\'avertissement et de la branche « sinon » du test à blanc : un état, pas une couleur d\'ambiance (contraste mesuré par CTR-*)',
    '--warn-soft': 'le fond doux de l\'ambre, paire de --warn-ink : paire inventée par l\'app, qui en garde le contraste',
    '--scrim': 'le voile noir translucide derrière une fenêtre : il assombrit ce qui est dessous, quelle que soit l\'ambiance',
  };
  const colors = new Set([...read('css/tokens.css').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .filter(([, name, value]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value) && !SHAPE_TOKENS.includes(name))
    .map(([, name]) => name));
  assert.deepStrictEqual([...colors].filter((name) => !COLOR_TOKENS.includes(name)).sort(), Object.keys(own).sort());
  for (const [name, why] of Object.entries(own)) assert.ok(why.length > 30, `${name} : la raison est écrite`);
});
