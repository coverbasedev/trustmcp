import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { saveFaqs } from "../actions";

export const dynamic = "force-dynamic";

export default async function FaqPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { faqs } = await trustmcp().getOwnerFaqs(vendorId, tc.ownerToken);

  const rows = [...faqs, ...Array(3).fill({ question: "", answer: "" })];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">FAQ</h1>
      <p className="text-sm text-slate-600">
        Frequently asked questions, shown as an accordion on your public trust center. Saving replaces
        the full list; rows without both a question and answer are ignored.
      </p>

      <form action={saveFaqs.bind(null, vendorId)} className="card space-y-4">
        {rows.map((f, i) => (
          <div key={i} className="space-y-1 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
            <input name="question" className="input" defaultValue={f.question} placeholder="Where can I find information about uptime?" />
            <textarea name="answer" className="input min-h-[70px]" defaultValue={f.answer} placeholder="Our status page is available at…" />
          </div>
        ))}
        <button className="btn-primary" type="submit">Save FAQ</button>
      </form>
    </div>
  );
}
