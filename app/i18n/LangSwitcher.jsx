"use client";

import { useState } from "react";
import { LOCALES, useLocale } from "./LocaleProvider";
import { IconGlobe } from "../ui/Icons";

export default function LangSwitcher() {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className={`lang-switcher ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="lang-switcher__toggle"
        aria-label={t("lang.label")}
        data-tip={t("lang.label")}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe size={22} />
      </button>
      {open ? (
        <div className="lang-switcher__menu" role="menu">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              className={l.id === locale ? "is-active" : ""}
              onClick={() => {
                setLocale(l.id);
                setOpen(false);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
