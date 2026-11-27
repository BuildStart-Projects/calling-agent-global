// Searchable ISO 4217 currency picker (all currencies the browser knows, common ones first).
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const COMMON = ["USD", "EUR", "GBP", "LKR", "INR", "AUD", "CAD", "AED", "SGD", "MYR", "NZD", "ZAR", "SAR", "QAR", "PKR", "BDT", "NGN", "KES", "PHP", "IDR", "THB", "JPY"];

type Currency = { code: string; name: string; symbol: string };

function currencyList(): Currency[] {
  let codes: string[] = COMMON;
  try { codes = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("currency"); } catch { /* older browsers: common list */ }
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  const symbol = (c: string) => {
    try { return new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? c; }
    catch { return c; }
  };
  const list = codes.map((code) => ({ code, name: names.of(code) ?? code, symbol: symbol(code) }));
  const rank = (c: string) => { const i = COMMON.indexOf(c); return i === -1 ? 999 : i; };
  return list.sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name));
}

export function CurrencySelect({ value, onChange, disabled, className, size = "default" }: {
  value?: string | null; onChange: (code: string) => void; disabled?: boolean; className?: string; size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const list = useMemo(currencyList, []);
  const current = list.find((c) => c.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="Currency" disabled={disabled}
          className={cn("w-full justify-between font-normal", size === "sm" ? "h-9" : "h-10", className)}>
          {current ? <span className="truncate">{current.code} <span className="text-muted-foreground">· {current.name}</span></span> : <span className="text-muted-foreground">Choose currency</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currency or code…" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {list.map((c) => (
                <CommandItem key={c.code} value={`${c.code} ${c.name} ${c.symbol}`} onSelect={() => { onChange(c.code); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="w-10 font-medium tabular">{c.code}</span>
                  <span className="truncate text-muted-foreground">{c.name}{c.symbol !== c.code ? ` (${c.symbol})` : ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
