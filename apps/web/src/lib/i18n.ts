"use client";

import { useConfig } from "@/lib/config/provider";

type Locale = "" | "en" | "de" | "fr" | "es" | "pt";

const STRINGS: Record<string, Record<Locale, string>> = {
  Search: { "": "Search", en: "Search", de: "Suche", fr: "Recherche", es: "Buscar", pt: "Buscar" },
  Downloads: { "": "Downloads", en: "Downloads", de: "Downloads", fr: "Téléchargements", es: "Descargas", pt: "Downloads" },
  Uploads: { "": "Uploads", en: "Uploads", de: "Uploads", fr: "Envois", es: "Subidas", pt: "Envios" },
  "Private Chat": { "": "Private Chat", en: "Private Chat", de: "Private Chat", fr: "Messages privés", es: "Chat privado", pt: "Chat privado" },
  "Browse Shares": { "": "Browse Shares", en: "Browse Shares", de: "Shares durchsuchen", fr: "Parcourir les partages", es: "Explorar compartidos", pt: "Navegar partilhas" },
  Files: { "": "Files", en: "Files", de: "Dateien", fr: "Fichiers", es: "Archivos", pt: "Ficheiros" },
  "User Profiles": { "": "User Profiles", en: "User Profiles", de: "Benutzerprofile", fr: "Profils", es: "Perfiles", pt: "Perfis" },
  Buddies: { "": "Buddies", en: "Buddies", de: "Buddies", fr: "Amis", es: "Amigos", pt: "Amigos" },
  "Chat Rooms": { "": "Chat Rooms", en: "Chat Rooms", de: "Chatrooms", fr: "Salons", es: "Salas de chat", pt: "Salas" },
  Interests: { "": "Interests", en: "Interests", de: "Interessen", fr: "Centres d’intérêt", es: "Intereses", pt: "Interesses" },
  Settings: { "": "Settings", en: "Settings", de: "Einstellungen", fr: "Paramètres", es: "Ajustes", pt: "Definições" },
  Diagnostics: { "": "Diagnostics", en: "Diagnostics", de: "Diagnose", fr: "Diagnostics", es: "Diagnóstico", pt: "Diagnóstico" },
  Statistics: { "": "Statistics", en: "Statistics", de: "Statistiken", fr: "Statistiques", es: "Estadísticas", pt: "Estatísticas" },
  "Secure Homelab Node": { "": "Secure Homelab Node", en: "Secure Homelab Node", de: "Sicherer Homelab-Knoten", fr: "Nœud homelab sécurisé", es: "Nodo homelab seguro", pt: "Nó homelab seguro" },
  "About": { "": "About", en: "About", de: "Über", fr: "À propos", es: "Acerca de", pt: "Sobre" },
  Logoff: { "": "Logoff", en: "Logoff", de: "Abmelden", fr: "Déconnexion", es: "Cerrar sesión", pt: "Terminar sessão" },
};

function resolveLocale(raw: string): Locale {
  if (raw === "" || raw === "en" || raw === "de" || raw === "fr" || raw === "es" || raw === "pt") return raw as Locale;
  // fallback: map navigator language prefix
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2).toLowerCase() : "en";
  if (nav === "de" || nav === "fr" || nav === "es" || nav === "pt") return nav as Locale;
  return "en";
}

export function useI18n() {
  const { settings } = useConfig();
  const raw = settings.ui.language as string ?? "";
  const locale = resolveLocale(raw);
  const t = (key: string) => {
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[locale] ?? entry.en ?? key;
  };
  return { t, locale, raw };
}

export function translate(key: string, localeRaw: string): string {
  const locale = resolveLocale(localeRaw);
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en ?? key;
}
