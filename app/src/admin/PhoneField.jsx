import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, countryForPhone, formatPhoneForInput, formatPhoneInternational, normalizePhone, parsePhone } from "../utils/phone.js";

export default function PhoneField({ label, value, onChange, defaultCountry = DEFAULT_PHONE_COUNTRY, hint, required = false }) {
  const fieldId = useId().replace(/:/g, "");
  const labelId = `${fieldId}-label`;
  const helpId = `${fieldId}-help`;
  const initialCountry = countryForPhone(value, defaultCountry);
  const [country, setCountry] = useState(initialCountry);
  const [inputValue, setInputValue] = useState(formatPhoneForInput(value, initialCountry));
  const lastValue = useRef(value || "");

  useEffect(() => {
    if ((value || "") === lastValue.current) return;
    const nextCountry = countryForPhone(value, defaultCountry);
    setCountry(nextCountry);
    setInputValue(formatPhoneForInput(value, nextCountry));
    lastValue.current = value || "";
  }, [value, defaultCountry]);

  const emit = (nextValue) => {
    lastValue.current = nextValue;
    onChange(nextValue);
  };

  const handleInput = (event) => {
    const nextValue = event.target.value;
    setInputValue(nextValue);
    emit(nextValue);
  };

  const handleCountryChange = (event) => {
    const nextCountry = event.target.value;
    const currentParsed = parsePhone(inputValue, country);
    const nationalNumber = currentParsed?.nationalNumber || inputValue.replace(/\D/g, "");
    const nextValue = nationalNumber ? normalizePhone(nationalNumber, nextCountry) : "";
    setCountry(nextCountry);
    setInputValue(formatPhoneForInput(nextValue, nextCountry));
    emit(nextValue);
  };

  const handleBlur = () => {
    const normalized = normalizePhone(inputValue, country);
    const international = formatPhoneInternational(normalized, country);
    if (international) {
      setInputValue(formatPhoneForInput(normalized, country));
      emit(normalized);
    }
  };

  const internationalPreview = formatPhoneInternational(inputValue, country);
  const selectedCountry = PHONE_COUNTRIES.find((item) => item.code === country);

  return (
    <div className="phone-field" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="phone-field-label">{label}{required ? " *" : ""}</span>
      <div className="phone-field-control">
        <label className="phone-country-select">
          <span className="visually-hidden">País de {label.toLowerCase()}</span>
          <select value={country} onChange={handleCountryChange} aria-label={`País de ${label.toLowerCase()}`} aria-describedby={helpId}>
            {PHONE_COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.flag} {item.name} ({item.dialCode})</option>)}
          </select>
          <span aria-hidden="true" title={selectedCountry ? `${selectedCountry.name} (${selectedCountry.dialCode})` : "Selecciona un país"}>{selectedCountry?.flag || "🌐"} {selectedCountry?.dialCode || "+"}</span>
        </label>
        <input type="tel" inputMode="tel" autoComplete="tel" value={inputValue} onChange={handleInput} onBlur={handleBlur} placeholder={selectedCountry?.code === "DO" ? "829 944 0111" : "Número de teléfono"} required={required} aria-labelledby={labelId} aria-describedby={helpId} />
      </div>
      {internationalPreview ? <small id={helpId} className="phone-field-preview" role="status" aria-live="polite">Se guardará como {internationalPreview}</small> : <small id={helpId} className="phone-field-hint">{hint || "Selecciona el país e introduce el número local."}</small>}
    </div>
  );
}
