import { FieldOps } from "@/components/fieldops";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <FieldOps initialReviewQuotationId={typeof query.q === "string" ? query.q : undefined} />;
}
