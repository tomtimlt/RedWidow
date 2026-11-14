// Éditeur de la fenêtre Fichiers : CodeMirror 6 (copie locale `web/vendor/codemirror.js`, chargée à la
// demande), thème sombre sobre assorti à la coquille (accent rouge RedWidow, graphite, mono de la coquille) et
// textes français pour la recherche. Une seule vue ; l'état de chaque fichier (historique d'annulation,
// sélection) est conservé à part et échangé à l'ouverture d'un onglet. CSP : les feuilles de style de
// CodeMirror passent par `adoptedStyleSheets` (correctif documenté dans scripts/vendor-codemirror.mjs).

/** Chargement paresseux du bundle (une fois). */
let loading = null;
export function loadCodeMirror(load = () => import("../vendor/codemirror.js")) {
  if (loading === null) {
    loading = load().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

const FR = {
  Find: "Rechercher",
  Replace: "Remplacer",
  next: "suivant",
  previous: "précédent",
  all: "tous",
  "match case": "respecter la casse",
  regexp: "expression régulière",
  "by word": "mot entier",
  replace: "remplacer",
  "replace all": "tout remplacer",
  close: "fermer",
  "Go to line": "Aller à la ligne",
  go: "aller",
  "current match": "occurrence courante",
  "on line": "ligne",
  "replaced $ matches": "$ occurrences remplacées",
  "replaced match on line $": "occurrence remplacée ligne $",
  "Selection deleted": "Sélection supprimée",
  "Folded lines": "Lignes repliées",
  "Unfolded lines": "Lignes dépliées",
  "Control character": "Caractère de contrôle",
};

/** Thème sombre à la charte, et couleurs de syntaxe. Les variables `--rw-*` viennent de theme.css. */
function themeExtensions(cm) {
  const { EditorView, HighlightStyle, syntaxHighlighting, tags } = cm;
  const theme = EditorView.theme(
    {
      "&": {
        color: "var(--rw-fg)",
        backgroundColor: "var(--rw-surface)",
        height: "100%",
        fontSize: "13px",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: "var(--rw-mono)", lineHeight: "1.55", overflow: "auto" },
      ".cm-content": { caretColor: "var(--rw-crimson-text)", padding: "8px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--rw-crimson-text)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "rgb(255 59 92 / 32%)" },
      ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 4%)" },
      ".cm-gutters": {
        backgroundColor: "var(--rw-surface)",
        color: "var(--rw-steel-text)",
        border: "none",
        borderRight: "1px solid var(--rw-line)",
      },
      ".cm-activeLineGutter": { backgroundColor: "rgb(255 255 255 / 7%)", color: "var(--rw-fg)" },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "rgb(255 255 255 / 14%)",
        outline: "1px solid var(--rw-fg-subtle)",
      },
      ".cm-searchMatch": {
        backgroundColor: "rgb(224 176 80 / 25%)",
        outline: "1px solid var(--rw-warn)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(255 59 92 / 38%)" },
      ".cm-selectionMatch": { backgroundColor: "rgb(255 255 255 / 10%)" },
      ".cm-panels": {
        backgroundColor: "var(--rw-surface)",
        color: "var(--rw-fg)",
        borderColor: "var(--rw-line)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--rw-line)" },
      ".cm-panel.cm-search": { padding: "6px 30px 6px 8px" },
      ".cm-panel.cm-search input, .cm-panel.cm-search button": {
        font: "inherit",
        fontSize: "12px",
        color: "var(--rw-fg)",
        backgroundColor: "var(--rw-surface-2)",
        border: "1px solid var(--rw-line-strong)",
        borderRadius: "var(--rw-radius)",
        padding: "4px 10px",
        margin: "2px 4px 2px 0",
      },
      ".cm-panel.cm-search button": { cursor: "pointer" },
      ".cm-panel.cm-search button:hover": { backgroundColor: "var(--rw-line)" },
      ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--rw-fg-muted)" },
      ".cm-panel.cm-search [name=close]": {
        color: "var(--rw-fg-muted)",
        backgroundColor: "transparent",
        border: "none",
      },
    },
    { dark: true },
  );
  const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--rw-crimson-text)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--rw-ok)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--rw-warn)" },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: "var(--rw-fg-subtle)",
      fontStyle: "italic",
    },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: "var(--rw-link)",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--rw-term-magenta)" },
    { tag: [tags.propertyName, tags.attributeName], color: "var(--rw-info)" },
    { tag: [tags.tagName, tags.heading], color: "var(--rw-crimson-text)", fontWeight: "700" },
    { tag: [tags.link, tags.url], color: "var(--rw-link)", textDecoration: "underline" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: [tags.meta, tags.processingInstruction], color: "var(--rw-fg-muted)" },
    { tag: tags.invalid, color: "var(--rw-err)" },
  ]);
  return [theme, syntaxHighlighting(highlight)];
}

