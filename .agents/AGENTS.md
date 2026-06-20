# Règles de Projet : Sécurité et Nettoyage Git

## 1. Protection des Données Personnelles et Secrets
* **Ne jamais commiter de secrets** : Les clés d'API, les mots de passe, ou les jetons d'accès (comme `HA_TOKEN`) doivent être stockés uniquement dans des fichiers ignorés localement (ex: `config.json`).
* **Fichiers de prompt et de travail** : Ne jamais inclure de fichiers de prompt (`agent.md`, `claude.md`) ou de journaux de conversation dans les commits Git.
* **Scripts temporaires (Scratch scripts)** : Tous les outils ou scripts de test ponctuels doivent être placés dans les dossiers temporaires du système ou dans le répertoire d'artifacts désigné, et exclus du suivi Git.
* **Vérification systématique** : Exécuter un `git status` ou `git diff --cached` avant toute action de push pour vérifier l'absence d'éléments sensibles.
