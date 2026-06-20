---
name: ml_sensor_alignment
description: Alignement robuste des séries temporelles de capteurs locaux et de prévisions météo pour entraînement ML
---

# Alignement Temporel pour Modèles de Régression (Biais & Thermique)

Lors de la construction d'un jeu d'entraînement pour des modèles de régression (ex: Ridge Regression) associant des capteurs locaux (comme Home Assistant) et des historiques météo de grille (comme Open-Meteo) :

## 1. Gestion de la Rétention Limitée (Extrapolation du Passé)
* **Problème** : Les bases locales purgent souvent l'historique (ex: 10 jours glissants). Requérir 30 jours de données peut pousser l'API locale à renvoyer la valeur la plus ancienne pour toute la période manquante, créant une ligne plate artificielle.
* **Correction** : 
  * Toujours renvoyer `null` (ou lever une exception) pour toute requête horaire antérieure au premier enregistrement réel enregistré dans la base locale.
  * Ignorer ces échantillons dans le calcul de la régression pour éviter de fausser la pente thermique ($\beta_1$).

## 2. Protection contre les données futures (Extrapolation du Futur)
* **Problème** : Les API d'archives ou de prévisions renvoient parfois les heures futures de la journée courante. Les capteurs locaux ne disposent d'aucune donnée réelle pour ces heures futures, ce qui conduit à répéter la dernière valeur connue.
* **Correction** :
  * Filtrer strictement les échantillons pour n'inclure que les points temporels inférieurs ou égaux à l'instant présent (`tTime <= now`).

## 3. Algorithme de Régression Ridge
* Utiliser une régression Ridge régularisée ($\lambda$) pour stabiliser la matrice d'inversion face à des jeux de données de taille variable.
* Borner physiquement les coefficients calculés (ex: pente thermique toujours négative).
