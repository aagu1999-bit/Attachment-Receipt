import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Plus, Minus, CheckCircle2, ExternalLink, Clock } from "lucide-react";
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
  const participantToken = localStorage.getItem(`slice_token_${code}`) ?? "";

  const [selections, setSelections] = useState<Record<number, number>>({});
  const initRef = useRef(false);

  const { data: session, isLoading } = useGetSession(code, {
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

  useEffect(() => {
    if (!participantId) {
      setLocation(`/join/${code}`);
    }
  }, [participantId, code, setLocation]);

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

  const mutateRef = useRef(updateSelections.mutate);
  mutateRef.current = updateSelections.mutate;

  const saveSelections = useCallback((currentSelections: Record<number, number>) => {
    if (!participantId) return;
    const selectionsArray = Object.entries(currentSelections)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ itemId: parseInt(id, 10), quantity: qty }));

    mutateRef.current({
      code,
      data: { participantId, participantToken, selections: selectionsArray }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
      }
    });
  }, [code, participantId, participantToken, queryClient]);

  const handleToggle = (itemId: number, checked: boolean) => {
    setSelections(prev => {
      const next = { ...prev, [itemId]: checked ? 1 : 0 };
      saveSelections(next);
      return next;
    });
  };

  const handleIncrement = (itemId: number, maxAvailable: number) => {
    if (maxAvailable <= 0) return;
    setSelections(prev => {
      const current = prev[itemId] || 0;
      const next = { ...prev, [itemId]: current + 1 };
      saveSelections(next);
      return next;
    });
  };

  const handleDecrement = (itemId: number) => {
    setSelections(prev => {
      const current = prev[itemId] || 0;
      if (current <= 0) return prev;
      const next = { ...prev, [itemId]: current - 1 };
      saveSelections(next);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!participantId) return;
    submitParticipant.mutate({ code, data: { participantId, participantToken } }, {
      onSuccess: () => {
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

  const myFoodTotal = session.items.reduce((acc, item) => {
    const qty = selections[item.id] || 0;
    return acc + (parseFloat(item.unitPrice) * qty);
  }, 0);

  const totalFees = parseFloat(session.tax) + parseFloat(session.tip) + parseFloat(session.otherFees);
  const feeShare = totalFees / session.headcount;
  const myEstimatedTotal = myFoodTotal + feeShare;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/20">
      <header className="bg-background border-b px-4 py-4 sticky top-0 z-10 flex flex-col gap-1">
        <h1 className="text-xl font-bold font-sans">{session.merchantName || "Dinner"}</h1>
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>{isSubmitted ? "Your order is locked in" : "Tap items to claim your share"}</span>
          <span className="font-mono font-bold text-foreground">Code: {code}</span>
        </div>
      </header>

      <ScrollArea className="flex-1 p-4">
        <div className="max-w-2xl mx-auto space-y-3 pb-56">
          {session.items.map(item => {
            const myQty = selections[item.id] || 0;
            const othersClaimed = Math.max(0, item.claimedQuantity - myQty);
            const available = Math.max(0, item.quantity - othersClaimed - myQty);
            const isSingleQuantity = item.quantity === 1;
            const isFullyClaimed = available <= 0 && myQty === 0;
            const isMyItem = myQty > 0;

            return (
              <Card 
                key={item.id}
                data-testid={`card-item-${item.id}`}
                className={`transition-colors border ${isMyItem ? 'border-primary bg-primary/5' : isFullyClaimed ? 'opacity-60 bg-muted/50 border-transparent' : 'border-border'}`}
              >
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 flex flex-col">
                    <span className={`font-medium ${isFullyClaimed && !isMyItem ? 'line-through text-muted-foreground' : ''}`}>
                      {item.name}
                    </span>
                    <span className="text-sm text-muted-foreground">${item.unitPrice} each</span>
                    <span className="text-xs font-mono text-muted-foreground mt-1">
                      {available + myQty} of {item.quantity} available
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {isSingleQuantity ? (
                      <Checkbox
                        data-testid={`checkbox-item-${item.id}`}
                        checked={myQty === 1}
                        disabled={isSubmitted || (isFullyClaimed && myQty === 0)}
                        onCheckedChange={(checked) => handleToggle(item.id, !!checked)}
                        className="h-6 w-6"
                      />
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-full border-muted-foreground/30 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                          onClick={() => handleDecrement(item.id)}
                          disabled={myQty <= 0 || isSubmitted}
                          data-testid={`button-decrement-${item.id}`}
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                        <span className="w-6 text-center font-bold text-lg" data-testid={`qty-${item.id}`}>
                          {myQty}
                        </span>
                        <Button
                          variant="default"
                          size="icon"
                          className="h-8 w-8 rounded-full shadow-sm"
                          onClick={() => handleIncrement(item.id, available)}
                          disabled={available <= 0 || isSubmitted}
                          data-testid={`button-increment-${item.id}`}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      <div className="bg-background border-t p-4 fixed bottom-0 left-0 right-0 z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="max-w-2xl mx-auto">
          {session.status === "closed" ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground font-medium">Results ready</span>
                <span className="text-2xl font-bold">${myEstimatedTotal.toFixed(2)}</span>
              </div>
              <Button
                size="lg"
                className="h-14 px-8 text-lg"
                onClick={() => setLocation(`/results/${code}`)}
                data-testid="button-view-results"
              >
                <ExternalLink className="w-5 h-5 mr-2" /> View Results
              </Button>
            </div>
          ) : isSubmitted ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Your order is locked in. Waiting for the host to finalize.</span>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Food items</span>
                  <span className="font-medium" data-testid="text-my-food-total">${myFoodTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fees (1/{session.headcount} share)</span>
                  <span className="font-medium" data-testid="text-my-fee-share">${feeShare.toFixed(2)}</span>
                </div>
                <div className="border-t pt-1.5 flex justify-between">
                  <span className="font-semibold">Estimated total</span>
                  <span className="font-bold text-primary" data-testid="text-my-estimated-total">${myEstimatedTotal.toFixed(2)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                <CheckCircle2 className="w-3 h-3 inline mr-1 text-green-500" />
                Final total confirmed once the host calculates
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground font-medium">Your total (food only)</span>
                <span className="text-2xl font-bold" data-testid="text-my-total">${myFoodTotal.toFixed(2)}</span>
              </div>
              <Button
                size="lg"
                className="h-14 px-8 text-lg"
                onClick={handleSubmit}
                disabled={submitParticipant.isPending}
                data-testid="button-submit-order"
              >
                {submitParticipant.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Submit Order
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
