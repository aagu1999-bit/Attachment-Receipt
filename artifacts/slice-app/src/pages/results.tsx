import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  useGetSessionResults, 
  getGetSessionResultsQueryKey
} from "@workspace/api-client-react";
import { Loader2, Receipt, ArrowRight } from "lucide-react";

export default function Results() {
  const params = useParams<{ code: string }>();
  const code = params.code!;
  const [, setLocation] = useLocation();

  const participantIdStr = localStorage.getItem(`slice_participant_${code}`);
  const participantId = participantIdStr ? parseInt(participantIdStr, 10) : null;

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

        {myResult && (
          <Card className="border-primary bg-primary/5 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">Your Share, {myResult.name}</CardTitle>
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
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Who pays whom</CardTitle>
            <CardDescription>{results.payerName} paid the restaurant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.settlements.length === 0 ? (
              <p className="text-muted-foreground italic">No payments needed!</p>
            ) : (
              results.settlements.map((settlement, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border text-sm font-medium">
                  <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                  <span>{settlement}</span>
                </div>
              ))
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

        <div className="pt-4 text-center pb-12">
          <Button variant="outline" size="lg" onClick={() => setLocation("/")}>
            Start a new session
          </Button>
        </div>

      </div>
    </div>
  );
}
