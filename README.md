# 🌦️ MeteoInsight-Pro

> **Console intelligente de suivi météo local et gestion domotique par Machine Learning, interfacée avec Home Assistant.**

MeteoInsight-Pro est une application web moderne conçue pour le suivi climatique et la gestion thermique d'un habitat. En s'appuyant sur des prévisions physiques à haute résolution de Météo-France (**AROME** et **ARPEGE**) et les données de vos capteurs **Home Assistant**, l'application utilise des algorithmes d'apprentissage automatique locaux (régression Ridge) pour corriger les prévisions brutes selon les spécificités de votre micro-climat local et optimiser la ventilation de votre logement.

---

## 📸 Aperçu de l'Interface

| 🖥️ Tableau de bord principal | 🌦️ Température Brute vs Ajustée (ML) |
| :---: | :---: |
| ![Dashboard principal](assets/dashboard_screenshot.png?v=2) | ![Prévisions](assets/forecasts_screenshot.png?v=2) |
| *Plan 2D interactif avec calques physiques (thermique, CO2, présence) et suivi en direct Roborock.* | *Comparaison en temps réel des prévisions brutes AROME/ARPEGE et de la prévision ajustée par le modèle de biais ML.* |

---

## 🚀 Fonctionnalités Clés

### 🧠 Machine Learning & Modèles Prédictifs
* **Correction de biais ML (AROME - Micro-climat local)** : Un modèle de régression Ridge (fenêtre glissante de 30 jours) compare en continu les prévisions brutes de la maille AROME avec les mesures de votre capteur extérieur Home Assistant. Il corrige les biais thermiques locaux (comme l'effet d'îlot de chaleur nocturne ou l'ombrage diurne) pour produire une prévision météo ultra-locale.
* **Projections thermiques des pièces à 24h** : Calcul prédictif de l'évolution de la température intérieure de chaque pièce par régression Ridge multivariable. Le modèle estime l'inertie thermique et les apports solaires sur 30 jours, en prenant en compte :
  * La température extérieure locale ajustée par le modèle de biais ML.
  * Le rayonnement solaire direct et diffus du modèle AROME.
  * L'orientation géométrique des fenêtres et l'impact du vent (force et direction).
* **Analyse d'Affluence sur 30 jours** : Agrégation statistique de vos détecteurs de mouvement et de présence pour modéliser une courbe de rythme d'activité horaire sur 24h.

### 💨 Gestion de l'Aération (Confort Hygrothermique)
* **Humidité Absolue ($g/m^3$)** : Comparaison en temps réel de la quantité de vapeur d'eau réelle dans l'air (plutôt que l'humidité relative) pour déterminer si l'ouverture des fenêtres va assécher ou humidifier le logement.
* **Indicateur d'Ouverture optimal** : Recommandations dynamiques de ventilation avec un compte à rebours précis indiquant la prochaine opportunité favorable pour ouvrir ou fermer les fenêtres afin de conserver la fraîcheur ou d'assécher l'air.

### 🏡 Cartographie 2D & Domotique
* **Plan 2D SVG Dynamique** : Dessiné en SVG sur le client en fonction de la configuration de vos pièces. Supporte les calques d'affichage thermique, lux, humidité, qualité de l'air (CO2/PM2.5), bruit (dB) et présence.
* **Intégration Aspirateur (Roborock)** : Visualisation en direct de l'aspirateur sur le plan 2D dans sa pièce de nettoyage, avec commandes bidirectionnelles rapides.
* **Console de Paramétrage Sécurisée** : Interface d'administration sécurisée pour configurer les jetons d'accès Home Assistant et éditer la disposition géométrique de vos pièces en JSON avec validateur intégré.
* **Thèmes Sombre & Apple Light** : Support complet d'un thème sombre immersif et d'un thème clair minimaliste (style Apple) avec transitions fluides, sélectionnable en un clic depuis la barre de navigation.

---

## 🛠️ Installation & Démarrage

### Prérequis
* **Node.js** (v18 ou supérieur)
* Une instance **Home Assistant** fonctionnelle avec un jeton d'accès longue durée (Long-Lived Access Token).

### 1. Installation
```bash
git clone https://github.com/PolgeBenjamin/MeteoInsight-Pro.git
cd MeteoInsight-Pro
npm install
```

### 2. Configuration
Créez votre fichier de configuration local :
```bash
cp config.json.example config.json
```
*Note : Le fichier `config.json` contient vos secrets locaux et est configuré pour être automatiquement ignoré par Git.*

### 3. Lancement
En développement :
```bash
npm run dev
```

En production avec **PM2** :
```bash
npm install -g pm2
pm2 start server.js --name "meteo-insight-pro"
pm2 startup && pm2 save
```

L'application sera accessible par défaut sur `http://localhost:3000` (ou le port configuré).

---

## 📐 Exemple de Configuration de Pièce (JSON)

Les dimensions `x, y, w, h` sont définies sur une grille de dessin de `500x500` pixels :
```json
{
  "id": "salon",
  "label": "Salon",
  "x": 20,
  "y": 300,
  "w": 160,
  "h": 180,
  "tempEntity": "sensor.netatmo_temperature",
  "humEntity": "sensor.netatmo_humidite",
  "motionEntity": "binary_sensor.alexa_salon_mouvement",
  "windowOrientation": 180,
  "clickable": true
}
```

---

## 🛡️ Licence
Ce projet est distribué sous la licence **Propriétaire - Usage Personnel et Non-Commercial Uniquement**. 
Pour plus de détails, veuillez consulter le fichier `LICENSE` joint.
