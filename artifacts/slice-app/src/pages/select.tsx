import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useGetSession,
  useGetParticipants,
  useGetSessionResults,
  useUpdateSelections,
  useSubmitParticipant,
  useUnsubmitParticipant,
  useConfirmPaid,
  useUnconfirmPaid,
  getGetSessionQueryKey,
  getGetParticipantsQueryKey,
  getGetSessionResultsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Loader2, Plus, Minus, CheckCircle2, ExternalLink, Clock, Circle, Pencil, Copy } from "lucide-react";
import { SiVenmo, SiCashapp, SiZelle, SiApplepay, SiGooglepay } from "react-icons/si";
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
  const unsubmitParticipant = useUnsubmitParticipant();
  const confirmPaid = useConfirmPaid();
  const unconfirmPaid = useUnconfirmPaid();
  
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

  // Live results for the post-submit payment view. Server now returns this in
  // 'open' status too (preview mode), so guests can pay before host finalizes.
  const { data: liveResults } = useGetSessionResults(code, {
    query: {
      enabled: !!code && !!participantId && (session?.status === "open" || session?.status === "closed"),
      queryKey: getGetSessionResultsQueryKey(code),
    },
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
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
        setLocation(`/results/${code}`);
      },
      onError: (err) => {
        toast({ title: "Error submitting", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleEditOrder = () => {
    if (!participantId) return;
    unsubmitParticipant.mutate({ code, data: { participantId, participantToken } }, {
      onSuccess: () => {
        initRef.current = false;
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(code) });
        queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey(code) });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
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
  const isSubmitted = me?.submitted ?? false;

  const submittedCount = session.participants.filter(p => p.submitted).length;
  const totalCount = session.participants.length;

  const myFoodTotal = session.items.reduce((acc, item) => {
    const qty = selections[item.id] || 0;
    return acc + (parseFloat(item.unitPrice) * qty);
  }, 0);

  const totalFees = parseFloat(session.tax) + parseFloat(session.tip) + parseFloat(session.otherFees);
  const feeShare = totalFees / session.headcount;
  const myEstimatedTotal = myFoodTotal + feeShare;

  const myClaimedItems = session.items.filter(item => (selections[item.id] || 0) > 0);

  // Full-screen submitted confirmation view
  if (isSubmitted && session.status === "open") {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-muted/20">
        <header className="bg-background border-b px-4 py-4 sticky top-0 z-10 flex flex-col gap-1">
          <h1 className="text-xl font-bold font-sans">{session.merchantName || "Dinner"}</h1>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>Your order is locked in</span>
            <span className="font-mono font-bold text-foreground">Code: {code}</span>
          </div>
        </header>

        <ScrollArea className="flex-1 p-4">
          <div className="max-w-lg mx-auto space-y-4 py-6">

            {/* Confirmation banner */}
            <div className="flex flex-col items-center text-center gap-2 py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-9 h-9 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold">You're all set!</h2>
              <p className="text-muted-foreground text-sm">Waiting for the host to calculate totals.</p>
            </div>

            {/* Estimated total card */}
            <div className="bg-background rounded-xl border p-5 space-y-3">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Your Estimate</h3>
              <div className="space-y-2">
                {myClaimedItems.map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.name} × {selections[item.id]}</span>
                    <span className="font-medium">${(parseFloat(item.unitPrice) * (selections[item.id] || 0)).toFixed(2)}</span>
                  </div>
                ))}
                {myClaimedItems.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-1">No items selected</p>
                )}
              </div>
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Food subtotal</span>
                  <span className="font-medium" data-testid="text-my-food-total">${myFoodTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax &amp; tip (1/{session.headcount} share)</span>
                  <span className="font-medium" data-testid="text-my-fee-share">${feeShare.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="font-bold text-base">Estimated total</span>
                  <span className="font-bold text-xl text-primary" data-testid="text-my-estimated-total">${myEstimatedTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Group progress strip */}
            <div className="bg-background rounded-xl border p-4 space-y-3" data-testid="participant-status-strip">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Who's in</span>
                <span className="text-xs font-medium text-muted-foreground" data-testid="submitted-count">
                  {submittedCount} of {totalCount} submitted
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {session.participants.map(p => {
                  const isMe = p.id === participantId;
                  return (
                    <div
                      key={p.id}
                      data-testid={`participant-row-${p.id}`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-colors ${
                        p.submitted
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-muted/40 border-border text-muted-foreground'
                      }`}
                    >
                      {p.submitted
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        : <Clock className="w-3.5 h-3.5 shrink-0 opacity-40" />
                      }
                      <span className="font-medium leading-none">
                        {p.name}
                        {isMe && <span className="font-normal opacity-60 ml-1">(you)</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payment buttons + "I sent the money" — works in preview mode (before host finalizes) */}
            {liveResults && participantId && (() => {
              const myResult = liveResults.participants.find(p => p.participantId === participantId);
              if (!myResult || myResult.name === liveResults.payerName || myResult.totalOwed <= 0) return null;

              const amountStr = myResult.totalOwed.toFixed(2);
              const note = encodeURIComponent(`Slice — ${liveResults.merchantName || "dinner"}`);
              const venmoHref = liveResults.payerVenmo
                ? `https://account.venmo.com/pay?recipients=${encodeURIComponent(liveResults.payerVenmo)}&amount=${amountStr}&note=${note}&txn=pay`
                : null;
              const cashappHref = liveResults.payerCashapp
                ? `https://cash.app/$${encodeURIComponent(liveResults.payerCashapp)}/${amountStr}`
                : null;
              const applePayHref = liveResults.payerApplePay
                ? `sms:${encodeURIComponent(liveResults.payerApplePay)}&body=${encodeURIComponent(`Sending you $${amountStr} for ${liveResults.merchantName || "dinner"} via Apple Cash (Slice)`)}`
                : null;
              const googlePayHref = liveResults.payerApplePay
                ? `sms:${encodeURIComponent(liveResults.payerApplePay)}?body=${encodeURIComponent(`Sending you $${amountStr} for ${liveResults.merchantName || "dinner"} via Google Pay (Slice)`)}`
                : null;
              const hasAnyHandle = !!(venmoHref || cashappHref || applePayHref || googlePayHref || liveResults.payerZelle);

              const handleCopyZelle = () => {
                if (!liveResults.payerZelle) return;
                navigator.clipboard.writeText(liveResults.payerZelle);
                toast({
                  title: "Zelle handle copied",
                  description: `Open your bank app and send $${amountStr} to ${liveResults.payerZelle}`,
                });
              };

              const handleConfirmPaid = () => {
                confirmPaid.mutate({ code, data: { participantId, participantToken } }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getGetSessionResultsQueryKey(code) });
                    toast({ title: "Marked as paid", description: "The host can see this in real time." });
                  },
                  onError: (err) => toast({ title: "Couldn't confirm", description: err.message, variant: "destructive" }),
                });
              };

              const handleUnconfirmPaid = () => {
                unconfirmPaid.mutate({ code, data: { participantId, participantToken } }, {
                  onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSessionResultsQueryKey(code) }),
                  onError: (err) => toast({ title: "Couldn't undo", description: err.message, variant: "destructive" }),
                });
              };

              return (
                <div className={`rounded-xl border p-5 space-y-4 ${myResult.paid ? "bg-green-50 border-green-200" : "bg-background"}`} data-testid="select-payment-panel">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You owe {liveResults.payerName}</p>
                      <p className="text-3xl font-bold font-mono mt-1">${amountStr}</p>
                    </div>
                    {myResult.paid && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                      </span>
                    )}
                  </div>

                  {!myResult.paid && hasAnyHandle && (
                    <div className="flex flex-wrap gap-2">
                      {venmoHref && (
                        <a href={venmoHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#3D95CE] text-white text-xs font-semibold hover:bg-[#3486bd] transition-colors" data-testid="select-pay-venmo">
                          <SiVenmo className="w-4 h-4" /> Venmo
                        </a>
                      )}
                      {cashappHref && (
                        <a href={cashappHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#00C244] text-white text-xs font-semibold hover:bg-[#00ad3c] transition-colors" data-testid="select-pay-cashapp">
                          <SiCashapp className="w-4 h-4" /> Cash App
                        </a>
                      )}
                      {applePayHref && (
                        <a href={applePayHref} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-black text-white text-xs font-semibold hover:bg-neutral-800 transition-colors" data-testid="select-pay-applepay" title="Opens Messages — send Apple Cash from there">
                          <SiApplepay className="w-5 h-5" /> via Messages
                        </a>
                      )}
                      {googlePayHref && (
                        <a href={googlePayHref} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1666D6] transition-colors" data-testid="select-pay-googlepay" title="Opens Messages — send Google Pay from there">
                          <SiGooglepay className="w-5 h-5" /> via Messages
                        </a>
                      )}
                      {liveResults.payerZelle && (
                        <button type="button" onClick={handleCopyZelle} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#6D1ED4] text-white text-xs font-semibold hover:bg-[#5e16bc] transition-colors" data-testid="select-pay-zelle">
                          <SiZelle className="w-4 h-4" /> Copy Zelle
                        </button>
                      )}
                    </div>
                  )}

                  {!myResult.paid && !hasAnyHandle && (
                    <p className="text-xs text-muted-foreground italic">The host didn't add payment handles. Pay them however you usually do.</p>
                  )}

                  <div className="pt-2 border-t flex items-center justify-between gap-3">
                    {myResult.paid ? (
                      <button
                        type="button"
                        onClick={handleUnconfirmPaid}
                        disabled={confirmPaid.isPending || unconfirmPaid.isPending}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        data-testid="select-button-unconfirm-paid"
                      >
                        Didn't send yet? Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConfirmPaid}
                        disabled={confirmPaid.isPending || unconfirmPaid.isPending}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-50 hover:bg-green-100 text-green-800 border-2 border-green-400 text-sm font-semibold transition-colors disabled:opacity-60 shadow-sm"
                        data-testid="select-button-confirm-paid"
                      >
                        {confirmPaid.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Tap once you've sent the money
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLocation(`/results/${code}`)}
                      className="text-xs font-semibold text-primary hover:underline shrink-0"
                      data-testid="select-button-view-full-breakdown"
                    >
                      Full breakdown →
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Edit order button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleEditOrder}
              disabled={unsubmitParticipant.isPending}
              data-testid="button-edit-order"
            >
              {unsubmitParticipant.isPending
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Pencil className="w-4 h-4 mr-2" />
              }
              Edit My Order
            </Button>

          </div>
        </ScrollArea>
      </div>
    );
  }

  // Session closed — redirect prompt
  if (session.status === "closed") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 bg-background p-6 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500" />
        <div>
          <h2 className="text-2xl font-bold mb-1">Bill finalized!</h2>
          <p className="text-muted-foreground">The host has calculated the final totals.</p>
        </div>
        <Button
          size="lg"
          className="w-full max-w-xs h-14 text-lg"
          onClick={() => setLocation(`/results/${code}`)}
          data-testid="button-view-results"
        >
          <ExternalLink className="w-5 h-5 mr-2" /> View Results
        </Button>
      </div>
    );
  }

  // Normal selection view (not yet submitted)
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
        <div className="max-w-2xl mx-auto space-y-3 pb-36">

          {/* Participant status strip */}
          <div className="bg-background border rounded-xl p-3 space-y-2" data-testid="participant-status-strip">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Who's in</span>
              <span className="text-xs font-medium text-muted-foreground" data-testid="submitted-count">
                {submittedCount} of {totalCount} submitted
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {session.participants.map(p => {
                const isMe = p.id === participantId;
                return (
                  <div
                    key={p.id}
                    data-testid={`participant-row-${p.id}`}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-colors ${
                      p.submitted
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-muted/40 border-border text-muted-foreground'
                    }`}
                  >
                    {p.submitted
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : <Circle className="w-3.5 h-3.5 shrink-0 opacity-40" />
                    }
                    <span className="font-medium leading-none">
                      {p.name}
                      {isMe && <span className="font-normal opacity-60 ml-1">(you)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Receipt items */}
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
                          disabled={available <= 0}
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
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
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
      </div>
    </div>
  );
}
