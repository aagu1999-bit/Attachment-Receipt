import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
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
import { useJoinSession, useGetSession, getGetSessionQueryKey, useGetParticipant, getGetParticipantQueryKey, ApiError } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Loader2, ArrowRight, AlertCircle } from "lucide-react";

const joinSchema = z.object({
  name: z.string().min(1, "Your name is required"),
});

export default function Join() {
  const params = useParams<{ code: string }>();
  const code = params.code!.toUpperCase();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const joinSession = useJoinSession();

  const storedParticipantId = localStorage.getItem(`slice_participant_${code}`);
  const storedToken = localStorage.getItem(`slice_token_${code}`);
  const storedParticipantIdNum = storedParticipantId ? parseInt(storedParticipantId, 10) : null;

  const [rejoinError, setRejoinError] = useState<string | null>(null);

  const { data: session, isLoading, error } = useGetSession(code, {
    query: {
      enabled: !!code,
      queryKey: getGetSessionQueryKey(code)
    }
  });

  const hasStoredCredentials = !!storedParticipantIdNum && !!storedToken;

  const rejoinParams = { participantToken: storedToken ?? "" };
  const { data: existingParticipant, isLoading: isValidatingRejoin, isError: isRejoinError, error: rejoinQueryError } = useGetParticipant(
    code,
    storedParticipantIdNum ?? 0,
    rejoinParams,
    {
      query: {
        enabled: hasStoredCredentials && !!session,
        retry: false,
        queryKey: getGetParticipantQueryKey(code, storedParticipantIdNum ?? 0, rejoinParams),
      }
    }
  );

  useEffect(() => {
    if (!hasStoredCredentials) return;
    if (!existingParticipant) return;

    if (session?.status === "open") {
      setLocation(`/select/${code}`);
    }
  }, [existingParticipant, session, code, setLocation, hasStoredCredentials]);

  useEffect(() => {
    if (!hasStoredCredentials) return;
    if (!isRejoinError) return;

    const status = rejoinQueryError instanceof ApiError ? rejoinQueryError.status : undefined;
    if (status === 403 || status === 404) {
      localStorage.removeItem(`slice_participant_${code}`);
      localStorage.removeItem(`slice_token_${code}`);
      setRejoinError("Your previous session could not be found. Please enter your name to join again.");
    }
  }, [isRejoinError, rejoinQueryError, code, hasStoredCredentials]);

  useSessionSocket(code, (event) => {
    if (event === "session:started") {
      const participantId = localStorage.getItem(`slice_participant_${code}`);
      if (participantId) {
        setLocation(`/select/${code}`);
      }
    }
  });

  const form = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: {
      name: "",
    },
  });

  function onSubmit(values: z.infer<typeof joinSchema>) {
    joinSession.mutate({ code, data: values }, {
      onSuccess: (data) => {
        localStorage.setItem(`slice_participant_${code}`, data.id.toString());
        localStorage.setItem(`slice_token_${code}`, data.participantToken);
        if (session?.status === "open") {
          setLocation(`/select/${code}`);
        } else {
          toast({ title: "Joined!", description: "Waiting for host to start the session..." });
        }
      },
      onError: (err) => {
        toast({ title: "Error joining", description: err.message, variant: "destructive" });
      }
    });
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h2 className="text-2xl font-bold mb-2">Session not found</h2>
        <p className="text-muted-foreground mb-6">Check the code and try again.</p>
        <Button onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  if (session.status === "finalized" || session.status === "closed") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h2 className="text-2xl font-bold mb-2">This session has ended</h2>
        <p className="text-muted-foreground mb-6">
          {session.merchantName ? `The bill for ${session.merchantName}` : "This bill"} has already been split.
        </p>
        <Button onClick={() => setLocation(`/results/${code}`)}>View Results</Button>
      </div>
    );
  }

  const isVerifiedParticipant = hasStoredCredentials && !!existingParticipant && !isRejoinError;

  if (isValidatingRejoin && hasStoredCredentials) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-secondary/10 via-background to-background pointer-events-none" />
      
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-sans mb-2">{session.merchantName || "Dinner"}</h1>
          <p className="text-muted-foreground">Hosted by {session.hostName}</p>
        </div>

        <Card className="border-secondary/20 shadow-xl shadow-secondary/5">
          <CardHeader>
            <CardTitle>Join Session</CardTitle>
            <CardDescription>Enter your name to claim your items.</CardDescription>
          </CardHeader>
          <CardContent>
            {rejoinError && (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{rejoinError}</span>
              </div>
            )}

            {isVerifiedParticipant && session.status === "pending" ? (
              <div className="text-center py-6 flex flex-col items-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary mb-4 opacity-50" />
                <p className="text-lg font-medium">Waiting for host...</p>
                <p className="text-sm text-muted-foreground mt-2">The host is reviewing the receipt.</p>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Charlie" className="h-12" {...field} data-testid="input-participant-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    className="w-full h-12" 
                    disabled={joinSession.isPending}
                    data-testid="button-join-submit"
                  >
                    {joinSession.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Join <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
