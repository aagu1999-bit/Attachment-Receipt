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
import { Upload, ArrowRight, Receipt, Plus, Trash2, Loader2, ArrowLeft } from "lucide-react";
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
              <CardDescription>Who's hosting and who paid the bill?</CardDescription>
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
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={createSession.isPending}
                    data-testid="button-create-session"
                  >
                    {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Continue
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
                        <FormLabel>Merchant Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Restaurant Name" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="space-y-4 mt-6">
                    <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground px-1">
                      <div className="col-span-1">Qty</div>
                      <div className="col-span-7">Item</div>
                      <div className="col-span-3">Price</div>
                      <div className="col-span-1"></div>
                    </div>
                    
                    {fields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.quantity`}
                          render={({ field }) => (
                            <div className="col-span-2 sm:col-span-1">
                              <Input type="number" min="1" {...field} onChange={e => field.onChange(Number(e.target.value))} className="px-1 text-center" />
                            </div>
                          )}
                        />
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.name`}
                          render={({ field }) => (
                            <div className="col-span-6 sm:col-span-7">
                              <Input placeholder="Item name" {...field} />
                            </div>
                          )}
                        />
                        <FormField
                          control={itemsForm.control}
                          name={`items.${index}.unitPrice`}
                          render={({ field }) => (
                            <div className="col-span-3">
                              <Input placeholder="0.00" {...field} />
                            </div>
                          )}
                        />
                        <div className="col-span-1 flex justify-end">
                          <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4 mt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <FormField
                        control={itemsForm.control}
                        name="tax"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tax</FormLabel>
                            <FormControl>
                              <Input placeholder="0.00" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={itemsForm.control}
                        name="tip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tip</FormLabel>
                            <FormControl>
                              <Input placeholder="0.00" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={itemsForm.control}
                        name="otherFees"
                        render={({ field }) => (
                          <FormItem className="col-span-2 sm:col-span-1">
                            <FormLabel>Other Fees</FormLabel>
                            <FormControl>
                              <Input placeholder="0.00" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
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