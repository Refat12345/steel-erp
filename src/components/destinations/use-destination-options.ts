"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";

export interface DestinationOption {
  id: number;
  name: string;
  details: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const optionCache = new Map<string, { data: DestinationOption[]; timestamp: number }>();

export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debouncedValue;
}

export function formatDestinationLabel(destination: DestinationOption) {
  return destination.details
    ? `${destination.name} - ${destination.details}`
    : destination.name;
}

export function useDestinationOptions(
  search: string,
  enabled: boolean,
  locale: Locale,
) {
  const t = useTranslations("trucks.destinationSelect");
  const [data, setData] = useState<DestinationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const normalizedSearch = search.trim();
    const cacheKey = `${locale}|${normalizedSearch.toLocaleLowerCase()}`;
    const cached = optionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      let cancelled = false;
      Promise.resolve().then(() => {
        if (cancelled) return;
        setData(cached.data);
        setLoading(false);
        setError(null);
      });
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });

    const params = new URLSearchParams();
    params.set("limit", "50");
    if (normalizedSearch) params.set("search", normalizedSearch);

    fetch(`/api/destinations?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || t("errorLoad"));
        const destinations = (json.data || []) as DestinationOption[];
        optionCache.set(cacheKey, {
          data: destinations,
          timestamp: Date.now(),
        });
        setData(destinations);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("errorLoad"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, search, locale, t]);

  return { data, loading, error };
}
