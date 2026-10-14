// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// feature names, connection status, errors, the reports of the configuration
// actions. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './bond/client.js';
import { FEATURES } from './bond/model.js';

export const LANGUAGE_FALLBACK = 'en';

/** The text of a multi-language object in one language (English if missing). */
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** Build a multi-language object from one function of the language. */
export const inEveryLanguage = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

// Feature names, in the language chosen in the configuration. They are frozen
// at creation in Gladys: renaming them here only changes new devices.
export const NAMES = {
  en: {
    [FEATURES.POWER]: 'Power',
    [FEATURES.SPEED]: 'Speed',
    [FEATURES.DIRECTION]: 'Direction',
    [FEATURES.BREEZE]: 'Breeze mode',
    [FEATURES.LIGHT]: 'Light',
    [FEATURES.BRIGHTNESS]: 'Brightness',
    [FEATURES.COLOR_TEMP]: 'Color temperature',
    [FEATURES.UP_LIGHT]: 'Up light',
    [FEATURES.DOWN_LIGHT]: 'Down light',
    [FEATURES.COVER]: 'Open / close',
    [FEATURES.POSITION]: 'Position',
    [FEATURES.FLAME]: 'Flame',
  },
  fr: {
    [FEATURES.POWER]: 'Marche / arrêt',
    [FEATURES.SPEED]: 'Vitesse',
    [FEATURES.DIRECTION]: 'Sens de rotation',
    [FEATURES.BREEZE]: 'Mode brise',
    [FEATURES.LIGHT]: 'Lumière',
    [FEATURES.BRIGHTNESS]: 'Luminosité',
    [FEATURES.COLOR_TEMP]: 'Température de couleur',
    [FEATURES.UP_LIGHT]: 'Lumière haute',
    [FEATURES.DOWN_LIGHT]: 'Lumière basse',
    [FEATURES.COVER]: 'Ouverture / fermeture',
    [FEATURES.POSITION]: 'Position',
    [FEATURES.FLAME]: 'Flamme',
  },
  de: {
    [FEATURES.POWER]: 'Ein / Aus',
    [FEATURES.SPEED]: 'Geschwindigkeit',
    [FEATURES.DIRECTION]: 'Drehrichtung',
    [FEATURES.BREEZE]: 'Brise-Modus',
    [FEATURES.LIGHT]: 'Licht',
    [FEATURES.BRIGHTNESS]: 'Helligkeit',
    [FEATURES.COLOR_TEMP]: 'Farbtemperatur',
    [FEATURES.UP_LIGHT]: 'Oberes Licht',
    [FEATURES.DOWN_LIGHT]: 'Unteres Licht',
    [FEATURES.COVER]: 'Öffnen / Schließen',
    [FEATURES.POSITION]: 'Position',
    [FEATURES.FLAME]: 'Flamme',
  },
  es: {
    [FEATURES.POWER]: 'Encendido / apagado',
    [FEATURES.SPEED]: 'Velocidad',
    [FEATURES.DIRECTION]: 'Sentido de giro',
    [FEATURES.BREEZE]: 'Modo brisa',
    [FEATURES.LIGHT]: 'Luz',
    [FEATURES.BRIGHTNESS]: 'Brillo',
    [FEATURES.COLOR_TEMP]: 'Temperatura de color',
    [FEATURES.UP_LIGHT]: 'Luz superior',
    [FEATURES.DOWN_LIGHT]: 'Luz inferior',
    [FEATURES.COVER]: 'Apertura / cierre',
    [FEATURES.POSITION]: 'Posición',
    [FEATURES.FLAME]: 'Llama',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noBridge: {
    en: 'Enter the IP address and the local token of your Bond bridge in the configuration.',
    fr: "Saisissez l'adresse IP et le jeton local de votre bridge Bond dans la configuration.",
    de: 'Gib die IP-Adresse und den lokalen Token deiner Bond Bridge in der Konfiguration ein.',
    es: 'Introduzca la dirección IP y el token local de su Bond Bridge en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.20',
    fr: 'Adresse incomprise, ex. 192.168.1.20',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20',
    es: 'Dirección no válida, p. ej. 192.168.1.20',
  },
};

// One short explanation per error kind (src/bond/client.js), plus the
// missing token, which is no error of the bridge.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'local token refused',
    fr: 'jeton local refusé',
    de: 'lokaler Token abgelehnt',
    es: 'token local rechazado',
  },
  [ERROR_KINDS.NOT_BOND]: {
    en: 'no Bond bridge at this address',
    fr: 'aucun bridge Bond à cette adresse',
    de: 'keine Bond Bridge unter dieser Adresse',
    es: 'no hay ningún Bond Bridge en esta dirección',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  no_token: {
    en: 'local token missing: use "Get the local token"',
    fr: 'jeton local manquant : utilisez « Récupérer le jeton local »',
    de: 'lokaler Token fehlt: Verwende „Lokalen Token abrufen“',
    es: 'falta el token local: use «Obtener el token local»',
  },
};

