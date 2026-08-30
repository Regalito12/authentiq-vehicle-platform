import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/min";

const preferredCountries = ["DO", "US", "CA", "PR", "MX", "ES", "CO", "PA", "VE", "AR", "CL", "CR", "GT", "HN", "NI", "SV", "PE", "BR", "GB"];
const countryNameOverrides = { DO: "República Dominicana", US: "Estados Unidos", PR: "Puerto Rico", GB: "Reino Unido" };
const displayNames = typeof Intl !== "undefined" && Intl.DisplayNames
  ? new Intl.DisplayNames(["es"], { type: "region" })
  : null;

function countryName(code) {
  return countryNameOverrides[code] || displayNames?.of(code) || code;
}

export function countryFlag(code) {
  return String(code || "").toUpperCase().replace(/./g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

export const PHONE_COUNTRIES = getCountries()
  .map((code) => ({ code, name: countryName(code), dialCode: `+${getCountryCallingCode(code)}`, flag: countryFlag(code) }))
  .sort((a, b) => {
    const aPriority = preferredCountries.indexOf(a.code);
    const bPriority = preferredCountries.indexOf(b.code);
    if (aPriority !== -1 || bPriority !== -1) return (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
    return a.name.localeCompare(b.name, "es");
  });

export const DEFAULT_PHONE_COUNTRY = "DO";

export function countryForPhone(value, fallback = DEFAULT_PHONE_COUNTRY) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed?.country && PHONE_COUNTRIES.some((country) => country.code === parsed.country)) return parsed.country;
  } catch { /* El campo todavía puede estar incompleto. */ }
  return fallback;
}

export function parsePhone(value, country = DEFAULT_PHONE_COUNTRY) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    return parsePhoneNumberFromString(raw, { defaultCountry: country, extract: false });
  } catch {
    return undefined;
  }
}

// Los números se guardan en E.164 cuando ya son posibles. Así un enlace de
// WhatsApp no depende de que alguien haya escrito espacios, paréntesis o +1.
export function normalizePhone(value, country = DEFAULT_PHONE_COUNTRY) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = parsePhone(raw, country);
  if (parsed?.isPossible()) return parsed.number;
  return raw;
}

export function formatPhoneForInput(value, country = DEFAULT_PHONE_COUNTRY) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = parsePhone(raw, country);
  if (parsed?.isPossible()) return parsed.formatNational();
  const formatter = new AsYouType(country);
  return formatter.input(raw);
}

export function formatPhoneInternational(value, country = DEFAULT_PHONE_COUNTRY) {
  const parsed = parsePhone(value, country);
  return parsed?.isPossible() ? parsed.formatInternational() : "";
}

export function whatsappDigits(value, fallbackCountry = DEFAULT_PHONE_COUNTRY) {
  const normalized = normalizePhone(value, countryForPhone(value, fallbackCountry));
  return normalized.replace(/\D/g, "");
}
