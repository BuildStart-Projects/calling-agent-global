import { cn } from "@/lib/utils";

type Props = {
  variant?: "wordmark" | "icon";
  /** Force a background tone; defaults to following the current theme. */
  tone?: "light" | "dark" | "auto";
  className?: string;
};

export function Logo({ variant = "wordmark", tone = "auto", className }: Props) {
  if (variant === "icon") {
    return <img src="/brand/icon-192.png" alt="BuildStart" className={cn("h-8 w-8", className)} draggable={false} />;
  }
  if (tone === "light") {
    return <img src="/brand/wordmark-light.png" alt="BuildStart" className={cn("h-7 w-auto", className)} draggable={false} />;
  }
  if (tone === "dark") {
    return <img src="/brand/wordmark-dark.png" alt="BuildStart" className={cn("h-7 w-auto", className)} draggable={false} />;
  }
  return (
    <>
      <img src="/brand/wordmark-light.png" alt="BuildStart" className={cn("h-7 w-auto dark:hidden", className)} draggable={false} />
      <img src="/brand/wordmark-dark.png" alt="BuildStart" className={cn("hidden h-7 w-auto dark:block", className)} draggable={false} />
    </>
  );
}
