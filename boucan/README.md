# Boucan

Soundboard Android ultra simple, pensé pour être joué d'une main, à vélo, en manif.

- **8 énormes cases par page** (2 colonnes × 4), jusqu'à **8 pages**, onglets en bas ; on change de page en glissant.
- **Cases** : *sample* (fichier ou prise au micro), *micro* (direct ou différé), *FX* (effet de DJ sur ce qui joue),
  *hub* (4 petits boutons dans une case).
- **Samples** : *one shot*, *on / off* ou *piano*, boucle, recadrage avec zoom, fondus, volume, débruiteur et « enhance » pour les prises micro.
- **Effets** : reverb, écho, coupe-haut, coupe-bas, mégaphone, disto, flanger, hachoir, pitch, loop, vinyl stop, cut.
  Un curseur en haut à gauche (le bouton `FX` fait défiler les effets ; appui long : cible, liste et réglages de chaque effet)
  et des cases FX réglables, y compris en glissant le doigt.
- **Lecteur de musique** (widget 2 × 3 cases, `web/js/deck.js`) : lit les fichiers du téléphone dossier par dossier, avec forme d'onde,
  recherche, volume propre, vinyl stop, commandes dans les notifications, et pour chaque morceau une couleur, un commentaire
  et un point de départ. Le morceau est joué depuis la mémoire pour que les positions soient exactes.
- **Phone control** (widget d'une rangée) : télécommande de l'appli de musique en cours (Spotify…). Demande l'« accès aux notifications ».
- **Cible des effets** : soundboard, musique du lecteur, ou les deux. La musique peut baisser ou se mettre en pause quand on parle au micro.
- **STOP** coupe tout ; **ÉDIT** pour tout régler ; interface en français ou en anglais.
- **Export / import** dans un seul fichier `.boucan` : toute la config et ses sons, avec ou sans les musiques du lecteur,
  ou seulement les étiquettes des morceaux.
- **Réglages audio** par téléphone (tampon, fréquence d'échantillonnage) pour éviter les craquements.
- Sons d'origine : 16 sons synthétisés dans l'app (aucun fichier audio embarqué).
- Pas d'accès Internet, fonctionne hors ligne. Android 5.0 et plus (lecteur et notifications : fonctions complètes à partir d'Android 10).

## Installer

Télécharger `dist/Boucan-2.5.apk` sur le téléphone, l'ouvrir, puis autoriser l'installation
depuis cette source quand Android le demande.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `web/` | L'app elle-même (HTML, CSS, JavaScript ES5, sans dépendance). S'ouvre aussi dans un navigateur. |
| `web/js/synth.js` | Sons d'origine, synthétisés au premier lancement. |
| `web/js/mic.js` | Débruiteur et capture micro. |
| `web/js/i18n.js` | Textes français et anglais. |
| `web/js/core.js` | Stockage (IndexedDB), moteur audio (Web Audio), format `.boucan`. |
| `web/js/deck.js` | Lecteur de musique intégré. |
| `web/js/ui.js` | Interface : cases, édition, recadrage, pages, menu. |
| `android/` | Enveloppe Android : une `WebView` plein écran, fichiers, export, musiques du téléphone, notification du lecteur. |

## Compiler

Il faut un JDK 17+ et le SDK Android (plateforme 35, build-tools 35).

```sh
# Sans Gradle, aucune dépendance à télécharger : produit dist/Boucan-<version>.apk
ANDROID_HOME=/chemin/vers/android-sdk android/build.sh

# Ou avec Gradle / Android Studio (ouvrir le dossier android/)
cd android && echo "sdk.dir=/chemin/vers/android-sdk" > local.properties && gradle assembleRelease
```

L'APK est signé avec `android/boucan-sideload.keystore`. Cette clé est **publique** (elle est dans le dépôt) :
elle sert uniquement à ce que les mises à jour s'installent par-dessus l'ancienne version. Pour une
publication sur le Play Store, signer avec une clé privée.

## Format `.boucan`

`BOUCAN01`, puis la taille de l'en-tête (entier 32 bits), l'en-tête JSON (config, table des sons, table des musiques jointes),
puis les sons en WAV 16 bits et les fichiers de musique mis bout à bout. Un fichier d'étiquettes n'a que l'en-tête.
