import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  useGetSession, 
  useFinalizeSession,
  getGetSessionQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Copy, Users, Receipt, CheckCircle2, Circle, Loader2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function HostLobby() {
  const params = useParams<{ code: string }>();
  const code = params.code!;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const finalizeSession = useFinalizeSession();

  const { data: session, isLoading, error } = useGetSession(code, {
    query: {
      enabled: !!code,
      queryKey: getGetSessionQueryKey(code)
    }
  });

  useSessionSocket(code);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "Link copied!",
      description: "Send this to your friends to join.",
    });
  };

  const handleFinalize = () => {
    const hostToken = localStorage.getItem(`slice_host_${code}`);
    if (!hostToken) {
      toast({ title: "Error", description: "Not authorized as host", variant: "destructive" });
      return;
    }

    finalizeSession.mutate({ code, data: { hostToken } }, {
      onSuccess: () => {
        setLocation(`/results/${code}`);
      },
      onError: (err) => {
        toast({ title: "Error finalizing", description: err.error, variant: "destructive" });
      }
    });
  };

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
        <p className="text-muted-foreground mb-6">This session might have been closed or doesn't exist.</p>
        <Button onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  const allSubmitted = session.participants.length > 0 && session.participants.every(p => p.submitted);
  const itemsClaimed = session.items.reduce((acc, item) => acc + item.claimedQuantity, 0);
  const itemsTotal = session.items.reduce((acc, item) => acc + item.quantity, 0);
  const percentClaimed = itemsTotal > 0 ? Math.round((itemsClaimed / itemsTotal) * 100) : 0;

  return (
    <div className="min-h-[100dvh] bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-sans">Lobby: {session.merchantName || "Dinner"}</h1>
            <p className="text-muted-foreground mt-1">Host: {session.hostName} • Payer: {session.payerName}</p>
          </div>
          <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-lg font-mono text-xl font-bold tracking-widest uppercase">
            {code}
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <h3 className="font-semibold text-lg">Invite Friends</h3>
              <p className="text-sm text-muted-foreground">Share this link or tell them to enter code <strong className="uppercase">{code}</strong></p>
            </div>
            <Button size="lg" onClick={handleCopyLink} className="w-full sm:w-auto shrink-0" data-testid="button-copy-link">
              <Copy className="w-4 h-4 mr-2" /> Copy Link
            </Button>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="flex flex-col h-[500px]">
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Users className="w-5 h-5 text-secondary" /> 
                  Participants ({session.participants.length})
                </CardTitle>
                {allSubmitted && session.participants.length > 0 && (
                  <Badge variant="secondary" className="bg-secondary text-secondary-foreground">Ready</Badge>
                )}
              </div>
            </CardHeader>
            <ScrollArea className="flex-1 p-0">
              <div className="p-6 space-y-4">
                {session.participants.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                    <Users className="w-8 h-8 mb-2 opacity-20" />
                    <p>Waiting for friends to join...</p>
                  </div>
                ) : (
                  session.participants.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-background border">
                      <span className="font-medium">{p.name}</span>
                      {p.submitted ? (
                        <Badge variant="default" className="bg-green-500 hover:bg-green-600 border-transparent text-white"><CheckCircle2 className="w-3 h-3 mr-1" /> Ready</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground"><Circle className="w-3 h-3 mr-1" /> Selecting...</Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </Card>

          <Card className="flex flex-col h-[500px]">
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Receipt className="w-5 h-5 text-accent" />
                  Receipt Items
                </CardTitle>
                <span className="text-sm font-medium text-muted-foreground">{percentClaimed}% claimed</span>
              </div>
            </CardHeader>
            <ScrollArea className="flex-1 p-0">
              <div className="p-6 space-y-4">
                {session.items.map(item => {
                  const isFullyClaimed = item.claimedQuantity >= item.quantity;
                  return (
                    <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg border ${isFullyClaimed ? 'bg-muted/50 border-muted opacity-60' : 'bg-background border-primary/20'}`}>
                      <div className="flex flex-col">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-xs text-muted-foreground">${item.unitPrice} each</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium">
                          {item.claimedQuantity} / {item.quantity}
                        </div>
                        {isFullyClaimed && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </Card>
        </div>

        <div className="flex justify-end pt-4">
          <Button 
            size="lg" 
            className="w-full md:w-auto h-14 px-8 text-lg" 
            onClick={handleFinalize}
            disabled={finalizeSession.isPending}
            data-testid="button-finalize-session"
          >
            {finalizeSession.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
            Calculate Totals <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}