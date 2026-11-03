# Configurer les fournisseurs IA

Dans **Réglages → Contrôle système**, configure Claude, OpenAI ou **OpenCode**.
Le catalogue réel d’OpenCode propose tous ses fournisseurs, connectés ou non :
utilise la recherche, configure la connexion native et active les fournisseurs
à proposer dans **Configurer** du chat. Aucun identifiant de modèle n’est codé en dur.
L’entrée générale **OpenCode** reste disponible et regroupe tous les modèles connectés.
Un fournisseur individuel filtre les modèles sur son propre catalogue.
La connexion ne donne aucune permission supplémentaire à l’agent.

Pour Ollama ou une API compatible OpenAI, clique **Ajouter Ollama / un endpoint
compatible**, saisis le nom, l’URL de l’API et les identifiants des modèles installés.
Configure une clé dans le dialogue natif si nécessaire, puis active la nouvelle entrée.
Aucun secret ne transite par la webview.

## Réglage avancé et isolation

Le réglage machine `warband.opencodeProviders` ajoute désormais des fournisseurs
compatibles au serveur isolé ; il ne réimporte pas la configuration globale.
Le catalogue, les tours et l'apprentissage reçoivent la même configuration
validée. Les entrées ne sont transmises ni à Claude ni au mode OpenAI officiel.

Exemple de réglage utilisateur VS Code pour une instance Ollama déjà démarrée :

```json
{
  "warband.opencodeProviders": {
    "venator-local": {
      "name": "Ollama local",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "IDENTIFIANT_EXACT_DU_MODELE_INSTALLE": {}
      }
    }
  }
}
```

Remplacer l'identifiant du modèle par celui réellement installé, puis choisir
le fournisseur nommé dans Configurer, après son activation dans Contrôle système,
puis actualiser les modèles. La déclaration n'installe ni
ne télécharge un modèle. Une URL HTTPS compatible suit le même format. HTTP
est accepté pour les endpoints locaux/LAN explicitement choisis.

Les identifiants de fournisseur commencent par `venator-`. Aucun secret ne doit
être placé dans ce réglage : ni clé API, ni header, ni URL avec identifiants,
paramètres ou fragment. Les interpolations de fichiers ou d'environnement et
les paquets npm arbitraires sont refusés. Pour une authentification nécessaire,
utiliser « Configurer » dans Contrôle système et le même
identifiant de fournisseur `venator-…` dans l'authentification native ; le cache
reste géré par OpenCode. Ce terminal charge les fournisseurs validés avec une
configuration temporaire isolée, supprimée à sa fermeture. Un endpoint local
sans clé reste soumis à la disponibilité réelle dans le catalogue OpenCode ;
la déclaration seule ne prouve pas qu'il est connecté.

Gemini utilise le fournisseur natif OpenCode : configurer Google Gemini dans
Contrôle système, l’activer et le choisir dans le chat, puis actualiser le catalogue. Ne pas ajouter une entrée `google`
au réglage des endpoints : ce nom est refusé pour protéger les identifiants des
fournisseurs natifs. L'accès effectif dépend des identifiants et modèles
annoncés par le catalogue runtime ; aucun appel d'inférence réel n'est validé
par ces exemples.

Les noms de modèles doivent aussi respecter le sélecteur commun : caractères
ASCII alphanumériques et `._:/@[]-`, 200 caractères au maximum pour
`fournisseur/modèle`. Les limites de contexte/sortie et les capacités déclarées
facultatives décrivent le modèle installé ; elles ne sont pas déduites de son nom.
Après chaque modification du réglage, actualiser explicitement les modèles du
chat pour remplacer le catalogue en cache.

Vérification locale sans inférence : le binaire Linux OpenCode 1.19.0 expose un
fournisseur `venator-…` déclaré avec ce format dans `models` et `/provider`, y
compris sans clé API, comme fournisseur connecté provenant de la configuration.
Cette lecture ne vérifie ni la présence du modèle dans Ollama, ni un tour
conversationnel, ni le comportement natif Windows.