/** Extension de langage pour un identifiant de `languageOf`, ou `null`. */
function languageExtension(cm, id) {
  switch (id) {
    case "markdown":
      return cm.markdown();
    case "json":
      return cm.json();
    case "yaml":
      return cm.yaml();
    case "xml":
      return cm.xml();
    case "html":
      return cm.html();
    case "javascript":
      return cm.javascript({ jsx: true });
    case "typescript":
      return cm.javascript({ typescript: true, jsx: true });
    case "python":
      return cm.python();
    case "css":
      return cm.css();
    case "shell":
      return cm.StreamLanguage.define(cm.shell);
    default:
      return null;
  }
}

/**
 * Éditeur à vue unique.
 * @param {object} cm module `codemirror.js`
 * @param {object} options
 * @param {HTMLElement} options.parent
 * @param {(key: string, text: string) => void} options.onChange saisie de l'utilisateur (jamais `open`/`setText`)
 * @param {() => void} options.onSave Ctrl+S dans l'éditeur
 */
export function createEditor(cm, { parent, onChange, onSave }) {
  const states = new Map();
  let key = null;
  let silent = false;
  const base = (id, readOnly) => [
    cm.lineNumbers(),
    cm.highlightActiveLineGutter(),
    cm.highlightSpecialChars(),
    cm.history(),
    cm.drawSelection(),
    cm.dropCursor(),
    cm.indentOnInput(),
    cm.bracketMatching(),
    cm.rectangularSelection(),
    cm.highlightActiveLine(),
    cm.highlightSelectionMatches(),
    cm.search({ top: true }),
    cm.EditorState.phrases.of(FR),
    cm.EditorState.readOnly.of(readOnly),
    cm.EditorView.contentAttributes.of({
      "aria-label": "Contenu du fichier",
      "aria-readonly": String(readOnly),
    }),
    cm.keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSave();
          return true;
        },
      },
      ...cm.searchKeymap,
      ...cm.historyKeymap,
      ...cm.defaultKeymap,
    ]),
    cm.EditorView.updateListener.of((update) => {
      if (update.docChanged && !silent && key !== null) onChange(key, update.state.doc.toString());
    }),
    themeExtensions(cm),
    languageExtension(cm, id) ?? [],
  ];
  const view = new cm.EditorView({ parent });

  const swap = (state) => {
    silent = true;
    try {
      view.setState(state);
    } finally {
      silent = false;
    }
  };

  return {
    /** Affiche le fichier `path` ; son état précédent (annulation, sélection) est repris s'il existe. */
    open(path, { text, language, readOnly }) {
      if (key !== null) states.set(key, view.state);
      key = path;
      const kept = states.get(path);
      swap(
        kept ?? cm.EditorState.create({ doc: text, extensions: base(language, readOnly === true) }),
      );
      return view;
    },
    /** Remplace tout le texte (rechargement) : l'état précédent du fichier est oublié. */
    reset(path, { text, language, readOnly }) {
      states.delete(path);
      key = path;
      swap(cm.EditorState.create({ doc: text, extensions: base(language, readOnly === true) }));
    },
    /** Oublie l'état d'un onglet fermé. */
    forget(path) {
      states.delete(path);
      if (key === path) key = null;
    },
    /** Renomme l'état conservé d'un onglet (le fichier a changé de chemin). */
    move(from, to) {
      const state = states.get(from);
      if (state !== undefined) {
        states.set(to, state);
        states.delete(from);
      }
      if (key === from) key = to;
    },
    text: () => view.state.doc.toString(),
    focus: () => view.focus(),
    openSearch: () => cm.openSearchPanel(view),
    view,
    destroy: () => view.destroy(),
  };
}
