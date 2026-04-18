import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Users, Receipt, ArrowRight } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

const joinSchema = z.object({
  code: z.string().min(1, "Code is required").toUpperCase(),
});

export default function Home() {
  const [, setLocation] = useLocation();
  useHealthCheck();

  const form = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: {
      code: "",
    },
  });

  function onSubmit(values: z.infer<typeof joinSchema>) {
    setLocation(`/join/${values.code}`);
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden bg-background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
      
      <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8 md:gap-16 items-center z-10">
        <div className="flex flex-col gap-6 text-center md:text-left">
          <div className="inline-flex items-center gap-2 justify-center md:justify-start">
            <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center rotate-3 shadow-lg">
              <PieChart className="w-6 h-6" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground font-sans">
              Slice
            </h1>
          </div>
          
          <p className="text-xl text-muted-foreground font-mono leading-relaxed max-w-md mx-auto md:mx-0">
            The collaborative bill-splitting app that doesn't make you do math.
          </p>
          
          <div className="flex flex-col gap-4 mt-4">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Receipt className="w-5 h-5 text-primary" />
              <span>Scan your receipt</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <Users className="w-5 h-5 text-secondary" />
              <span>Friends pick their items</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <PieChart className="w-5 h-5 text-accent" />
              <span>Everyone pays their exact share</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 w-full max-w-sm mx-auto">
          <Card className="border-primary/20 shadow-xl shadow-primary/5">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-2xl">Host a Dinner</CardTitle>
              <CardDescription>You paid the bill and have the receipt.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                size="lg" 
                className="w-full text-lg h-14" 
                onClick={() => setLocation("/host")}
                data-testid="button-start-splitting"
              >
                Start splitting <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </CardContent>
          </Card>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground font-mono tracking-wider">Or</span>
            </div>
          </div>

          <Card className="border-secondary/20 shadow-xl shadow-secondary/5 bg-secondary/5">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-xl">Join a Session</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="sr-only">Session Code</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Enter 6-letter code" 
                            className="text-center text-xl tracking-widest uppercase h-14 bg-background font-mono" 
                            {...field} 
                            data-testid="input-join-code"
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    variant="secondary" 
                    className="w-full h-12"
                    data-testid="button-join-session"
                  >
                    Join Session
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}