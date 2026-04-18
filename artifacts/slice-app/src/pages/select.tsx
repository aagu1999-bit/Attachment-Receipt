import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  useGetSession, 
  useGetParticipants,
  useUpdateSelections,
  useSubmitParticipant,
  getGetSessionQueryKey,
  getGetParticipantsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Loader2, Plus, Minus, CheckCircle2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";

export default function Select() {
  const params = useParams<{ code: string }>();
  const code = params.code!;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSelections = useUpdateSelections();
  const submitParticipant = useSubmitParticipant();
  
  const participantIdStr = localStorage.getItem(`slice_participant_${code}`);
  const participantId = participantIdStr ? parseInt(participantIdStr, 10) : null;

  // Local selections state
  const [selections, setSelections] = useState<Record<number, number>>({});
  const initRef = useRef(false);

  const { data: session, isLoading, error } = useGetSession(code, {
    query: {
      enabled: !!code && !!participantId,
      queryKey: getGetSessionQueryKey(code)
    }
  });

  const { data: participantsList } = useGetParticipants(code, {
    query: {
      enabled: !!code && !!participantId,
      queryKey: getGetParticipantsQueryKey(code)
    }
  });

  useSessionSocket(code, (event) => {
    if (event === "session:finalized") {
      setLocation(`/results/${code}`);
    }
  });

  // Redirect if not joined or session finalized
  useEffect(() => {
    if (!participantId) {
      setLocation(`/join/${code}`);
    }
    if (session?.status === "closed") {
      setLocation(`/results/${code}`);
    }
  }, [participantId, code, setLocation, session]);

  // Initialize local selections from server-fetched participant data
  useEffect(() => {
    if (participantsList && participantId && !initRef.current) {
      const me = participantsList.find(p => p.id === participantId);
      if (me) {
        const initialMap: Record<number, number> = {};
        me.selections.forEach(sel => {
          initialMap[sel.itemId] = sel.quantity;
        });
        setSelections(initialMap);
        initRef.current = true;
      }
    }
  }, [participantsList, participantId]);

  // Debounced save
  const mutateRef = useRef(updateSelections.mutate);
  mutateRef.current = updateSelections.mutate;

  const saveSelections = useCallback((currentSelections: Record<number, number>) => {
    if (!participantId) return;
    const selectionsArray = Object.entries(currentSelections)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ itemId: parseInt(id, 10), quantity: qty }));

    mutateRef.current({
      code,
      data: { participantId, selections: selectionsArray }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
      }
    });
  }, [code, participantId, queryClient]);

  const handleIncrement = (itemId: number, maxAvailable: number) => {
    if (maxAvailable <= 0) return;
    setSelections(prev => {
      const current = prev[itemId] || 0;
      const next = { ...prev, [itemId]: current + 1 };
      // Fire save immediately
      saveSelections(next);
      return next;
    });
  };

  const handleDecrement = (itemId: number) => {
    setSelections(prev => {
      const current = prev[itemId] || 0;
      if (current <= 0) return prev;
      const next = { ...prev, [itemId]: current - 1 };
      // Fire save immediately
      saveSelections(next);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!participantId) return;
    submitParticipant.mutate({ code, data: { participantId } }, {
      onSuccess: () => {
        toast({ title: "Order submitted!", description: "Waiting for host to finalize." });
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
      },
      onError: (err) => {
        toast({ title: "Error submitting", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading || !session) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const me = session.participants.find(p => p.id === participantId);
  const isSubmitted = me?.submitted;

  // Calculate my current total
  const myTotal = session.items.reduce((acc, item) => {
    const qty = selections[item.id] || 0;
    return acc + (parseFloat(item.unitPrice) * qty);
  }, 0);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/20">
      <header className="bg-background border-b px-4 py-4 sticky top-0 z-10 flex flex-col gap-1">
        <h1 className="text-xl font-bold font-sans">{session.merchantName || "Dinner"}</h1>
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>Tap items to claim your share</span>
          <span className="font-mono font-bold text-foreground">Code: {code}</span>
        </div>
      </header>

      <ScrollArea className="flex-1 p-4">
        <div className="max-w-2xl mx-auto space-y-3 pb-32">
          {session.items.map(item => {
            const myQty = selections[item.id] || 0;
            // claimedQuantity from server includes our own selections as persisted
            // We use local state as the source of truth for "my" selections
            // so available = total - othersTotal - myLocalQty
            // othersTotal ≈ claimedQuantity (server) - myQty (since server reflects latest save)
            // But to avoid negative, just use: available = max(0, item.quantity - othersClaimedByOthers - myQty)
            const othersClaimed = Math.max(0, item.claimedQuantity - myQty);
            const available = Math.max(0, item.quantity - othersClaimed - myQty);
            
            const isFullyClaimed = available <= 0 && myQty === 0;
            const isMyItem = myQty > 0;

            return (
              <Card 
                key={item.id} 
                className={`transition-colors border ${isMyItem ? 'border-primary bg-primary/5' : isFullyClaimed ? 'opacity-60 bg-muted/50 border-transparent' : 'border-border'}`}
              >
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 flex flex-col">
                    <span className={`font-medium ${isFullyClaimed && !isMyItem ? 'line-through text-muted-foreground' : ''}`}>{item.name}</span>
                    <span className="text-sm text-muted-foreground">${item.unitPrice} each</span>
                    <span className="text-xs font-mono text-muted-foreground mt-1">
                      {available + myQty} available
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8 rounded-full border-muted-foreground/30 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                      onClick={() => handleDecrement(item.id)}
                      disabled={myQty <= 0 || isSubmitted}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-6 text-center font-bold text-lg">{myQty}</span>
                    <Button 
                      variant="default" 
                      size="icon" 
                      className="h-8 w-8 rounded-full shadow-sm"
                      onClick={() => handleIncrement(item.id, available)}
                      disabled={available <= 0 || isSubmitted}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      <div className="bg-background border-t p-4 fixed bottom-0 left-0 right-0 z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground font-medium">Your total (food only)</span>
            <span className="text-2xl font-bold">${myTotal.toFixed(2)}</span>
          </div>
          
          {isSubmitted ? (
            <Button size="lg" variant="secondary" className="h-14 px-8 text-secondary-foreground" disabled>
              <CheckCircle2 className="w-5 h-5 mr-2" /> Waiting for host
            </Button>
          ) : (
            <Button 
              size="lg" 
              className="h-14 px-8 text-lg" 
              onClick={handleSubmit}
              disabled={submitParticipant.isPending || myTotal === 0}
              data-testid="button-submit-order"
            >
              {submitParticipant.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              Submit Order
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}