# Boucan

Soundboard Android ultra simple, pensé pour être joué d'une main, à vélo, en manif.

- **8 énormes cases par page** (2 colonnes × 4), jusqu'à **8 pages**, sélection des pages en bas.
- **3 déclenchements** par case : *one shot*, *on / off*, *piano* (joue tant qu'on appuie), avec boucle au choix.
- **Un seul curseur d'effet** en haut à gauche : reverb par défaut, le bouton `FX` passe à écho, filtre ou mégaphone.
- **STOP** coupe tout, y compris les queues de reverb et d'écho.
- **ÉDIT** (appui long, pour ne pas y entrer par accident) : nom, couleur, volume, recadrage, import d'un son,
  déplacement, suppression ; couleur et nom de chaque page.
- **Export / import** de toute la config (pages, réglages et sons) dans un seul fichier `.boucan`.
- 16 sons d'origine, synthétisés par l'app : aucun enregistrement sous droits, mélodies du domaine public.
- Aucune permission sensible, pas d'accès Internet, fonctionne hors ligne. Android 5.0 et plus.

## Installer

Télécharger `dist/Boucan-1.0.apk` sur le téléphone, l'ouvrir, puis autoriser l'installation
depuis cette source quand Android le demande.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `web/` | L'app elle-même (HTML, CSS, JavaScript ES5, sans dépendance). S'ouvre aussi dans un navigateur. |
| `web/js/synth.js` | Synthèse des 16 sons d'origine. |
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
