import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-white px-6 text-center">
      <Logo variant="icon" className="h-14 w-14" />
      <div>
        <p className="font-display text-6xl font-semibold text-gradient">404</p>
        <h1 className="mt-2 text-2xl font-semibold">This page doesn't exist</h1>
        <p className="mt-2 text-neutral-600">The link may be broken or the page may have moved.</p>
      </div>
      <Button asChild><Link to="/">Go home</Link></Button>
    </div>
  );
}
