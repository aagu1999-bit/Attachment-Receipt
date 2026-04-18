import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { FileQuestion, Home } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 text-center">
      <div className="w-20 h-20 bg-muted rounded-2xl flex items-center justify-center mb-6 text-muted-foreground rotate-3">
        <FileQuestion className="w-10 h-10" />
      </div>
      <h1 className="text-4xl font-bold font-sans tracking-tight mb-2">404</h1>
      <p className="text-xl text-muted-foreground mb-8 max-w-md">
        We couldn't find the page you're looking for. The dinner party might have moved elsewhere.
      </p>
      <Button size="lg" onClick={() => setLocation("/")} className="gap-2">
        <Home className="w-4 h-4" /> Return Home
      </Button>
    </div>
  );
}
