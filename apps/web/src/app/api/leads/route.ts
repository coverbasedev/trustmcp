import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// Unauthenticated lead capture for the /resources landing page. The page works
// without a submission, so this endpoint only ever records contact details.
const LeadInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email").max(320),
  company: z.string().trim().min(1, "Company is required").max(200),
  source: z.string().trim().max(100).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = LeadInput.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "invalid input";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { name, email, company, source } = parsed.data;
  await db.lead.create({
    data: { name, email: email.toLowerCase(), company, source: source ?? "resources" },
  });

  return NextResponse.json({ ok: true });
}
