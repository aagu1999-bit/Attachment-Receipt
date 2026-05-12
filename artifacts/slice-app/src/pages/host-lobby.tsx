import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  useGetSession,
  useFinalizeSession,
  useGetParticipants,
  useUpdateSelections,
  useSubmitParticipant,
  useUnsubmitParticipant,
  useUpdateHeadcount,
  getGetSessionQueryKey,
  getGetParticipantsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Copy, Users, Receipt, CheckCircle2, Circle, Loader2, ArrowRight, ExternalLink, Plus, Minus, ShoppingBag, Lock, Edit3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";

export default function HostLobby() {
  const params = useParams<{ code: string }>();
  const code = params.code!;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const finalizeSession = useFinalizeSession();
  const updateSelections = useUpdateSelections();
  const submitParticipant = useSubmitParticipant();
  const unsubmitParticipant = useUnsubmitParticipant();
  const updateHeadcount = useUpdateHeadcount();

  const hostToken = localStorage.getItem(`slice_host_${code}`) ?? "";
  const isHost = !!hostToken;

  const participantIdStr = localStorage.getItem(`slice_participant_${code}`);
  const participantId = participantIdStr ? parseInt(participantIdStr, 10) : null;
  const participantToken = localStorage.getItem(`slice_token_${code}`) ?? "";

  const [selections, setSelections] = useState<Record<number, number>>({});
  const initRef = useRef(false);

  const { data: session, isLoading, error } = useGetSession(code, {
    query: {
      enabled: !!code,
      queryKey: getGetSessionQueryKey(code)
    }
  });

  const { data: participantsList } = useGetParticipants(code, {
    query: {
      enabled: !!code && !!participantId && session?.status === "open",
      queryKey: getGetParticipantsQueryKey(code)
    }
  });

  useSessionSocket(code);

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

  const handleCopyLink = () => {
    const url = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "Link copied!",
      description: "Send this to your friends to join.",
    });
  };

  const handleSubmitMyOrder = () => {
    if (!participantId) return;
    submitParticipant.mutate({ code, data: { participantId, participantToken } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
        toast({ title: "Order locked in!", description: "Your items are confirmed. You can now finalize when everyone is ready." });
      },
      onError: (err) => {
        toast({ title: "Error submitting order", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleEditMyOrder = () => {
    if (!participantId) return;
    unsubmitParticipant.mutate({ code, data: { participantId, participantToken } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
        toast({ title: "Order unlocked", description: "Adjust your items below, then lock in again." });
      },
      onError: (err) => {
        toast({ title: "Error unlocking order", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleHeadcount = (delta: number) => {
    if (!session || !isHost) return;
    const next = Math.min(50, Math.max(1, session.headcount + delta));
    if (next === session.headcount) return;
    updateHeadcount.mutate({ code, data: { hostToken, headcount: next } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
      },
      onError: (err) => {
        toast({ title: "Error updating headcount", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleFinalize = () => {
    if (!hostToken) {
      toast({ title: "Error", description: "Not authorized as host", variant: "destructive" });
      return;
    }

    finalizeSession.mutate({ code, data: { hostToken } }, {
      onSuccess: () => {
        setLocation(`/results/${code}`);
      },
      onError: (err) => {
        toast({ title: "Error finalizing", description: err.message, variant: "destructive" });
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

  const guests = session.participants.filter(p => p.name !== session.hostName);
  const allGuestsSubmitted = guests.length > 0 && guests.every(p => p.submitted);
  const itemsClaimed = session.items.reduce((acc, item) => acc + item.claimedQuantity, 0);
  const itemsTotal = session.items.reduce((acc, item) => acc + item.quantity, 0);
  const percentClaimed = itemsTotal > 0 ? Math.round((itemsClaimed / itemsTotal) * 100) : 0;

  const myTotal = session.items.reduce((acc, item) => {
    const qty = selections[item.id] || 0;
    return acc + (parseFloat(item.unitPrice) * qty);
  }, 0);

  const isOpen = session.status === "open";

  // Determine if host has submitted their own order
  const hostParticipant = session.participants.find(p => p.name === session.hostName);
  const hostSubmitted = hostParticipant?.submitted ?? false;

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
          <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-6">
            <div className="shrink-0 p-3 bg-white rounded-lg border border-primary/10" data-testid="qr-invite">
              <QRCodeSVG
                value={`${window.location.origin}/join/${code}`}
                size={144}
                level="M"
                marginSize={0}
              />
            </div>
            <div className="flex-1 text-center sm:text-left space-y-3">
              <div>
                <h3 className="font-semibold text-lg">Invite Friends</h3>
                <p className="text-sm text-muted-foreground">
                  Have them scan the QR code, or send the link and code <strong className="uppercase">{code}</strong>
                </p>
              </div>
              <Button size="lg" onClick={handleCopyLink} className="w-full sm:w-auto" data-testid="button-copy-link">
                <Copy className="w-4 h-4 mr-2" /> Copy Link
              </Button>
            </div>
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
                {allGuestsSubmitted && guests.length > 0 && (
                  <Badge variant="secondary" className="bg-secondary text-secondary-foreground">Guests Ready</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Table size (for fee split):</span>
                {isHost && isOpen ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-6 w-6 rounded-full"
                      onClick={() => handleHeadcount(-1)}
                      disabled={session.headcount <= 1 || updateHeadcount.isPending}
                      data-testid="button-lobby-headcount-decrement"
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="text-sm font-bold w-6 text-center" data-testid="text-lobby-headcount">
                      {session.headcount}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-6 w-6 rounded-full"
                      onClick={() => handleHeadcount(1)}
                      disabled={session.headcount >= 50 || updateHeadcount.isPending}
                      data-testid="button-lobby-headcount-increment"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm font-semibold">{session.headcount}</span>
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
                      <span className="font-medium">
                        {p.name}
                        {p.name === session.hostName && (
                          <span className="ml-2 text-xs text-muted-foreground font-normal">(you)</span>
                        )}
                      </span>
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

        {isOpen && participantId && (
          <Card>
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <ShoppingBag className="w-5 h-5 text-primary" />
                    My Items
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {hostSubmitted ? "Your items are locked in." : "Select the items you personally ordered, then lock in your order."}
                  </CardDescription>
                </div>
                <span className="text-lg font-bold text-primary">${myTotal.toFixed(2)}</span>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {hostSubmitted ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <CheckCircle2 className="w-5 h-5 shrink-0 text-green-600" />
                      <div>
                        <p className="font-semibold">Your order is locked in</p>
                        <p className="text-sm text-green-700">Food subtotal: ${myTotal.toFixed(2)}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEditMyOrder}
                      disabled={unsubmitParticipant.isPending}
                      className="bg-white shrink-0"
                      data-testid="button-host-edit-order"
                    >
                      {unsubmitParticipant.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4 mr-1.5" />}
                      Edit Order
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {session.items.filter(item => (selections[item.id] || 0) > 0).map(item => (
                      <div key={item.id} className="flex justify-between text-sm py-1 border-b border-dashed last:border-0">
                        <span>{item.name} × {selections[item.id]}</span>
                        <span className="font-medium">${(parseFloat(item.unitPrice) * (selections[item.id] || 0)).toFixed(2)}</span>
                      </div>
                    ))}
                    {session.items.filter(item => (selections[item.id] || 0) > 0).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-2">No items selected</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {session.items.map(item => {
                    const myQty = selections[item.id] || 0;
                    const othersClaimed = Math.max(0, item.claimedQuantity - myQty);
                    const available = Math.max(0, item.quantity - othersClaimed - myQty);
                    const isSingleQuantity = item.quantity === 1;
                    const isFullyClaimed = available <= 0 && myQty === 0;
                    const isMyItem = myQty > 0;

                    return (
                      <div
                        key={item.id}
                        data-testid={`host-card-item-${item.id}`}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${isMyItem ? 'border-primary bg-primary/5' : isFullyClaimed ? 'opacity-60 bg-muted/50 border-transparent' : 'border-border bg-background'}`}
                      >
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
                              data-testid={`host-checkbox-item-${item.id}`}
                              checked={myQty === 1}
                              disabled={isFullyClaimed && myQty === 0}
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
                                disabled={myQty <= 0}
                                data-testid={`host-button-decrement-${item.id}`}
                              >
                                <Minus className="w-4 h-4" />
                              </Button>
                              <span className="w-6 text-center font-bold text-lg" data-testid={`host-qty-${item.id}`}>
                                {myQty}
                              </span>
                              <Button
                                variant="default"
                                size="icon"
                                className="h-8 w-8 rounded-full shadow-sm"
                                onClick={() => handleIncrement(item.id, available)}
                                disabled={available <= 0}
                                data-testid={`host-button-increment-${item.id}`}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <Button
                    className="w-full mt-2"
                    onClick={handleSubmitMyOrder}
                    disabled={submitParticipant.isPending}
                    data-testid="button-host-submit-order"
                  >
                    {submitParticipant.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      : <Lock className="w-4 h-4 mr-2" />
                    }
                    Lock In My Order
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end pt-4">
          {session.status === "closed" ? (
            <Button
              size="lg"
              className="w-full md:w-auto h-14 px-8 text-lg"
              onClick={() => setLocation(`/results/${code}`)}
              data-testid="button-view-results"
            >
              <ExternalLink className="w-5 h-5 mr-2" /> View Results
            </Button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
