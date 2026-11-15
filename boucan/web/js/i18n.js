/*
 * Boucan — textes de l'interface, en français et en anglais.
 * La langue suit celle du téléphone au premier lancement, puis le réglage du menu.
 */
(function (B) {
  'use strict';

  var T = {
    fr: {
      edit: 'ÉDIT', menu: 'MENU', cancel: 'ANNULER', loop: 'BOUCLE',
      'mode.oneshot': 'ONE SHOT', 'mode.toggle': 'ON / OFF', 'mode.gate': 'PIANO',
      'hint.oneshot': 'Un appui joue le son en entier. Un nouvel appui le relance du début.',
      'hint.toggle': 'Un appui lance le son, un autre appui l\'arrête.',
      'hint.gate': 'Le son joue tant que le doigt reste appuyé.',
      'fx.reverb': 'REVERB', 'fx.echo': 'ÉCHO', 'fx.highcut': 'COUPE-HAUT', 'fx.lowcut': 'COUPE-BAS',
      'fx.mega': 'MÉGAPHONE', 'fx.disto': 'DISTO', 'fx.flanger': 'FLANGER', 'fx.gate': 'HACHOIR',
      'bar.edit': 'ÉDITION · TOUCHE UNE CASE OU UNE PAGE', 'bar.move': 'TOUCHE LA CASE DE DESTINATION',
      hold: 'Maintenir appuyé pour éditer',
      tooHeavy: 'Fichier trop lourd (60 Mo max)', tooLong: 'Son trop long (10 minutes max)',
      badAudio: 'Format audio non reconnu', importing: 'IMPORT DU SON…',
      pad: 'CASE', name: 'NOM', color: 'COULEUR', trigger: 'DÉCLENCHEMENT',
      loopOn: 'BOUCLE : OUI', loopOff: 'BOUCLE : NON', volume: 'VOLUME',
      crop: 'RECADRAGE', start: 'DÉBUT', end: 'FIN', play: 'LECTURE', pause: 'PAUSE',
      cropNote: 'Durée jouée : {0} s. Glisse sur l\'onde pour recadrer, − et + pour ajuster.',
      keepNote: ' Son long : à la fermeture, seule la partie recadrée est conservée.',
      fadeIn: 'FONDU D\'ENTRÉE', fadeOut: 'FONDU DE SORTIE', none: 'AUCUN',
      change: 'CHANGER LE SON', move: 'DÉPLACER LA CASE', clear: 'VIDER LA CASE', padSec: 'CASE',
      askClear: 'Vider la case « {0} » ?', doClear: 'VIDER',
      page: 'PAGE', order: 'ORDRE', left: '← À GAUCHE', right: 'À DROITE →',
      del: 'SUPPRESSION', delPage: 'SUPPRIMER LA PAGE', keepOne: 'Il faut garder au moins une page',
      askDelPage: 'Supprimer la page « {0} » et ses sons ?', doDel: 'SUPPRIMER',
      transfer: 'TRANSFÉRER SUR UN AUTRE TÉLÉPHONE', send: 'ENVOYER LA CONFIG', saveFile: 'ENREGISTRER DANS UN FICHIER',
      exportCfg: 'EXPORTER LA CONFIG', importCfg: 'IMPORTER UNE CONFIG',
      transferNote: 'Le fichier .boucan contient toutes les pages, tous les réglages et tous les sons. Sur l\'autre téléphone : MENU, puis IMPORTER UNE CONFIG.',
      fxList: 'EFFETS DU BOUTON FX', fxNote: 'Les effets cochés défilent avec le bouton FX. Le curseur règle celui qui est affiché.',
      keepFx: 'Il faut garder au moins un effet',
      settings: 'RÉGLAGES', lang: 'LANGUE', vibOn: 'VIBRATION AU TOUCHER : OUI', vibOff: 'VIBRATION AU TOUCHER : NON',
      reset: 'REMISE À ZÉRO', resetBtn: 'REMETTRE LES SONS D\'ORIGINE',
      askReset: 'Effacer toutes les pages et tous les sons importés, et remettre les sons d\'origine ?', doReset: 'REMETTRE À ZÉRO',
      about: 'Boucan {0}', credits: 'SONS D\'ORIGINE',
      creditsNote: 'Enregistrements libres de droits issus de Wikimedia Commons :',
      preparing: 'PRÉPARATION DES SONS', makingFile: 'PRÉPARATION DU FICHIER…', readingFile: 'LECTURE DU FICHIER…',
      importingCfg: 'IMPORT DE LA CONFIG…', downloaded: 'Config téléchargée', imported: 'Config importée',
      exportFail: 'Export impossible : ', importFail: 'Import impossible : ', notBoucan: 'Ce fichier n\'est pas une config Boucan',
      askImport: 'Remplacer toute la config actuelle par celle de ce fichier ?', doImport: 'REMPLACER',
      saveFail: 'Sauvegarde impossible', noStore: 'Stockage indisponible : rien ne sera gardé à la fermeture',
      noAudio: 'Audio indisponible sur cet appareil', bootFail: 'Erreur au démarrage : ', error: 'Erreur : ',
      'n.saved': 'Config enregistrée', 'n.saveFail': 'Enregistrement impossible', 'n.noPicker': 'Aucune app pour choisir un fichier',
      'n.noShare': 'Aucune app pour envoyer le fichier', 'n.exportFail': 'Export impossible (stockage plein ?)'
    },
    en: {
      edit: 'EDIT', menu: 'MENU', cancel: 'CANCEL', loop: 'LOOP',
      'mode.oneshot': 'ONE SHOT', 'mode.toggle': 'ON / OFF', 'mode.gate': 'PIANO',
      'hint.oneshot': 'One tap plays the whole sound. Tapping again restarts it.',
      'hint.toggle': 'One tap starts the sound, another tap stops it.',
      'hint.gate': 'The sound plays for as long as you hold the pad.',
      'fx.reverb': 'REVERB', 'fx.echo': 'ECHO', 'fx.highcut': 'HIGH CUT', 'fx.lowcut': 'LOW CUT',
      'fx.mega': 'MEGAPHONE', 'fx.disto': 'DRIVE', 'fx.flanger': 'FLANGER', 'fx.gate': 'CHOPPER',
      'bar.edit': 'EDITING · TAP A PAD OR A PAGE', 'bar.move': 'TAP THE DESTINATION PAD',
      hold: 'Hold to edit',
      tooHeavy: 'File too large (60 MB max)', tooLong: 'Sound too long (10 minutes max)',
      badAudio: 'Audio format not recognised', importing: 'IMPORTING SOUND…',
      pad: 'PAD', name: 'NAME', color: 'COLOUR', trigger: 'TRIGGER',
      loopOn: 'LOOP: ON', loopOff: 'LOOP: OFF', volume: 'VOLUME',
      crop: 'CROP', start: 'START', end: 'END', play: 'PLAY', pause: 'PAUSE',
      cropNote: 'Plays {0} s. Drag on the waveform to crop, − and + to fine-tune.',
      keepNote: ' Long sound: only the cropped part is kept when you close.',
      fadeIn: 'FADE IN', fadeOut: 'FADE OUT', none: 'NONE',
      change: 'CHANGE SOUND', move: 'MOVE PAD', clear: 'CLEAR PAD', padSec: 'PAD',
      askClear: 'Clear pad “{0}”?', doClear: 'CLEAR',
      page: 'PAGE', order: 'ORDER', left: '← LEFT', right: 'RIGHT →',
      del: 'DELETE', delPage: 'DELETE PAGE', keepOne: 'At least one page must remain',
      askDelPage: 'Delete page “{0}” and its sounds?', doDel: 'DELETE',
      transfer: 'MOVE TO ANOTHER PHONE', send: 'SEND CONFIG', saveFile: 'SAVE TO A FILE',
      exportCfg: 'EXPORT CONFIG', importCfg: 'IMPORT A CONFIG',
      transferNote: 'The .boucan file holds every page, every setting and every sound. On the other phone: MENU, then IMPORT A CONFIG.',
      fxList: 'EFFECTS ON THE FX BUTTON', fxNote: 'The FX button cycles through the ticked effects. The slider controls the one shown.',
      keepFx: 'At least one effect must remain',
      settings: 'SETTINGS', lang: 'LANGUAGE', vibOn: 'VIBRATE ON TOUCH: ON', vibOff: 'VIBRATE ON TOUCH: OFF',
      reset: 'RESET', resetBtn: 'RESTORE FACTORY SOUNDS',
      askReset: 'Erase every page and every imported sound, and restore the factory sounds?', doReset: 'RESET',
      about: 'Boucan {0}', credits: 'FACTORY SOUNDS',
      creditsNote: 'Free-licensed recordings from Wikimedia Commons:',
      preparing: 'PREPARING SOUNDS', makingFile: 'PREPARING FILE…', readingFile: 'READING FILE…',
      importingCfg: 'IMPORTING CONFIG…', downloaded: 'Config downloaded', imported: 'Config imported',
      exportFail: 'Export failed: ', importFail: 'Import failed: ', notBoucan: 'This file is not a Boucan config',
      askImport: 'Replace the whole current config with the one in this file?', doImport: 'REPLACE',
      saveFail: 'Could not save', noStore: 'Storage unavailable: nothing will be kept after closing',
      noAudio: 'Audio is not available on this device', bootFail: 'Startup error: ', error: 'Error: ',
      'n.saved': 'Config saved', 'n.saveFail': 'Could not save the file', 'n.noPicker': 'No app available to pick a file',
      'n.noShare': 'No app available to send the file', 'n.exportFail': 'Export failed (storage full?)'
    }
  };

  B.LANGS = [['fr', 'FRANÇAIS'], ['en', 'ENGLISH']];
  B.lang = /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
  B.t = function (key, arg) {
    var s = T[B.lang][key];
    if (s === undefined) s = T.fr[key] === undefined ? key : T.fr[key];
    return arg === undefined ? s : s.replace('{0}', arg);
  };
})(window.Boucan = window.Boucan || {});
