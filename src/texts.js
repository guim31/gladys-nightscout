// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs
// and errors. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './nightscout/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Nightscout site in the configuration.',
    fr: "Saisissez l'adresse de votre site Nightscout dans la configuration.",
    de: 'Gib die Adresse deiner Nightscout-Seite in der Konfiguration ein.',
    es: 'Introduzca la dirección de su sitio Nightscout en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://my-site.example.org',
    fr: 'Adresse incomprise, ex. https://mon-site.example.org',
    de: 'Adresse nicht verstanden, z. B. https://meine-seite.example.org',
    es: 'Dirección no válida, p. ej. https://mi-sitio.example.org',
  },
};

// One short explanation per error kind (src/nightscout/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Nightscout does not answer',
    fr: 'Nightscout ne répond pas',
    de: 'Nightscout antwortet nicht',
    es: 'Nightscout no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'Certificate refused: use a trusted certificate or an http:// address',
    fr: 'Certificat refusé : utilisez un certificat reconnu ou une adresse http://',
    de: 'Zertifikat abgelehnt: Nutze ein vertrauenswürdiges Zertifikat oder eine http://-Adresse',
    es: 'Certificado rechazado: use un certificado reconocido o una dirección http://',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Access refused: check the access token or the API_SECRET',
    fr: "Accès refusé : vérifiez le jeton d'accès ou l'API_SECRET",
    de: 'Zugriff verweigert: Prüfe das Zugriffstoken oder das API_SECRET',
    es: 'Acceso denegado: compruebe el token de acceso o el API_SECRET',
  },
  [ERROR_KINDS.NOT_NIGHTSCOUT]: {
    en: 'No Nightscout at this address',
    fr: 'Aucun Nightscout à cette adresse',
    de: 'Kein Nightscout unter dieser Adresse',
    es: 'No hay ningún Nightscout en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'The address redirects: enter the https:// address',
    fr: "L'adresse redirige : saisissez l'adresse en https://",
    de: 'Die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'La dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'Nightscout answers with an error: check its database (MongoDB)',
    fr: 'Nightscout répond en erreur : vérifiez sa base de données (MongoDB)',
    de: 'Nightscout antwortet mit einem Fehler: Prüfe seine Datenbank (MongoDB)',
    es: 'Nightscout responde con un error: compruebe su base de datos (MongoDB)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Unexpected answer, see the logs',
    fr: 'Réponse inattendue, voir les logs',
    de: 'Unerwartete Antwort, sieh in den Protokollen nach',
    es: 'Respuesta inesperada, consulte los registros',
  },
};

// The state of the data, beside the connection (widget, report, actions).
export const DATA_TEXT = {
  none: {
    en: 'Nightscout has no glucose value yet.',
    fr: "Nightscout n'a encore aucune glycémie.",
    de: 'Nightscout hat noch keinen Glukosewert.',
    es: 'Nightscout aún no tiene ningún valor de glucosa.',
  },
  stale: {
    en: 'No current value: check the sensor, the phone and the uploader app.',
    fr: "Pas de valeur à jour : vérifiez le capteur, le téléphone et l'application d'envoi.",
    de: 'Kein aktueller Wert: Prüfe den Sensor, das Telefon und die Uploader-App.',
    es: 'Ningún valor actual: compruebe el sensor, el teléfono y la aplicación de envío.',
  },
  notMedical: {
    en: 'Not a medical device',
    fr: 'Pas un dispositif médical',
    de: 'Kein Medizinprodukt',
    es: 'No es un dispositivo médico',
  },
};

// A duration in minutes, in hours past two hours, in days past two days.
export const AGE_TEXT = {
  en: { minutes: (n) => `${n} min`, hours: (n) => `${n} h`, days: (n) => `${n} days` },
  fr: { minutes: (n) => `${n} min`, hours: (n) => `${n} h`, days: (n) => `${n} jours` },
  de: { minutes: (n) => `${n} Min.`, hours: (n) => `${n} Std.`, days: (n) => `${n} Tagen` },
  es: { minutes: (n) => `${n} min`, hours: (n) => `${n} h`, days: (n) => `${n} días` },
};

/** "4 min", "3 h", "3 days" (German in the dative: "vor 3 Tagen"). */
export function ageText(minutes, language) {
  const text = AGE_TEXT[language] ?? AGE_TEXT.en;
  if (minutes >= 48 * 60) {
    return text.days(Math.floor(minutes / 1440));
  }
  return minutes >= 120 ? text.hours(Math.floor(minutes / 60)) : text.minutes(minutes);
}

// "Glucose 142 mg/dL →, +3, 4 min ago": the `sentence` of the scene action
// and the report.
export const SENTENCE_TEXT = {
  en: {
    current: (glucose, trend, ago) => `Glucose ${glucose} ${trend}, ${ago} ago`,
    stale: (glucose, ago) => `Last glucose ${glucose}, ${ago} ago (not current)`,
  },
  fr: {
    current: (glucose, trend, ago) => `Glycémie ${glucose} ${trend}, il y a ${ago}`,
    stale: (glucose, ago) => `Dernière glycémie ${glucose}, il y a ${ago} (pas à jour)`,
  },
  de: {
    current: (glucose, trend, ago) => `Glukose ${glucose} ${trend}, vor ${ago}`,
    stale: (glucose, ago) => `Letzte Glukose ${glucose}, vor ${ago} (nicht aktuell)`,
  },
  es: {
    current: (glucose, trend, ago) => `Glucosa ${glucose} ${trend}, hace ${ago}`,
    stale: (glucose, ago) => `Última glucosa ${glucose}, hace ${ago} (no actual)`,
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: { ok: 'Connected', thresholds: (low, high) => `target ${low}–${high}` },
  fr: { ok: 'Connecté', thresholds: (low, high) => `cible ${low}–${high}` },
  de: { ok: 'Verbunden', thresholds: (low, high) => `Zielbereich ${low}–${high}` },
  es: { ok: 'Conectado', thresholds: (low, high) => `objetivo ${low}–${high}` },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
