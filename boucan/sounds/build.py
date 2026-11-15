#!/usr/bin/env python3
"""Sons d'origine de Boucan.

  build.py                  régénère ../web/js/factory.js à partir des extraits *.mp3 de ce dossier
  build.py DOSSIER meta.json   recoupe d'abord les extraits depuis les enregistrements complets
                            téléchargés sur Wikimedia Commons (DOSSIER/<clé>.*), puis régénère

Chaque son : clé, nom (fr, en), couleur, déclenchement, boucle, début de l'extrait (s), durée (s).
"""
import base64, glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RED, ORANGE, YELLOW, GREEN, CYAN, BLUE, VIOLET, PINK, GREY = (
    '#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#EC407A', '#546E7A')

PAGES = [(('AMBIANCE', 'HYPE'), RED), (('RÉFS', 'TUNES'), BLUE)]
SOUNDS = [
    # page 1 : ambiance
    ('klaxon',    ('KLAXON', 'HORN'),               RED,    'oneshot', False, 0, 6),
    ('sirene',    ('SIRÈNE', 'SIREN'),              ORANGE, 'toggle',  True,  0, 12),
    ('sifflet',   ('SIFFLET', 'WHISTLE'),           YELLOW, 'oneshot', False, 0, 4),
    ('corne',     ('CORNE DE BRUME', 'FOG HORN'),   GREEN,  'oneshot', False, 0, 8),
    ('foule',     ('FOULE', 'CROWD'),               CYAN,   'toggle',  True,  0, 15),
    ('applau',    ('BRAVO', 'APPLAUSE'), BLUE,  'oneshot', False, 0, 7),
    ('roulement', ('ROULEMENT', 'DRUM ROLL'),       VIOLET, 'oneshot', False, 0, 8),
    ('alerte',    ('ALERTE', 'ALARM'),              PINK,   'toggle',  True,  0, 20),
    # page 2 : airs du domaine public
    ('bella',     ('BELLA CIAO', 'BELLA CIAO'),     RED,    'toggle',  False, 0, 22),
    ('cancan',    ('CANCAN', 'CAN-CAN'),            PINK,   'toggle',  False, 0, 20),
    ('toreador',  ('TORÉADOR', 'TOREADOR'),         ORANGE, 'toggle',  False, 0, 20),
    ('walkyries', ('WALKYRIES', 'VALKYRIES'),       BLUE,   'toggle',  False, 0, 22),
    ('cucaracha', ('CUCARACHA', 'CUCARACHA'),       YELLOW, 'toggle',  False, 0, 18),
    ('funebre',   ('MARCHE FUNÈBRE', 'FUNERAL MARCH'), GREY, 'toggle', False, 0, 20),
    ('inter',     ('INTERNATIONALE', 'INTERNATIONALE'), CYAN, 'toggle', False, 0, 22),
    ('trombone',  ('TROMBONE TRISTE', 'SAD TROMBONE'), VIOLET, 'oneshot', False, 0, 5),
]
# Début de l'extrait quand le thème connu n'est pas au début de l'enregistrement.
STARTS = {}
if os.path.exists(os.path.join(HERE, 'starts.json')):
    STARTS = json.load(open(os.path.join(HERE, 'starts.json')))


def cut(raw_dir):
    for key, _, _, _, loop, start, dur in SOUNDS:
        src = [f for f in glob.glob(os.path.join(raw_dir, key + '.*')) if os.path.getsize(f) > 20000]
        if not src:
            print('absent :', key)
            continue
        start = STARTS.get(key, start)
        fade = 0.05 if loop else min(1.5, dur / 4)
        # silence de tête retiré, fondu de fin, niveau sonore homogène d'un son à l'autre
        af = ('silenceremove=start_periods=1:start_threshold=-42dB,atrim=0:%g,areverse,'
              'silenceremove=start_periods=1:start_threshold=-42dB,afade=t=in:d=%g,areverse,'
              'loudnorm=I=-14:TP=-1.5:LRA=11' % (dur, fade))
        subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(start), '-t', str(dur + 10), '-i', src[0],
                               '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5',
                               os.path.join(HERE, key + '.mp3')])


def credits(meta):
    lines, md = [], ['# Sons d\'origine — sources et licences', '',
                     'Extraits d\'enregistrements publiés sur Wikimedia Commons, recoupés et normalisés.', '',
                     '| Son | Fichier d\'origine | Auteur | Licence |', '| --- | --- | --- | --- |']
    for key, name, *_ in SOUNDS:
        m = meta.get(key)
        if not m or not os.path.exists(os.path.join(HERE, key + '.mp3')):
            continue
        who = m['artist'] or '—'
        label = name[0].replace('-', '')
        lines.append('%s — %s, %s' % (label, who[:60], m['license']))
        md.append('| %s | [%s](%s) | %s | %s |' % (label, m['title'], m['page'], who, m['license']))
    open(os.path.join(HERE, 'CREDITS.md'), 'w', encoding='utf8').write('\n'.join(md) + '\n')
    return lines


def generate():
    meta = json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf8'))
    audio, defs = {}, []
    for key, name, color, mode, loop, _, _ in SOUNDS:
        path = os.path.join(HERE, key + '.mp3')
        if os.path.exists(path):
            audio[key] = base64.b64encode(open(path, 'rb').read()).decode('ascii')
        defs.append({'audio': key, 'name': list(name), 'color': color, 'mode': mode, 'loop': loop})
    out = ['/* Généré par sounds/build.py — ne pas modifier à la main. */',
           '(function (B) {', "  'use strict';",
           '  B.FACTORY_PAGES = ' + json.dumps([{'name': list(n), 'color': c} for n, c in PAGES], ensure_ascii=False) + ';',
           '  B.FACTORY = ' + json.dumps(defs, ensure_ascii=False) + ';',
           '  B.CREDITS = ' + json.dumps(credits(meta), ensure_ascii=False) + ';',
           '  B.FACTORY_AUDIO = {']
    out += ['    %s: "%s"%s' % (k, v, ',' if i < len(audio) - 1 else '') for i, (k, v) in enumerate(audio.items())]
    out += ['  };', '})(window.Boucan = window.Boucan || {});', '']
    open(os.path.join(HERE, '..', 'web', 'js', 'factory.js'), 'w', encoding='utf8').write('\n'.join(out))
    print('%d sons, %d Ko' % (len(audio), sum(len(v) for v in audio.values()) * 3 // 4 // 1024))


if __name__ == '__main__':
    if len(sys.argv) > 2:
        meta = json.load(open(sys.argv[2], encoding='utf8'))
        keep = {k: {f: m[f] for f in ('title', 'page', 'license', 'licenseUrl', 'artist')} for k, m in meta.items()}
        json.dump(keep, open(os.path.join(HERE, 'sources.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
        cut(sys.argv[1])
    generate()
