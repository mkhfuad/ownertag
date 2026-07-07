/* Content moderation pipeline — fail closed. Order per design doc §4.2:
   1. structural strip (URLs, phones, emails, markup) — kills phishing
   2. lexicon (DE/EN/TR) — §185 StGB makes this legal hygiene in Germany
   3. LLM moderation — hook left for a hosted moderation API (free text only)
*/

const URL_RE = /(?:https?:\/\/|www\.)\S+|[a-z0-9-]+\.(?:de|com|net|org|io|app|me|ru|cn|info|xyz)\/?\S*/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE_RE = /(?:\+|00)?[\d\s\-()\/]{7,}\d/g;
const MARKUP_RE = /<[^>]*>/g;

/* Seed lexicon — deliberately small; extend from a maintained list
   (e.g. shutterstock/List-of-Dirty-Naughty-Obscene-Words) at deploy. */
const LEXICON = [
  // de
  'arschloch', 'fotze', 'hurensohn', 'wichser', 'missgeburt', 'schlampe',
  // en
  'fuck you', 'cunt', 'bitch', 'asshole', 'faggot',
  // tr
  'orospu', 'siktir', 'amk', 'piç',
  // threats (de/en)
  'ich bring dich um', 'ich töte dich', 'kill you', 'du bist tot',
];

export const TEMPLATES = {
  blocked:   { de: 'Ihr Fahrzeug wird zugeparkt / blockiert jemanden.', en: 'Your vehicle is blocked in / blocking someone.' },
  lights:    { de: 'Ihre Lichter sind noch an.',                        en: 'Your lights are still on.' },
  alarm:     { de: 'Ihre Alarmanlage läutet.',                          en: 'Your alarm is ringing.' },
  window:    { de: 'Ein Fenster ist offen.',                            en: 'A window is open.' },
  damage:    { de: 'Ein kleiner Schaden wurde bemerkt.',                en: 'Minor damage was noticed.' },
  towing:    { de: 'Ihr Fahrzeug wird abgeschleppt.',                   en: 'Your vehicle is being towed.' },
  emergency: { de: 'Notfall — bitte kommen Sie sofort.',                en: 'Emergency — please come now.' },
};

export function moderateFreeText(text) {
  if (!text) return { ok: true, clean: '' };
  let clean = String(text).slice(0, 200)
    .replace(MARKUP_RE, '')
    .replace(URL_RE, '[link entfernt]')
    .replace(EMAIL_RE, '[entfernt]')
    .replace(PHONE_RE, '[entfernt]')
    .trim();
  const lower = clean.toLowerCase();
  if (LEXICON.some(w => lower.includes(w))) return { ok: false, clean: null };
  // ponytail: LLM moderation hook goes here (free text only, templates bypass);
  // add when lexicon misses start showing up in abuse reports.
  return { ok: true, clean };
}
