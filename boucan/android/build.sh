#!/bin/sh
# Compile l'APK sans Gradle : il suffit d'un JDK et du SDK Android
# (plateforme + build-tools). Aucune dépendance à télécharger.
#
#   ANDROID_HOME=/chemin/vers/android-sdk ./build.sh
#
# Résultat : ../dist/Boucan-<version>.apk
set -e
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?ANDROID_HOME doit pointer vers le SDK Android}}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
JAR="$SDK/platforms/$(ls "$SDK/platforms" | sort -V | tail -1)/android.jar"
PKG=com.felixfarjas.boucan
VERSION=$(sed -n "s/.*versionName '\(.*\)'.*/\1/p" app/build.gradle)
CODE=$(sed -n "s/.*versionCode \([0-9]*\).*/\1/p" app/build.gradle)
OUT=build/manual
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" ../dist

# Le manifeste Gradle n'a ni nom de paquet ni identifiant résolu : on les pose ici.
sed -e "s|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"$PKG\">|" \
    -e "s|\${applicationId}|$PKG|" app/src/main/AndroidManifest.xml > "$OUT/AndroidManifest.xml"

"$BT/aapt2" compile --dir app/src/main/res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/unsigned.apk" -I "$JAR" --manifest "$OUT/AndroidManifest.xml" -A ../web \
    --min-sdk-version 21 --target-sdk-version 35 --version-code "$CODE" --version-name "$VERSION" "$OUT/res.zip"

javac -nowarn -source 8 -target 8 -cp "$JAR" -d "$OUT/classes" $(find app/src/main/java -name '*.java')
"$BT/d8" --release --min-api 21 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q ../unsigned.apk classes.dex)

"$BT/zipalign" -f -P 16 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks boucan-sideload.keystore --ks-pass pass:boucan --key-pass pass:boucan \
    --ks-key-alias boucan --min-sdk-version 21 --out "../dist/Boucan-$VERSION.apk" "$OUT/aligned.apk"
rm -f "../dist/Boucan-$VERSION.apk.idsig"
"$BT/apksigner" verify --min-sdk-version 21 "../dist/Boucan-$VERSION.apk"
echo "OK : dist/Boucan-$VERSION.apk"
