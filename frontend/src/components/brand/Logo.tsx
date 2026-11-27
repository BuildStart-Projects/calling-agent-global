import { cn } from "@/lib/utils";

type Props = {
  variant?: "wordmark" | "icon";
  /** Force a background tone; defaults to following the current theme. */
  tone?: "light" | "dark" | "auto";
  className?: string;
  /** Use the tightly cropped wordmark (no transparent margin) so it can be sized precisely. */
  tight?: boolean;
};

export function Logo({ variant = "wordmark", tone = "auto", className, tight = false }: Props) {
  const src = (t: "light" | "dark") => `/brand/wordmark-${t}${tight ? "-tight" : ""}.png`;
  if (variant === "icon") {
    return <img src="/brand/icon-192.png" alt="BuildStart" className={cn("h-8 w-8", className)} draggable={false} />;
  }
  if (tone === "light") {
    return <img src={src("light")} alt="BuildStart" className={cn("h-7 w-auto", className)} draggable={false} />;
  }
  if (tone === "dark") {
    return <img src={src("dark")} alt="BuildStart" className={cn("h-7 w-auto", className)} draggable={false} />;
  }
  return (
    <>
      <img src={src("light")} alt="BuildStart" className={cn("h-7 w-auto dark:hidden", className)} draggable={false} />
      <img src={src("dark")} alt="BuildStart" className={cn("hidden h-7 w-auto dark:block", className)} draggable={false} />
    </>
  );
}
