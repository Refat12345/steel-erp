"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type DestinationOption,
  formatDestinationLabel,
  useDebouncedValue,
  useDestinationOptions,
} from "./use-destination-options";

interface DestinationSelectProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  disabled?: boolean;
}

export function DestinationSelect({
  value,
  onValueChange,
  disabled = false,
}: DestinationSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedOption, setSelectedOption] = useState<DestinationOption | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: options, loading, error } = useDestinationOptions(debouncedSearch, open);

  const selectedDestination = useMemo(() => {
    if (value == null) return null;
    return selectedOption?.id === value
      ? selectedOption
      : options.find((destination) => destination.id === value) ?? null;
  }, [options, selectedOption, value]);

  const selectedLabel = selectedDestination
    ? formatDestinationLabel(selectedDestination)
    : "اختر الوجهة (اختياري)";

  return (
    <div className="flex min-w-0 gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-8 min-w-0 flex-1 items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            !selectedDestination && "text-muted-foreground",
          )}
          aria-label="اختيار الوجهة"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="ابحث باسم الوجهة..."
            />
            <CommandList>
              {loading && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري تحميل الوجهات...
                </div>
              )}
              {!loading && error && (
                <div className="px-3 py-3 text-sm text-destructive">{error}</div>
              )}
              {!loading && !error && options.length === 0 && (
                <CommandEmpty>لا توجد نتائج</CommandEmpty>
              )}
              {!error && options.length > 0 && (
                <CommandGroup>
                  {options.map((destination) => (
                    <CommandItem
                      key={destination.id}
                      value={formatDestinationLabel(destination)}
                      onSelect={() => {
                        setSelectedOption(destination);
                        onValueChange(destination.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "me-2 h-4 w-4",
                          value === destination.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {destination.name}
                      </span>
                      {destination.details && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {destination.details}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value != null && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            setSearch("");
            setSelectedOption(null);
            onValueChange(null);
          }}
          disabled={disabled}
          aria-label="مسح الوجهة"
          className="shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
