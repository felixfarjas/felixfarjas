# Boucan

Soundboard Android ultra simple, pensé pour être joué d'une main, à vélo, en manif.

- **8 énormes cases par page** (2 colonnes × 4), jusqu'à **8 pages**, sélection des pages en bas.
- **Trois types de case** : *sample* (un son), *micro* (on parle tant qu'on appuie, glisser hors de la case annule)
  et *FX* (effet de DJ sur tout ce qui joue : vinyl stop, reverb, écho, filtres, hachoir, cut).
- **Samples** : *one shot*, *on / off* ou *piano*, boucle, recadrage, fondus, volume ; import d'un fichier ou prise au micro.
- **Micro** : différé ou direct, débruiteur spectral réglable.
- **Un curseur d'effet** en haut à gauche ; le bouton `FX` fait défiler les effets cochés dans le menu.
- **STOP** coupe tout, y compris les queues de reverb et d'écho.
- **ÉDIT** (appui long) pour tout régler ; interface en français ou en anglais.
- **Export / import** de toute la config (pages, réglages et sons) dans un seul fichier `.boucan`.
- Sons d'origine : 16 sons synthétisés dans l'app (aucun fichier audio embarqué), répartis sur 3 pages avec le micro et les effets DJ.
- Widget LECTEUR (2 × 3 cases) : lit les fichiers de musique du téléphone, dossier par dossier (dossier source réglable dans le menu), avec forme d'onde pour se déplacer dans le morceau, son propre volume et, au choix, les effets de Boucan (`web/js/deck.js`).
- Widget PHONE CONTROL (une rangée) : télécommande du lecteur de musique en cours (Spotify ou autre) — titre, pochette, lecture/pause, suivant/précédent. Demande l'« accès aux notifications » d'Android ; les effets ne s'appliquent pas à cette musique.
- La musique peut baisser ou se mettre en pause quand on parle au micro. On change de page en glissant le doigt (désactivable dans le menu).
- Pas d'accès Internet, fonctionne hors ligne. Android 5.0 et plus.

## Installer

Télécharger `dist/Boucan-1.6.apk` sur le téléphone, l'ouvrir, puis autoriser l'installation
depuis cette source quand Android le demande.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `web/` | L'app elle-même (HTML, CSS, JavaScript ES5, sans dépendance). S'ouvre aussi dans un navigateur. |
| `web/js/synth.js` | Sons d'origine, synthétisés au premier lancement. |
| `web/js/mic.js` | Débruiteur et capture micro. |
| `web/js/i18n.js` | Textes français et anglais. |
| `web/js/core.js` | Stockage (IndexedDB), moteur audio (Web Audio), format `.boucan`. |
| `web/js/ui.js` | Interface : cases, édition, recadrage, pages, menu. |
| `android/` | Enveloppe Android : une `WebView` plein écran, sélecteur de fichier, enregistrement et partage de l'export. |

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

`BOUCAN01`, puis la taille de l'en-tête (entier 32 bits), l'en-tête JSON (config et table des sons),
puis les sons en WAV 16 bits mis bout à bout.
