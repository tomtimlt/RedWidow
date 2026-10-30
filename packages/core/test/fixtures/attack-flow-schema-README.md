Fixtures de validation, récupérées via GitHub le 30 octobre 2026.

- `attack-flow-schema-2.0.0.json` : copie au JSON identique (indentation Biome) de `center-for-threat-informed-defense/attack-flow`, `stix/attack-flow-schema-2.0.0.json`, blob `b6c7897e72be614e63350701a8621dc91ce40c67`, licence Apache-2.0 jointe.
- `attack-flow-schema-stix.json` : regroupement des schémas communs référencés depuis `oasis-open/cti-stix2-json-schemas`, branche `stix2.1`, répertoire `schemas/common/`. Contenu JSON inchangé, indentation Biome ; licence OASIS jointe.
- La définition officielle embarquée dans `attack-flow.ts` vient de `stix/attack-flow-extension-2.0.0.json`, blob `cf963d3f904f9cb9669a68ab6e6a6e40dedf203f`.

Le test Python utilise jsonschema Draft 2020-12 et un registre local : aucun téléchargement ni exécution de code amont. Il est explicitement ignoré si Python/jsonschema manque. Aucun test d'import dans Attack Flow Builder n'a été effectué.
