import { Logo } from "@/components/brand/Logo";

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-4">
        <Logo variant="icon" className="h-12 w-12 animate-float" />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-[shimmer_1.1s_ease-in-out_infinite] rounded-full bg-brand-gradient" />
        </div>
      </div>
    </div>
  );
}
