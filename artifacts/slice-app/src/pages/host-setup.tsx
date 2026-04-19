import { useState } from "react";
import { useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload, ArrowRight, Receipt, Plus, Trash2, Loader2, ArrowLeft, Users } from "lucide-react";
import { 
  useCreateSession, 
  useParseReceipt, 
  useUpdateSessionItems,
  useStartSession
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const setupSchema = z.object({
  hostName: z.string().min(1, "Your name is required"),
  payerName: z.string().min(1, "Payer name is required"),
  headcount: z.number().int().min(1, "Must be at least 1 person").max(50, "Max 50 people"),
});

const itemsSchema = z.object({
  merchantName: z.string().optional(),
  items: z.array(z.object({
    name: z.string().min(1, "Name required"),
    unitPrice: z.string().min(1, "Price required"),
    quantity: z.number().min(1).int(),
  })).min(1, "Add at least one item"),
  tax: z.string().min(1, "Tax required"),
  tip: z.string().min(1, "Tip required"),
  otherFees: z.string().min(1, "Fees required"),
});

export default function HostSetup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"details" | "receipt" | "review">("details");
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  
  const createSession = useCreateSession();
  const parseReceipt = useParseReceipt();
  const updateItems = useUpdateSessionItems();
  const startSession = useStartSession();

  const detailsForm = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      hostName: "",
      payerName: "",
      headcount: 2,
    },
  });

  const itemsForm = useForm<z.infer<typeof itemsSchema>>({
    resolver: zodResolver(itemsSchema),
    defaultValues: {
      merchantName: "",
      items: [{ name: "", unitPrice: "0.00", quantity: 1 }],
      tax: "0.00",
      tip: "0.00",
      otherFees: "0.00",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: itemsForm.control,
    name: "items",
  });

  function onDetailsSubmit(values: z.infer<typeof setupSchema>) {
    createSession.mutate({ data: values }, {
      onSuccess: (data) => {
        setSessionCode(data.code);
        localStorage.setItem(`slice_host_${data.code}`, data.hostToken);
        localStorage.setItem(`slice_participant_${data.code}`, String(data.hostParticipantId));
        localStorage.setItem(`slice_token_${data.code}`, data.hostParticipantToken);
        setStep("receipt");
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !sessionCode) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const base64Data = base64.split(",")[1];
      
      parseReceipt.mutate({ code: sessionCode, data: { imageBase64: base64Data } }, {
        onSuccess: (data) => {
          itemsForm.reset({
            merchantName: data.merchantName || "",
            items: data.items,
            tax: data.tax,
            tip: data.tip,
            otherFees: data.otherFees,
          });
          setStep("review");
        },
        onError: (err) => {
          toast({ title: "Error parsing receipt", description: err.message, variant: "destructive" });
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function skipReceipt() {
    setStep("review");
  }

  function onReviewSubmit(values: z.infer<typeof itemsSchema>) {
    if (!sessionCode) return;
    const hostToken = localStorage.getItem(`slice_host_${sessionCode}`);
    if (!hostToken) return;

    updateItems.mutate({ code: sessionCode, data: { hostToken, ...values } }, {
      onSuccess: () => {
        startSession.mutate({ code: sessionCode, data: { hostToken } }, {
          onSuccess: () => {
            setLocation(`/host/${sessionCode}`);
          },
          onError: (err) => {
            toast({ title: "Error starting session", description: err.message, variant: "destructive" });
          }
        });
      },
      onError: (err) => {
        toast({ title: "Error updating items", description: err.message, variant: "destructive" });
      }
    });
  }

  return (
    <div className="min-h-[100dvh] bg-muted/30 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => {
          if (step === "details") setLocation("/");
          else if (step === "review") setStep("receipt");
          else setStep("details");
        }}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>

        {step === "details" && (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-2xl">Session Details</CardTitle>
              <CardDescription>Tell us about your group before sharing the link.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...detailsForm}>
                <form onSubmit={detailsForm.handleSubmit(onDetailsSubmit)} className="space-y-6">
                  <FormField
                    control={detailsForm.control}
                    name="hostName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Alice" {...field} data-testid="input-host-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={detailsForm.control}
                    name="payerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Who paid the bill?</FormLabel>
                        <FormControl>
                          <Input placeholder="Bob (or Alice)" {...field} data-testid="input-payer-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={detailsForm.control}
                    name="headcount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          How many people at the table?
                        </FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 rounded-full shrink-0"
                              onClick={() => field.onChange(Math.max(1, field.value - 1))}
                              disabled={field.value <= 1}
                              data-testid="button-headcount-decrement"
                            >
                              <span className="text-lg font-bold leading-none">−</span>
                            </Button>
                            <div className="flex-1 text-center">
                              <span className="text-3xl font-bold" data-testid="text-headcount">{field.value}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {field.value === 1 ? "person" : "people"} • Tax &amp; tip split {field.value === 1 ? "by you" : `${field.value} ways`}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 rounded-full shrink-0"
                              onClick={() => field.onChange(Math.min(50, field.value + 1))}
                              disabled={field.value >= 50}
                              data-testid="button-headcount-increment"
                            >
                              <span className="text-lg font-bold leading-none">+</span>
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={createSession.isPending}
                    data-testid="button-create-session"
                  >
                    {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Continue <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {step === "receipt" && (
          <Card className="border-primary/20 text-center py-12">
            <CardContent className="flex flex-col items-center gap-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Receipt className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Upload Receipt</h3>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  We'll scan your receipt and extract the items automatically.
                </p>
              </div>
              
              <div className="flex flex-col gap-4 w-full max-w-xs">
                <Label 
                  htmlFor="receipt-upload" 
                  className="flex items-center justify-center w-full h-14 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer transition-colors"
                >
                  {parseReceipt.isPending ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Parsing...</>
                  ) : (
                    <><Upload className="w-5 h-5 mr-2" /> Select Image</>
                  )}
                </Label>
                <input 
                  id="receipt-upload" 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={parseReceipt.isPending}
                  data-testid="input-receipt-upload"
                />
                
                <Button variant="outline" onClick={skipReceipt} disabled={parseReceipt.isPending}>
                  Enter manually
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          <Form {...itemsForm}>
            <form onSubmit={itemsForm.handleSubmit(onReviewSubmit)} className="space-y-6">
              <Card className="border-primary/20">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl">Review Items</CardTitle>
                    <CardDescription>Edit the scanned items or add new ones.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", unitPrice: "0.00", quantity: 1 })}>
                    <Plus className="w-4 h-4 mr-2" /> Add Item
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={itemsForm.control}
                    name="merchantName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Restaurant Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Chipotle" {...field} data-testid="input-merchant-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end p-3 bg-muted/30 rounded-lg border">
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Item name</FormLabel>
                              <FormControl>
                                <Input placeholder="Burrito" {...field} data-testid={`input-item-name-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.unitPrice`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Price</FormLabel>
                              <FormControl>
                                <Input className="w-20" placeholder="9.99" {...field} data-testid={`input-item-price-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Qty</FormLabel>
                              <FormControl>
                                <Input
                                  className="w-16"
                                  type="number"
                                  min={1}
                                  {...field}
                                  onChange={e => field.onChange(parseInt(e.target.value, 10) || 1)}
                                  data-testid={`input-item-qty-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 self-end"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                          data-testid={`button-remove-item-${index}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-lg">Fees &amp; Charges</CardTitle>
                  <CardDescription>These are split evenly across all {detailsForm.getValues("headcount")} people.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  <FormField
                    control={itemsForm.control}
                    name="tax"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tax ($)</FormLabel>
                        <FormControl>
                          <Input placeholder="2.50" {...field} data-testid="input-tax" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={itemsForm.control}
                    name="tip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tip ($)</FormLabel>
                        <FormControl>
                          <Input placeholder="5.00" {...field} data-testid="input-tip" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={itemsForm.control}
                    name="otherFees"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Other ($)</FormLabel>
                        <FormControl>
                          <Input placeholder="0.00" {...field} data-testid="input-other-fees" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Button
                type="submit"
                size="lg"
                className="w-full h-14 text-lg"
                disabled={updateItems.isPending || startSession.isPending}
                data-testid="button-start-session"
              >
                {(updateItems.isPending || startSession.isPending) ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Open Session <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}
