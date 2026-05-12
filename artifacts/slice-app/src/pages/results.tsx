import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  useGetSessionResults,
  useConfirmPaid,
  useUnconfirmPaid,
  getGetSessionResultsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionSocket } from "@/hooks/use-socket";
import { Loader2, Receipt, ArrowRight, Share2, UserCheck, Copy, CheckCircle2, Clock, Edit3 } from "lucide-react";
import { SiVenmo, SiCashapp, SiZelle, SiApplepay, SiGooglepay } from "react-icons/si";

interface SettlementRowProps {
  payerName: string;
  debtorName: string;
  amount: number;
  merchantName: string | null;
  paid: boolean;
  isMe: boolean;
  isHostViewing: boolean;
  payerVenmo: string | null;
  payerCashapp: string | null;
  payerZelle: string | null;
  payerApplePay: string | null;
  onCopyZelle: () => void;
  onConfirmPaid: () => void;
  onUnconfirmPaid: () => void;
  onHostMarkPaid: () => void;
  onHostUnmarkPaid: () => void;
  confirmPending: boolean;
}

function SettlementRow({
  payerName,
  debtorName,
  amount,
  merchantName,
  paid,
  isMe,
  isHostViewing,
  payerVenmo,
  payerCashapp,
  payerZelle,
  payerApplePay,
  onCopyZelle,
  onConfirmPaid,
  onUnconfirmPaid,
  onHostMarkPaid,
  onHostUnmarkPaid,
  confirmPending,
}: SettlementRowProps) {
  const note = encodeURIComponent(`Slice — ${merchantName || "dinner"}`);
  const amountStr = amount.toFixed(2);
  const hasAnyHandle = !!(payerVenmo || payerCashapp || payerZelle || payerApplePay);

  const venmoHref = payerVenmo
    ? `https://account.venmo.com/pay?recipients=${encodeURIComponent(payerVenmo)}&amount=${amountStr}&note=${note}&txn=pay`
    : null;
  const cashappHref = payerCashapp
    ? `https://cash.app/$${encodeURIComponent(payerCashapp)}/${amountStr}`
    : null;
  // Apple Pay & Google Pay have no public P2P deep link, so both buttons open Messages prefilled to the
  // payer's phone — guest sends via Apple Cash or Google Pay from the bubble. The phone is the same; only
  // the prefilled body differs so the guest knows which app to open.
  const applePayHref = payerApplePay
    ? `sms:${encodeURIComponent(payerApplePay)}&body=${encodeURIComponent(`Sending you $${amountStr} for ${merchantName || "dinner"} via Apple Cash (Slice)`)}`
    : null;
  const googlePayHref = payerApplePay
    ? `sms:${encodeURIComponent(payerApplePay)}?body=${encodeURIComponent(`Sending you $${amountStr} for ${merchantName || "dinner"} via Google Pay (Slice)`)}`
    : null;

  const handleCopyZelle = () => {
    if (!payerZelle) return;
    navigator.clipboard.writeText(payerZelle);
    onCopyZelle();
  };

  return (
    <div className={`p-3 rounded-lg border space-y-3 ${paid ? "bg-green-50 border-green-200" : "bg-muted/40"}`}>
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <div className="flex items-center gap-3">
          {paid ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          ) : (
            <ArrowRight className="w-4 h-4 text-primary shrink-0" />
          )}
          <span>
            {debtorName}
            {isMe && <span className="ml-1 text-xs text-primary font-semibold">(you)</span>}
            {" "}owes {payerName}{" "}
            <span className="font-mono">${amountStr}</span>
          </span>
        </div>
        {paid && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0">
            ✓ Sent
          </span>
        )}
      </div>

      {!paid && hasAnyHandle && (
        <div className="flex flex-wrap gap-2 pl-7">
          {venmoHref && (
            <a
              href={venmoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#3D95CE] text-white text-xs font-semibold hover:bg-[#3486bd] transition-colors"
              data-testid={`pay-venmo-${debtorName}`}
            >
              <SiVenmo className="w-4 h-4" /> Venmo
            </a>
          )}
          {cashappHref && (
            <a
              href={cashappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00C244] text-white text-xs font-semibold hover:bg-[#00ad3c] transition-colors"
              data-testid={`pay-cashapp-${debtorName}`}
            >
              <SiCashapp className="w-4 h-4" /> Cash App
            </a>
          )}
          {applePayHref && (
            <a
              href={applePayHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-black text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
              data-testid={`pay-applepay-${debtorName}`}
              title="Opens Messages — send Apple Cash from there (iPhone)"
            >
              <SiApplepay className="w-5 h-5" /> via Messages
            </a>
          )}
          {googlePayHref && (
            <a
              href={googlePayHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1666D6] transition-colors"
              data-testid={`pay-googlepay-${debtorName}`}
              title="Opens Messages — send Google Pay from there (Android)"
            >
              <SiGooglepay className="w-5 h-5" /> via Messages
            </a>
          )}
          {payerZelle && (
            <button
              type="button"
              onClick={handleCopyZelle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#6D1ED4] text-white text-xs font-semibold hover:bg-[#5e16bc] transition-colors"
              data-testid={`pay-zelle-${debtorName}`}
            >
              <SiZelle className="w-4 h-4" /> Copy Zelle
            </button>
          )}
        </div>
      )}

      {isMe && (
        <div className="pl-7">
          {paid ? (
            <button
              type="button"
              onClick={onUnconfirmPaid}
              disabled={confirmPending}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              data-testid={`button-unconfirm-paid-${debtorName}`}
            >
              Didn't send yet? Undo
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirmPaid}
              disabled={confirmPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-50 hover:bg-green-100 text-green-800 border-2 border-green-400 hover:border-green-500 text-sm font-semibold transition-colors disabled:opacity-60 shadow-sm"
              data-testid={`button-confirm-paid-${debtorName}`}
            >
              {confirmPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Tap once you've sent the money
            </button>
          )}
        </div>
      )}

      {isHostViewing && !isMe && (
        <div className="pl-7 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Host control:</span>
          {paid ? (
            <button
              type="button"
              onClick={onHostUnmarkPaid}
              disabled={confirmPending}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              data-testid={`button-host-unmark-paid-${debtorName}`}
            >
              Mark as unpaid
            </button>
          ) : (
            <button
              type="button"
              onClick={onHostMarkPaid}
              disabled={confirmPending}
              className="font-semibold text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
              data-testid={`button-host-mark-paid-${debtorName}`}
            >
              Mark as paid
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Results() {
  const params = useParams<{ code: string }>();
  const code = params.code!;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const readStoredParticipantId = (sessionCode: string): number | null => {
    const str = localStorage.getItem(`slice_participant_${sessionCode}`);
    if (!str) return null;
    const parsed = parseInt(str, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const [participantId, setParticipantId] = useState<number | null>(() => readStoredParticipantId(code));
  const [showPicker, setShowPicker] = useState(false);

  const participantToken = localStorage.getItem(`slice_token_${code}`) ?? "";
  const hostToken = localStorage.getItem(`slice_host_${code}`) ?? "";
  const isHost = !!hostToken;

  useEffect(() => {
    setParticipantId(readStoredParticipantId(code));
    setShowPicker(false);
  }, [code]);

  // Keep results in sync with real-time payment confirmations from other guests.
  useSessionSocket(code);

  const confirmPaid = useConfirmPaid();
  const unconfirmPaid = useUnconfirmPaid();

  const { data: results, isLoading, error } = useGetSessionResults(code, {
    query: {
      enabled: !!code,
      queryKey: getGetSessionResultsQueryKey(code)
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h2 className="text-2xl font-bold mb-2">Results not found</h2>
        <p className="text-muted-foreground mb-6">This session hasn't been finalized yet.</p>
        <Button onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  const myResult = participantId ? results.participants.find(p => p.participantId === participantId) : null;

  const handleSelectParticipant = (id: number) => {
    localStorage.setItem(`slice_participant_${code}`, String(id));
    setParticipantId(id);
    setShowPicker(false);
  };

  const handleShareResults = () => {
    const url = `${window.location.origin}/results/${code}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "Results link copied!",
      description: "Anyone with this link can view the final breakdown.",
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="text-center space-y-2 mt-4">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
            results.preview ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-600"
          }`}>
            {results.preview ? <Clock className="w-8 h-8" /> : <Receipt className="w-8 h-8" />}
          </div>
          <h1 className="text-4xl font-bold font-sans">
            {results.preview ? "Live Breakdown" : "The Bill is Settled"}
          </h1>
          <p className="text-muted-foreground text-lg">
            {results.merchantName || "Dinner"} &bull; Total: ${results.totalBill.toFixed(2)}
          </p>
        </div>

        {results.preview && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900" data-testid="banner-session-preview">
            <Clock className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="flex-1 space-y-2">
              <p className="font-semibold text-sm">Session still in progress</p>
              <p className="text-xs leading-relaxed">
                The host hasn't finalized yet, so these totals may change as other guests add or edit their orders.
                You can still pay your share now — payment confirmations are saved.
              </p>
              {participantId && (
                <button
                  type="button"
                  onClick={() => setLocation(`/select/${code}`)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 underline underline-offset-2 hover:no-underline"
                  data-testid="button-edit-my-order"
                >
                  <Edit3 className="w-3 h-3" /> Edit my order
                </button>
              )}
            </div>
          </div>
        )}

        {myResult && !showPicker ? (
          <Card className="border-primary bg-primary/5 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Your Share, {myResult.name}</CardTitle>
                <button
                  onClick={() => setShowPicker(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  data-testid="button-change-identity"
                >
                  Not you?
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-4">
                <span className="text-5xl font-bold font-mono tracking-tight">${myResult.totalOwed.toFixed(2)}</span>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground border-t border-primary/10 pt-4">
                <div className="flex justify-between">
                  <span>Food &amp; Drinks</span>
                  <span>${myResult.foodSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax, Tip &amp; Fees (shared evenly)</span>
                  <span>${myResult.feesShare.toFixed(2)}</span>
                </div>
                {myResult.itemsEaten.length > 0 && (
                  <div className="mt-4 pt-2 border-t border-primary/10 text-foreground">
                    <p className="font-medium mb-1">Items you ordered:</p>
                    <ul className="list-disc list-inside pl-4 space-y-0.5">
                      {myResult.itemsEaten.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-2 border-muted-foreground/30 bg-muted/20">
            <CardContent className="pt-6">
              {showPicker ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <UserCheck className="w-5 h-5 text-primary" />
                    <p className="font-semibold">Which one is you?</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {results.participants.map(p => (
                      <button
                        key={p.participantId}
                        onClick={() => handleSelectParticipant(p.participantId)}
                        data-testid={`picker-participant-${p.participantId}`}
                        className="flex items-center justify-between px-4 py-3 rounded-lg border bg-background hover:border-primary hover:bg-primary/5 transition-colors text-left"
                      >
                        <span className="font-medium">
                          {p.name}
                          {p.isHost && <span className="ml-1 text-xs text-muted-foreground">(Host)</span>}
                        </span>
                        <span className="text-sm font-mono text-muted-foreground">${p.totalOwed.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-xs text-muted-foreground hover:text-foreground mt-2 underline underline-offset-2 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-foreground">See your personal share</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Identify yourself to view your breakdown</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowPicker(true)}
                    data-testid="button-identify-self"
                    className="shrink-0"
                  >
                    <UserCheck className="w-4 h-4 mr-2" />
                    Which one is me?
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(() => {
          const debtors = results.participants.filter(p => p.name !== results.payerName && p.totalOwed > 0);
          const paidCount = debtors.filter(p => p.paid).length;
          const hostShare = results.participants.find(p => p.name === results.payerName);

          const handleConfirmPaid = (pId: number) => {
            confirmPaid.mutate({
              code,
              data: { participantId: pId, participantToken },
            }, {
              onSuccess: () => {
                toast({ title: "Marked as paid", description: "The host can see this in real time." });
              },
              onError: (err) => {
                toast({ title: "Couldn't confirm", description: err.message, variant: "destructive" });
              }
            });
          };

          const handleUnconfirmPaid = (pId: number) => {
            unconfirmPaid.mutate({
              code,
              data: { participantId: pId, participantToken },
            }, {
              onError: (err) => {
                toast({ title: "Couldn't undo", description: err.message, variant: "destructive" });
              }
            });
          };

          const handleHostMarkPaid = (pId: number, pName: string) => {
            confirmPaid.mutate({
              code,
              data: { participantId: pId, hostToken },
            }, {
              onSuccess: () => {
                toast({ title: `Marked ${pName} as paid`, description: "Use the undo link if this was a mistake." });
              },
              onError: (err) => {
                toast({ title: "Couldn't mark paid", description: err.message, variant: "destructive" });
              }
            });
          };

          const handleHostUnmarkPaid = (pId: number, pName: string) => {
            unconfirmPaid.mutate({
              code,
              data: { participantId: pId, hostToken },
            }, {
              onSuccess: () => {
                toast({ title: `${pName} reset to unpaid` });
              },
              onError: (err) => {
                toast({ title: "Couldn't undo", description: err.message, variant: "destructive" });
              }
            });
          };

          return (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">Who pays whom</CardTitle>
                    <CardDescription>{results.payerName} paid the restaurant</CardDescription>
                  </div>
                  {debtors.length > 0 && (
                    <div className={`text-xs font-semibold px-3 py-1.5 rounded-full shrink-0 ${
                      paidCount === debtors.length
                        ? "bg-green-100 text-green-700"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {paidCount} of {debtors.length} paid
                    </div>
                  )}
                </div>
                {isHost && debtors.length > 0 && paidCount < debtors.length && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Updates live as guests confirm. Don't refresh.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {hostShare && hostShare.totalOwed > 0 && (
                  <div className="p-3 rounded-lg border border-dashed bg-muted/20 text-sm flex items-center gap-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Host's share</span>
                    <span className="text-muted-foreground">
                      {results.payerName} covered <span className="font-mono">${hostShare.totalOwed.toFixed(2)}</span> for their own portion.
                    </span>
                  </div>
                )}
                {debtors.length === 0 ? (
                  <p className="text-muted-foreground italic">No payments needed!</p>
                ) : (
                  debtors.map(p => (
                    <SettlementRow
                      key={p.participantId}
                      payerName={results.payerName}
                      debtorName={p.name}
                      amount={p.totalOwed}
                      merchantName={results.merchantName}
                      paid={p.paid}
                      isMe={p.participantId === participantId}
                      isHostViewing={isHost}
                      payerVenmo={results.payerVenmo ?? null}
                      payerCashapp={results.payerCashapp ?? null}
                      payerZelle={results.payerZelle ?? null}
                      payerApplePay={results.payerApplePay ?? null}
                      onCopyZelle={() => toast({
                        title: "Zelle handle copied",
                        description: `Open your bank app and send $${p.totalOwed.toFixed(2)} to ${results.payerZelle}`,
                      })}
                      onConfirmPaid={() => handleConfirmPaid(p.participantId)}
                      onUnconfirmPaid={() => handleUnconfirmPaid(p.participantId)}
                      onHostMarkPaid={() => handleHostMarkPaid(p.participantId, p.name)}
                      onHostUnmarkPaid={() => handleHostUnmarkPaid(p.participantId, p.name)}
                      confirmPending={confirmPaid.isPending || unconfirmPaid.isPending}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Full Breakdown</CardTitle>
            <CardDescription>Tax/tip/fees of ${results.totalFees.toFixed(2)} split evenly · live payment status</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Items Ordered</th>
                  <th className="pb-3 pr-4 font-medium text-right">Food Subtotal</th>
                  <th className="pb-3 pr-4 font-medium text-right">Share of Fees</th>
                  <th className="pb-3 pr-4 font-medium text-right">Total Owed</th>
                  <th className="pb-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.participants.map(p => {
                  const isPayer = p.name === results.payerName;
                  return (
                    <tr
                      key={p.participantId}
                      className={`border-b last:border-0 ${p.participantId === participantId ? "bg-primary/5" : ""}`}
                    >
                      <td className="py-3 pr-4 font-medium align-top">
                        {p.name}
                        {p.isHost && <span className="ml-1 text-xs text-muted-foreground">(Host)</span>}
                        {p.participantId === participantId && <span className="ml-1 text-xs text-primary">(You)</span>}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground align-top">
                        {p.itemsEaten.length > 0 ? (
                          <ul className="list-disc list-inside space-y-0.5">
                            {p.itemsEaten.map((item, i) => (
                              <li key={i} className="leading-tight">{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono align-top">${p.foodSubtotal.toFixed(2)}</td>
                      <td className="py-3 pr-4 text-right font-mono align-top">${p.feesShare.toFixed(2)}</td>
                      <td className="py-3 pr-4 text-right font-mono font-bold align-top">${p.totalOwed.toFixed(2)}</td>
                      <td className="py-3 text-center align-top">
                        {isPayer ? (
                          <span className="inline-flex items-center text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            Paid bill
                          </span>
                        ) : p.paid ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Sent
                          </span>
                        ) : p.totalOwed === 0 ? (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        ) : (
                          <span className="inline-flex items-center text-xs font-medium text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="pt-3 pr-4">Total</td>
                  <td className="pt-3 pr-4" />
                  <td className="pt-3 pr-4 text-right font-mono">
                    ${results.participants.reduce((s, p) => s + p.foodSubtotal, 0).toFixed(2)}
                  </td>
                  <td className="pt-3 pr-4 text-right font-mono">${results.totalFees.toFixed(2)}</td>
                  <td className="pt-3 pr-4 text-right font-mono">${results.totalBill.toFixed(2)}</td>
                  <td className="pt-3" />
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3 pb-12">
          <Button variant="default" size="lg" onClick={handleShareResults} data-testid="button-share-results">
            <Share2 className="w-4 h-4 mr-2" /> Copy Results Link
          </Button>
          <Button variant="outline" size="lg" onClick={() => setLocation("/")}>
            Start a new session
          </Button>
        </div>

      </div>
    </div>
  );
}
