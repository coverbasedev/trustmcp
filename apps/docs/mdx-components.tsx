import type { MDXComponents } from "mdx/types";
import Link from "next/link";

// Styling for MDX content (App Router @next/mdx reads this from the project root).
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (p) => <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900" {...p} />,
    h2: (p) => <h2 className="mt-10 border-b border-slate-200 pb-2 text-2xl font-semibold text-slate-900" {...p} />,
    h3: (p) => <h3 className="mt-6 text-lg font-semibold text-slate-900" {...p} />,
    p: (p) => <p className="mt-4 leading-7 text-slate-700" {...p} />,
    ul: (p) => <ul className="mt-4 list-disc space-y-1 pl-6 text-slate-700" {...p} />,
    ol: (p) => <ol className="mt-4 list-decimal space-y-1 pl-6 text-slate-700" {...p} />,
    li: (p) => <li className="leading-7" {...p} />,
    a: ({ href = "#", ...p }) => (
      <Link href={href} className="font-medium text-indigo-600 hover:underline" {...p} />
    ),
    code: (p) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm text-slate-800" {...p} />,
    pre: (p) => (
      <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100" {...p} />
    ),
    table: (p) => <table className="mt-4 w-full border-collapse text-sm" {...p} />,
    th: (p) => <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold" {...p} />,
    td: (p) => <td className="border-b border-slate-100 px-3 py-2 align-top text-slate-700" {...p} />,
    blockquote: (p) => (
      <blockquote className="mt-4 border-l-4 border-indigo-200 bg-indigo-50/50 py-2 pl-4 text-slate-700" {...p} />
    ),
    ...components,
  };
}
