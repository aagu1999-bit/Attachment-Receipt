import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  useGetSessionResults, 
  getGetSessionResultsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Receipt, ArrowRight, Share2, UserCheck, Copy } from "lucide-react";

interface SettlementRowProps {
  payerName: string;
  debtorName: string;
  amount: number;
  merchantName: string | null;
  payerVenmo: string | null;
  payerCashapp: string | null;
  payerZelle: string | null;
  onCopyZelle: () => void;
}

function SettlementRow({
  payerName,
  debtorName,
  amount,
  merchantName,
  payerVenmo,
  payerCashapp,
  payerZelle,
  onCopyZelle,
}: SettlementRowProps) {
  const note = encodeURIComponent(`Slice — ${merchantName || "dinner"}`);
  const amountStr = amount.toFixed(2);
  const hasAnyHandle = !!(payerVenmo || payerCashapp || payerZelle);

  const venmoHref = payerVenmo
    ? `https://account.venmo.com/pay?recipients=${encodeURIComponent(payerVenmo)}&amount=${amountStr}&note=${note}&txn=pay`
    : null;
  const cashappHref = payerCashapp
    ? `https://cash.app/$${encodeURIComponent(payerCashapp)}/${amountStr}`
    : null;

  const handleCopyZelle = () => {
    if (!payerZelle) return;
    navigator.clipboard.writeText(payerZelle);
    onCopyZelle();
  };

  return (
    <div className="p-3 bg-muted/40 rounded-lg border space-y-3">
      <div className="flex items-center gap-3 text-sm font-medium">
        <ArrowRight className="w-4 h-4 text-primary shrink-0" />
        <span>{debtorName} owes {payerName} <span className="font-mono">${amountStr}</span></span>
      </div>
      {hasAnyHandle && (
        <div className="flex flex-wrap gap-2 pl-7">
          {venmoHref && (
            <a
              href={venmoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#3D95CE] text-white text-xs font-semibold hover:bg-[#3486bd] transition-colors"
              data-testid={`pay-venmo-${debtorName}`}
            >
              Pay with Venmo
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
              Pay with Cash App
            </a>
          )}
          {payerZelle && (
            <button
              type="button"
              onClick={handleCopyZelle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#6D1ED4] text-white text-xs font-semibold hover:bg-[#5e16bc] transition-colors"
              data-testid={`pay-zelle-${debtorName}`}
            >
              <Copy className="w-3 h-3" /> Copy Zelle handle
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

  useEffect(() => {
    setParticipantId(readStoredParticipantId(code));
    setShowPicker(false);
  }, [code]);

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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
            <Receipt className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold font-sans">The Bill is Settled</h1>
          <p className="text-muted-foreground text-lg">
            {results.merchantName || "Dinner"} &bull; Total: ${results.totalBill.toFixed(2)}
          </p>
        </div>

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

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Who pays whom</CardTitle>
            <CardDescription>{results.payerName} paid the restaurant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.participants.length === 0 ? (
              <p className="text-muted-foreground italic">No payments needed!</p>
            ) : (
              results.participants
                .filter(p => p.name !== results.payerName && p.totalOwed > 0)
                .map(p => (
                  <SettlementRow
                    key={p.participantId}
                    payerName={results.payerName}
                    debtorName={p.name}
                    amount={p.totalOwed}
                    merchantName={results.merchantName}
                    payerVenmo={results.payerVenmo ?? null}
                    payerCashapp={results.payerCashapp ?? null}
                    payerZelle={results.payerZelle ?? null}
                    onCopyZelle={() => toast({
                      title: "Zelle handle copied",
                      description: `Open your bank app and send $${p.totalOwed.toFixed(2)} to ${results.payerZelle}`,
                    })}
                  />
                ))
            )}
            {results.participants.filter(p => p.name !== results.payerName && p.totalOwed > 0).length === 0 && (
              <p className="text-muted-foreground italic">No payments needed!</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Full Breakdown</CardTitle>
            <CardDescription>Tax/tip/fees of ${results.totalFees.toFixed(2)} split evenly</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Items Ordered</th>
                  <th className="pb-3 pr-4 font-medium text-right">Food Subtotal</th>
                  <th className="pb-3 pr-4 font-medium text-right">Share of Fees</th>
                  <th className="pb-3 font-medium text-right">Total Owed</th>
                </tr>
              </thead>
              <tbody>
                {results.participants.map(p => (
                  <tr
                    key={p.participantId}
                    className={`border-b last:border-0 ${p.participantId === participantId ? "bg-primary/5" : ""}`}
                  >
                    <td className="py-3 pr-4 font-medium">
                      {p.name}
                      {p.isHost && <span className="ml-1 text-xs text-muted-foreground">(Host)</span>}
                      {p.participantId === participantId && <span className="ml-1 text-xs text-primary">(You)</span>}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {p.itemsEaten.length > 0 ? p.itemsEaten.join(", ") : <span className="italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono">${p.foodSubtotal.toFixed(2)}</td>
                    <td className="py-3 pr-4 text-right font-mono">${p.feesShare.toFixed(2)}</td>
                    <td className="py-3 text-right font-mono font-bold">${p.totalOwed.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="pt-3 pr-4">Total</td>
                  <td className="pt-3 pr-4" />
                  <td className="pt-3 pr-4 text-right font-mono">
                    ${results.participants.reduce((s, p) => s + p.foodSubtotal, 0).toFixed(2)}
                  </td>
                  <td className="pt-3 pr-4 text-right font-mono">${results.totalFees.toFixed(2)}</td>
                  <td className="pt-3 text-right font-mono">${results.totalBill.toFixed(2)}</td>
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