// The "Test the connection" report, one line per bridge.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    devices: (count) => `${count} device(s) for Gladys`,
    skipped: (count) => `${count} not supported or hidden`,
    push: 'live updates on',
    noPush: 'no live updates, read every 30 s',
  },
  fr: {
    ok: 'OK',
    devices: (count) => `${count} appareil(s) pour Gladys`,
    skipped: (count) => `${count} non pris en charge ou masqué(s)`,
    push: 'mises à jour en direct actives',
    noPush: 'pas de mise à jour en direct, lecture toutes les 30 s',
  },
  de: {
    ok: 'OK',
    devices: (count) => `${count} Gerät(e) für Gladys`,
    skipped: (count) => `${count} nicht unterstützt oder ausgeblendet`,
    push: 'Live-Updates aktiv',
    noPush: 'keine Live-Updates, Abfrage alle 30 s',
  },
  es: {
    ok: 'OK',
    devices: (count) => `${count} dispositivo(s) para Gladys`,
    skipped: (count) => `${count} no compatible(s) u oculto(s)`,
    push: 'actualizaciones en directo activas',
    noPush: 'sin actualizaciones en directo, lectura cada 30 s',
  },
};

// The "Get the local token" report, one line per bridge.
export const TOKEN_TEXT = {
  en: {
    saved: 'token saved',
    working: 'the saved token works',
    locked:
      'locked: unplug the bridge, plug it back, then press this button within 10 minutes (or copy the token from the Bond app)',
  },
  fr: {
    saved: 'jeton enregistré',
    working: 'le jeton enregistré fonctionne',
    locked:
      "verrouillé : débranchez le bridge, rebranchez-le, puis appuyez sur ce bouton dans les 10 minutes (ou copiez le jeton depuis l'application Bond)",
  },
  de: {
    saved: 'Token gespeichert',
    working: 'der gespeicherte Token funktioniert',
    locked:
      'gesperrt: Zieh den Stecker der Bridge, steck ihn wieder ein und drück diesen Knopf innerhalb von 10 Minuten (oder kopiere den Token aus der Bond-App)',
  },
  es: {
    saved: 'token guardado',
    working: 'el token guardado funciona',
    locked:
      'bloqueado: desenchufe el bridge, vuelva a enchufarlo y pulse este botón en los 10 minutos siguientes (o copie el token desde la aplicación Bond)',
  },
};

// The "Find the bridges" report.
export const FIND_TEXT = {
  en: {
    none: 'No Bond bridge answered on the network. Enter its IP address by hand.',
    found: (count) => `${count} Bond bridge(s) found:`,
    configured: 'already configured',
    added: (slot) => `added as bridge ${slot}`,
    noSlot: 'no free slot left',
    next: 'Then press "Get the local token".',
  },
  fr: {
    none: "Aucun bridge Bond n'a répondu sur le réseau. Saisissez son adresse IP à la main.",
    found: (count) => `${count} bridge(s) Bond trouvé(s) :`,
    configured: 'déjà configuré',
    added: (slot) => `ajouté comme bridge ${slot}`,
    noSlot: 'plus de place libre',
    next: 'Appuyez ensuite sur « Récupérer le jeton local ».',
  },
  de: {
    none: 'Keine Bond Bridge hat im Netzwerk geantwortet. Gib ihre IP-Adresse von Hand ein.',
    found: (count) => `${count} Bond Bridge(s) gefunden:`,
    configured: 'bereits konfiguriert',
    added: (slot) => `als Bridge ${slot} hinzugefügt`,
    noSlot: 'kein freier Platz mehr',
    next: 'Drück dann auf „Lokalen Token abrufen“.',
  },
  es: {
    none: 'Ningún Bond Bridge ha respondido en la red. Introduzca su dirección IP a mano.',
    found: (count) => `${count} Bond Bridge(s) encontrado(s):`,
    configured: 'ya configurado',
    added: (slot) => `añadido como bridge ${slot}`,
    noSlot: 'no queda ningún hueco libre',
    next: 'Pulse después «Obtener el token local».',
  },
};

// Errors and confirmations of the commands (device features, widget,
// "tell state" action and scene action).
export const ACTION_TEXT = {
  noBridge: {
    en: 'No Bond bridge is configured.',
    fr: "Aucun bridge Bond n'est configuré.",
    de: 'Keine Bond Bridge ist konfiguriert.',
    es: 'No hay ningún Bond Bridge configurado.',
  },
  unknownDevice: {
    en: 'This device is not on a configured Bond bridge.',
    fr: "Cet appareil n'est sur aucun bridge Bond configuré.",
    de: 'Dieses Gerät ist auf keiner konfigurierten Bond Bridge.',
    es: 'Este dispositivo no está en ningún Bond Bridge configurado.',
  },
  unsupported: {
    en: 'This device does not support that.',
    fr: 'Cet appareil ne le permet pas.',
    de: 'Dieses Gerät unterstützt das nicht.',
    es: 'Este dispositivo no lo permite.',
  },
  readOnly: {
    en: 'Fireplaces are read-only in Gladys.',
    fr: 'Les foyers sont en lecture seule dans Gladys.',
    de: 'Kamine sind in Gladys schreibgeschützt.',
    es: 'Las chimeneas son de solo lectura en Gladys.',
  },
  stateTold: {
    en: 'State corrected, no signal sent.',
    fr: 'État corrigé, aucun signal envoyé.',
    de: 'Zustand korrigiert, kein Signal gesendet.',
    es: 'Estado corregido, no se ha enviado ninguna señal.',
  },
};

/** The message of a command error, in every language. */
export function commandErrorText(code) {
  if (code === 'read_only') {
    return ACTION_TEXT.readOnly;
  }
  return ACTION_TEXT.unsupported;
}
